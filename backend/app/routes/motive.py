from fastapi import APIRouter, Depends, Path, Query

from app.auth import get_current_user
from app.config import get_settings
from app.models import User
from app.motive import MotiveClient
from app.schemas import MotiveIntegrationStatus


router = APIRouter(prefix="/motive", tags=["motive"])
settings = get_settings()
client = MotiveClient(settings)


@router.get("/status", response_model=MotiveIntegrationStatus)
def motive_status(current_user: User = Depends(get_current_user)):
    return client.integration_status()


@router.get("/fleet")
def motive_fleet(
    refresh: bool = Query(default=False, description="Force a fresh Motive fetch instead of cached snapshot."),
    current_user: User = Depends(get_current_user),
):
    return client.fetch_snapshot(force_refresh=refresh)


@router.get("/vehicles/{vehicle_id}")
def motive_vehicle_detail(
    vehicle_id: int = Path(..., ge=1),
    refresh: bool = Query(default=False, description="Force a fresh fetch for the selected vehicle."),
    current_user: User = Depends(get_current_user),
):
    return client.fetch_vehicle_detail(vehicle_id=vehicle_id, force_refresh=refresh)
