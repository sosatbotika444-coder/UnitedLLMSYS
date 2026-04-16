from __future__ import annotations

import math
import re
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_user_department
from app.config import get_settings
from app.database import get_db
from app.models import FuelAuthorization, User
from app.motive import MotiveClient
from app.schemas import (
    FuelAuthorizationAction,
    FuelAuthorizationBulkReconcileResponse,
    FuelAuthorizationCreate,
    FuelAuthorizationReconcileResult,
    FuelAuthorizationResponse,
    FuelAuthorizationUpdate,
)

router = APIRouter(prefix="/fuel-authorizations", tags=["fuel-authorizations"])
settings = get_settings()
motive_client = MotiveClient(settings)

OPEN_STATUSES = {"approved", "sent", "violated"}
TERMINAL_STATUSES = {"used", "expired", "cancelled"}
GALLON_TOLERANCE = 1.0
AMOUNT_TOLERANCE = 2.0
PRICE_TOLERANCE = 0.025
DEFAULT_EXPIRATION_HOURS = 24
MATCH_WINDOW_BEFORE_MINUTES = 30
MATCH_WINDOW_AFTER_HOURS = 4


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def ensure_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def parse_datetime(value: object) -> datetime | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    if not text:
        return None
    normalized = text.replace(" UTC", "+00:00").replace("UTC", "+00:00")
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
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


def as_float(value: object) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def as_int(value: object) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def clean_text(value: object) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip())


def normalize_text(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", clean_text(value).lower()).strip()


def round_money(value: float) -> float:
    return round(max(0.0, float(value)), 2)


def round_gallons(value: float) -> float:
    return round(max(0.0, float(value)), 1)


def round_price(value: float | None) -> float | None:
    if value is None:
        return None
    return round(max(0.0, float(value)), 3)


def generate_approval_code(db: Session) -> str:
    prefix = now_utc().strftime("FA-%Y%m%d")
    for _ in range(8):
        code = f"{prefix}-{uuid4().hex[:6].upper()}"
        exists = db.scalar(select(FuelAuthorization.id).where(FuelAuthorization.approval_code == code))
        if not exists:
            return code
    return f"{prefix}-{uuid4().hex[:10].upper()}"


def apply_expiration(record: FuelAuthorization, current_time: datetime | None = None) -> bool:
    current_time = current_time or now_utc()
    expires_at = ensure_aware(record.expires_at)
    if record.status in {"approved", "sent"} and expires_at and expires_at < current_time:
        record.status = "expired"
        details = dict(record.reconciliation_details or {})
        details.setdefault("warnings", [])
        if "Authorization expired before a matching Motive fuel purchase was found." not in details["warnings"]:
            details["warnings"].append("Authorization expired before a matching Motive fuel purchase was found.")
        record.reconciliation_details = details
        record.reconciled_at = current_time
        return True
    return False


def policy_snapshot(payload: FuelAuthorizationCreate, max_gallons: float, max_amount: float, max_price: float | None) -> dict:
    base = dict(payload.policy_snapshot or {})
    base.update({
        "gallon_tolerance": GALLON_TOLERANCE,
        "amount_tolerance": AMOUNT_TOLERANCE,
        "price_tolerance": PRICE_TOLERANCE,
        "max_gallons": max_gallons,
        "max_amount": max_amount,
        "max_price_per_gallon": max_price,
        "expiration_hours": DEFAULT_EXPIRATION_HOURS,
        "station_match_policy": "Vendor/city/state checked when Motive fuel purchase data includes them.",
    })
    return base


def build_driver_message(record: FuelAuthorization) -> str:
    station = record.station_brand or record.station_name or "approved fuel stop"
    max_price = f" at or below ${record.max_price_per_gallon:.3f}/gal" if record.max_price_per_gallon is not None else ""
    amount = f" Max card amount ${record.max_amount:.2f}." if record.max_amount else ""
    expires = ensure_aware(record.expires_at)
    expires_text = f" Approval expires {expires.strftime('%Y-%m-%d %H:%M UTC')}." if expires else ""
    route_text = f" Route: {record.station_map_link}" if record.station_map_link else ""
    return (
        f"Fuel approval {record.approval_code}: Truck {record.vehicle_number or record.vehicle_id or 'unit'} "
        f"is approved to stop at {station}, {record.station_address}. "
        f"Buy up to {record.max_gallons:.1f} gal {record.fuel_type}{max_price}.{amount} "
        f"Use this approved station only, then send the receipt after fueling.{expires_text}{route_text}"
    )


def create_authorization_record(db: Session, current_user: User, payload: FuelAuthorizationCreate) -> FuelAuthorization:
    planned_gallons = round_gallons(payload.planned_gallons)
    if planned_gallons <= 0 and not payload.max_gallons:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Fuel authorization requires planned gallons or max gallons.")

    planned_price = round_price(payload.planned_price_per_gallon)
    if planned_price is None and payload.planned_amount and planned_gallons > 0:
        planned_price = round_price(payload.planned_amount / planned_gallons)

    max_gallons = round_gallons(payload.max_gallons if payload.max_gallons is not None else max(planned_gallons + 5.0, planned_gallons * 1.05))
    max_price = round_price(payload.max_price_per_gallon if payload.max_price_per_gallon is not None else ((planned_price + 0.05) if planned_price is not None else None))
    planned_amount = round_money(payload.planned_amount or ((planned_price or 0.0) * planned_gallons))
    computed_max_amount = max(planned_amount * 1.08, (max_price or planned_price or 0.0) * max_gallons)
    max_amount = round_money(payload.max_amount if payload.max_amount is not None else computed_max_amount)
    if max_amount <= 0 and max_price is not None:
        max_amount = round_money(max_price * max_gallons)

    expires_at = ensure_aware(payload.expires_at) or (now_utc() + timedelta(hours=DEFAULT_EXPIRATION_HOURS))
    approval_time = now_utc() if payload.status in {"approved", "sent"} else None
    sent_time = now_utc() if payload.status == "sent" else None

    record = FuelAuthorization(
        user_id=current_user.id,
        routing_request_id=payload.routing_request_id,
        approval_code=generate_approval_code(db),
        status=payload.status,
        source=payload.source or "route_assistant",
        vehicle_id=payload.vehicle_id,
        vehicle_number=clean_text(payload.vehicle_number),
        driver_name=clean_text(payload.driver_name),
        origin_label=clean_text(payload.origin_label),
        destination_label=clean_text(payload.destination_label),
        route_id=clean_text(payload.route_id),
        route_label=clean_text(payload.route_label),
        station_id=clean_text(payload.station_id),
        station_name=clean_text(payload.station_name),
        station_brand=clean_text(payload.station_brand),
        station_address=clean_text(payload.station_address),
        station_city=clean_text(payload.station_city),
        station_state=clean_text(payload.station_state).upper(),
        station_postal_code=clean_text(payload.station_postal_code),
        station_lat=payload.station_lat,
        station_lon=payload.station_lon,
        station_source_url=clean_text(payload.station_source_url),
        station_map_link=clean_text(payload.station_map_link),
        fuel_type=clean_text(payload.fuel_type) or "Auto Diesel",
        planned_gallons=planned_gallons,
        max_gallons=max_gallons,
        planned_amount=planned_amount,
        max_amount=max_amount,
        planned_price_per_gallon=planned_price,
        max_price_per_gallon=max_price,
        price_target=round_price(payload.price_target),
        fuel_before_gallons=round_gallons(payload.fuel_before_gallons) if payload.fuel_before_gallons is not None else None,
        fuel_after_gallons=round_gallons(payload.fuel_after_gallons) if payload.fuel_after_gallons is not None else None,
        route_miles=round_gallons(payload.route_miles) if payload.route_miles is not None else None,
        miles_to_next=round_gallons(payload.miles_to_next) if payload.miles_to_next is not None else None,
        safety_buffer_miles=round_gallons(payload.safety_buffer_miles) if payload.safety_buffer_miles is not None else None,
        dispatcher_note=clean_text(payload.dispatcher_note),
        driver_message=clean_text(payload.driver_message),
        policy_snapshot=policy_snapshot(payload, max_gallons, max_amount, max_price),
        station_snapshot=dict(payload.station_snapshot or {}),
        strategy_snapshot=dict(payload.strategy_snapshot or {}),
        approved_at=approval_time,
        sent_at=sent_time,
        expires_at=expires_at,
    )
    if not record.driver_message:
        record.driver_message = build_driver_message(record)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def purchase_key(purchase: dict) -> str:
    purchase_id = clean_text(purchase.get("id"))
    if purchase_id:
        return purchase_id
    return "|".join(clean_text(purchase.get(key)) for key in ("vehicle_id", "vehicle_number", "purchased_at", "vendor", "amount", "volume"))


def collect_fuel_purchases(snapshot: dict) -> list[dict]:
    by_key: dict[str, dict] = {}
    for purchase in (snapshot.get("recent_activity") or {}).get("fuel_purchases") or []:
        if isinstance(purchase, dict):
            by_key[purchase_key(purchase)] = purchase
    for vehicle in snapshot.get("vehicles") or []:
        for purchase in ((vehicle.get("previews") or {}).get("fuel_purchases") or []):
            if isinstance(purchase, dict):
                merged = dict(purchase)
                merged.setdefault("vehicle_id", vehicle.get("id"))
                merged.setdefault("vehicle_number", vehicle.get("number"))
                by_key[purchase_key(merged)] = merged
    return list(by_key.values())


def vehicle_matches(record: FuelAuthorization, purchase: dict) -> bool:
    purchase_vehicle_id = as_int(purchase.get("vehicle_id"))
    if record.vehicle_id is not None and purchase_vehicle_id == record.vehicle_id:
        return True
    record_number = normalize_text(record.vehicle_number)
    purchase_number = normalize_text(purchase.get("vehicle_number"))
    if record_number and purchase_number:
        return record_number == purchase_number or record_number in purchase_number or purchase_number in record_number
    return record.vehicle_id is None and not record_number


def station_match_signals(record: FuelAuthorization, purchase: dict) -> tuple[bool, bool, bool]:
    vendor_text = normalize_text(purchase.get("vendor"))
    city_text = normalize_text(purchase.get("city"))
    state_text = normalize_text(purchase.get("state"))
    approved_text = normalize_text(" ".join([record.station_brand, record.station_name, record.station_id]))
    approved_city = normalize_text(record.station_city)
    approved_state = normalize_text(record.station_state)

    tokens = {token for token in approved_text.split() if len(token) >= 4}
    if "love" in approved_text or "loves" in approved_text:
        tokens.update({"love", "loves"})
    if "pilot" in approved_text or "flying" in approved_text:
        tokens.update({"pilot", "flying"})
    vendor_match = bool(vendor_text and tokens and any(token in vendor_text for token in tokens))
    city_match = bool(approved_city and city_text and approved_city == city_text)
    state_match = bool(approved_state and state_text and approved_state == state_text)
    return vendor_match, city_match, state_match


def purchase_score(record: FuelAuthorization, purchase: dict) -> int:
    if not vehicle_matches(record, purchase):
        return -1
    score = 5
    purchased_at = parse_datetime(purchase.get("purchased_at"))
    window_start = (ensure_aware(record.approved_at) or ensure_aware(record.created_at) or now_utc()) - timedelta(minutes=MATCH_WINDOW_BEFORE_MINUTES)
    window_end = (ensure_aware(record.expires_at) or (window_start + timedelta(hours=DEFAULT_EXPIRATION_HOURS))) + timedelta(hours=MATCH_WINDOW_AFTER_HOURS)
    if purchased_at:
        if purchased_at < window_start or purchased_at > window_end:
            return -1
        score += 4
    vendor_match, city_match, state_match = station_match_signals(record, purchase)
    if vendor_match:
        score += 3
    if city_match:
        score += 2
    if state_match:
        score += 1
    if as_float(purchase.get("volume")) is not None:
        score += 1
    return score


def best_purchase_match(record: FuelAuthorization, purchases: list[dict]) -> dict | None:
    scored = [(purchase_score(record, purchase), purchase) for purchase in purchases]
    scored = [(score, purchase) for score, purchase in scored if score >= 5]
    if not scored:
        return None
    scored.sort(key=lambda item: (item[0], parse_datetime(item[1].get("purchased_at")) or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
    return scored[0][1]


def purchase_unit_price(purchase: dict) -> float | None:
    unit_price = as_float(purchase.get("unit_price"))
    if unit_price is not None:
        return round_price(unit_price)
    amount = as_float(purchase.get("amount"))
    volume = as_float(purchase.get("volume"))
    if amount is not None and volume and volume > 0:
        return round_price(amount / volume)
    return None


def reconcile_record(db: Session, record: FuelAuthorization, snapshot: dict) -> FuelAuthorizationReconcileResult:
    status_before = record.status
    if record.status == "cancelled":
        return FuelAuthorizationReconcileResult(
            authorization=FuelAuthorizationResponse.model_validate(record),
            status_before=status_before,
            status_after=record.status,
            matched=False,
            warnings=["Cancelled authorizations are not reconciled."],
        )

    purchases = collect_fuel_purchases(snapshot)
    match = best_purchase_match(record, purchases)
    current_time = now_utc()
    issues: list[str] = []
    warnings: list[str] = []

    if not match:
        expired = apply_expiration(record, current_time)
        if expired:
            warnings.append("Authorization expired before a matching Motive fuel purchase was found.")
        else:
            warnings.append("No matching Motive fuel purchase has been found yet.")
        record.reconciliation_details = {
            "matched": False,
            "issues": issues,
            "warnings": warnings,
            "snapshot_fetched_at": snapshot.get("fetched_at"),
            "checked_purchase_count": len(purchases),
        }
        record.reconciled_at = current_time
        db.commit()
        db.refresh(record)
        return FuelAuthorizationReconcileResult(
            authorization=FuelAuthorizationResponse.model_validate(record),
            status_before=status_before,
            status_after=record.status,
            matched=False,
            issues=issues,
            warnings=warnings,
        )

    actual_gallons = as_float(match.get("volume"))
    actual_amount = as_float(match.get("amount"))
    actual_price = purchase_unit_price(match)
    vendor_match, city_match, state_match = station_match_signals(record, match)

    if actual_gallons is not None and actual_gallons > record.max_gallons + GALLON_TOLERANCE:
        issues.append(f"Gallons exceeded approval: {actual_gallons:.1f} gal > {record.max_gallons:.1f} gal.")
    if actual_amount is not None and record.max_amount > 0 and actual_amount > record.max_amount + AMOUNT_TOLERANCE:
        issues.append(f"Amount exceeded approval: ${actual_amount:.2f} > ${record.max_amount:.2f}.")
    if actual_price is not None and record.max_price_per_gallon is not None and actual_price > record.max_price_per_gallon + PRICE_TOLERANCE:
        issues.append(f"Unit price exceeded approval: ${actual_price:.3f}/gal > ${record.max_price_per_gallon:.3f}/gal.")

    purchase_has_location = bool(clean_text(match.get("city")) or clean_text(match.get("state")) or clean_text(match.get("vendor")))
    station_confirmed = vendor_match or (city_match and state_match)
    if purchase_has_location and not station_confirmed:
        issues.append("Purchase vendor or city/state did not match the approved station.")
    elif not purchase_has_location:
        warnings.append("Motive purchase did not include vendor/city/state, so station match could not be fully verified.")

    record.matched_purchase_id = clean_text(match.get("id")) or None
    record.actual_purchased_at = clean_text(match.get("purchased_at")) or None
    record.actual_vendor = clean_text(match.get("vendor"))
    record.actual_city = clean_text(match.get("city"))
    record.actual_state = clean_text(match.get("state")).upper()
    record.actual_gallons = round_gallons(actual_gallons) if actual_gallons is not None else None
    record.actual_amount = round_money(actual_amount) if actual_amount is not None else None
    record.actual_price_per_gallon = actual_price
    record.violation_count = len(issues)
    record.status = "violated" if issues else "used"
    record.reconciled_at = current_time
    record.reconciliation_details = {
        "matched": True,
        "issues": issues,
        "warnings": warnings,
        "snapshot_fetched_at": snapshot.get("fetched_at"),
        "checked_purchase_count": len(purchases),
        "matched_purchase": match,
        "station_signals": {
            "vendor_match": vendor_match,
            "city_match": city_match,
            "state_match": state_match,
        },
        "tolerances": {
            "gallons": GALLON_TOLERANCE,
            "amount": AMOUNT_TOLERANCE,
            "price": PRICE_TOLERANCE,
        },
    }
    db.commit()
    db.refresh(record)
    return FuelAuthorizationReconcileResult(
        authorization=FuelAuthorizationResponse.model_validate(record),
        status_before=status_before,
        status_after=record.status,
        matched=True,
        issues=issues,
        warnings=warnings,
    )


def get_authorization_or_404(db: Session, authorization_id: int) -> FuelAuthorization:
    record = db.get(FuelAuthorization, authorization_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fuel authorization not found")
    return record


@router.get("", response_model=list[FuelAuthorizationResponse])
def list_fuel_authorizations(
    status_filter: str = Query(default="open", alias="status", max_length=120),
    limit: int = Query(default=100, ge=1, le=300),
    current_user: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    query = select(FuelAuthorization).order_by(FuelAuthorization.created_at.desc()).limit(limit)
    normalized = normalize_text(status_filter)
    if normalized in {"open", "active"}:
        query = query.where(FuelAuthorization.status.in_(sorted(OPEN_STATUSES)))
    elif normalized and normalized != "all":
        statuses = [item.strip() for item in status_filter.split(",") if item.strip()]
        query = query.where(FuelAuthorization.status.in_(statuses))
    records = db.scalars(query).all()
    changed = False
    for record in records:
        changed = apply_expiration(record) or changed
    if changed:
        db.commit()
        records = db.scalars(query).all()
    return records


@router.post("", response_model=FuelAuthorizationResponse, status_code=status.HTTP_201_CREATED)
def create_fuel_authorization(
    payload: FuelAuthorizationCreate,
    current_user: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    return create_authorization_record(db, current_user, payload)


@router.post("/reconcile-open", response_model=FuelAuthorizationBulkReconcileResponse)
def reconcile_open_authorizations(
    refresh: bool = Query(default=False),
    current_user: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    snapshot = motive_client.fetch_snapshot(force_refresh=refresh, allow_stale=True)
    records = db.scalars(
        select(FuelAuthorization)
        .where(FuelAuthorization.status.in_(sorted(OPEN_STATUSES)))
        .order_by(FuelAuthorization.created_at.asc())
        .limit(100)
    ).all()
    results = [reconcile_record(db, record, snapshot) for record in records]
    return FuelAuthorizationBulkReconcileResponse(
        checked=len(results),
        matched=sum(1 for item in results if item.matched),
        violated=sum(1 for item in results if item.status_after == "violated"),
        expired=sum(1 for item in results if item.status_after == "expired"),
        results=results,
    )


@router.patch("/{authorization_id}", response_model=FuelAuthorizationResponse)
def update_fuel_authorization(
    authorization_id: int,
    payload: FuelAuthorizationUpdate,
    current_user: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    record = get_authorization_or_404(db, authorization_id)
    updates = payload.model_dump(exclude_unset=True)
    if "status" in updates and updates["status"]:
        record.status = updates["status"]
        if record.status in {"approved", "sent"} and record.approved_at is None:
            record.approved_at = now_utc()
        if record.status == "sent" and record.sent_at is None:
            record.sent_at = now_utc()
    for field in ("max_gallons", "max_amount", "max_price_per_gallon", "expires_at", "dispatcher_note", "driver_message"):
        if field in updates:
            value = updates[field]
            if isinstance(value, str):
                value = clean_text(value)
            setattr(record, field, value)
    if not record.driver_message:
        record.driver_message = build_driver_message(record)
    db.commit()
    db.refresh(record)
    return record


@router.post("/{authorization_id}/mark-sent", response_model=FuelAuthorizationResponse)
def mark_fuel_authorization_sent(
    authorization_id: int,
    payload: FuelAuthorizationAction | None = None,
    current_user: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    record = get_authorization_or_404(db, authorization_id)
    if record.status in TERMINAL_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Terminal fuel authorizations cannot be marked sent.")
    record.status = "sent"
    record.sent_at = now_utc()
    if record.approved_at is None:
        record.approved_at = record.sent_at
    note = clean_text((payload or FuelAuthorizationAction()).note)
    if note:
        record.dispatcher_note = "\n".join(part for part in [record.dispatcher_note, f"Sent note: {note}"] if part)
    db.commit()
    db.refresh(record)
    return record


@router.post("/{authorization_id}/cancel", response_model=FuelAuthorizationResponse)
def cancel_fuel_authorization(
    authorization_id: int,
    payload: FuelAuthorizationAction | None = None,
    current_user: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    record = get_authorization_or_404(db, authorization_id)
    if record.status == "used":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Used fuel authorizations cannot be cancelled.")
    record.status = "cancelled"
    note = clean_text((payload or FuelAuthorizationAction()).note)
    if note:
        record.dispatcher_note = "\n".join(part for part in [record.dispatcher_note, f"Cancel note: {note}"] if part)
    db.commit()
    db.refresh(record)
    return record


@router.post("/{authorization_id}/reconcile", response_model=FuelAuthorizationReconcileResult)
def reconcile_fuel_authorization(
    authorization_id: int,
    refresh: bool = Query(default=False),
    current_user: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    record = get_authorization_or_404(db, authorization_id)
    snapshot = motive_client.fetch_snapshot(force_refresh=refresh, allow_stale=True)
    return reconcile_record(db, record, snapshot)

