from datetime import datetime, timezone
import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import TeamChatMessage, User
from app.schemas import TeamChatMessageCreate, TeamChatMessageResponse, TeamChatMessageUpdate


router = APIRouter(prefix="/chat", tags=["chat"])
ROOM_PATTERN = re.compile(r"[^a-z0-9_-]+")
DELETED_MESSAGE = "Message deleted"


def _normalize_room(value: str) -> str:
    room = ROOM_PATTERN.sub("-", (value or "general").strip().lower()).strip("-")
    return (room or "general")[:64]


def _clean_body(value: str) -> str:
    body = re.sub(r"\r\n?", "\n", value or "").strip()
    if not body:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message cannot be empty")
    return body


def _users_by_id(db: Session, user_ids: set[int]) -> dict[int, User]:
    ids = {user_id for user_id in user_ids if user_id}
    if not ids:
        return {}
    return {user.id: user for user in db.scalars(select(User).where(User.id.in_(ids))).all()}


def _author_payload(user: User | None, fallback_id: int) -> dict:
    return {
        "id": user.id if user else fallback_id,
        "fullName": (user.full_name if user else "Unknown user") or "Unknown user",
        "email": (user.email if user else "") or "",
        "department": (user.department if user else "fuel") or "fuel",
    }


def _reply_payload(message: TeamChatMessage | None, users_by_id: dict[int, User]) -> dict | None:
    if not message:
        return None
    author = users_by_id.get(message.user_id)
    return {
        "id": message.id,
        "body": DELETED_MESSAGE if message.is_deleted else message.body,
        "authorName": (author.full_name if author else "Unknown user") or "Unknown user",
        "department": (author.department if author else "fuel") or "fuel",
        "createdAt": message.created_at,
        "isDeleted": message.is_deleted,
    }


def _message_payload(
    message: TeamChatMessage,
    current_user: User,
    users_by_id: dict[int, User],
    replies_by_id: dict[int, TeamChatMessage],
) -> TeamChatMessageResponse:
    reply = replies_by_id.get(message.reply_to_id or 0)
    return TeamChatMessageResponse(
        id=message.id,
        room=message.room,
        body=DELETED_MESSAGE if message.is_deleted else message.body,
        author=_author_payload(users_by_id.get(message.user_id), message.user_id),
        replyTo=_reply_payload(reply, users_by_id),
        isOwn=message.user_id == current_user.id,
        isDeleted=message.is_deleted,
        createdAt=message.created_at,
        updatedAt=message.updated_at,
        editedAt=message.edited_at,
    )


def _hydrate_messages(db: Session, messages: list[TeamChatMessage], current_user: User) -> list[TeamChatMessageResponse]:
    reply_ids = {message.reply_to_id for message in messages if message.reply_to_id}
    replies = db.scalars(select(TeamChatMessage).where(TeamChatMessage.id.in_(reply_ids))).all() if reply_ids else []
    replies_by_id = {message.id: message for message in replies}
    user_ids = {message.user_id for message in messages} | {message.user_id for message in replies}
    users_by_id = _users_by_id(db, user_ids)
    return [_message_payload(message, current_user, users_by_id, replies_by_id) for message in messages]


@router.get("/messages", response_model=list[TeamChatMessageResponse])
def list_team_chat_messages(
    room: str = Query(default="general", min_length=1, max_length=64),
    limit: int = Query(default=80, ge=1, le=200),
    after_id: int | None = Query(default=None, ge=1),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    normalized_room = _normalize_room(room)
    query = select(TeamChatMessage).where(TeamChatMessage.room == normalized_room)
    if after_id:
        messages = db.scalars(query.where(TeamChatMessage.id > after_id).order_by(TeamChatMessage.id.asc()).limit(limit)).all()
    else:
        latest = db.scalars(query.order_by(TeamChatMessage.id.desc()).limit(limit)).all()
        messages = list(reversed(latest))
    return _hydrate_messages(db, messages, current_user)


@router.post("/messages", response_model=TeamChatMessageResponse, status_code=status.HTTP_201_CREATED)
def create_team_chat_message(
    payload: TeamChatMessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _normalize_room(payload.room)
    body = _clean_body(payload.body)
    reply_to = None
    if payload.replyToId:
        reply_to = db.get(TeamChatMessage, payload.replyToId)
        if not reply_to or reply_to.room != room:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reply message not found")

    message = TeamChatMessage(room=room, user_id=current_user.id, body=body, reply_to_id=payload.replyToId if reply_to else None)
    db.add(message)
    db.commit()
    db.refresh(message)
    return _hydrate_messages(db, [message], current_user)[0]


@router.put("/messages/{message_id}", response_model=TeamChatMessageResponse)
def update_team_chat_message(
    message_id: int,
    payload: TeamChatMessageUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    message = db.get(TeamChatMessage, message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if message.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the author can edit this message")
    if message.is_deleted:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Deleted messages cannot be edited")

    message.body = _clean_body(payload.body)
    message.edited_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(message)
    return _hydrate_messages(db, [message], current_user)[0]


@router.delete("/messages/{message_id}", response_model=TeamChatMessageResponse)
def delete_team_chat_message(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    message = db.get(TeamChatMessage, message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if message.user_id != current_user.id and current_user.department not in {"safety", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the author, Safety, or Admin can delete this message")

    message.is_deleted = True
    message.body = DELETED_MESSAGE
    message.edited_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(message)
    return _hydrate_messages(db, [message], current_user)[0]
