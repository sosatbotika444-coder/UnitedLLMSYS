from datetime import datetime, timezone
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_user_department
from app.config import get_settings
from app.database import get_db
from app.models import MotiveApiConnection, User
from app.motive_archive import build_vehicle_archive
from app.motive import MotiveClient, format_http_error, iso_now, sort_by_recent
from app.motive_export import build_motive_snapshot_workbook
from app.motive_statistics import build_vehicle_statistics_detail, enrich_snapshot_with_statistics
from app.schemas import MotiveApiConnectionCreate, MotiveApiConnectionResponse, MotiveApiConnectionUpdate, MotiveIntegrationStatus


router = APIRouter(prefix="/motive", tags=["motive"])
settings = get_settings()
client = MotiveClient(settings)


def _clean_text(value: object, fallback: str = "") -> str:
    if value is None:
        return fallback
    text = str(value).strip()
    return text or fallback


def _normal_base_url(value: object) -> str:
    return _clean_text(value, settings.motive_api_base_url).rstrip("/") or settings.motive_api_base_url


def _mask_api_key(value: object) -> str:
    secret = _clean_text(value)
    if not secret:
        return ""
    if len(secret) <= 8:
        return "****"
    return f"{secret[:4]}...{secret[-4:]}"


def _iso(value: datetime | None) -> str | None:
    if not value:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _connection_response(row: MotiveApiConnection) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "keyLabel": _mask_api_key(row.api_key),
        "apiBaseUrl": row.api_base_url,
        "metricUnits": bool(row.metric_units),
        "motiveUserId": row.motive_user_id,
        "isActive": bool(row.is_active),
        "lastStatus": row.last_status,
        "lastError": row.last_error,
        "lastSyncedAt": _iso(row.last_synced_at),
        "lastVehicleCount": row.last_vehicle_count,
        "createdAt": _iso(row.created_at),
        "updatedAt": _iso(row.updated_at),
    }


def _connections_for_user(db: Session, user: User, *, active_only: bool = False) -> list[MotiveApiConnection]:
    statement = select(MotiveApiConnection).where(MotiveApiConnection.user_id == user.id)
    if active_only:
        statement = statement.where(MotiveApiConnection.is_active.is_(True))
    return list(db.scalars(statement.order_by(MotiveApiConnection.created_at.asc(), MotiveApiConnection.id.asc())).all())


def _connection_for_user(db: Session, user: User, connection_id: int) -> MotiveApiConnection:
    row = db.scalar(
        select(MotiveApiConnection).where(
            MotiveApiConnection.id == connection_id,
            MotiveApiConnection.user_id == user.id,
        )
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Motive API connection was not found.")
    return row


def _connection_settings(row: MotiveApiConnection):
    return settings.model_copy(
        update={
            "motive_api_base_url": _normal_base_url(row.api_base_url),
            "motive_api_key": row.api_key,
            "motive_access_token": "",
            "motive_refresh_token": "",
            "motive_client_id": "",
            "motive_client_secret": "",
            "motive_redirect_uri": "",
            "motive_metric_units": bool(row.metric_units),
            "motive_user_id": row.motive_user_id,
            "motive_snapshot_disk_cache_enabled": False,
            "motive_background_refresh_enabled": False,
        }
    )


def _source_fields(row: MotiveApiConnection) -> dict:
    return {
        "source_connection_id": row.id,
        "source_connection_name": row.name,
        "source_key_label": _mask_api_key(row.api_key),
    }


def _tag_source_record(row: MotiveApiConnection, record: dict) -> dict:
    tagged = dict(record)
    tagged.update(_source_fields(row))
    return tagged


def _tag_snapshot(row: MotiveApiConnection, snapshot: dict, *, cache_status: str) -> dict:
    tagged = dict(snapshot)
    connection_info = _connection_response(row)
    tagged["connection"] = connection_info
    tagged["fleet_connections"] = [connection_info]
    tagged["source_mode"] = "single_connection"

    cache = dict(tagged.get("cache") or {})
    cache.update({
        "status": cache_status,
        "refreshing": False,
        "served_at": iso_now(),
        "source_connection_id": row.id,
    })
    tagged["cache"] = cache

    vehicles = []
    for index, vehicle in enumerate(snapshot.get("vehicles") or []):
        next_vehicle = _tag_source_record(row, vehicle)
        original_vehicle_id = next_vehicle.get("id")
        next_vehicle["original_vehicle_id"] = original_vehicle_id
        next_vehicle["source_vehicle_key"] = f"{row.id}:{original_vehicle_id if original_vehicle_id is not None else index}"
        vehicles.append(next_vehicle)
    tagged["vehicles"] = vehicles

    tagged["drivers"] = [_tag_source_record(row, item) for item in (snapshot.get("drivers") or []) if isinstance(item, dict)]

    recent_activity = {}
    for key, items in dict(snapshot.get("recent_activity") or {}).items():
        recent_activity[key] = [_tag_source_record(row, item) for item in (items or []) if isinstance(item, dict)]
    tagged["recent_activity"] = recent_activity
    return tagged


def _snapshot_is_ready(snapshot: object) -> bool:
    return isinstance(snapshot, dict) and isinstance(snapshot.get("vehicles"), list)


def _exception_message(prefix: str, exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return format_http_error(prefix, detail, exc.status_code)
    return f"{prefix}: {exc}"


def _refresh_connection_snapshot(
    db: Session,
    row: MotiveApiConnection,
    *,
    refresh: bool = False,
    allow_stale: bool = True,
) -> dict:
    cached_snapshot = row.last_snapshot_payload if _snapshot_is_ready(row.last_snapshot_payload) else None
    if cached_snapshot and not refresh:
        return _tag_snapshot(row, cached_snapshot, cache_status="cached")

    if not row.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This Motive API connection is inactive.")

    try:
        raw_snapshot = MotiveClient(_connection_settings(row))._build_snapshot(light_mode=False, previous_snapshot=None)
    except Exception as exc:
        message = _exception_message("Motive refresh failed", exc)
        row.last_status = "error"
        row.last_error = message
        db.add(row)
        db.commit()
        db.refresh(row)
        if cached_snapshot and allow_stale:
            stale = _tag_snapshot(row, cached_snapshot, cache_status="stale")
            warnings = list(stale.get("warnings") or [])
            warnings.insert(0, f"{row.name}: {message}")
            stale["warnings"] = list(dict.fromkeys(warnings))
            return stale
        status_code = exc.status_code if isinstance(exc, HTTPException) else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(status_code=status_code, detail=f"{row.name}: {message}") from exc

    row.last_snapshot_payload = raw_snapshot
    row.last_status = "synced"
    row.last_error = ""
    row.last_synced_at = datetime.now(timezone.utc)
    row.last_vehicle_count = len(raw_snapshot.get("vehicles") or [])
    db.add(row)
    db.commit()
    db.refresh(row)
    return _tag_snapshot(row, raw_snapshot, cache_status="fresh")


def _empty_multi_snapshot(connections: list[MotiveApiConnection], warnings: list[str]) -> dict:
    return {
        "configured": bool(connections),
        "auth_mode": "multi-api-key",
        "fetched_at": "",
        "company": {"name": "Combined Motive fleet", "account_count": len(connections)},
        "windows": {},
        "metrics": {
            "total_vehicles": 0,
            "located_vehicles": 0,
            "moving_vehicles": 0,
            "stopped_vehicles": 0,
            "online_vehicles": 0,
            "stale_vehicles": 0,
            "vehicles_with_driver": 0,
            "active_drivers": 0,
            "low_fuel_vehicles": 0,
            "active_fault_codes": 0,
            "vehicles_with_faults": 0,
            "performance_events_7d": 0,
            "pending_review_events": 0,
            "idle_hours_7d": 0,
            "driving_miles_7d": 0,
            "ifta_miles_30d": 0,
            "hos_driver_clocks": 0,
            "hos_warning_units": 0,
        },
        "datasets": {},
        "drivers": [],
        "vehicles": [],
        "recent_activity": {},
        "warnings": warnings,
        "fleet_connections": [_connection_response(row) for row in connections],
        "source_mode": "multi_connection",
        "cache": {"status": "empty", "refreshing": False, "served_at": iso_now()},
    }


def _combine_datasets(snapshots: list[dict]) -> dict:
    combined: dict[str, dict] = {}
    for snapshot in snapshots:
        for key, payload in dict(snapshot.get("datasets") or {}).items():
            payload = payload or {}
            current = combined.setdefault(key, {"count": 0, "available": False})
            current["count"] += int(payload.get("count") or 0)
            current["available"] = bool(current["available"] or payload.get("available"))
    return combined


def _combine_metrics(snapshots: list[dict]) -> dict:
    combined: dict[str, int | float | str | None] = {"company_name": "Combined Motive fleet"}
    averages: dict[str, list[float]] = {}
    for snapshot in snapshots:
        for key, value in dict(snapshot.get("metrics") or {}).items():
            if key == "company_name" or isinstance(value, bool):
                continue
            if isinstance(value, (int, float)):
                if key.startswith("average_"):
                    averages.setdefault(key, []).append(float(value))
                else:
                    combined[key] = round(float(combined.get(key) or 0) + float(value), 2)
    for key, values in averages.items():
        combined[key] = round(sum(values) / len(values), 1) if values else None
    return combined


def _combine_recent_activity(snapshots: list[dict]) -> dict:
    combined: dict[str, list[dict]] = {}
    for snapshot in snapshots:
        for key, items in dict(snapshot.get("recent_activity") or {}).items():
            combined.setdefault(key, []).extend([item for item in (items or []) if isinstance(item, dict)])
    sort_keys = ("end_time", "start_time", "last_observed_at", "purchased_at", "submitted_at", "date", "updated_at", "created_at")
    return {key: sort_by_recent(items, *sort_keys)[:40] for key, items in combined.items()}


def _combine_connection_snapshots(snapshots: list[dict], connections: list[MotiveApiConnection], warnings: list[str]) -> dict:
    vehicles = [vehicle for snapshot in snapshots for vehicle in (snapshot.get("vehicles") or [])]
    drivers = [driver for snapshot in snapshots for driver in (snapshot.get("drivers") or [])]
    snapshot_warnings = [warning for snapshot in snapshots for warning in (snapshot.get("warnings") or [])]
    return {
        "configured": True,
        "auth_mode": "multi-api-key",
        "fetched_at": iso_now(),
        "company": {"name": "Combined Motive fleet", "account_count": len(connections)},
        "windows": dict((snapshots[0].get("windows") or {}) if snapshots else {}),
        "metrics": _combine_metrics(snapshots),
        "datasets": _combine_datasets(snapshots),
        "drivers": drivers,
        "vehicles": vehicles,
        "recent_activity": _combine_recent_activity(snapshots),
        "warnings": list(dict.fromkeys(warnings + snapshot_warnings)),
        "fleet_connections": [_connection_response(row) for row in connections],
        "source_mode": "multi_connection",
        "cache": {"status": "combined", "refreshing": False, "served_at": iso_now()},
    }


def _fleet_snapshot_for_user(db: Session, user: User, *, refresh: bool = False, allow_stale: bool = True) -> dict:
    all_connections = _connections_for_user(db, user, active_only=False)
    active_connections = [row for row in all_connections if row.is_active]

    if not all_connections:
        return client.fetch_snapshot(force_refresh=refresh, allow_stale=allow_stale)

    if not active_connections:
        return _empty_multi_snapshot(all_connections, ["No active Motive API connections. Enable at least one key to sync fleet data."])

    snapshots: list[dict] = []
    warnings: list[str] = []
    for row in active_connections:
        try:
            snapshots.append(_refresh_connection_snapshot(db, row, refresh=refresh, allow_stale=allow_stale))
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            warnings.append(detail)

    if not snapshots:
        return _empty_multi_snapshot(active_connections, warnings or ["No Motive snapshots are available yet. Refresh all keys to sync live data."])

    return _combine_connection_snapshots(snapshots, active_connections, warnings)


@router.get("/status", response_model=MotiveIntegrationStatus)
def motive_status(
    current_user: User = Depends(require_user_department("fuel", "statistics")),
    db: Session = Depends(get_db),
):
    connections = _connections_for_user(db, current_user, active_only=False)
    active_count = sum(1 for row in connections if row.is_active)
    status_payload = client.integration_status()
    status_payload.update({
        "configured": bool(active_count) or bool(status_payload.get("configured")),
        "auth_mode": "multi-api-key" if active_count else status_payload.get("auth_mode", "none"),
        "connection_count": len(connections),
        "active_connection_count": active_count,
        "managed_connections": bool(connections),
    })
    return status_payload


@router.get("/connections")
def motive_connections(
    current_user: User = Depends(require_user_department("fuel", "statistics")),
    db: Session = Depends(get_db),
):
    connections = _connections_for_user(db, current_user, active_only=False)
    return {
        "connections": [_connection_response(row) for row in connections],
        "total": len(connections),
        "active": sum(1 for row in connections if row.is_active),
    }


@router.post("/connections", response_model=MotiveApiConnectionResponse)
def create_motive_connection(
    payload: MotiveApiConnectionCreate,
    current_user: User = Depends(require_user_department("fuel", "statistics")),
    db: Session = Depends(get_db),
):
    row = MotiveApiConnection(
        user_id=current_user.id,
        name=_clean_text(payload.name, "Motive account")[:160],
        api_key=payload.apiKey.strip(),
        api_base_url=_normal_base_url(payload.apiBaseUrl),
        metric_units=bool(payload.metricUnits),
        motive_user_id=payload.motiveUserId,
        is_active=bool(payload.isActive),
        last_status="ready",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _connection_response(row)


@router.post("/connections/refresh")
def refresh_motive_connections(
    current_user: User = Depends(require_user_department("fuel", "statistics")),
    db: Session = Depends(get_db),
):
    snapshot = _fleet_snapshot_for_user(db, current_user, refresh=True, allow_stale=True)
    return enrich_snapshot_with_statistics(db, snapshot)


@router.patch("/connections/{connection_id}", response_model=MotiveApiConnectionResponse)
def update_motive_connection(
    payload: MotiveApiConnectionUpdate,
    connection_id: int = Path(..., ge=1),
    current_user: User = Depends(require_user_department("fuel", "statistics")),
    db: Session = Depends(get_db),
):
    row = _connection_for_user(db, current_user, connection_id)
    fields = payload.model_fields_set
    if "name" in fields and payload.name is not None:
        row.name = _clean_text(payload.name, row.name)[:160]
    if "apiKey" in fields and payload.apiKey is not None:
        row.api_key = payload.apiKey.strip()
        row.last_status = "ready"
        row.last_error = ""
        row.last_snapshot_payload = {}
        row.last_vehicle_count = 0
        row.last_synced_at = None
    if "apiBaseUrl" in fields and payload.apiBaseUrl is not None:
        row.api_base_url = _normal_base_url(payload.apiBaseUrl)
    if "metricUnits" in fields and payload.metricUnits is not None:
        row.metric_units = bool(payload.metricUnits)
    if "motiveUserId" in fields:
        row.motive_user_id = payload.motiveUserId
    if "isActive" in fields and payload.isActive is not None:
        row.is_active = bool(payload.isActive)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _connection_response(row)


@router.delete("/connections/{connection_id}")
def delete_motive_connection(
    connection_id: int = Path(..., ge=1),
    current_user: User = Depends(require_user_department("fuel", "statistics")),
    db: Session = Depends(get_db),
):
    row = _connection_for_user(db, current_user, connection_id)
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": connection_id}


@router.post("/connections/{connection_id}/refresh")
def refresh_motive_connection(
    connection_id: int = Path(..., ge=1),
    current_user: User = Depends(require_user_department("fuel", "statistics")),
    db: Session = Depends(get_db),
):
    row = _connection_for_user(db, current_user, connection_id)
    snapshot = _refresh_connection_snapshot(db, row, refresh=True, allow_stale=True)
    return enrich_snapshot_with_statistics(db, snapshot)


@router.get("/fleet")
def motive_fleet(
    refresh: bool = Query(default=False, description="Force a fresh Motive fetch instead of cached snapshot."),
    current_user: User = Depends(require_user_department("fuel", "statistics")),
    db: Session = Depends(get_db),
):
    snapshot = _fleet_snapshot_for_user(db, current_user, refresh=refresh, allow_stale=True)
    return enrich_snapshot_with_statistics(db, snapshot)


@router.get("/vehicles/{vehicle_id}")
def motive_vehicle_detail(
    vehicle_id: int = Path(..., ge=1),
    refresh: bool = Query(default=False, description="Force a fresh fetch for the selected vehicle."),
    connection_id: int | None = Query(default=None, ge=1, description="Saved Motive API connection id for multi-key fleets."),
    current_user: User = Depends(require_user_department("fuel", "statistics")),
    db: Session = Depends(get_db),
):
    if connection_id is not None:
        row = _connection_for_user(db, current_user, connection_id)
        snapshot = _refresh_connection_snapshot(db, row, refresh=refresh, allow_stale=True)
        detail = MotiveClient(_connection_settings(row)).build_vehicle_detail_from_snapshot(snapshot, vehicle_id)
        detail["vehicle"] = _tag_snapshot(row, {"vehicles": [detail.get("vehicle") or {}]}, cache_status="detail")["vehicles"][0]
    else:
        detail = client.fetch_vehicle_detail(vehicle_id=vehicle_id, force_refresh=refresh)
    detail["statistics"] = build_vehicle_statistics_detail(db, detail.get("vehicle") or {})
    return detail


@router.get("/vehicles/{vehicle_id}/history")
def motive_vehicle_history(
    vehicle_id: int = Path(..., ge=1),
    limit: int = Query(default=25, ge=1, le=200, description="How many archived snapshots and change events to return."),
    current_user: User = Depends(require_user_department("fuel", "statistics")),
    db: Session = Depends(get_db),
):
    return build_vehicle_archive(db, vehicle_id=vehicle_id, limit=limit)


@router.get("/export")
def motive_export(
    refresh: bool = Query(default=False, description="Force a fresh Motive fetch before creating the Excel export."),
    current_user: User = Depends(require_user_department("fuel", "statistics")),
    db: Session = Depends(get_db),
):
    snapshot = _fleet_snapshot_for_user(db, current_user, refresh=refresh, allow_stale=not refresh)
    workbook_bytes = build_motive_snapshot_workbook(snapshot)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"motive_tracking_export_{timestamp}.xlsx"
    return StreamingResponse(
        BytesIO(workbook_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )#contnutrh increasing 
