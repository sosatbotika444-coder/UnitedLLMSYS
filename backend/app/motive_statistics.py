from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import MotiveVehicleDailyStat


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _motive_zone() -> ZoneInfo:
    zone_name = getattr(get_settings(), "motive_time_zone", "America/New_York") or "America/New_York"
    try:
        return ZoneInfo(zone_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _parse_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value or "").strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _snapshot_recorded_at(snapshot: dict) -> datetime:
    return _parse_datetime(snapshot.get("fetched_at")) or _now_utc()


def _local_date(value: datetime | None = None) -> date:
    return (value or _now_utc()).astimezone(_motive_zone()).date()


def _today_key(value: datetime | None = None) -> str:
    return _local_date(value).isoformat()


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


def _vehicle_number(vehicle: dict) -> str:
    return str(vehicle.get("number") or vehicle.get("vin") or f"Vehicle {vehicle.get('id') or ''}").strip()


def _vehicle_driver_name(vehicle: dict) -> str:
    driver = vehicle.get("resolved_driver") or vehicle.get("driver") or vehicle.get("permanent_driver") or {}
    return str(driver.get("full_name") or "Unassigned").strip() or "Unassigned"


def _vehicle_fuel_percent(vehicle: dict) -> float | None:
    location = vehicle.get("location") or {}
    for key in (
        "fuel_level_percent",
        "fuel_primary_remaining_percentage",
        "fuel_remaining_percentage",
        "fuel_percentage",
    ):
        parsed = _safe_float(location.get(key))
        if parsed is not None:
            return parsed
    return None


def _vehicle_odometer(vehicle: dict) -> float | None:
    location = vehicle.get("location") or {}
    return _safe_float(location.get("true_odometer")) or _safe_float(location.get("odometer"))


def _vehicle_engine_hours(vehicle: dict) -> float | None:
    location = vehicle.get("location") or {}
    return _safe_float(location.get("true_engine_hours")) or _safe_float(location.get("engine_hours"))


def _vehicle_speed_mph(vehicle: dict) -> float | None:
    return _safe_float((vehicle.get("location") or {}).get("speed_mph"))


def _vehicle_active_faults(vehicle: dict) -> int:
    return _safe_int((vehicle.get("fault_summary") or {}).get("active_count"), 0)


def _vehicle_utilization_pct(vehicle: dict) -> float | None:
    return _safe_float((vehicle.get("utilization_summary") or {}).get("utilization_percentage"))


def _vehicle_drive_miles_7d(vehicle: dict) -> float | None:
    return _safe_float((vehicle.get("driving_summary") or {}).get("distance_miles"))


def _vehicle_idle_hours_7d(vehicle: dict) -> float | None:
    seconds = _safe_float((vehicle.get("idle_summary") or {}).get("duration_seconds"))
    if seconds is None:
        return None
    return round(seconds / 3600, 1)


def _vehicle_ifta_miles_30d(vehicle: dict) -> float | None:
    return _safe_float((vehicle.get("ifta_summary") or {}).get("distance_miles"))


def _vehicle_mpg(vehicle: dict) -> float | None:
    direct_mpg = _safe_float(vehicle.get("mpg"))
    if direct_mpg is not None and direct_mpg > 0:
        return round(direct_mpg, 2)

    total_distance = _safe_float((vehicle.get("utilization_summary") or {}).get("total_distance_miles"))
    total_fuel = _safe_float((vehicle.get("utilization_summary") or {}).get("total_fuel"))
    if total_distance is not None and total_fuel not in (None, 0):
        return round(total_distance / total_fuel, 2)

    drive_distance = _safe_float((vehicle.get("driving_summary") or {}).get("distance_miles"))
    drive_fuel = _safe_float((vehicle.get("utilization_summary") or {}).get("driving_fuel"))
    if drive_distance is not None and drive_fuel not in (None, 0):
        return round(drive_distance / drive_fuel, 2)

    return None


def _daily_delta(end_value: float | None, start_value: float | None) -> float:
    if end_value is None or start_value is None:
        return 0.0
    if end_value < start_value:
        return 0.0
    return round(end_value - start_value, 1)


def _parse_snapshot_date(value: str) -> date | None:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _average_speed_7d(vehicle: dict) -> float | None:
    miles = _safe_float((vehicle.get("driving_summary") or {}).get("distance_miles"))
    seconds = _safe_float((vehicle.get("driving_summary") or {}).get("duration_seconds"))
    if miles is None or seconds in (None, 0):
        return None
    hours = seconds / 3600
    if hours <= 0:
        return None
    return round(miles / hours, 1)


def _trend_points(rows: list[MotiveVehicleDailyStat], limit: int = 14) -> list[dict]:
    return [
        {
            "date": row.snapshot_date,
            "miles": _daily_delta(row.closing_odometer_miles, row.opening_odometer_miles),
            "opening_odometer_miles": row.opening_odometer_miles,
            "closing_odometer_miles": row.closing_odometer_miles,
            "latest_speed_mph": row.latest_speed_mph,
            "max_speed_mph": row.max_speed_mph,
            "opening_fuel_percent": row.opening_fuel_percent,
            "latest_fuel_percent": row.latest_fuel_percent,
            "min_fuel_percent": row.min_fuel_percent,
            "latest_active_faults": row.latest_active_faults,
            "max_active_faults": row.max_active_faults,
            "last_recorded_at": row.last_recorded_at.isoformat() if row.last_recorded_at else "",
        }
        for row in rows[-limit:]
    ]


def sync_motive_daily_statistics(db: Session, snapshot: dict) -> None:
    vehicles = snapshot.get("vehicles") or []
    vehicle_ids = [_safe_int(vehicle.get("id"), 0) for vehicle in vehicles if _safe_int(vehicle.get("id"), 0) > 0]
    if not vehicle_ids:
        return

    now = _snapshot_recorded_at(snapshot)
    today_key = _today_key(now)
    existing_rows = db.scalars(
        select(MotiveVehicleDailyStat).where(
            MotiveVehicleDailyStat.snapshot_date == today_key,
            MotiveVehicleDailyStat.vehicle_id.in_(vehicle_ids),
        )
    ).all()
    rows_by_vehicle_id = {row.vehicle_id: row for row in existing_rows}
    changed = False

    for vehicle in vehicles:
        vehicle_id = _safe_int(vehicle.get("id"), 0)
        if vehicle_id <= 0:
            continue

        vehicle_number = _vehicle_number(vehicle)
        driver_name = _vehicle_driver_name(vehicle)
        odometer_miles = _vehicle_odometer(vehicle)
        engine_hours = _vehicle_engine_hours(vehicle)
        fuel_percent = _vehicle_fuel_percent(vehicle)
        speed_mph = _vehicle_speed_mph(vehicle)
        active_faults = _vehicle_active_faults(vehicle)
        utilization_pct = _vehicle_utilization_pct(vehicle)
        drive_miles_7d = _vehicle_drive_miles_7d(vehicle)
        idle_hours_7d = _vehicle_idle_hours_7d(vehicle)
        ifta_miles_30d = _vehicle_ifta_miles_30d(vehicle)
        mpg = _vehicle_mpg(vehicle)
        telemetry_age = _safe_float((vehicle.get("location") or {}).get("age_minutes"))
        is_moving = bool(vehicle.get("is_moving"))
        is_stale = bool(vehicle.get("is_stale"))

        row = rows_by_vehicle_id.get(vehicle_id)
        if not row:
            row = MotiveVehicleDailyStat(
                vehicle_id=vehicle_id,
                snapshot_date=today_key,
                vehicle_number=vehicle_number,
                driver_name=driver_name,
                first_recorded_at=now,
                last_recorded_at=now,
                opening_odometer_miles=odometer_miles,
                closing_odometer_miles=odometer_miles,
                opening_engine_hours=engine_hours,
                closing_engine_hours=engine_hours,
                opening_fuel_percent=fuel_percent,
                latest_fuel_percent=fuel_percent,
                min_fuel_percent=fuel_percent,
                latest_speed_mph=speed_mph,
                max_speed_mph=speed_mph,
                latest_mpg=mpg,
                latest_active_faults=active_faults,
                max_active_faults=active_faults,
                latest_utilization_pct=utilization_pct,
                latest_drive_miles_7d=drive_miles_7d,
                latest_idle_hours_7d=idle_hours_7d,
                latest_ifta_miles_30d=ifta_miles_30d,
                telemetry_age_minutes=telemetry_age,
                latest_is_moving=is_moving,
                latest_is_stale=is_stale,
            )
            db.add(row)
            rows_by_vehicle_id[vehicle_id] = row
            changed = True
            continue

        row.vehicle_number = vehicle_number
        row.driver_name = driver_name
        row.last_recorded_at = now
        row.closing_odometer_miles = odometer_miles if odometer_miles is not None else row.closing_odometer_miles
        row.closing_engine_hours = engine_hours if engine_hours is not None else row.closing_engine_hours
        row.latest_fuel_percent = fuel_percent if fuel_percent is not None else row.latest_fuel_percent
        row.min_fuel_percent = min(
            [value for value in [row.min_fuel_percent, fuel_percent] if value is not None],
            default=row.min_fuel_percent,
        )
        row.latest_speed_mph = speed_mph if speed_mph is not None else row.latest_speed_mph
        row.max_speed_mph = max(
            [value for value in [row.max_speed_mph, speed_mph] if value is not None],
            default=row.max_speed_mph,
        )
        row.latest_mpg = mpg if mpg is not None else row.latest_mpg
        row.latest_active_faults = active_faults
        row.max_active_faults = max(row.max_active_faults or 0, active_faults)
        row.latest_utilization_pct = utilization_pct if utilization_pct is not None else row.latest_utilization_pct
        row.latest_drive_miles_7d = drive_miles_7d if drive_miles_7d is not None else row.latest_drive_miles_7d
        row.latest_idle_hours_7d = idle_hours_7d if idle_hours_7d is not None else row.latest_idle_hours_7d
        row.latest_ifta_miles_30d = ifta_miles_30d if ifta_miles_30d is not None else row.latest_ifta_miles_30d
        row.telemetry_age_minutes = telemetry_age if telemetry_age is not None else row.telemetry_age_minutes
        row.latest_is_moving = is_moving
        row.latest_is_stale = is_stale
        changed = True

    if changed:
        try:
            db.commit()
        except IntegrityError:
            db.rollback()


def _load_history_rows(db: Session, vehicle_ids: list[int]) -> dict[int, list[MotiveVehicleDailyStat]]:
    if not vehicle_ids:
        return {}
    rows = db.scalars(
        select(MotiveVehicleDailyStat)
        .where(MotiveVehicleDailyStat.vehicle_id.in_(vehicle_ids))
        .order_by(MotiveVehicleDailyStat.vehicle_id.asc(), MotiveVehicleDailyStat.snapshot_date.asc())
    ).all()
    grouped: dict[int, list[MotiveVehicleDailyStat]] = defaultdict(list)
    for row in rows:
        grouped[row.vehicle_id].append(row)
    return dict(grouped)


def _build_vehicle_statistics_summary(vehicle: dict, history_rows: list[MotiveVehicleDailyStat]) -> dict:
    daily_rows = sorted(history_rows, key=lambda item: item.snapshot_date)
    latest_row = daily_rows[-1] if daily_rows else None
    report_date = _parse_snapshot_date(latest_row.snapshot_date) if latest_row else _local_date()
    report_date = report_date or _local_date()
    week_cutoff = report_date - timedelta(days=6)
    month_cutoff = report_date - timedelta(days=29)
    today_miles = 0.0
    week_miles = 0.0
    month_miles = 0.0
    tracked_miles = 0.0
    max_daily_miles = 0.0

    for row in daily_rows:
        daily_miles = _daily_delta(row.closing_odometer_miles, row.opening_odometer_miles)
        tracked_miles += daily_miles
        max_daily_miles = max(max_daily_miles, daily_miles)
        row_date = _parse_snapshot_date(row.snapshot_date)
        if row_date is None:
            continue
        if row_date == report_date:
            today_miles += daily_miles
        if row_date >= week_cutoff:
            week_miles += daily_miles
        if row_date >= month_cutoff:
            month_miles += daily_miles

    tracked_days = len(daily_rows)
    avg_daily_miles = round(tracked_miles / tracked_days, 1) if tracked_days else 0.0
    average_speed_mph_7d = _average_speed_7d(vehicle)

    return {
        "today_miles": round(today_miles, 1),
        "today_date": report_date.isoformat(),
        "week_miles": round(week_miles, 1),
        "month_miles": round(month_miles, 1),
        "tracked_miles": round(tracked_miles, 1),
        "tracked_days": tracked_days,
        "average_daily_miles": avg_daily_miles,
        "max_daily_miles": round(max_daily_miles, 1),
        "current_speed_mph": _vehicle_speed_mph(vehicle),
        "average_speed_mph_7d": average_speed_mph_7d,
        "archive_started_at": daily_rows[0].snapshot_date if daily_rows else "",
        "archive_last_seen_at": latest_row.last_recorded_at.isoformat() if latest_row and latest_row.last_recorded_at else "",
        "latest_odometer_miles": _vehicle_odometer(vehicle),
        "latest_engine_hours": _vehicle_engine_hours(vehicle),
        "daily_trend_14d": _trend_points(daily_rows, 14),
    }


def _leaderboard_items(
    vehicles: list[dict],
    value_getter,
    *,
    unit: str = "",
    count: int = 6,
    reverse: bool = True,
    drop_empty: bool = True,
) -> list[dict]:
    ranked = []
    for vehicle in vehicles:
        summary = vehicle.get("statistics_summary") or {}
        value = value_getter(vehicle, summary)
        numeric = _safe_float(value)
        if numeric is None and drop_empty:
            continue
        if numeric is None:
            numeric = 0.0
        ranked.append(
            {
                "vehicle_id": vehicle.get("id"),
                "truck_number": _vehicle_number(vehicle),
                "driver_name": _vehicle_driver_name(vehicle),
                "value": round(numeric, 1),
                "unit": unit,
            }
        )
    ranked.sort(key=lambda item: item["value"], reverse=reverse)
    return ranked[:count]


def enrich_snapshot_with_statistics(db: Session, snapshot: dict) -> dict:
    vehicles = snapshot.get("vehicles") or []
    vehicle_ids = [_safe_int(vehicle.get("id"), 0) for vehicle in vehicles if _safe_int(vehicle.get("id"), 0) > 0]
    history_rows_by_vehicle_id = _load_history_rows(db, vehicle_ids)

    enriched_vehicles: list[dict] = []
    first_dates: list[str] = []
    last_timestamps: list[str] = []
    report_dates: list[str] = []
    vehicles_with_history = 0
    vehicle_days = 0

    for vehicle in vehicles:
        vehicle_id = _safe_int(vehicle.get("id"), 0)
        history_rows = history_rows_by_vehicle_id.get(vehicle_id, [])
        summary = _build_vehicle_statistics_summary(vehicle, history_rows)
        next_vehicle = dict(vehicle)
        next_vehicle["statistics_summary"] = summary
        enriched_vehicles.append(next_vehicle)

        if history_rows:
            vehicles_with_history += 1
            vehicle_days += len(history_rows)
            first_dates.append(history_rows[0].snapshot_date)
            if summary.get("today_date"):
                report_dates.append(str(summary["today_date"]))
            if history_rows[-1].last_recorded_at:
                last_timestamps.append(history_rows[-1].last_recorded_at.isoformat())

    total_today_miles = round(sum((vehicle.get("statistics_summary") or {}).get("today_miles") or 0 for vehicle in enriched_vehicles), 1)
    total_week_miles = round(sum((vehicle.get("statistics_summary") or {}).get("week_miles") or 0 for vehicle in enriched_vehicles), 1)
    total_month_miles = round(sum((vehicle.get("statistics_summary") or {}).get("month_miles") or 0 for vehicle in enriched_vehicles), 1)
    total_tracked_miles = round(sum((vehicle.get("statistics_summary") or {}).get("tracked_miles") or 0 for vehicle in enriched_vehicles), 1)

    moving_speeds = [
        _safe_float((vehicle.get("statistics_summary") or {}).get("current_speed_mph"))
        for vehicle in enriched_vehicles
        if vehicle.get("is_moving")
    ]
    moving_speeds = [value for value in moving_speeds if value is not None]

    avg_speed_now = round(sum(moving_speeds) / len(moving_speeds), 1) if moving_speeds else None
    avg_speed_7d_values = [
        _safe_float((vehicle.get("statistics_summary") or {}).get("average_speed_mph_7d"))
        for vehicle in enriched_vehicles
    ]
    avg_speed_7d_values = [value for value in avg_speed_7d_values if value is not None]
    avg_speed_7d = round(sum(avg_speed_7d_values) / len(avg_speed_7d_values), 1) if avg_speed_7d_values else None

    statistics = {
        "archive": {
            "first_tracked_at": min(first_dates) if first_dates else "",
            "last_tracked_at": max(last_timestamps) if last_timestamps else "",
            "reporting_day": max(report_dates) if report_dates else _today_key(),
            "vehicle_days": vehicle_days,
            "vehicles_with_history": vehicles_with_history,
        },
        "totals": {
            "today_miles": total_today_miles,
            "week_miles": total_week_miles,
            "month_miles": total_month_miles,
            "tracked_miles": total_tracked_miles,
            "avg_speed_now_mph": avg_speed_now,
            "avg_speed_7d_mph": avg_speed_7d,
        },
        "leaders": {
            "today_miles": _leaderboard_items(enriched_vehicles, lambda _vehicle, summary: summary.get("today_miles"), unit="mi"),
            "week_miles": _leaderboard_items(enriched_vehicles, lambda _vehicle, summary: summary.get("week_miles"), unit="mi"),
            "month_miles": _leaderboard_items(enriched_vehicles, lambda _vehicle, summary: summary.get("month_miles"), unit="mi"),
            "speed_now": _leaderboard_items(enriched_vehicles, lambda _vehicle, summary: summary.get("current_speed_mph"), unit="mph"),
            "faults": _leaderboard_items(enriched_vehicles, lambda vehicle, _summary: _vehicle_active_faults(vehicle), count=6, unit="", reverse=True, drop_empty=False),
            "fuel_low": _leaderboard_items(enriched_vehicles, lambda vehicle, _summary: _vehicle_fuel_percent(vehicle), unit="%", reverse=False),
        },
    }

    return {
        **snapshot,
        "vehicles": enriched_vehicles,
        "statistics": statistics,
    }


def build_vehicle_statistics_detail(db: Session, vehicle: dict) -> dict:
    vehicle_id = _safe_int(vehicle.get("id"), 0)
    history_rows = _load_history_rows(db, [vehicle_id]).get(vehicle_id, [])
    summary = _build_vehicle_statistics_summary(vehicle, history_rows)
    return {
        **summary,
        "daily_history": _trend_points(history_rows, 60),
        "coverage": {
            "tracked_days": summary.get("tracked_days") or 0,
            "archive_started_at": summary.get("archive_started_at") or "",
            "archive_last_seen_at": summary.get("archive_last_seen_at") or "",
            "reporting_day": summary.get("today_date") or "",
        },
    }
