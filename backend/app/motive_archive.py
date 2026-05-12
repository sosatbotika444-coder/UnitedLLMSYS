from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import MotiveSnapshotRun, MotiveVehicleChangeEvent, MotiveVehicleSnapshot


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _clean_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _safe_float(value: object) -> float | None:
    if value in (None, ""):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if numeric == numeric else None


def _safe_int(value: object, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _parse_datetime(value: object) -> datetime | None:
    text = _clean_text(value)
    if not text:
        return None
    normalized = text.replace(" UTC", "+00:00").replace("UTC", "+00:00")
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        for fmt in (
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%dT%H:%M:%S.%f%z",
            "%Y-%m-%d %H:%M:%S%z",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d",
        ):
            try:
                parsed = datetime.strptime(normalized, fmt)
                break
            except ValueError:
                parsed = None
        if parsed is None:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _json_safe(value: object):
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return value


def _iso_datetime(value: datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _payload_diff(before: object, after: object, prefix: str = "") -> dict[str, dict[str, object]]:
    if before == after:
        return {}

    if isinstance(before, dict) and isinstance(after, dict):
        diff: dict[str, dict[str, object]] = {}
        for key in sorted(set(before) | set(after)):
            next_prefix = f"{prefix}.{key}" if prefix else str(key)
            diff.update(_payload_diff(before.get(key), after.get(key), next_prefix))
        return diff

    if isinstance(before, list) and isinstance(after, list):
        if before == after:
            return {}
        return {prefix or "$": {"before": before, "after": after}}

    return {prefix or "$": {"before": before, "after": after}}


def _vehicle_driver_name(vehicle: dict) -> str:
    for source_key in ("resolved_driver", "driver", "permanent_driver"):
        source = vehicle.get(source_key) or {}
        name = _clean_text(source.get("full_name"))
        if name:
            return name
    return ""


def _load_latest_snapshots(db: Session, vehicle_ids: list[int]) -> dict[int, MotiveVehicleSnapshot]:
    if not vehicle_ids:
        return {}

    rows = db.scalars(
        select(MotiveVehicleSnapshot)
        .where(MotiveVehicleSnapshot.vehicle_id.in_(vehicle_ids))
        .order_by(
            MotiveVehicleSnapshot.vehicle_id.asc(),
            MotiveVehicleSnapshot.snapshot_fetched_at.desc(),
            MotiveVehicleSnapshot.id.desc(),
        )
    ).all()

    latest: dict[int, MotiveVehicleSnapshot] = {}
    for row in rows:
        latest.setdefault(row.vehicle_id, row)
    return latest


def sync_motive_vehicle_archive(db: Session, snapshot: dict) -> None:
    vehicles = [item for item in (snapshot.get("vehicles") or []) if _safe_int(item.get("id"), 0) > 0]
    if not vehicles:
        return

    fetched_at = _parse_datetime(snapshot.get("fetched_at")) or _now_utc()
    metrics = dict(snapshot.get("metrics") or {})
    run = MotiveSnapshotRun(
        fetched_at=fetched_at,
        auth_mode=_clean_text(snapshot.get("auth_mode")),
        company_name=_clean_text((snapshot.get("company") or {}).get("name")),
        total_vehicles=_safe_int(metrics.get("total_vehicles"), len(vehicles)),
        moving_vehicles=_safe_int(metrics.get("moving_vehicles"), 0),
        stale_vehicles=_safe_int(metrics.get("stale_vehicles"), 0),
        warning_count=len(snapshot.get("warnings") or []),
        metrics_payload=_json_safe(metrics) or {},
        datasets_payload=_json_safe(snapshot.get("datasets") or {}) or {},
        recent_activity_payload=_json_safe(snapshot.get("recent_activity") or {}) or {},
        warnings_payload=_json_safe(snapshot.get("warnings") or []) or [],
        snapshot_payload=_json_safe(snapshot) or {},
    )
    db.add(run)
    db.flush()

    vehicle_ids = [_safe_int(item.get("id"), 0) for item in vehicles]
    latest_snapshots = _load_latest_snapshots(db, vehicle_ids)

    for vehicle in vehicles:
        vehicle_id = _safe_int(vehicle.get("id"), 0)
        if vehicle_id <= 0:
            continue

        payload = _json_safe(vehicle) or {}
        previous_snapshot = latest_snapshots.get(vehicle_id)
        previous_payload = dict(previous_snapshot.payload or {}) if previous_snapshot else {}
        diff_payload = _payload_diff(previous_payload, payload)
        location = vehicle.get("location") or {}
        fault_summary = vehicle.get("fault_summary") or {}
        utilization_summary = vehicle.get("utilization_summary") or {}
        driving_summary = vehicle.get("driving_summary") or {}
        idle_summary = vehicle.get("idle_summary") or {}
        ifta_summary = vehicle.get("ifta_summary") or {}

        vehicle_snapshot = MotiveVehicleSnapshot(
            snapshot_run_id=run.id,
            vehicle_id=vehicle_id,
            snapshot_fetched_at=fetched_at,
            vehicle_number=_clean_text(vehicle.get("number")),
            vin=_clean_text(vehicle.get("vin")),
            status=_clean_text(vehicle.get("status")),
            availability_status=_clean_text(vehicle.get("availability_status")),
            driver_name=_vehicle_driver_name(vehicle),
            driver_source=_clean_text(vehicle.get("driver_source")),
            make=_clean_text(vehicle.get("make")),
            model=_clean_text(vehicle.get("model")),
            year=_clean_text(vehicle.get("year")),
            fuel_type=_clean_text(vehicle.get("fuel_type")),
            license_plate_number=_clean_text(vehicle.get("license_plate_number")),
            license_plate_state=_clean_text(vehicle.get("license_plate_state")),
            location_label=_clean_text(location.get("display_label") or location.get("address") or location.get("description")),
            location_city=_clean_text(location.get("city")),
            location_state=_clean_text(location.get("state")),
            location_lat=_safe_float(location.get("lat")),
            location_lon=_safe_float(location.get("lon")),
            location_located_at=_parse_datetime(location.get("located_at")),
            telemetry_age_minutes=_safe_float(location.get("age_minutes")),
            speed_mph=_safe_float(location.get("speed_mph")),
            odometer_miles=_safe_float(location.get("true_odometer")) or _safe_float(location.get("odometer")),
            engine_hours=_safe_float(location.get("true_engine_hours")) or _safe_float(location.get("engine_hours")),
            fuel_level_percent=_safe_float(location.get("fuel_level_percent")),
            range_remaining=_safe_float(location.get("range_remaining")),
            battery_voltage=_safe_float(location.get("battery_voltage")),
            mpg=_safe_float(vehicle.get("mpg")),
            active_fault_count=_safe_int(fault_summary.get("active_count"), 0),
            severe_fault_count=_safe_int(fault_summary.get("severe_count"), 0),
            utilization_pct=_safe_float(utilization_summary.get("utilization_percentage")),
            drive_miles_7d=_safe_float(driving_summary.get("distance_miles")),
            idle_hours_7d=(
                round((_safe_float(idle_summary.get("duration_seconds")) or 0) / 3600, 1)
                if idle_summary.get("duration_seconds") not in (None, "")
                else None
            ),
            ifta_miles_30d=_safe_float(ifta_summary.get("distance_miles")),
            is_moving=bool(vehicle.get("is_moving")),
            is_stale=bool(vehicle.get("is_stale")),
            payload=payload,
        )
        db.add(vehicle_snapshot)
        db.flush()

        if not previous_snapshot or diff_payload:
            change_event = MotiveVehicleChangeEvent(
                snapshot_run_id=run.id,
                vehicle_snapshot_id=vehicle_snapshot.id,
                previous_snapshot_id=previous_snapshot.id if previous_snapshot else None,
                vehicle_id=vehicle_id,
                vehicle_number=_clean_text(vehicle.get("number")),
                snapshot_fetched_at=fetched_at,
                change_kind="created" if previous_snapshot is None else "updated",
                change_count=len(diff_payload),
                changed_fields=sorted(diff_payload.keys()),
                diff_payload=diff_payload,
            )
            db.add(change_event)

    db.commit()


def build_latest_motive_snapshot(db: Session) -> dict | None:
    """Rebuild the latest fleet snapshot from PostgreSQL without calling Motive."""
    run = db.scalars(
        select(MotiveSnapshotRun)
        .order_by(MotiveSnapshotRun.fetched_at.desc(), MotiveSnapshotRun.id.desc())
        .limit(1)
    ).first()
    if not run:
        return None

    snapshot_payload = dict(getattr(run, "snapshot_payload", None) or {})
    if isinstance(snapshot_payload.get("vehicles"), list):
        snapshot_payload["configured"] = True
        snapshot_payload["auth_mode"] = snapshot_payload.get("auth_mode") or run.auth_mode or "postgres"
        snapshot_payload["fetched_at"] = snapshot_payload.get("fetched_at") or _iso_datetime(run.fetched_at)
        if not snapshot_payload.get("company") and run.company_name:
            snapshot_payload["company"] = {"name": run.company_name}
        cache = dict(snapshot_payload.get("cache") or {})
        cache.update({
            "source": "postgres",
            "snapshot_run_id": run.id,
            "loaded_at": _iso_datetime(_now_utc()),
        })
        snapshot_payload["cache"] = cache
        return snapshot_payload

    vehicle_rows = db.scalars(
        select(MotiveVehicleSnapshot)
        .where(MotiveVehicleSnapshot.snapshot_run_id == run.id)
        .order_by(MotiveVehicleSnapshot.vehicle_number.asc(), MotiveVehicleSnapshot.vehicle_id.asc())
    ).all()
    vehicles: list[dict] = []
    for row in vehicle_rows:
        payload = dict(row.payload or {})
        payload.setdefault("id", row.vehicle_id)
        payload.setdefault("number", row.vehicle_number)
        payload.setdefault("vin", row.vin)
        payload.setdefault("status", row.status)
        payload.setdefault("availability_status", row.availability_status)
        payload.setdefault("driver_source", row.driver_source)
        payload.setdefault("make", row.make)
        payload.setdefault("model", row.model)
        payload.setdefault("year", row.year)
        payload.setdefault("fuel_type", row.fuel_type)
        payload.setdefault("license_plate_number", row.license_plate_number)
        payload.setdefault("license_plate_state", row.license_plate_state)
        vehicles.append(payload)

    metrics = dict(run.metrics_payload or {})
    if not metrics:
        metrics = {
            "total_vehicles": run.total_vehicles,
            "moving_vehicles": run.moving_vehicles,
            "stale_vehicles": run.stale_vehicles,
        }

    return {
        "configured": True,
        "auth_mode": run.auth_mode or "postgres",
        "fetched_at": _iso_datetime(run.fetched_at),
        "company": {"name": run.company_name} if run.company_name else None,
        "windows": {},
        "metrics": metrics,
        "datasets": dict(run.datasets_payload or {}),
        "drivers": [],
        "vehicles": vehicles,
        "recent_activity": dict(run.recent_activity_payload or {}),
        "warnings": list(run.warnings_payload or []),
        "cache": {
            "source": "postgres",
            "snapshot_run_id": run.id,
            "loaded_at": _iso_datetime(_now_utc()),
        },
    }


def _serialize_snapshot(row: MotiveVehicleSnapshot) -> dict:
    return {
        "id": row.id,
        "snapshotRunId": row.snapshot_run_id,
        "vehicleId": row.vehicle_id,
        "vehicleNumber": row.vehicle_number,
        "driverName": row.driver_name,
        "status": row.status,
        "availabilityStatus": row.availability_status,
        "snapshotFetchedAt": row.snapshot_fetched_at.isoformat() if row.snapshot_fetched_at else "",
        "location": {
            "label": row.location_label,
            "city": row.location_city,
            "state": row.location_state,
            "lat": row.location_lat,
            "lon": row.location_lon,
            "locatedAt": row.location_located_at.isoformat() if row.location_located_at else "",
        },
        "telemetry": {
            "speedMph": row.speed_mph,
            "odometerMiles": row.odometer_miles,
            "engineHours": row.engine_hours,
            "fuelLevelPercent": row.fuel_level_percent,
            "rangeRemaining": row.range_remaining,
            "batteryVoltage": row.battery_voltage,
            "mpg": row.mpg,
            "utilizationPct": row.utilization_pct,
            "driveMiles7d": row.drive_miles_7d,
            "idleHours7d": row.idle_hours_7d,
            "iftaMiles30d": row.ifta_miles_30d,
        },
        "flags": {
            "isMoving": row.is_moving,
            "isStale": row.is_stale,
            "activeFaultCount": row.active_fault_count,
            "severeFaultCount": row.severe_fault_count,
        },
        "payload": row.payload or {},
        "createdAt": row.created_at.isoformat() if row.created_at else "",
    }


def _serialize_change(row: MotiveVehicleChangeEvent) -> dict:
    return {
        "id": row.id,
        "snapshotRunId": row.snapshot_run_id,
        "vehicleSnapshotId": row.vehicle_snapshot_id,
        "previousSnapshotId": row.previous_snapshot_id,
        "vehicleId": row.vehicle_id,
        "vehicleNumber": row.vehicle_number,
        "snapshotFetchedAt": row.snapshot_fetched_at.isoformat() if row.snapshot_fetched_at else "",
        "changeKind": row.change_kind,
        "changeCount": row.change_count,
        "changedFields": row.changed_fields or [],
        "diff": row.diff_payload or {},
        "createdAt": row.created_at.isoformat() if row.created_at else "",
    }


def build_vehicle_archive(db: Session, vehicle_id: int, limit: int = 25) -> dict:
    total_snapshots = db.scalar(
        select(func.count())
        .select_from(MotiveVehicleSnapshot)
        .where(MotiveVehicleSnapshot.vehicle_id == vehicle_id)
    ) or 0
    total_changes = db.scalar(
        select(func.count())
        .select_from(MotiveVehicleChangeEvent)
        .where(MotiveVehicleChangeEvent.vehicle_id == vehicle_id)
    ) or 0
    snapshots = db.scalars(
        select(MotiveVehicleSnapshot)
        .where(MotiveVehicleSnapshot.vehicle_id == vehicle_id)
        .order_by(MotiveVehicleSnapshot.snapshot_fetched_at.desc(), MotiveVehicleSnapshot.id.desc())
        .limit(limit)
    ).all()
    changes = db.scalars(
        select(MotiveVehicleChangeEvent)
        .where(MotiveVehicleChangeEvent.vehicle_id == vehicle_id)
        .order_by(MotiveVehicleChangeEvent.snapshot_fetched_at.desc(), MotiveVehicleChangeEvent.id.desc())
        .limit(limit)
    ).all()
    latest = snapshots[0] if snapshots else None
    return {
        "vehicleId": vehicle_id,
        "vehicleNumber": latest.vehicle_number if latest else "",
        "snapshotCount": total_snapshots,
        "changeCount": total_changes,
        "returnedSnapshotCount": len(snapshots),
        "returnedChangeCount": len(changes),
        "snapshots": [_serialize_snapshot(row) for row in snapshots],
        "changes": [_serialize_change(row) for row in changes],
    }
