from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import User, UserActivityEvent
from app.schemas import ActivityEventResponse, AdminLiveSnapshot, AdminLiveUser


def _trim_text(value: Any, max_length: int) -> str:
    return str(value or "").strip()[:max_length]


def _compact_details(details: Any) -> dict[str, Any]:
    if not isinstance(details, dict):
        return {}

    compact: dict[str, Any] = {}
    for raw_key, raw_value in list(details.items())[:12]:
        key = _trim_text(raw_key, 64)
        if not key:
            continue
        if raw_value is None or isinstance(raw_value, (bool, int, float)):
            compact[key] = raw_value
            continue
        if isinstance(raw_value, str):
            compact[key] = _trim_text(raw_value, 255)
            continue
        if isinstance(raw_value, (list, tuple)):
            compact[key] = [
                _trim_text(item, 80) if not isinstance(item, (bool, int, float)) else item
                for item in list(raw_value)[:8]
            ]
            continue
        compact[key] = _trim_text(raw_value, 255)
    return compact


def record_activity_event(
    db: Session,
    *,
    user: User | None = None,
    session_id: str = "",
    event_type: str,
    event_name: str = "",
    page: str = "",
    workspace: str = "",
    label: str = "",
    details: dict[str, Any] | None = None,
    actor_name: str = "",
    actor_email: str = "",
    department: str = "",
) -> UserActivityEvent:
    event = UserActivityEvent(
        user_id=user.id if user else None,
        actor_name=_trim_text(actor_name or getattr(user, "full_name", "") or "Visitor", 255),
        actor_email=_trim_text(actor_email or getattr(user, "email", ""), 255),
        department=_trim_text(department or getattr(user, "department", "") or "guest", 32) or "guest",
        session_id=_trim_text(session_id, 120),
        event_type=_trim_text(event_type, 64) or "activity",
        event_name=_trim_text(event_name, 120),
        page=_trim_text(page, 255),
        workspace=_trim_text(workspace, 80),
        label=_trim_text(label, 255),
        details=_compact_details(details or {}),
    )
    db.add(event)
    return event


def summarize_activity_event(event: UserActivityEvent) -> str:
    label = _trim_text(event.label, 255)
    workspace = _trim_text(event.workspace, 80)
    page = _trim_text(event.page, 255)
    event_name = _trim_text(event.event_name, 120)

    if event.event_type == "click":
        return f"Clicked {label or event_name or 'control'}"
    if event.event_type == "workspace_view":
        return f"Opened {label or workspace or page or event_name or 'workspace'}"
    if event.event_type == "page_enter":
        return f"Entered {label or page or 'site'}"
    if event.event_type == "login":
        return "Signed in"
    if event.event_type == "session_end":
        return "Signed out"
    if event.event_type == "heartbeat":
        return f"Still active in {workspace or page or 'workspace'}"
    if event_name and label:
        return f"{event_name}: {label}"
    if event_name:
        return event_name
    if label:
        return label
    return _trim_text(event.event_type.replace("_", " ").title(), 120)


def serialize_activity_event(event: UserActivityEvent) -> ActivityEventResponse:
    return ActivityEventResponse(
        id=event.id,
        actorName=event.actor_name or "Visitor",
        actorEmail=event.actor_email or "",
        department=event.department or "guest",
        sessionId=event.session_id or "",
        eventType=event.event_type or "activity",
        eventName=event.event_name or "",
        page=event.page or "",
        workspace=event.workspace or "",
        label=event.label or "",
        summary=summarize_activity_event(event),
        details=event.details or {},
        createdAt=event.created_at,
    )


def _session_key(event: UserActivityEvent) -> str:
    if event.session_id:
        return f"session:{event.session_id}"
    if event.user_id:
        return f"user:{event.user_id}"
    if event.actor_email:
        return f"email:{event.actor_email.casefold()}"
    return f"guest:{event.id}"


def build_live_activity_snapshot(
    db: Session,
    *,
    limit: int = 60,
    online_window_minutes: int = 5,
) -> AdminLiveSnapshot:
    now = datetime.now(timezone.utc)
    online_cutoff = now - timedelta(minutes=max(1, online_window_minutes))
    recent_action_cutoff = now - timedelta(hours=1)
    login_cutoff = now - timedelta(hours=24)

    online_events = db.scalars(
        select(UserActivityEvent)
        .where(UserActivityEvent.created_at >= online_cutoff)
        .order_by(UserActivityEvent.created_at.desc(), UserActivityEvent.id.desc())
        .limit(250)
    ).all()

    recent_events = db.scalars(
        select(UserActivityEvent)
        .where(UserActivityEvent.event_type != "heartbeat")
        .order_by(UserActivityEvent.created_at.desc(), UserActivityEvent.id.desc())
        .limit(max(10, min(limit, 120)))
    ).all()

    actions_last_hour = int(
        db.scalar(
            select(func.count())
            .select_from(UserActivityEvent)
            .where(UserActivityEvent.created_at >= recent_action_cutoff, UserActivityEvent.event_type != "heartbeat")
        )
        or 0
    )
    logins_last_day = int(
        db.scalar(
            select(func.count())
            .select_from(UserActivityEvent)
            .where(UserActivityEvent.created_at >= login_cutoff, UserActivityEvent.event_type == "login")
        )
        or 0
    )

    online_users_by_session: dict[str, AdminLiveUser] = {}
    for event in online_events:
        key = _session_key(event)
        if key in online_users_by_session:
            continue
        online_users_by_session[key] = AdminLiveUser(
            actorName=event.actor_name or "Visitor",
            actorEmail=event.actor_email or "",
            department=event.department or "guest",
            sessionId=event.session_id or "",
            currentPage=event.page or "",
            currentWorkspace=event.workspace or "",
            lastEventType=event.event_type or "activity",
            lastEventLabel=summarize_activity_event(event),
            lastSeenAt=event.created_at,
            isGuest=not bool(event.user_id),
        )

    online_users = list(online_users_by_session.values())
    online_users.sort(
        key=lambda item: item.lastSeenAt or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )

    return AdminLiveSnapshot(
        onlineSessions=len(online_users),
        guestSessions=sum(1 for item in online_users if item.isGuest),
        actionsLastHour=actions_last_hour,
        loginsLast24Hours=logins_last_day,
        onlineUsers=online_users[:24],
        recentEvents=[serialize_activity_event(event) for event in recent_events],
    )
