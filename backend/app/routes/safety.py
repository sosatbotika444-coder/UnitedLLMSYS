from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_user_department
from app.database import get_db
from app.models import SafetyNote, User
from app.schemas import SafetyNoteResponse, SafetyNoteUpdate


router = APIRouter(prefix="/safety", tags=["safety"])


@router.get("/notes", response_model=SafetyNoteResponse)
def get_safety_notes(current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    note = db.scalar(select(SafetyNote).where(SafetyNote.user_id == current_user.id))
    if not note:
        return SafetyNoteResponse(content="", updated_at=None)
    return note


@router.put("/notes", response_model=SafetyNoteResponse)
def save_safety_notes(payload: SafetyNoteUpdate, current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    note = db.scalar(select(SafetyNote).where(SafetyNote.user_id == current_user.id))
    if not note:
        note = SafetyNote(user_id=current_user.id, content=payload.content)
        db.add(note)
    else:
        note.content = payload.content

    db.commit()
    db.refresh(note)
    return note
