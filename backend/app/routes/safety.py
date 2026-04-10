from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_user_department
from app.config import get_settings
from app.database import get_db
from app.models import SafetyDocument, SafetyNote, User
from app.motive import MotiveClient
from app.safety_documents import SafetyDocumentError, analyze_uploaded_safety_document
from app.safety_fleet import build_safety_fleet_snapshot
from app.schemas import (
    SafetyDocumentResponse,
    SafetyDocumentUpload,
    SafetyNoteResponse,
    SafetyNoteUpdate,
)


router = APIRouter(prefix="/safety", tags=["safety"])
settings = get_settings()
motive_client = MotiveClient(settings)


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


@router.get("/documents", response_model=list[SafetyDocumentResponse])
def list_safety_documents(current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    return db.scalars(select(SafetyDocument).where(SafetyDocument.user_id == current_user.id).order_by(SafetyDocument.created_at.desc(), SafetyDocument.id.desc())).all()


@router.post("/documents", response_model=SafetyDocumentResponse, status_code=status.HTTP_201_CREATED)
def upload_safety_document(payload: SafetyDocumentUpload, current_user: User = Depends(require_user_department("safety")), db: Session = Depends(get_db)):
    try:
        analysis = analyze_uploaded_safety_document(
            file_name=payload.file_name,
            content_type=payload.content_type,
            data_url=payload.data_url,
        )
    except SafetyDocumentError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    document = SafetyDocument(
        user_id=current_user.id,
        file_name=payload.file_name,
        content_type=payload.content_type,
        bucket=analysis.bucket,
        document_type=analysis.document_type,
        summary=analysis.summary,
        issues=analysis.issues,
        recommended_action=analysis.recommended_action,
        excerpt=analysis.excerpt,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("/fleet")
def get_safety_fleet(
    refresh: bool = Query(default=False, description="Force a fresh Motive fetch instead of the cached safety fleet snapshot."),
    current_user: User = Depends(require_user_department("safety")),
):
    snapshot = motive_client.fetch_snapshot(force_refresh=refresh)
    return build_safety_fleet_snapshot(snapshot)
