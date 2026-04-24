from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.activity import record_activity_event
from app.auth import get_optional_user
from app.database import get_db
from app.models import User
from app.schemas import ActivityEventCreate


router = APIRouter(prefix="/activity", tags=["activity"])


@router.post("/events", status_code=status.HTTP_204_NO_CONTENT)
def create_activity_event(
    payload: ActivityEventCreate,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    record_activity_event(
        db,
        user=current_user,
        session_id=payload.sessionId,
        event_type=payload.eventType,
        event_name=payload.eventName,
        page=payload.page,
        workspace=payload.workspace,
        label=payload.label,
        details=payload.details,
    )
    db.commit()
