import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import assert_user_can_authenticate, create_access_token, hash_password, mark_user_login, require_user_department, verify_password
from app.config import get_settings
from app.database import get_db
from app.driver_identity import make_driver_email, parse_driver_vehicle_id
from app.models import User
from app.motive import MotiveClient
from app.schemas import DriverLogin, DriverProfile, DriverRegister, DriverVehicleMatch, TokenResponse


router = APIRouter(prefix="/driver", tags=["driver"])
settings = get_settings()
motive_client = MotiveClient(settings)


def _vehicle_driver(vehicle: dict) -> dict | None:
    return vehicle.get("driver") or vehicle.get("permanent_driver") or None


def _driver_name(vehicle: dict) -> str:
    driver = _vehicle_driver(vehicle) or {}
    return str(driver.get("full_name") or "").strip()


def _compact_truck_value(value: object) -> str:
    return re.sub(r"[^0-9a-zA-Z]+", "", str(value or "").strip().casefold())


def _vehicle_label(vehicle: dict) -> str:
    return str(vehicle.get("number") or vehicle.get("vin") or f"Truck {vehicle.get('id')}").strip()


def _add_identifier(identifiers: list[str], value: object) -> None:
    normalized = _compact_truck_value(value)
    if normalized and normalized not in identifiers:
        identifiers.append(normalized)
    if normalized.isdigit():
        stripped = normalized.lstrip("0")
        if stripped and stripped not in identifiers:
            identifiers.append(stripped)


def _truck_identifier_variants(value: object) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []

    variants = [text]
    before_driver_name = text.split("/", 1)[0]
    variants.append(before_driver_name)
    variants.extend(re.split(r"[\s/#-]+", before_driver_name))
    variants.extend(re.findall(r"\d+", before_driver_name))
    return variants


def _truck_identifiers(vehicle: dict) -> list[str]:
    values = [
        vehicle.get("number"),
        _vehicle_label(vehicle),
        vehicle.get("id"),
        vehicle.get("vin"),
        vehicle.get("license_plate_number"),
        vehicle.get("license_plate_state"),
    ]
    identifiers: list[str] = []
    for value in values:
        for variant in _truck_identifier_variants(value):
            _add_identifier(identifiers, variant)
    return identifiers


def _truck_match(vehicle: dict, query: str) -> tuple[int, str] | None:
    term = _compact_truck_value(query)
    if not term:
        return None

    identifiers = _truck_identifiers(vehicle)
    if not identifiers:
        return None
    if term in identifiers:
        return 0, "Exact truck match"
    if any(item.startswith(term) for item in identifiers):
        return 1, "Truck number starts with this"
    if any(term in item for item in identifiers):
        return 2, "Truck number, VIN, or plate contains this"
    return None


def _location_label(vehicle: dict) -> str:
    location = vehicle.get("location") or {}
    return str(
        location.get("address")
        or ", ".join(part for part in [location.get("city"), location.get("state")] if part)
        or "Location unavailable"
    ).strip()


def _fuel_percent(vehicle: dict) -> float | None:
    location = vehicle.get("location") or {}
    for key in ("fuel_level_percent", "fuel_primary_remaining_percentage", "fuel_remaining_percentage", "fuel_percentage"):
        value = location.get(key)
        if value is None or value == "":
            continue
        try:
            return round(float(value), 1)
        except (TypeError, ValueError):
            continue
    return None


def _vehicle_match(vehicle: dict, matched: str = "") -> DriverVehicleMatch:
    return DriverVehicleMatch(
        vehicleId=int(vehicle.get("id") or 0),
        driverName=_driver_name(vehicle) or "Motive driver",
        truckNumber=_vehicle_label(vehicle),
        vehicleLabel=_vehicle_label(vehicle),
        locationLabel=_location_label(vehicle),
        fuelLevelPercent=_fuel_percent(vehicle),
        status=str(vehicle.get("status") or vehicle.get("availability_status") or "").strip(),
        matched=matched,
    )


def _find_vehicle(snapshot: dict, vehicle_id: int) -> dict | None:
    for vehicle in snapshot.get("vehicles") or []:
        if str(vehicle.get("id")) == str(vehicle_id):
            return vehicle
    return None


def _validate_truck_selection(vehicle: dict, truck_number: str) -> None:
    if _truck_match(vehicle, truck_number):
        return
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected Motive truck does not match this truck number")


def _driver_profile_name(vehicle: dict, fallback: str) -> str:
    return _driver_name(vehicle) or fallback or _vehicle_label(vehicle)


def _filtered_snapshot(snapshot: dict, vehicle: dict) -> dict:
    return {
        "configured": snapshot.get("configured", True),
        "fetched_at": snapshot.get("fetched_at") or "",
        "location_source": snapshot.get("location_source") or "motive",
        "company": snapshot.get("company"),
        "metrics": {
            "total_vehicles": 1,
            "located_vehicles": 1 if vehicle.get("location") else 0,
            "moving_vehicles": 1 if vehicle.get("is_moving") else 0,
            "stopped_vehicles": 0 if vehicle.get("is_moving") else 1,
            "online_vehicles": 1,
            "stale_vehicles": 1 if vehicle.get("is_stale") else 0,
            "vehicles_with_driver": 1 if _vehicle_driver(vehicle) else 0,
            "active_drivers": 1 if _vehicle_driver(vehicle) else 0,
        },
        "drivers": [_vehicle_driver(vehicle)] if _vehicle_driver(vehicle) else [],
        "vehicles": [vehicle],
        "warnings": snapshot.get("warnings") or [],
    }


@router.get("/matches", response_model=list[DriverVehicleMatch])
def driver_matches(
    q: str = Query(min_length=1, max_length=255),
    limit: int = Query(default=6, ge=1, le=10),
):
    snapshot = motive_client.fetch_snapshot(force_refresh=False)
    matches: list[tuple[int, DriverVehicleMatch]] = []
    for vehicle in snapshot.get("vehicles") or []:
        match = _truck_match(vehicle, q)
        if not match:
            continue
        score, matched = match
        matches.append((score, _vehicle_match(vehicle, matched)))

    matches.sort(key=lambda item: (item[0], item[1].truckNumber, item[1].driverName))
    return [item for _, item in matches[:limit]]


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register_driver(payload: DriverRegister, db: Session = Depends(get_db)):
    snapshot = motive_client.fetch_snapshot(force_refresh=False)
    vehicle = _find_vehicle(snapshot, payload.vehicleId)
    if not vehicle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Motive vehicle not found")
    _validate_truck_selection(vehicle, payload.truckNumber)

    email = make_driver_email(payload.vehicleId)
    existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Driver profile already exists. Please sign in.")

    user = User(
        email=email,
        full_name=_driver_profile_name(vehicle, _vehicle_label(vehicle)),
        department="driver",
        hashed_password=hash_password(payload.password),
    )
    db.add(user)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Driver profile already exists. Please sign in.") from exc

    db.refresh(user)
    mark_user_login(db, user)
    return TokenResponse(access_token=create_access_token(user.id), user=user)


@router.post("/login", response_model=TokenResponse)
def login_driver(payload: DriverLogin, db: Session = Depends(get_db)):
    snapshot = motive_client.fetch_snapshot(force_refresh=False)
    vehicle = _find_vehicle(snapshot, payload.vehicleId)
    if not vehicle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Motive vehicle not found")
    _validate_truck_selection(vehicle, payload.truckNumber)

    email = make_driver_email(payload.vehicleId)
    user = db.scalar(select(User).where(User.email == email, User.department == "driver"))
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid truck number or password")
    assert_user_can_authenticate(user)

    motive_name = _driver_name(vehicle)
    if motive_name and user.full_name != motive_name:
        user.full_name = motive_name
        db.commit()
        db.refresh(user)

    mark_user_login(db, user)
    return TokenResponse(access_token=create_access_token(user.id), user=user)


@router.get("/profile", response_model=DriverProfile)
def driver_profile(current_user: User = Depends(require_user_department("driver"))):
    vehicle_id = parse_driver_vehicle_id(current_user.email)
    if vehicle_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Driver account is not linked to a Motive vehicle")

    snapshot = motive_client.fetch_snapshot(force_refresh=False)
    vehicle = _find_vehicle(snapshot, vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Linked Motive vehicle was not found")

    return DriverProfile(
        vehicleId=vehicle_id,
        driverName=_driver_profile_name(vehicle, current_user.full_name),
        truckNumber=_vehicle_label(vehicle),
        match=_vehicle_match(vehicle, "Linked driver profile"),
        vehicle=vehicle,
        fleetSnapshot=_filtered_snapshot(snapshot, vehicle),
    )
