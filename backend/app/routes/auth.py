from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import (
    DEPARTMENT_LABELS,
    assert_user_can_authenticate,
    create_access_token,
    find_user_by_identifier,
    hash_password,
    mark_user_login,
    normalize_email,
    verify_password,
    get_current_user,
)
from app.config import get_settings
from app.database import get_db
from app.models import MotiveApiConnection, User
from app.routes.motive import DEFAULT_MOTIVE_CONNECTION_NAME, sync_motive_login_selection
from app.schemas import MotiveKeyOption, TokenResponse, UserCreate, UserLogin, UserResponse


router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


def _motive_key_options(db: Session) -> list[MotiveKeyOption]:
    names: list[str] = []
    seen: set[str] = set()

    def add_name(value: object) -> None:
        name = str(value or "").strip()[:160]
        if not name:
            return
        key = name.casefold()
        if key in seen:
            return
        seen.add(key)
        names.append(name)

    add_name(DEFAULT_MOTIVE_CONNECTION_NAME)
    rows = db.scalars(
        select(MotiveApiConnection.name)
        .join(User, User.id == MotiveApiConnection.user_id)
        .where(MotiveApiConnection.is_active.is_(True), User.department == "admin")
        .order_by(MotiveApiConnection.name.asc())
    ).all()
    for name in rows:
        add_name(name)

    return [MotiveKeyOption(name=name) for name in names]


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    if not settings.public_registration_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public registration is disabled. Accounts are created by Admin only.",
        )
    if payload.department == "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin accounts can only be created from the admin panel")

    email = normalize_email(payload.email)
    existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    user = User(
        email=email,
        full_name=payload.full_name,
        department=payload.department,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered") from exc

    db.refresh(user)
    mark_user_login(db, user)
    return TokenResponse(access_token=create_access_token(user.id), user=user)


@router.get("/motive-key-options", response_model=list[MotiveKeyOption])
def motive_key_options(db: Session = Depends(get_db)):
    return _motive_key_options(db)


@router.post("/login", response_model=TokenResponse)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = find_user_by_identifier(db, payload.email)
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username, email, or password")

    assert_user_can_authenticate(user)

    if user.department != payload.department:
        department_label = DEPARTMENT_LABELS.get(user.department, user.department.title())
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"This account belongs to {department_label}.")

    motive_connection_name = (payload.motiveConnectionName or DEFAULT_MOTIVE_CONNECTION_NAME).strip()[:160] or DEFAULT_MOTIVE_CONNECTION_NAME
    user.motive_connection_name = motive_connection_name
    db.add(user)
    db.commit()
    db.refresh(user)
    sync_motive_login_selection(db, user, motive_connection_name)
    mark_user_login(db, user)
    return TokenResponse(access_token=create_access_token(user.id), user=user)


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return current_user
