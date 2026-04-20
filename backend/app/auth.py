from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import User


pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
bearer_scheme = HTTPBearer()
settings = get_settings()
DEPARTMENT_LABELS = {
    "admin": "Admin",
    "fuel": "Fuel Service",
    "safety": "Safety",
    "driver": "Driver",
}


def normalize_username(value: str | None) -> str | None:
    username = "".join(ch for ch in str(value or "").strip().casefold() if ch.isalnum() or ch in {"_", "-", "."})
    return username[:80] or None


def normalize_email(value: str) -> str:
    return str(value or "").strip().casefold()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(user_id: int) -> str:
    payload = {"sub": str(user_id)}
    if settings.access_token_expire_minutes > 0:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
        payload["exp"] = expire
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def find_user_by_identifier(db: Session, identifier: str) -> User | None:
    cleaned = str(identifier or "").strip()
    if not cleaned:
        return None
    lowered = cleaned.casefold()
    username = normalize_username(cleaned)
    conditions = [func.lower(User.email) == lowered]
    if username:
        conditions.append(func.lower(User.username) == username)
    return db.scalar(select(User).where(or_(*conditions)))


def ensure_admin_user(db: Session) -> User | None:
    if not settings.admin_bootstrap_enabled:
        return None

    username = normalize_username(settings.admin_username) or "redevil"
    email = normalize_email(settings.admin_email or f"{username}@admin.unitedlanellc.com")
    password = settings.admin_password or "reddevil"

    user = db.scalar(select(User).where(or_(func.lower(User.username) == username, func.lower(User.email) == email)))
    if not user:
        user = User(
            email=email,
            username=username,
            full_name="Admin",
            department="admin",
            hashed_password=hash_password(password),
            is_banned=False,
            ban_reason="",
        )
        db.add(user)
    else:
        user.email = email
        user.username = username
        user.department = "admin"
        user.full_name = user.full_name or "Admin"
        user.hashed_password = hash_password(password)
        user.is_banned = False
        user.ban_reason = ""

    db.commit()
    db.refresh(user)
    return user


def assert_user_can_authenticate(user: User) -> None:
    if getattr(user, "is_banned", False):
        reason = (getattr(user, "ban_reason", "") or "Contact the administrator.").strip()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This account is banned. {reason}",
        )


def mark_user_login(db: Session, user: User) -> None:
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Session is no longer valid.",
    )

    try:
        decode_options = {"verify_exp": settings.access_token_expire_minutes > 0}
        payload = jwt.decode(
            credentials.credentials,
            settings.secret_key,
            algorithms=["HS256"],
            options=decode_options,
        )
        user_id = int(payload.get("sub", "0"))
    except (JWTError, ValueError):
        raise unauthorized

    user = db.get(User, user_id)
    if not user:
        raise unauthorized
    assert_user_can_authenticate(user)
    return user


def require_user_department(*allowed_departments: str):
    allowed = {department.strip().lower() for department in allowed_departments if department.strip()}

    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.department == "admin":
            return current_user
        if current_user.department not in allowed:
            allowed_labels = ", ".join(DEPARTMENT_LABELS.get(item, item.title()) for item in sorted(allowed))
            current_label = DEPARTMENT_LABELS.get(current_user.department, current_user.department.title())
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This account belongs to {current_label}. Access is limited to {allowed_labels}.",
            )
        return current_user

    return dependency
