from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.auth import require_user_department
from app.models import User
from app.relay_discounts import (
    clear_relay_discount_records,
    load_relay_discount_records,
    parse_relay_discount_csv,
    relay_discount_runtime_status,
    save_relay_discount_records,
)


router = APIRouter(prefix="/relay-discounts", tags=["relay-discounts"])


class RelayDiscountImportItem(BaseModel):
    location_id: str = ""
    brand: str = ""
    name: str = ""
    store_number: str = ""
    address: str = ""
    city: str = ""
    state_code: str = ""
    postal_code: str = ""
    lat: float | None = None
    lon: float | None = None
    retail_price: float | None = Field(default=None, ge=0)
    net_price: float | None = Field(default=None, ge=0)
    discount_amount: float | None = None
    discount_type: str = "per_gallon"
    program: str = "Relay"
    source: str = "Relay import"
    updated_at: str = ""


class RelayDiscountImportRequest(BaseModel):
    items: list[RelayDiscountImportItem] = Field(default_factory=list)
    csv_text: str = Field(default="", max_length=5_000_000)
    replace: bool = True


@router.get("/status")
def relay_discount_status(_: User = Depends(require_user_department("fuel"))):
    status_payload = relay_discount_runtime_status()
    status_payload["preview"] = load_relay_discount_records()[:8]
    return status_payload


@router.get("")
def list_relay_discounts(
    limit: int = Query(default=250, ge=1, le=2000),
    _: User = Depends(require_user_department("fuel")),
):
    return {
        "items": load_relay_discount_records()[:limit],
        "status": relay_discount_runtime_status(),
    }


@router.post("/import", status_code=status.HTTP_201_CREATED)
def import_relay_discounts(
    payload: RelayDiscountImportRequest,
    _: User = Depends(require_user_department("fuel")),
):
    raw_items = [item.model_dump() for item in payload.items]
    if payload.csv_text.strip():
        raw_items.extend(parse_relay_discount_csv(payload.csv_text))
    if not raw_items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide Relay discount rows in items or csv_text")
    status_payload = save_relay_discount_records(raw_items, replace=payload.replace)
    status_payload["preview"] = load_relay_discount_records()[:8]
    return status_payload


@router.delete("")
def delete_relay_discounts(_: User = Depends(require_user_department("fuel"))):
    status_payload = clear_relay_discount_records()
    status_payload["preview"] = []
    return status_payload
