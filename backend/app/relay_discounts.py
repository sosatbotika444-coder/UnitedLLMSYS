from __future__ import annotations

import csv
import json
import math
import threading
from datetime import datetime, timezone
from functools import lru_cache
from io import StringIO
from pathlib import Path

from app.schemas import FuelStop

RELAY_DISCOUNT_CACHE_VERSION = 1
RELAY_DISCOUNT_PATH = Path(__file__).resolve().parent / "data" / "relay_discount_cache.json"
RELAY_DISCOUNT_LOCK = threading.Lock()


def _normalize_text(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _normalize_address(value: str | None) -> str:
    cleaned = _normalize_text(value)
    return cleaned.replace(".", "").replace(",", "")


def _normalize_store_number(value: str | None) -> str:
    return "".join(ch for ch in str(value or "").strip() if ch.isalnum()).lower()


def _coerce_float(value) -> float | None:
    if value in (None, "", "-"):
        return None
    try:
        return round(float(str(value).replace("$", "").replace(",", "").strip()), 3)
    except (TypeError, ValueError):
        return None


def _brand_family(value: str | None) -> str:
    normalized = _normalize_text(value)
    if not normalized:
        return ""
    if "love" in normalized:
        return "loves"
    if "pilot" in normalized or "flying j" in normalized:
        return "pilot"
    if "circle k" in normalized:
        return "circlek"
    if normalized in {"ta", "petro"} or "travelcenters" in normalized:
        return "ta"
    return normalized.replace(" ", "")


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_m = 6371000.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return 2 * radius_m * math.asin(math.sqrt(a))


def _record_key(record: dict) -> str:
    location_id = _normalize_text(record.get("location_id"))
    if location_id:
        return f"location:{location_id}"
    brand = _brand_family(record.get("brand") or record.get("name"))
    store_number = _normalize_store_number(record.get("store_number"))
    if brand and store_number:
        return f"store:{brand}:{store_number}"
    lat = _coerce_float(record.get("lat"))
    lon = _coerce_float(record.get("lon"))
    if lat is not None and lon is not None:
        return f"coord:{lat:.5f}:{lon:.5f}:{brand}"
    address = _normalize_address(record.get("address"))
    city = _normalize_text(record.get("city"))
    state_code = _normalize_text(record.get("state_code"))
    postal_code = _normalize_text(record.get("postal_code"))
    return f"addr:{brand}:{address}:{city}:{state_code}:{postal_code}"


def _load_cache_file() -> list[dict]:
    if not RELAY_DISCOUNT_PATH.exists():
        return []
    try:
        payload = json.loads(RELAY_DISCOUNT_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    if not isinstance(payload, dict):
        return []
    items = payload.get("items") or []
    return [item for item in items if isinstance(item, dict)]


@lru_cache(maxsize=1)
def load_relay_discount_records() -> list[dict]:
    with RELAY_DISCOUNT_LOCK:
        return _load_cache_file()


def relay_discount_runtime_status() -> dict:
    with RELAY_DISCOUNT_LOCK:
        records = _load_cache_file()
        updated_at = None
        if RELAY_DISCOUNT_PATH.exists():
            updated_at = datetime.fromtimestamp(RELAY_DISCOUNT_PATH.stat().st_mtime, tz=timezone.utc).isoformat()
    active_count = sum(1 for item in records if _coerce_float(item.get("net_price")) is not None)
    return {
        "enabled": bool(records),
        "recordCount": len(records),
        "activePriceCount": active_count,
        "updatedAt": updated_at,
        "path": str(RELAY_DISCOUNT_PATH),
    }


def normalize_relay_discount_item(item: dict) -> dict | None:
    if not isinstance(item, dict):
        return None

    retail_price = _coerce_float(
        item.get("retail_price")
        or item.get("street_price")
        or item.get("gross_price")
        or item.get("pump_price")
    )
    net_price = _coerce_float(
        item.get("net_price")
        or item.get("fuel_price")
        or item.get("effective_price")
    )
    discount_amount = _coerce_float(
        item.get("discount_amount")
        or item.get("discount")
        or item.get("total_discount")
        or item.get("discount_per_gallon")
    )

    if net_price is None and retail_price is not None and discount_amount is not None:
        net_price = round(retail_price - discount_amount, 3)
    if discount_amount is None and retail_price is not None and net_price is not None:
        discount_amount = round(retail_price - net_price, 3)
    if net_price is None:
        return None

    normalized = {
        "location_id": str(item.get("location_id") or item.get("station_id") or item.get("id") or "").strip(),
        "brand": str(item.get("brand") or "").strip(),
        "name": str(item.get("name") or "").strip(),
        "store_number": str(item.get("store_number") or item.get("store") or "").strip(),
        "address": str(item.get("address") or "").strip(),
        "city": str(item.get("city") or "").strip(),
        "state_code": str(item.get("state_code") or item.get("state") or "").strip().upper(),
        "postal_code": str(item.get("postal_code") or item.get("zip") or "").strip(),
        "lat": _coerce_float(item.get("lat") or item.get("latitude")),
        "lon": _coerce_float(item.get("lon") or item.get("longitude")),
        "retail_price": retail_price,
        "net_price": net_price,
        "discount_amount": discount_amount,
        "discount_type": str(item.get("discount_type") or "per_gallon").strip() or "per_gallon",
        "program": str(item.get("program") or item.get("discount_program") or "Relay").strip() or "Relay",
        "source": str(item.get("source") or "Relay import").strip() or "Relay import",
        "updated_at": str(item.get("updated_at") or item.get("price_updated_at") or item.get("effective_at") or "").strip(),
    }
    if not any(
        [
            normalized["location_id"],
            normalized["store_number"],
            normalized["address"],
            normalized["lat"] is not None and normalized["lon"] is not None,
        ]
    ):
        return None
    return normalized


def _persist_relay_discount_records(records: list[dict]) -> None:
    payload = {
        "version": RELAY_DISCOUNT_CACHE_VERSION,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "items": records,
    }
    RELAY_DISCOUNT_PATH.parent.mkdir(parents=True, exist_ok=True)
    RELAY_DISCOUNT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    load_relay_discount_records.cache_clear()


def save_relay_discount_records(records: list[dict], replace: bool = True) -> dict:
    normalized_records = [item for item in (normalize_relay_discount_item(record) for record in records) if item]
    with RELAY_DISCOUNT_LOCK:
        if replace:
            merged = normalized_records
        else:
            merged_map = {_record_key(record): record for record in _load_cache_file()}
            for record in normalized_records:
                merged_map[_record_key(record)] = record
            merged = list(merged_map.values())
        _persist_relay_discount_records(merged)
    return relay_discount_runtime_status()


def clear_relay_discount_records() -> dict:
    with RELAY_DISCOUNT_LOCK:
        _persist_relay_discount_records([])
    return relay_discount_runtime_status()


def parse_relay_discount_csv(csv_text: str) -> list[dict]:
    if not csv_text.strip():
        return []

    def pick(row: dict[str, str], *aliases: str) -> str:
        for alias in aliases:
            if alias in row and str(row[alias]).strip():
                return str(row[alias]).strip()
        return ""

    stream = StringIO(csv_text)
    reader = csv.DictReader(stream)
    records: list[dict] = []
    for raw_row in reader:
        row = {_normalize_text(key): str(value or "").strip() for key, value in (raw_row or {}).items()}
        records.append(
            {
                "location_id": pick(row, "location id", "location_id", "station id", "station_id", "id"),
                "brand": pick(row, "brand"),
                "name": pick(row, "name", "station", "station name", "location"),
                "store_number": pick(row, "store number", "store_number", "store"),
                "address": pick(row, "address", "street", "street address"),
                "city": pick(row, "city"),
                "state_code": pick(row, "state", "state code", "state_code"),
                "postal_code": pick(row, "zip", "postal code", "postal_code"),
                "lat": pick(row, "lat", "latitude"),
                "lon": pick(row, "lon", "longitude"),
                "retail_price": pick(row, "retail price", "retail_price", "street price", "street_price", "gross price", "gross_price", "pump price", "pump_price"),
                "net_price": pick(row, "net price", "net_price", "fuel price", "fuel_price", "effective price", "effective_price"),
                "discount_amount": pick(row, "discount", "discount amount", "discount_amount", "total discount", "total_discount", "discount per gallon", "discount_per_gallon"),
                "discount_type": pick(row, "discount type", "discount_type"),
                "program": pick(row, "program", "discount program", "discount_program"),
                "source": pick(row, "source"),
                "updated_at": pick(row, "updated at", "updated_at", "effective at", "effective_at", "price updated at", "price_updated_at"),
            }
        )
    return records


def _match_score(stop: FuelStop, record: dict) -> float:
    stop_brand = _brand_family(stop.brand or stop.name)
    record_brand = _brand_family(record.get("brand") or record.get("name"))
    if stop_brand and record_brand and stop_brand != record_brand:
        return -1

    score = 0.0
    stop_store = _normalize_store_number(stop.store_number)
    record_store = _normalize_store_number(record.get("store_number"))
    if stop_store and record_store and stop_store == record_store:
        score += 60

    stop_address = _normalize_address(stop.address)
    record_address = _normalize_address(record.get("address"))
    if stop_address and record_address and stop_address == record_address:
        score += 45

    stop_city = _normalize_text(stop.city)
    record_city = _normalize_text(record.get("city"))
    if stop_city and record_city and stop_city == record_city:
        score += 12

    stop_state = _normalize_text(stop.state_code)
    record_state = _normalize_text(record.get("state_code"))
    if stop_state and record_state and stop_state == record_state:
        score += 10

    stop_postal = _normalize_text(stop.postal_code)
    record_postal = _normalize_text(record.get("postal_code"))
    if stop_postal and record_postal and stop_postal == record_postal:
        score += 8

    record_lat = _coerce_float(record.get("lat"))
    record_lon = _coerce_float(record.get("lon"))
    if record_lat is not None and record_lon is not None:
        distance_m = _haversine_m(stop.lat, stop.lon, record_lat, record_lon)
        if distance_m <= 400:
            score += 40 - min(20, distance_m / 20)
        elif distance_m <= 1600:
            score += max(0, 8 - ((distance_m - 400) / 150))

    stop_name = _normalize_text(stop.name)
    record_name = _normalize_text(record.get("name"))
    if stop_name and record_name and stop_name == record_name:
        score += 6

    return score


def match_relay_discount(stop: FuelStop) -> dict | None:
    best_match = None
    best_score = 0.0
    for record in load_relay_discount_records():
        score = _match_score(stop, record)
        if score > best_score:
            best_match = record
            best_score = score
    return best_match if best_score >= 28 else None


def apply_relay_discount(stop: FuelStop) -> FuelStop:
    record = match_relay_discount(stop)
    if not record:
        return stop

    retail_auto_diesel = _coerce_float(record.get("retail_price"))
    if retail_auto_diesel is None:
        retail_auto_diesel = stop.auto_diesel_price if stop.auto_diesel_price is not None else stop.price
    net_price = _coerce_float(record.get("net_price"))
    if net_price is None:
        return stop

    discount_amount = _coerce_float(record.get("discount_amount"))
    if discount_amount is None and retail_auto_diesel is not None:
        discount_amount = round(retail_auto_diesel - net_price, 3)

    stop.retail_price = stop.price
    stop.retail_diesel_price = stop.diesel_price
    stop.retail_auto_diesel_price = stop.auto_diesel_price if stop.auto_diesel_price is not None else retail_auto_diesel
    stop.relay_location_id = record.get("location_id") or None
    stop.relay_applied = True
    stop.relay_net_price = round(net_price, 3)
    stop.relay_discount_amount = round(discount_amount, 3) if discount_amount is not None else None
    stop.relay_discount_type = str(record.get("discount_type") or "per_gallon")
    stop.relay_program = str(record.get("program") or "Relay")
    stop.relay_price_source = str(record.get("source") or "Relay import")
    stop.relay_price_updated_at = str(record.get("updated_at") or "")
    stop.price = round(net_price, 3)
    stop.auto_diesel_price = round(net_price, 3)
    stop.price_status = "relay_import"
    base_source = stop.price_source or "official retail"
    stop.price_source = f"Relay net price overlay on {base_source}"
    if stop.relay_price_updated_at:
        stop.price_updated_at = stop.relay_price_updated_at
    return stop
