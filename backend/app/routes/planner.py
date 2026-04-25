from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import PlannerItem, User
from app.schemas import PlannerItemCreate, PlannerItemResponse, PlannerItemUpdate


router = APIRouter(prefix="/planner", tags=["planner"])


def _planner_item_response(item: PlannerItem) -> PlannerItemResponse:
    return PlannerItemResponse(
        id=item.id,
        kind=item.kind if item.kind == "break" else "task",
        title=item.title,
        notes=item.notes,
        startedAt=item.started_at,
        dueAt=item.due_at,
        completedAt=item.completed_at,
        verifiedAt=item.verified_at,
        alertedAt=item.alerted_at,
        createdAt=item.created_at,
        updatedAt=item.updated_at,
    )


def _apply_planner_payload(item: PlannerItem, payload: PlannerItemCreate | PlannerItemUpdate) -> None:
    item.kind = payload.kind if payload.kind == "break" else "task"
    item.title = payload.title.strip()
    item.notes = payload.notes.strip()
    item.started_at = payload.startedAt
    item.due_at = payload.dueAt
    item.completed_at = payload.completedAt
    item.verified_at = payload.verifiedAt
    item.alerted_at = payload.alertedAt


def _user_planner_item(db: Session, *, item_id: int, user_id: int) -> PlannerItem | None:
    return db.scalar(select(PlannerItem).where(PlannerItem.id == item_id, PlannerItem.user_id == user_id))


@router.get("/items", response_model=list[PlannerItemResponse])
def list_planner_items(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = db.scalars(
        select(PlannerItem)
        .where(PlannerItem.user_id == current_user.id)
        .order_by(PlannerItem.verified_at.is_(None).desc(), PlannerItem.due_at.asc(), PlannerItem.id.desc())
    ).all()
    return [_planner_item_response(item) for item in items]


@router.post("/items", response_model=PlannerItemResponse, status_code=status.HTTP_201_CREATED)
def create_planner_item(payload: PlannerItemCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = PlannerItem(user_id=current_user.id)
    _apply_planner_payload(item, payload)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _planner_item_response(item)


@router.put("/items/{item_id}", response_model=PlannerItemResponse)
def update_planner_item(item_id: int, payload: PlannerItemUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = _user_planner_item(db, item_id=item_id, user_id=current_user.id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Planner item not found")

    _apply_planner_payload(item, payload)
    db.commit()
    db.refresh(item)
    return _planner_item_response(item)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_planner_item(item_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = _user_planner_item(db, item_id=item_id, user_id=current_user.id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Planner item not found")

    db.delete(item)
    db.commit()
