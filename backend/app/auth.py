from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import User


pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
bearer_scheme = HTTPBearer()
settings = get_settings()
DEPARTMENT_LABELS = {
    "fuel": "Fuel Service",
    "safety": "Safety",
}


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
    )

    try:
        payload = jwt.decode(credentials.credentials, settings.secret_key, algorithms=["HS256"])
        user_id = int(payload.get("sub", "0"))
    except (JWTError, ValueError):
        raise unauthorized

    user = db.get(User, user_id)
    if not user:
        raise unauthorized
    return user


def require_user_department(*allowed_departments: str):
    allowed = {department.strip().lower() for department in allowed_departments if department.strip()}

    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.department not in allowed:
            allowed_labels = ", ".join(DEPARTMENT_LABELS.get(item, item.title()) for item in sorted(allowed))
            current_label = DEPARTMENT_LABELS.get(current_user.department, current_user.department.title())
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This account belongs to {current_label}. Access is limited to {allowed_labels}.",
            )
        return current_user

    return dependency
