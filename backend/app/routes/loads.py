from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Load, User
from app.schemas import LoadCreate, LoadResponse, LoadUpdate


router = APIRouter(prefix="/loads", tags=["loads"])


@router.get("", response_model=list[LoadResponse])
def list_loads(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.scalars(select(Load).where(Load.user_id == current_user.id).order_by(Load.id.desc())).all()


@router.post("", response_model=LoadResponse, status_code=status.HTTP_201_CREATED)
def create_load(payload: LoadCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    load = Load(user_id=current_user.id, **payload.model_dump())
    db.add(load)
    db.commit()
    db.refresh(load)
    return load


@router.put("/{load_id}", response_model=LoadResponse)
def update_load(load_id: int, payload: LoadUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    load = db.scalar(select(Load).where(Load.id == load_id, Load.user_id == current_user.id))
    if not load:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Load not found")

    for field, value in payload.model_dump().items():
        setattr(load, field, value)

    db.commit()
    db.refresh(load)
    return load


@router.delete("/{load_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_load(load_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    load = db.scalar(select(Load).where(Load.id == load_id, Load.user_id == current_user.id))
    if not load:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Load not found")

    db.delete(load)
    db.commit()
