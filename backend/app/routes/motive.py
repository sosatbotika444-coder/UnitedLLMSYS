from datetime import datetime, timezone
from io import BytesIO

from fastapi import APIRouter, Depends, Path, Query
from fastapi.responses import StreamingResponse

from app.auth import require_user_department
from app.config import get_settings
from app.models import User
from app.motive import MotiveClient
from app.motive_export import build_motive_snapshot_workbook
from app.schemas import MotiveIntegrationStatus


router = APIRouter(prefix="/motive", tags=["motive"])
settings = get_settings()
client = MotiveClient(settings)


@router.get("/status", response_model=MotiveIntegrationStatus)
def motive_status(current_user: User = Depends(require_user_department("fuel"))):
    return client.integration_status()


@router.get("/fleet")
def motive_fleet(
    refresh: bool = Query(default=False, description="Force a fresh Motive fetch instead of cached snapshot."),
    current_user: User = Depends(require_user_department("fuel")),
):
    return client.fetch_snapshot(force_refresh=refresh)


@router.get("/vehicles/{vehicle_id}")
def motive_vehicle_detail(
    vehicle_id: int = Path(..., ge=1),
    refresh: bool = Query(default=False, description="Force a fresh fetch for the selected vehicle."),
    current_user: User = Depends(require_user_department("fuel")),
):
    return client.fetch_vehicle_detail(vehicle_id=vehicle_id, force_refresh=refresh)


@router.get("/export")
def motive_export(
    refresh: bool = Query(default=False, description="Force a fresh Motive fetch before creating the Excel export."),
    current_user: User = Depends(require_user_department("fuel")),
):
    snapshot = client.fetch_snapshot(force_refresh=refresh, allow_stale=not refresh)
    workbook_bytes = build_motive_snapshot_workbook(snapshot)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"motive_tracking_export_{timestamp}.xlsx"
    return StreamingResponse(
        BytesIO(workbook_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )#contnutrh increasing 
