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
from app.database import get_db
from app.models import User
from app.schemas import TokenResponse, UserCreate, UserLogin, UserResponse


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)):
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


@router.post("/login", response_model=TokenResponse)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = find_user_by_identifier(db, payload.email)
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username, email, or password")

    assert_user_can_authenticate(user)

    if user.department != payload.department:
        department_label = DEPARTMENT_LABELS.get(user.department, user.department.title())
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"This account belongs to {department_label}.")

    mark_user_login(db, user)
    return TokenResponse(access_token=create_access_token(user.id), user=user)


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return current_user
