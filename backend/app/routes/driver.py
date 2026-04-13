from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import create_access_token, hash_password, require_user_department, verify_password
from app.config import get_settings
from app.database import get_db
from app.driver_identity import make_driver_email, normalize_driver_name, parse_driver_vehicle_id
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

def _names_match(requested_name: str, motive_name: str) -> bool:
    requested = normalize_driver_name(requested_name)
    motive = normalize_driver_name(motive_name)
    return bool(requested and motive and requested == motive)



def _vehicle_label(vehicle: dict) -> str:
    return str(vehicle.get("number") or vehicle.get("vin") or f"Truck {vehicle.get('id')}").strip()


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
        driverName=_driver_name(vehicle) or "Unassigned",
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
    q: str = Query(min_length=2, max_length=255),
    limit: int = Query(default=6, ge=1, le=10),
):
    snapshot = motive_client.fetch_snapshot(force_refresh=False)
    term = normalize_driver_name(q)
    matches: list[tuple[int, DriverVehicleMatch]] = []
    for vehicle in snapshot.get("vehicles") or []:
        driver_name = _driver_name(vehicle)
        truck_number = _vehicle_label(vehicle)
        haystack = normalize_driver_name(f"{driver_name} {truck_number}")
        if not driver_name or term not in haystack:
            continue
        normalized_driver = normalize_driver_name(driver_name)
        if normalized_driver == term:
            score = 0
            matched = "Exact driver match"
        elif normalized_driver.startswith(term):
            score = 1
            matched = "Driver starts with this name"
        else:
            score = 2
            matched = "Driver or truck contains this text"
        matches.append((score, _vehicle_match(vehicle, matched)))

    matches.sort(key=lambda item: (item[0], item[1].driverName, item[1].truckNumber))
    return [item for _, item in matches[:limit]]


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register_driver(payload: DriverRegister, db: Session = Depends(get_db)):
    snapshot = motive_client.fetch_snapshot(force_refresh=False)
    vehicle = _find_vehicle(snapshot, payload.vehicleId)
    if not vehicle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Motive vehicle not found")

    email = make_driver_email(payload.vehicleId)
    existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Driver profile already exists. Please sign in.")

    motive_name = _driver_name(vehicle)
    requested_name = payload.fullName.strip()
    if motive_name and not _names_match(requested_name, motive_name):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected Motive driver does not match this name")

    user = User(
        email=email,
        full_name=motive_name or requested_name,
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
    return TokenResponse(access_token=create_access_token(user.id), user=user)


@router.post("/login", response_model=TokenResponse)
def login_driver(payload: DriverLogin, db: Session = Depends(get_db)):
    email = make_driver_email(payload.vehicleId)
    user = db.scalar(select(User).where(User.email == email, User.department == "driver"))
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid driver name, truck, or password")

    if normalize_driver_name(payload.fullName) and normalize_driver_name(payload.fullName) != normalize_driver_name(user.full_name):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="This password belongs to a different driver profile")

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
        driverName=current_user.full_name,
        truckNumber=_vehicle_label(vehicle),
        match=_vehicle_match(vehicle, "Linked driver profile"),
        vehicle=vehicle,
        fleetSnapshot=_filtered_snapshot(snapshot, vehicle),
    )
