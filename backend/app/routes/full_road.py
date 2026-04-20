from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth import require_user_department
from app.database import get_db
from app.models import FullRoadTrip, User
from app.schemas import FullRoadTripCreate, FullRoadTripResponse, FullRoadTripUpdate


router = APIRouter(prefix="/full-road-trips", tags=["full-road"])


def _serialize_trip(record: FullRoadTrip) -> FullRoadTripResponse:
    return FullRoadTripResponse(
        id=record.id,
        userId=record.user_id,
        loadId=record.load_id,
        vehicleId=record.vehicle_id,
        truckNumber=record.truck_number,
        driverName=record.driver_name,
        pickup=record.pickup,
        delivery=record.delivery,
        stage=record.stage,
        tankCapacityGallons=record.tank_capacity_gallons,
        mpg=record.mpg,
        currentFuelGallons=record.current_fuel_gallons,
        fuelPercent=record.fuel_percent,
        toPickupPlan=dict(record.to_pickup_plan or {}),
        toDeliveryPlan=dict(record.to_delivery_plan or {}),
        metrics=dict(record.metrics or {}),
        live=dict(record.live or {}),
        isArchived=bool(record.is_archived),
        createdAt=record.created_at,
        updatedAt=record.updated_at,
    )


def _get_trip_or_404(db: Session, trip_id: int) -> FullRoadTrip:
    trip = db.get(FullRoadTrip, trip_id)
    if not trip:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Full Road trip not found")
    return trip


@router.get("", response_model=list[FullRoadTripResponse])
def list_full_road_trips(
    include_archived: bool = Query(default=False),
    search: str = Query(default="", max_length=255),
    limit: int = Query(default=150, ge=1, le=500),
    _: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    statement = select(FullRoadTrip)
    if not include_archived:
        statement = statement.where(FullRoadTrip.is_archived.is_(False))

    term = search.strip().casefold()
    if term:
        like_term = f"%{term}%"
        statement = statement.where(
            or_(
                FullRoadTrip.truck_number.ilike(like_term),
                FullRoadTrip.driver_name.ilike(like_term),
                FullRoadTrip.pickup.ilike(like_term),
                FullRoadTrip.delivery.ilike(like_term),
                FullRoadTrip.stage.ilike(like_term),
            )
        )

    records = db.scalars(statement.order_by(FullRoadTrip.updated_at.desc(), FullRoadTrip.id.desc()).limit(limit)).all()
    return [_serialize_trip(record) for record in records]


@router.get("/{trip_id}", response_model=FullRoadTripResponse)
def get_full_road_trip(
    trip_id: int,
    _: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    return _serialize_trip(_get_trip_or_404(db, trip_id))


@router.post("", response_model=FullRoadTripResponse, status_code=status.HTTP_201_CREATED)
def create_full_road_trip(
    payload: FullRoadTripCreate,
    current_user: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    record = FullRoadTrip(
        user_id=current_user.id,
        load_id=payload.loadId,
        vehicle_id=payload.vehicleId,
        truck_number=payload.truckNumber.strip(),
        driver_name=payload.driverName.strip(),
        pickup=payload.pickup.strip(),
        delivery=payload.delivery.strip(),
        stage=payload.stage.strip() or "enroute_pickup",
        tank_capacity_gallons=payload.tankCapacityGallons,
        mpg=payload.mpg,
        current_fuel_gallons=payload.currentFuelGallons,
        fuel_percent=payload.fuelPercent,
        to_pickup_plan=dict(payload.toPickupPlan or {}),
        to_delivery_plan=dict(payload.toDeliveryPlan or {}),
        metrics=dict(payload.metrics or {}),
        live=dict(payload.live or {}),
        is_archived=False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _serialize_trip(record)


@router.put("/{trip_id}", response_model=FullRoadTripResponse)
def update_full_road_trip(
    trip_id: int,
    payload: FullRoadTripUpdate,
    _: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    record = _get_trip_or_404(db, trip_id)
    record.load_id = payload.loadId
    record.vehicle_id = payload.vehicleId
    record.truck_number = payload.truckNumber.strip()
    record.driver_name = payload.driverName.strip()
    record.pickup = payload.pickup.strip()
    record.delivery = payload.delivery.strip()
    record.stage = payload.stage.strip() or record.stage
    record.tank_capacity_gallons = payload.tankCapacityGallons
    record.mpg = payload.mpg
    record.current_fuel_gallons = payload.currentFuelGallons
    record.fuel_percent = payload.fuelPercent
    record.to_pickup_plan = dict(payload.toPickupPlan or {})
    record.to_delivery_plan = dict(payload.toDeliveryPlan or {})
    record.metrics = dict(payload.metrics or {})
    record.live = dict(payload.live or {})
    db.commit()
    db.refresh(record)
    return _serialize_trip(record)


@router.post("/{trip_id}/archive", response_model=FullRoadTripResponse)
def archive_full_road_trip(
    trip_id: int,
    _: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    record = _get_trip_or_404(db, trip_id)
    record.is_archived = True
    db.commit()
    db.refresh(record)
    return _serialize_trip(record)
