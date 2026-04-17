from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import hash_password, normalize_email, normalize_username, require_user_department
from app.database import get_db
from app.models import (
    FuelAuthorization,
    Load,
    RoutingRequest,
    SafetyDocument,
    SafetyInvestigationCase,
    SafetyShiftBrief,
    TeamChatMessage,
    User,
)
from app.schemas import AdminPasswordReset, AdminUserCreate, AdminUserRow, AdminUserUpdate


router = APIRouter(prefix="/admin", tags=["admin"])


def _count(db: Session, model: type, *where) -> int:
    statement = select(func.count()).select_from(model)
    if where:
        statement = statement.where(*where)
    return int(db.scalar(statement) or 0)


def _count_by_user(db: Session, model: type, user_ids: list[int]) -> dict[int, int]:
    if not user_ids:
        return {}
    rows = db.execute(select(model.user_id, func.count()).where(model.user_id.in_(user_ids)).group_by(model.user_id)).all()
    return {int(user_id): int(total) for user_id, total in rows}


def _serialize_user(user: User, counts: dict[str, dict[int, int]] | None = None) -> AdminUserRow:
    counts = counts or {}
    return AdminUserRow(
        id=user.id,
        email=user.email,
        username=user.username,
        full_name=user.full_name,
        department=user.department,
        is_banned=bool(user.is_banned),
        ban_reason=user.ban_reason or "",
        created_at=user.created_at,
        updated_at=user.updated_at,
        last_login_at=user.last_login_at,
        load_count=counts.get("loads", {}).get(user.id, 0),
        routing_request_count=counts.get("routing", {}).get(user.id, 0),
        fuel_authorization_count=counts.get("fuel_authorizations", {}).get(user.id, 0),
        chat_message_count=counts.get("chat", {}).get(user.id, 0),
    )


def _users_with_counts(db: Session, users: list[User]) -> list[AdminUserRow]:
    user_ids = [user.id for user in users]
    counts = {
        "loads": _count_by_user(db, Load, user_ids),
        "routing": _count_by_user(db, RoutingRequest, user_ids),
        "fuel_authorizations": _count_by_user(db, FuelAuthorization, user_ids),
        "chat": _count_by_user(db, TeamChatMessage, user_ids),
    }
    return [_serialize_user(user, counts) for user in users]


def _ensure_not_last_admin(db: Session, user: User) -> None:
    if user.department != "admin":
        return
    other_active_admins = _count(db, User, User.department == "admin", User.is_banned.is_(False), User.id != user.id)
    if other_active_admins < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one active admin account must remain")


def _find_existing_identity(db: Session, email: str, username: str | None, exclude_user_id: int | None = None) -> User | None:
    conditions = [func.lower(User.email) == email]
    if username:
        conditions.append(func.lower(User.username) == username)
    statement = select(User).where(or_(*conditions))
    if exclude_user_id:
        statement = statement.where(User.id != exclude_user_id)
    return db.scalar(statement)


def _apply_integrity_error(exc: IntegrityError) -> None:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email or username already exists") from exc


@router.get("/overview")
def admin_overview(
    _: User = Depends(require_user_department("admin")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    department_rows = db.execute(select(User.department, func.count()).group_by(User.department)).all()
    users_by_department = {str(department or "unknown"): int(total) for department, total in department_rows}

    auth_status = {
        "total": _count(db, User),
        "active": _count(db, User, User.is_banned.is_(False)),
        "banned": _count(db, User, User.is_banned.is_(True)),
        "admins": users_by_department.get("admin", 0),
    }

    fuel_rows = db.execute(select(FuelAuthorization.status, func.count()).group_by(FuelAuthorization.status)).all()
    fuel_authorizations_by_status = {str(item_status or "unknown"): int(total) for item_status, total in fuel_rows}

    recent_users = db.scalars(select(User).order_by(User.id.desc()).limit(8)).all()
    recent_logins = db.scalars(select(User).where(User.last_login_at.is_not(None)).order_by(User.last_login_at.desc()).limit(8)).all()

    return {
        "users": auth_status,
        "usersByDepartment": users_by_department,
        "operations": {
            "loads": _count(db, Load),
            "routingRequests": _count(db, RoutingRequest),
            "fuelAuthorizations": _count(db, FuelAuthorization),
            "teamMessages": _count(db, TeamChatMessage),
            "safetyDocuments": _count(db, SafetyDocument),
            "safetyCases": _count(db, SafetyInvestigationCase),
            "safetyBriefs": _count(db, SafetyShiftBrief),
        },
        "fuelAuthorizationsByStatus": fuel_authorizations_by_status,
        "recentUsers": _users_with_counts(db, recent_users),
        "recentLogins": _users_with_counts(db, recent_logins),
    }


@router.get("/users", response_model=list[AdminUserRow])
def list_admin_users(
    search: str = Query(default="", max_length=255),
    department: str = Query(default="all", max_length=32),
    status_filter: str = Query(default="all", alias="status", max_length=32),
    limit: int = Query(default=100, ge=1, le=250),
    _: User = Depends(require_user_department("admin")),
    db: Session = Depends(get_db),
):
    statement = select(User)
    if department != "all":
        statement = statement.where(User.department == department)
    if status_filter == "banned":
        statement = statement.where(User.is_banned.is_(True))
    elif status_filter == "active":
        statement = statement.where(User.is_banned.is_(False))

    term = search.strip().casefold()
    if term:
        like_term = f"%{term}%"
        statement = statement.where(
            or_(
                func.lower(User.email).like(like_term),
                func.lower(func.coalesce(User.username, "")).like(like_term),
                func.lower(User.full_name).like(like_term),
                func.lower(User.department).like(like_term),
            )
        )

    users = db.scalars(statement.order_by(User.id.desc()).limit(limit)).all()
    return _users_with_counts(db, users)


@router.post("/users", response_model=AdminUserRow, status_code=status.HTTP_201_CREATED)
def create_admin_user(
    payload: AdminUserCreate,
    _: User = Depends(require_user_department("admin")),
    db: Session = Depends(get_db),
):
    email = normalize_email(payload.email)
    username = normalize_username(payload.username)
    if _find_existing_identity(db, email, username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email or username already exists")

    user = User(
        email=email,
        username=username,
        full_name=payload.full_name.strip(),
        department=payload.department,
        hashed_password=hash_password(payload.password),
        is_banned=False,
        ban_reason="",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        _apply_integrity_error(exc)
    db.refresh(user)
    return _serialize_user(user)


@router.patch("/users/{user_id}", response_model=AdminUserRow)
def update_admin_user(
    user_id: int,
    payload: AdminUserUpdate,
    current_user: User = Depends(require_user_department("admin")),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    changes = payload.model_dump(exclude_unset=True)
    next_department = changes.get("department", user.department)
    if user.id == current_user.id:
        if changes.get("is_banned"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot ban your own admin account")
        if next_department != "admin":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot remove admin access from your own account")
    elif user.department == "admin" and next_department != "admin":
        _ensure_not_last_admin(db, user)

    next_email = normalize_email(str(changes.get("email", user.email)))
    next_username = normalize_username(changes.get("username", user.username)) if "username" in changes else user.username
    existing = _find_existing_identity(db, next_email, next_username, exclude_user_id=user.id)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email or username already exists")

    if "email" in changes:
        user.email = next_email
    if "username" in changes:
        user.username = next_username
    if "full_name" in changes and changes["full_name"] is not None:
        user.full_name = changes["full_name"].strip()
    if "department" in changes and changes["department"] is not None:
        user.department = changes["department"]
    if "is_banned" in changes and changes["is_banned"] is not None:
        if changes["is_banned"] and user.department == "admin":
            _ensure_not_last_admin(db, user)
        user.is_banned = bool(changes["is_banned"])
        if not user.is_banned:
            user.ban_reason = ""
    if "ban_reason" in changes and changes["ban_reason"] is not None:
        user.ban_reason = changes["ban_reason"].strip()

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        _apply_integrity_error(exc)
    db.refresh(user)
    return _serialize_user(user)


@router.post("/users/{user_id}/reset-password", response_model=AdminUserRow)
def reset_admin_user_password(
    user_id: int,
    payload: AdminPasswordReset,
    _: User = Depends(require_user_department("admin")),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.hashed_password = hash_password(payload.password)
    db.commit()
    db.refresh(user)
    return _serialize_user(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_user(
    user_id: int,
    current_user: User = Depends(require_user_department("admin")),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own admin account")
    _ensure_not_last_admin(db, user)
    db.delete(user)
    db.commit()
