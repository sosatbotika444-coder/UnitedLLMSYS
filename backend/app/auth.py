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


def is_admin(user: User | None) -> bool:
    return bool(user and str(getattr(user, "department", "") or "").strip().casefold() == "admin")


def create_access_token(user_id: int) -> str:
    issued_at = datetime.now(timezone.utc)
    expire = issued_at + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": str(user_id),
        "iat": issued_at,
        "exp": expire,
    }
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

    existing_admin = db.scalar(select(User).where(func.lower(User.department) == "admin").order_by(User.id.asc()))
    if existing_admin:
        return existing_admin

    username = normalize_username(settings.admin_username)
    password = str(settings.admin_password or "").strip()
    if not username or not password:
        raise RuntimeError("Admin bootstrap is enabled, but ADMIN_USERNAME and ADMIN_PASSWORD are not fully configured.")

    email = normalize_email(settings.admin_email or f"{username}@admin.unitedlanellc.com")
    conflicting_user = db.scalar(
        select(User).where(or_(func.lower(User.username) == username, func.lower(User.email) == email))
    )
    if conflicting_user:
        if is_admin(conflicting_user):
            return conflicting_user
        raise RuntimeError("Admin bootstrap identifiers already belong to a non-admin account.")

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
        payload = jwt.decode(
            credentials.credentials,
            settings.secret_key,
            algorithms=["HS256"],
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
        if is_admin(current_user):
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
