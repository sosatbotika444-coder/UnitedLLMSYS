from datetime import datetime, timezone
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth import is_admin, require_user_department
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


def _scope_trip_statement(statement, current_user: User):
    if is_admin(current_user):
        return statement
    return statement.where(FullRoadTrip.user_id == current_user.id)


def _get_trip_or_404(db: Session, trip_id: int, current_user: User) -> FullRoadTrip:
    trip = db.scalar(_scope_trip_statement(select(FullRoadTrip).where(FullRoadTrip.id == trip_id), current_user))
    if not trip:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Full Road trip not found")
    return trip


def _safe_number(value):
    try:
        parsed = float(value)
        if parsed.is_integer():
            return int(parsed)
        return round(parsed, 3)
    except (TypeError, ValueError):
        return ""


def _safe_datetime(value) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, str):
        return value
    return ""


def _point_value(point: dict | None, key: str, fallback: str = ""):
    if not isinstance(point, dict):
        return fallback
    value = point.get(key)
    if value in (None, ""):
        return fallback
    return value


def _trip_export_rows(records: list[FullRoadTrip]) -> list[dict]:
    rows = []
    for record in records:
        to_pickup_plan = dict(record.to_pickup_plan or {})
        to_delivery_plan = dict(record.to_delivery_plan or {})
        metrics = dict(record.metrics or {})
        live = dict(record.live or {})
        pickup_origin = to_pickup_plan.get("origin") or {}
        pickup_destination = to_pickup_plan.get("destination") or {}
        delivery_destination = to_delivery_plan.get("destination") or {}
        pickup_route = (to_pickup_plan.get("routes") or [None])[0] or {}
        delivery_route = (to_delivery_plan.get("routes") or [None])[0] or {}

        rows.append({
            "Trip ID": record.id,
            "Archived": bool(record.is_archived),
            "Stage": record.stage or "",
            "Truck": record.truck_number or "",
            "Driver": record.driver_name or "",
            "Vehicle ID": record.vehicle_id if record.vehicle_id is not None else "",
            "Load ID": record.load_id if record.load_id is not None else "",
            "Fuel %": _safe_number(record.fuel_percent),
            "Current Fuel Gallons": _safe_number(record.current_fuel_gallons),
            "Tank Capacity Gallons": _safe_number(record.tank_capacity_gallons),
            "MPG": _safe_number(record.mpg),
            "Pickup Input": record.pickup or "",
            "Pickup Address": _point_value(pickup_destination, "label", record.pickup or ""),
            "Pickup Latitude": _safe_number(_point_value(pickup_destination, "lat")),
            "Pickup Longitude": _safe_number(_point_value(pickup_destination, "lon")),
            "Delivery Input": record.delivery or "",
            "Delivery Address": _point_value(delivery_destination, "label", record.delivery or ""),
            "Delivery Latitude": _safe_number(_point_value(delivery_destination, "lat")),
            "Delivery Longitude": _safe_number(_point_value(delivery_destination, "lon")),
            "Route Start Address": _point_value(pickup_origin, "label"),
            "Route Start Latitude": _safe_number(_point_value(pickup_origin, "lat")),
            "Route Start Longitude": _safe_number(_point_value(pickup_origin, "lon")),
            "Live Truck Address": live.get("locationLabel") or "",
            "Live Truck Latitude": _safe_number(live.get("lat")),
            "Live Truck Longitude": _safe_number(live.get("lon")),
            "Live Truck Fuel %": _safe_number(live.get("fuelPercent")),
            "Live Last Ping": _safe_datetime(live.get("locatedAt")),
            "Distance to Pickup (mi)": _safe_number(live.get("distanceToPickupMiles")),
            "Distance to Delivery (mi)": _safe_number(live.get("distanceToDeliveryMiles")),
            "Drive Seconds Left": _safe_number(live.get("driveSeconds")),
            "Duty Status": live.get("dutyStatus") or "",
            "Is Moving": bool(live.get("isMoving")) if live else False,
            "Is GPS Stale": bool(live.get("isStale")) if live else False,
            "Leg 1 Route Label": pickup_route.get("label") or "",
            "Leg 1 Distance Meters": _safe_number(pickup_route.get("distance_meters")),
            "Leg 1 Travel Seconds": _safe_number(pickup_route.get("travel_time_seconds")),
            "Leg 2 Route Label": delivery_route.get("label") or "",
            "Leg 2 Distance Meters": _safe_number(delivery_route.get("distance_meters")),
            "Leg 2 Travel Seconds": _safe_number(delivery_route.get("travel_time_seconds")),
            "To Pickup Miles": _safe_number(metrics.get("toPickupMiles")),
            "To Pickup Duration Seconds": _safe_number(metrics.get("toPickupDurationSeconds")),
            "To Delivery Miles": _safe_number(metrics.get("toDeliveryMiles")),
            "To Delivery Duration Seconds": _safe_number(metrics.get("toDeliveryDurationSeconds")),
            "Total Miles": _safe_number(metrics.get("totalMiles")),
            "Total Duration Seconds": _safe_number(metrics.get("totalDurationSeconds")),
            "Fuel Stops Count": _safe_number(metrics.get("fuelStopCount")),
            "Estimated Fuel Cost": _safe_number(metrics.get("estimatedFuelCost")),
            "ETA Pickup": _safe_datetime(metrics.get("etaToPickup")),
            "ETA Delivery": _safe_datetime(metrics.get("etaToDelivery")),
            "Last Route Refresh": _safe_datetime(metrics.get("lastRouteRefreshAt")),
            "Created At": _safe_datetime(record.created_at),
            "Updated At": _safe_datetime(record.updated_at),
        })
    return rows


def _excel_response(rows: list[dict], file_name: str, sheet_name: str) -> StreamingResponse:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = (sheet_name or "Full Road Export")[:31]
    safe_rows = rows or [{"Message": "No trips found"}]
    columns: list[str] = []
    for row in safe_rows:
        for key in row.keys():
            if key not in columns:
                columns.append(key)

    worksheet.append(columns)
    for row in safe_rows:
        worksheet.append([row.get(column, "") for column in columns])

    for column_cells in worksheet.columns:
        header = str(column_cells[0].value or "")
        max_length = min(56, max(len(str(cell.value or "")) for cell in column_cells))
        worksheet.column_dimensions[column_cells[0].column_letter].width = max(12, max(len(header), max_length) + 2)

    stream = BytesIO()
    workbook.save(stream)
    stream.seek(0)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )


@router.get("", response_model=list[FullRoadTripResponse])
def list_full_road_trips(
    include_archived: bool = Query(default=False),
    search: str = Query(default="", max_length=255),
    limit: int = Query(default=150, ge=1, le=500),
    current_user: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    statement = _scope_trip_statement(select(FullRoadTrip), current_user)
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


@router.get("/export")
def export_full_road_trips(
    include_archived: bool = Query(default=True),
    search: str = Query(default="", max_length=255),
    current_user: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    statement = _scope_trip_statement(select(FullRoadTrip), current_user)
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

    records = db.scalars(statement.order_by(FullRoadTrip.updated_at.desc(), FullRoadTrip.id.desc())).all()
    rows = _trip_export_rows(records)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"full_road_trips_{timestamp}.xlsx"
    return _excel_response(rows, filename, "Full Road Trips")


@router.get("/{trip_id}", response_model=FullRoadTripResponse)
def get_full_road_trip(
    trip_id: int,
    current_user: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    return _serialize_trip(_get_trip_or_404(db, trip_id, current_user))


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
    current_user: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    record = _get_trip_or_404(db, trip_id, current_user)
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
    current_user: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    record = _get_trip_or_404(db, trip_id, current_user)
    record.is_archived = True
    db.commit()
    db.refresh(record)
    return _serialize_trip(record)
