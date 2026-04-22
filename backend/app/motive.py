from __future__ import annotations

import json
import re
import ssl
import threading
import time
from pathlib import Path
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import certifi
from fastapi import HTTPException, status

from app.config import Settings


SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
CURRENT_LOCATION_ENDPOINTS = [
    ("/v2/vehicle_locations", "v2"),
    ("/v3/vehicle_locations", "v3"),
]
HISTORY_LOCATION_ENDPOINTS = [
    ("/v3/vehicle_locations/{vehicle_id}", "v3"),
    ("/v2/vehicle_locations/{vehicle_id}", "v2"),
]
TOKEN_LOCK = threading.Lock()
TOKEN_STATE: dict[str, object] = {
    "access_token": "",
    "refresh_token": "",
    "expires_at": None,
}
SNAPSHOT_LOCK = threading.Condition()
SNAPSHOT_CACHE: dict[str, object] = {
    "snapshot": None,
    "expires_at": 0.0,
    "building": False,
    "loaded_disk": False,
    "last_error": "",
    "last_refresh_started_at": 0.0,
    "last_refresh_finished_at": "",
}
SNAPSHOT_CACHE_PATH = Path(__file__).resolve().parent / "data" / "motive_snapshot_cache.json"
SNAPSHOT_REFRESH_MIN_INTERVAL_SECONDS = 15
SNAPSHOT_WORKER_STOP = threading.Event()
SNAPSHOT_WORKER_LOCK = threading.Lock()
SNAPSHOT_WORKER_THREAD: threading.Thread | None = None
DETAIL_LOCK = threading.Condition()
DETAIL_CACHE: dict[int, dict[str, object]] = {}
DETAIL_BUILDING: set[int] = set()


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def utc_today() -> date:
    return datetime.now(timezone.utc).date()


def as_int(value: object) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def as_float(value: object) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def first_float(*values: object) -> float | None:
    for value in values:
        parsed = as_float(value)
        if parsed is not None:
            return parsed
    return None


def as_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "y", "on"}:
            return True
        if lowered in {"false", "0", "no", "n", "off"}:
            return False
    return None


def clean_text(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return str(value)


def first_text(*values: object) -> str | None:
    for value in values:
        text = clean_text(value)
        if text:
            return text
    return None


def unwrap_record(value: object) -> dict:
    if isinstance(value, dict) and len(value) == 1:
        first_value = next(iter(value.values()))
        if isinstance(first_value, dict):
            return first_value
    return value if isinstance(value, dict) else {}


def unwrap_records(values: list[dict]) -> list[dict]:
    return [unwrap_record(item) for item in values if isinstance(item, dict)]


def extract_list(payload: object, *keys: str) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def parse_datetime(value: object) -> datetime | None:
    text = clean_text(value)
    if not text:
        return None
    normalized = text.replace(" UTC", "+00:00").replace("UTC", "+00:00")
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        for fmt in (
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%dT%H:%M:%S.%f%z",
            "%Y-%m-%d %H:%M:%S%z",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d",
        ):
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


def age_minutes(value: object) -> float | None:
    parsed = parse_datetime(value)
    if not parsed:
        return None
    return max(0.0, round((datetime.now(timezone.utc) - parsed).total_seconds() / 60, 1))


def _snapshot_cache_path(settings: Settings) -> Path:
    configured_path = clean_text(getattr(settings, "motive_snapshot_cache_file", ""))
    if configured_path:
        path = Path(configured_path)
        if not path.is_absolute():
            path = Path(__file__).resolve().parents[1] / path
        return path
    return SNAPSHOT_CACHE_PATH


def _snapshot_age_seconds(snapshot: dict | None) -> float | None:
    if not snapshot:
        return None
    parsed = parse_datetime(snapshot.get("fetched_at"))
    if not parsed:
        return None
    return max(0.0, (datetime.now(timezone.utc) - parsed).total_seconds())


def _snapshot_expires_at(snapshot: dict | None, ttl_seconds: int) -> float:
    parsed = parse_datetime((snapshot or {}).get("fetched_at"))
    if parsed:
        return parsed.timestamp() + ttl_seconds
    return time.time()


def _snapshot_is_usable(snapshot: object) -> bool:
    return isinstance(snapshot, dict) and isinstance(snapshot.get("vehicles"), list)


def _exception_summary(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return format_http_error("Motive refresh failed", detail, exc.status_code)
    return f"Motive refresh failed: {exc}"


def _decorate_snapshot(snapshot: dict, status_label: str, refreshing: bool, last_error: str = "") -> dict:
    decorated = snapshot.copy()
    cache = dict(decorated.get("cache") or {})
    age_seconds = _snapshot_age_seconds(snapshot)
    cache.update({
        "status": status_label,
        "refreshing": bool(refreshing),
        "served_at": iso_now(),
        "fetched_at": snapshot.get("fetched_at") or "",
        "age_seconds": round(age_seconds, 1) if age_seconds is not None else None,
        "last_error": last_error or "",
    })
    decorated["cache"] = cache

    warnings = list(decorated.get("warnings") or [])
    if status_label in {"stale", "disk", "refreshing"} and refreshing:
        warnings.insert(0, "Showing cached Motive data while a fresh fleet refresh runs in the background.")
    elif status_label in {"stale", "disk"}:
        warnings.insert(0, "Showing cached Motive data.")
    if last_error:
        warnings.insert(0, last_error)
    decorated["warnings"] = list(dict.fromkeys(warnings))
    return decorated


def _warming_snapshot(message: str, refreshing: bool = True, last_error: str = "") -> dict:
    warnings = [message]
    if last_error:
        warnings.insert(0, last_error)
    return {
        "configured": True,
        "auth_mode": "warming",
        "fetched_at": "",
        "company": None,
        "windows": {},
        "metrics": {
            "total_vehicles": 0,
            "located_vehicles": 0,
            "moving_vehicles": 0,
            "stopped_vehicles": 0,
            "online_vehicles": 0,
            "stale_vehicles": 0,
            "vehicles_with_driver": 0,
            "active_drivers": 0,
            "low_fuel_vehicles": 0,
            "active_fault_codes": 0,
            "vehicles_with_faults": 0,
            "ifta_miles_30d": 0,
        },
        "datasets": {},
        "drivers": [],
        "vehicles": [],
        "recent_activity": {},
        "warnings": warnings,
        "cache": {
            "status": "warming",
            "refreshing": bool(refreshing),
            "served_at": iso_now(),
            "fetched_at": "",
            "age_seconds": None,
            "last_error": last_error or "",
        },
    }


def _load_snapshot_from_disk(settings: Settings) -> dict | None:
    if not getattr(settings, "motive_snapshot_disk_cache_enabled", True):
        return None
    path = _snapshot_cache_path(settings)
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as handle:
            snapshot = json.load(handle)
    except Exception:
        return None
    if not _snapshot_is_usable(snapshot):
        return None
    stale_ttl_seconds = max(0, int(getattr(settings, "motive_snapshot_stale_ttl_seconds", 86400) or 0))
    age_seconds = _snapshot_age_seconds(snapshot)
    if stale_ttl_seconds and age_seconds is not None and age_seconds > stale_ttl_seconds:
        return None
    return snapshot


def _write_snapshot_to_disk(settings: Settings, snapshot: dict) -> None:
    if not getattr(settings, "motive_snapshot_disk_cache_enabled", True):
        return
    if not _snapshot_is_usable(snapshot):
        return
    path = _snapshot_cache_path(settings)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_name(f"{path.name}.tmp")
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(snapshot, handle, ensure_ascii=False, separators=(",", ":"))
        tmp_path.replace(path)
    except Exception:
        return


def motive_snapshot_runtime_status() -> dict:
    with SNAPSHOT_LOCK:
        snapshot = SNAPSHOT_CACHE.get("snapshot") if isinstance(SNAPSHOT_CACHE.get("snapshot"), dict) else None
        age_seconds = _snapshot_age_seconds(snapshot)
        return {
            "cached": bool(snapshot),
            "building": bool(SNAPSHOT_CACHE.get("building")),
            "loaded_disk": bool(SNAPSHOT_CACHE.get("loaded_disk")),
            "worker_running": bool(SNAPSHOT_WORKER_THREAD and SNAPSHOT_WORKER_THREAD.is_alive()),
            "fetched_at": snapshot.get("fetched_at") if snapshot else "",
            "age_seconds": round(age_seconds, 1) if age_seconds is not None else None,
            "expires_at": float(SNAPSHOT_CACHE.get("expires_at") or 0.0),
            "last_error": str(SNAPSHOT_CACHE.get("last_error") or ""),
            "last_refresh_started_at": float(SNAPSHOT_CACHE.get("last_refresh_started_at") or 0.0),
            "last_refresh_finished_at": str(SNAPSHOT_CACHE.get("last_refresh_finished_at") or ""),
        }


def duration_to_seconds(value: object) -> int:
    if value in (None, ""):
        return 0
    if isinstance(value, (int, float)):
        numeric = float(value)
        if numeric < 0:
            return 0
        if numeric > 1000 and numeric.is_integer():
            return int(numeric)
        if numeric < 1000:
            return int(round(numeric * 60))
        return int(round(numeric))
    text = str(value).strip().lower()
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", text)
    if not match:
        return 0
    numeric = float(match.group(1))
    if "hour" in text or text.endswith("h"):
        return int(round(numeric * 3600))
    if "min" in text or text.endswith("m"):
        return int(round(numeric * 60))
    return int(round(numeric))


def distance_to_miles(value: object) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return round(float(value), 1)
    text = str(value).strip().lower()
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", text)
    if not match:
        return None
    numeric = float(match.group(1))
    if "km" in text or "kilometer" in text:
        numeric *= 0.621371
    return round(numeric, 1)


def format_http_error(prefix: str, detail: str | None, status_code: int) -> str:
    if detail:
        return f"{prefix} ({status_code}): {detail}"
    return f"{prefix} ({status_code})"


def sort_by_recent(items: list[dict], *keys: str) -> list[dict]:
    def sort_key(item: dict):
        for key in keys:
            parsed = parse_datetime(item.get(key))
            if parsed:
                return parsed
        return datetime.min.replace(tzinfo=timezone.utc)

    return sorted(items, key=sort_key, reverse=True)


class MotiveClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def auth_mode(self) -> str:
        if self.settings.motive_api_key:
            return "x-api-key"
        if self.settings.motive_access_token or TOKEN_STATE.get("access_token"):
            return "oauth"
        return "none"

    @property
    def is_configured(self) -> bool:
        return self.auth_mode != "none"

    def integration_status(self) -> dict:
        return {
            "configured": self.is_configured,
            "api_base_url": self.settings.motive_api_base_url,
            "oauth_base_url": self.settings.motive_oauth_base_url,
            "has_refresh_credentials": bool(
                self.settings.motive_refresh_token and self.settings.motive_client_id and self.settings.motive_client_secret
            ),
            "metric_units": bool(self.settings.motive_metric_units),
            "time_zone": self.settings.motive_time_zone,
            "fleet_user_id": self.settings.motive_user_id,
            "auth_mode": self.auth_mode,
        }

    def _hydrate_snapshot_cache(self, ttl_seconds: int) -> None:
        should_load_disk = False
        with SNAPSHOT_LOCK:
            if not SNAPSHOT_CACHE.get("loaded_disk"):
                SNAPSHOT_CACHE["loaded_disk"] = True
                should_load_disk = SNAPSHOT_CACHE.get("snapshot") is None

        if not should_load_disk:
            return

        snapshot = _load_snapshot_from_disk(self.settings)
        if not snapshot:
            return

        with SNAPSHOT_LOCK:
            if SNAPSHOT_CACHE.get("snapshot") is None:
                SNAPSHOT_CACHE["snapshot"] = snapshot
                SNAPSHOT_CACHE["expires_at"] = _snapshot_expires_at(snapshot, ttl_seconds)

    def _build_and_store_snapshot(self, ttl_seconds: int) -> dict:
        try:
            snapshot = self._build_snapshot()
        except Exception as exc:
            with SNAPSHOT_LOCK:
                SNAPSHOT_CACHE["building"] = False
                SNAPSHOT_CACHE["last_error"] = _exception_summary(exc)
                SNAPSHOT_CACHE["last_refresh_finished_at"] = iso_now()
                SNAPSHOT_LOCK.notify_all()
            raise

        _write_snapshot_to_disk(self.settings, snapshot)
        with SNAPSHOT_LOCK:
            SNAPSHOT_CACHE["snapshot"] = snapshot
            SNAPSHOT_CACHE["expires_at"] = time.time() + ttl_seconds
            SNAPSHOT_CACHE["building"] = False
            SNAPSHOT_CACHE["last_error"] = ""
            SNAPSHOT_CACHE["last_refresh_finished_at"] = iso_now()
            SNAPSHOT_LOCK.notify_all()
        return snapshot

    def _refresh_snapshot_in_background(self, ttl_seconds: int) -> None:
        try:
            self._build_and_store_snapshot(ttl_seconds)
        except Exception:
            return

    def _start_background_snapshot_refresh(self, ttl_seconds: int, force_refresh: bool = False) -> None:
        with SNAPSHOT_LOCK:
            now = time.time()
            if SNAPSHOT_CACHE.get("building"):
                return
            last_started_at = float(SNAPSHOT_CACHE.get("last_refresh_started_at") or 0.0)
            if not force_refresh and now - last_started_at < SNAPSHOT_REFRESH_MIN_INTERVAL_SECONDS:
                return
            SNAPSHOT_CACHE["building"] = True
            SNAPSHOT_CACHE["last_refresh_started_at"] = now
            SNAPSHOT_CACHE["last_refresh_finished_at"] = ""

        thread = threading.Thread(
            target=self._refresh_snapshot_in_background,
            args=(ttl_seconds,),
            name="motive-snapshot-refresh",
            daemon=True,
        )
        thread.start()

    def fetch_snapshot(self, force_refresh: bool = False, allow_stale: bool = True) -> dict:
        if not self.is_configured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Motive integration is not configured. Set MOTIVE_API_KEY or MOTIVE_ACCESS_TOKEN on the backend.",
            )

        ttl_seconds = max(10, int(self.settings.motive_snapshot_ttl_seconds or 45))
        self._hydrate_snapshot_cache(ttl_seconds)

        if allow_stale:
            with SNAPSHOT_LOCK:
                now = time.time()
                cached = SNAPSHOT_CACHE.get("snapshot") if isinstance(SNAPSHOT_CACHE.get("snapshot"), dict) else None
                expires_at = float(SNAPSHOT_CACHE.get("expires_at") or 0.0)
                refreshing = bool(SNAPSHOT_CACHE.get("building"))
                last_error = str(SNAPSHOT_CACHE.get("last_error") or "")
                if cached and not force_refresh and now < expires_at:
                    return _decorate_snapshot(cached, "fresh", refreshing, last_error)

            if cached:
                self._start_background_snapshot_refresh(ttl_seconds, force_refresh=force_refresh)
                with SNAPSHOT_LOCK:
                    refreshing = bool(SNAPSHOT_CACHE.get("building"))
                    last_error = str(SNAPSHOT_CACHE.get("last_error") or "")
                return _decorate_snapshot(cached, "refreshing" if force_refresh else "stale", refreshing, last_error)

            self._start_background_snapshot_refresh(ttl_seconds, force_refresh=force_refresh)
            with SNAPSHOT_LOCK:
                last_error = str(SNAPSHOT_CACHE.get("last_error") or "")
                refreshing = bool(SNAPSHOT_CACHE.get("building"))
            return _warming_snapshot("Motive fleet is warming up. Fresh data is loading in the background.", refreshing=refreshing, last_error=last_error)

        with SNAPSHOT_LOCK:
            now = time.time()
            cached = SNAPSHOT_CACHE.get("snapshot") if isinstance(SNAPSHOT_CACHE.get("snapshot"), dict) else None
            expires_at = float(SNAPSHOT_CACHE.get("expires_at") or 0.0)
            if not force_refresh and cached and now < expires_at:
                return _decorate_snapshot(cached, "fresh", bool(SNAPSHOT_CACHE.get("building")), str(SNAPSHOT_CACHE.get("last_error") or ""))

            while SNAPSHOT_CACHE.get("building"):
                SNAPSHOT_LOCK.wait(timeout=5)
                cached = SNAPSHOT_CACHE.get("snapshot") if isinstance(SNAPSHOT_CACHE.get("snapshot"), dict) else None
                expires_at = float(SNAPSHOT_CACHE.get("expires_at") or 0.0)
                if not force_refresh and cached and time.time() < expires_at:
                    return _decorate_snapshot(cached, "fresh", bool(SNAPSHOT_CACHE.get("building")), str(SNAPSHOT_CACHE.get("last_error") or ""))

            SNAPSHOT_CACHE["building"] = True
            SNAPSHOT_CACHE["last_refresh_started_at"] = time.time()
            SNAPSHOT_CACHE["last_refresh_finished_at"] = ""

        snapshot = self._build_and_store_snapshot(ttl_seconds)
        return _decorate_snapshot(snapshot, "fresh", False, "")

    def fetch_vehicle_detail(self, vehicle_id: int, force_refresh: bool = False) -> dict:
        if not self.is_configured:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Motive integration is not configured. Set MOTIVE_API_KEY or MOTIVE_ACCESS_TOKEN on the backend.",
            )

        ttl_seconds = max(10, int(self.settings.motive_snapshot_ttl_seconds or 45))
        with DETAIL_LOCK:
            now = time.time()
            cached = DETAIL_CACHE.get(vehicle_id)
            if cached and not force_refresh and now < float(cached.get("expires_at") or 0.0):
                return cached.get("detail")

            while vehicle_id in DETAIL_BUILDING:
                DETAIL_LOCK.wait(timeout=5)
                cached = DETAIL_CACHE.get(vehicle_id)
                if cached and time.time() < float(cached.get("expires_at") or 0.0):
                    return cached.get("detail")

            DETAIL_BUILDING.add(vehicle_id)

        try:
            detail = self._build_vehicle_detail(vehicle_id, force_refresh=force_refresh)
        except Exception:
            with DETAIL_LOCK:
                DETAIL_BUILDING.discard(vehicle_id)
                DETAIL_LOCK.notify_all()
            raise

        with DETAIL_LOCK:
            DETAIL_CACHE[vehicle_id] = {"detail": detail, "expires_at": time.time() + ttl_seconds}
            DETAIL_BUILDING.discard(vehicle_id)
            DETAIL_LOCK.notify_all()
        return detail
    def _build_snapshot(self) -> dict:
        warnings: list[str] = []
        windows = {
            "history_days": int(self.settings.motive_vehicle_history_days or 2),
            "events_days": 7,
            "compliance_days": 30,
        }

        tasks = {
            "companies": lambda: self._request_json("/v1/companies"),
            "users": lambda: self._paginate("/v1/users", ("users",), page_size=100),
            "vehicles": lambda: self._paginate("/v1/vehicles", ("vehicles",), page_size=100),
            "vehicle_locations_v2": lambda: self._paginate("/v2/vehicle_locations", ("vehicles",), page_size=100),
            "vehicle_locations_v3": lambda: self._paginate("/v3/vehicle_locations", ("vehicles",), page_size=100),
            "eld_devices": lambda: self._paginate("/v1/eld_devices", ("eld_devices",), page_size=100),
            "hos_available_time": lambda: self._paginate(
                "/v1/available_time",
                ("users", "drivers", "available_times", "available_time"),
                page_size=100,
                max_pages=8,
            ),
            "hos_summaries": lambda: self._paginate(
                "/v1/hours_of_service",
                ("hours_of_services", "hours_of_service", "users", "drivers"),
                page_size=100,
                extra_params=self._date_params(8),
                max_pages=8,
            ),
            "hos_logs": lambda: self._paginate(
                "/v1/logs",
                ("logs",),
                page_size=100,
                extra_params={**self._date_params(8), "status": "all"},
                max_pages=8,
            ),
            "fault_codes": lambda: self._paginate("/v1/fault_codes", ("fault_codes",), page_size=100, max_pages=5),
            "vehicle_utilizations": lambda: self._paginate(
                "/v2/vehicle_utilization",
                ("vehicle_utilizations",),
                page_size=100,
                extra_params=self._date_params(7),
                max_pages=5,
            ),
            "idle_events": lambda: self._paginate(
                "/v1/idle_events",
                ("idle_events",),
                page_size=100,
                extra_params=self._date_params(7),
                max_pages=5,
            ),
            "driving_periods": lambda: self._paginate(
                "/v1/driving_periods",
                ("driving_periods",),
                page_size=100,
                extra_params=self._date_params(7),
                max_pages=8,
            ),
            "driver_performance_events": lambda: self._paginate(
                "/v2/driver_performance_events",
                ("driver_performance_events",),
                page_size=100,
                extra_params=self._date_params(7),
                max_pages=5,
            ),
            "ifta_trips": lambda: self._paginate(
                "/v1/ifta/trips",
                ("ifta_trips",),
                page_size=100,
                extra_params=self._date_params(30),
                max_pages=5,
            ),
            "fuel_purchases": lambda: self._paginate(
                "/v1/fuel_purchases",
                ("fuel_purchases",),
                page_size=100,
                extra_params=self._date_params(30),
                max_pages=3,
            ),
            "inspection_reports": lambda: self._paginate(
                "/v2/inspection_reports",
                ("inspection_reports",),
                page_size=100,
                extra_params=self._date_params(30),
                max_pages=3,
            ),
            "form_entries": lambda: self._paginate(
                "/v2/form_entries",
                ("form_entries",),
                page_size=100,
                extra_params=self._date_params(30),
                max_pages=3,
            ),
            "scorecard_summary": lambda: self._paginate(
                "/v1/scorecard_summary",
                ("driver_performance_rollups",),
                page_size=100,
                extra_params=self._date_params(30),
                max_pages=3,
            ),
        }

        raw_results: dict[str, object] = {}
        errors: dict[str, HTTPException] = {}
        with ThreadPoolExecutor(max_workers=8) as executor:
            future_map = {executor.submit(task): name for name, task in tasks.items()}
            for future in as_completed(future_map):
                name = future_map[future]
                try:
                    raw_results[name] = future.result()
                except HTTPException as exc:
                    errors[name] = exc
                except Exception as exc:
                    errors[name] = HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail=f"Unexpected Motive error while fetching {name}: {exc}",
                    )

        if errors.get("vehicles") and errors.get("vehicle_locations_v2") and errors.get("vehicle_locations_v3"):
            raise errors["vehicle_locations_v2"]

        for name, exc in errors.items():
            warnings.append(format_http_error(f"Could not load {name.replace('_', ' ')}", exc.detail if isinstance(exc.detail, str) else None, exc.status_code))

        company_items = unwrap_records(extract_list(raw_results.get("companies"), "companies", "company"))
        users = [self._normalize_user(item) for item in unwrap_records(raw_results.get("users") or [])]
        users_by_id = {user["id"]: user for user in users if user.get("id") is not None}

        base_vehicles = unwrap_records(raw_results.get("vehicles") or [])
        current_v2_records = unwrap_records(raw_results.get("vehicle_locations_v2") or [])
        current_v3_records = unwrap_records(raw_results.get("vehicle_locations_v3") or [])
        eld_records = unwrap_records(raw_results.get("eld_devices") or [])
        fault_records = [self._normalize_fault_code(item) for item in unwrap_records(raw_results.get("fault_codes") or [])]
        utilization_records = [self._normalize_vehicle_utilization(item) for item in unwrap_records(raw_results.get("vehicle_utilizations") or [])]
        idle_records = [self._normalize_idle_event(item) for item in unwrap_records(raw_results.get("idle_events") or [])]
        driving_records = [self._normalize_driving_period(item) for item in unwrap_records(raw_results.get("driving_periods") or [])]
        performance_records = [self._normalize_performance_event(item) for item in unwrap_records(raw_results.get("driver_performance_events") or [])]
        ifta_records = [self._normalize_ifta_trip(item) for item in unwrap_records(raw_results.get("ifta_trips") or [])]
        fuel_records = [self._normalize_fuel_purchase(item) for item in unwrap_records(raw_results.get("fuel_purchases") or [])]
        inspection_records = [self._normalize_inspection_report(item) for item in unwrap_records(raw_results.get("inspection_reports") or [])]
        form_records = [self._normalize_form_entry(item) for item in unwrap_records(raw_results.get("form_entries") or [])]
        scorecard_records = [self._normalize_scorecard(item, users_by_id) for item in unwrap_records(raw_results.get("scorecard_summary") or [])]
        hos_available_records = [self._normalize_hos_available_time(item, users_by_id) for item in unwrap_records(raw_results.get("hos_available_time") or [])]
        hos_summary_records = [self._normalize_hos_summary(item, users_by_id) for item in unwrap_records(raw_results.get("hos_summaries") or [])]
        hos_log_records = [self._normalize_hos_log(item, users_by_id) for item in unwrap_records(raw_results.get("hos_logs") or [])]

        company = self._normalize_company(company_items[0] if company_items else None)
        company_metric_units = bool(company.get("metric_units")) if company else bool(self.settings.motive_metric_units)

        hos_available_by_driver_id = {item["driver_id"]: item for item in hos_available_records if item.get("driver_id") is not None}
        hos_available_by_driver_name = {
            self._driver_name_key(item.get("driver_name")): item
            for item in hos_available_records
            if self._driver_name_key(item.get("driver_name"))
        }
        hos_summaries_by_driver_id = self._group_by_driver(hos_summary_records)
        hos_summaries_by_driver_name = self._group_by_driver_name(hos_summary_records)
        hos_logs_by_driver_id = self._group_by_driver(hos_log_records)
        hos_logs_by_driver_name = self._group_by_driver_name(hos_log_records)

        location_v2_by_id: dict[int, dict] = {}
        location_v3_by_id: dict[int, dict] = {}
        for record in current_v2_records:
            vehicle_id = as_int(record.get("id"))
            if vehicle_id is not None:
                location_v2_by_id[vehicle_id] = record
        for record in current_v3_records:
            vehicle_id = as_int(record.get("id"))
            if vehicle_id is not None:
                location_v3_by_id[vehicle_id] = record

        base_by_id: dict[int, dict] = {}
        for record in base_vehicles:
            vehicle_id = as_int(record.get("id"))
            if vehicle_id is not None:
                base_by_id[vehicle_id] = record

        eld_by_vehicle_id: dict[int, dict] = {}
        for item in eld_records:
            eld = self._normalize_eld_device(item)
            vehicle_id = eld.get("vehicle_id") if eld else None
            if vehicle_id is not None and vehicle_id not in eld_by_vehicle_id:
                eld_by_vehicle_id[vehicle_id] = eld
        faults_by_vehicle = self._group_by_vehicle(fault_records)
        utilization_by_vehicle = {item["vehicle_id"]: item for item in utilization_records if item.get("vehicle_id") is not None}
        idles_by_vehicle = self._group_by_vehicle(idle_records)
        driving_by_vehicle = self._group_by_vehicle(driving_records)
        performance_by_vehicle = self._group_by_vehicle(performance_records)
        ifta_by_vehicle = self._group_by_vehicle(ifta_records)
        fuel_by_vehicle = self._group_by_vehicle(fuel_records)
        inspection_by_vehicle = self._group_by_vehicle(inspection_records)
        forms_by_vehicle = self._group_by_vehicle(form_records)
        scorecards_by_driver = {item["driver_id"]: item for item in scorecard_records if item.get("driver_id") is not None}

        all_vehicle_ids: set[int] = set(base_by_id.keys()) | set(location_v2_by_id.keys()) | set(location_v3_by_id.keys())
        all_vehicle_ids |= set(faults_by_vehicle.keys()) | set(utilization_by_vehicle.keys()) | set(idles_by_vehicle.keys())
        all_vehicle_ids |= set(driving_by_vehicle.keys()) | set(performance_by_vehicle.keys()) | set(ifta_by_vehicle.keys())
        all_vehicle_ids |= set(fuel_by_vehicle.keys()) | set(inspection_by_vehicle.keys()) | set(forms_by_vehicle.keys()) | set(eld_by_vehicle_id.keys())

        vehicles: list[dict] = []
        for vehicle_id in sorted(all_vehicle_ids):
            base = base_by_id.get(vehicle_id, {})
            current_v2 = location_v2_by_id.get(vehicle_id, {})
            current_v3 = location_v3_by_id.get(vehicle_id, {})
            vehicle_metric_units = as_bool(base.get("metric_units"))
            if vehicle_metric_units is None:
                vehicle_metric_units = company_metric_units
            current_location = self._merge_locations(
                self._normalize_current_location(current_v2.get("current_location"), current_v2, bool(vehicle_metric_units)),
                self._normalize_current_location(current_v3.get("current_location"), current_v3, bool(vehicle_metric_units)),
            )
            vehicle_summary = self._build_vehicle_summary(
                vehicle_id=vehicle_id,
                base=base,
                current_v2=current_v2,
                current_location=current_location,
                users_by_id=users_by_id,
                faults=sort_by_recent(faults_by_vehicle.get(vehicle_id, []), "last_observed_at", "first_observed_at"),
                utilization=utilization_by_vehicle.get(vehicle_id),
                idles=sort_by_recent(idles_by_vehicle.get(vehicle_id, []), "end_time", "start_time"),
                driving_periods=sort_by_recent(driving_by_vehicle.get(vehicle_id, []), "end_time", "start_time"),
                performance_events=sort_by_recent(performance_by_vehicle.get(vehicle_id, []), "end_time", "start_time"),
                ifta_trips=sort_by_recent(ifta_by_vehicle.get(vehicle_id, []), "date"),
                fuel_purchases=sort_by_recent(fuel_by_vehicle.get(vehicle_id, []), "purchased_at", "created_at", "updated_at"),
                inspection_reports=sort_by_recent(inspection_by_vehicle.get(vehicle_id, []), "submitted_at", "updated_at", "created_at"),
                form_entries=sort_by_recent(forms_by_vehicle.get(vehicle_id, []), "submitted_at", "updated_at", "created_at"),
                eld_device=eld_by_vehicle_id.get(vehicle_id),
                scorecards_by_driver=scorecards_by_driver,
                hos_available_by_driver_id=hos_available_by_driver_id,
                hos_available_by_driver_name=hos_available_by_driver_name,
                hos_summaries_by_driver_id=hos_summaries_by_driver_id,
                hos_summaries_by_driver_name=hos_summaries_by_driver_name,
                hos_logs_by_driver_id=hos_logs_by_driver_id,
                hos_logs_by_driver_name=hos_logs_by_driver_name,
            )
            vehicles.append(vehicle_summary)

        metrics = self._compute_metrics(
            company=company,
            vehicles=vehicles,
            users=users,
            faults=fault_records,
            performance_events=performance_records,
            idle_events=idle_records,
            driving_periods=driving_records,
            ifta_trips=ifta_records,
            fuel_purchases=fuel_records,
            inspections=inspection_records,
            form_entries=form_records,
            scorecards=scorecard_records,
        )
        hos_matched_vehicle_count = sum(
            1
            for item in vehicles
            if (item.get("eld_hours") or {}).get("source") not in {None, "", "unavailable", "eld_device_only"}
        )
        eld_only_hos_count = sum(
            1
            for item in vehicles
            if (item.get("eld_hours") or {}).get("source") == "eld_device_only"
        )
        if eld_only_hos_count and not hos_matched_vehicle_count and not errors.get("hos_available_time"):
            warnings.append(
                f"Motive returned {len(hos_available_records)} HOS available-time record(s), but none matched current trucks. ELD gateways are mapped; live HOS clocks need current Motive driver/HOS data."
            )

        recent_activity = {
            "fault_codes": sort_by_recent(fault_records, "last_observed_at", "first_observed_at")[:12],
            "performance_events": sort_by_recent(performance_records, "end_time", "start_time")[:12],
            "driving_periods": sort_by_recent(driving_records, "end_time", "start_time")[:12],
            "idle_events": sort_by_recent(idle_records, "end_time", "start_time")[:12],
            "ifta_trips": sort_by_recent(ifta_records, "date")[:12],
            "fuel_purchases": sort_by_recent(fuel_records, "purchased_at", "created_at", "updated_at")[:12],
            "inspection_reports": sort_by_recent(inspection_records, "submitted_at", "updated_at", "created_at")[:12],
            "form_entries": sort_by_recent(form_records, "submitted_at", "updated_at", "created_at")[:12],
            "driver_scores": sorted(
                scorecard_records,
                key=lambda item: (item.get("score") is None, -(item.get("score") or 0), item.get("driver_name") or ""),
            )[:12],
            "hos_logs": sort_by_recent(hos_log_records, "date", "end_date", "updated_at")[:12],
            "hos_summaries": sort_by_recent(hos_summary_records, "date")[:12],
        }

        datasets = {
            "vehicles": {"count": len(base_by_id), "available": not bool(errors.get("vehicles"))},
            "vehicle_locations_v2": {"count": len(location_v2_by_id), "available": not bool(errors.get("vehicle_locations_v2"))},
            "vehicle_locations_v3": {"count": len(location_v3_by_id), "available": not bool(errors.get("vehicle_locations_v3"))},
            "fault_codes": {"count": len(fault_records), "available": not bool(errors.get("fault_codes"))},
            "vehicle_utilizations": {"count": len(utilization_records), "available": not bool(errors.get("vehicle_utilizations"))},
            "idle_events": {"count": len(idle_records), "available": not bool(errors.get("idle_events"))},
            "driving_periods": {"count": len(driving_records), "available": not bool(errors.get("driving_periods"))},
            "driver_performance_events": {"count": len(performance_records), "available": not bool(errors.get("driver_performance_events"))},
            "ifta_trips": {"count": len(ifta_records), "available": not bool(errors.get("ifta_trips"))},
            "fuel_purchases": {"count": len(fuel_records), "available": not bool(errors.get("fuel_purchases"))},
            "inspection_reports": {"count": len(inspection_records), "available": not bool(errors.get("inspection_reports"))},
            "form_entries": {"count": len(form_records), "available": not bool(errors.get("form_entries"))},
            "eld_devices": {"count": len(eld_records), "available": not bool(errors.get("eld_devices"))},
            "scorecard_summary": {"count": len(scorecard_records), "available": not bool(errors.get("scorecard_summary"))},
            "hos_available_time": {"count": len(hos_available_records), "available": not bool(errors.get("hos_available_time"))},
            "hos_summaries": {"count": len(hos_summary_records), "available": not bool(errors.get("hos_summaries"))},
            "hos_logs": {"count": len(hos_log_records), "available": not bool(errors.get("hos_logs"))},
        }

        return {
            "configured": True,
            "auth_mode": self.auth_mode,
            "fetched_at": iso_now(),
            "company": company,
            "windows": windows,
            "metrics": metrics,
            "datasets": datasets,
            "drivers": users,
            "vehicles": vehicles,
            "recent_activity": recent_activity,
            "warnings": warnings,
        }

    def _build_vehicle_detail(self, vehicle_id: int, force_refresh: bool = False) -> dict:
        snapshot = self.fetch_snapshot(force_refresh=force_refresh)
        vehicle = next((item for item in snapshot.get("vehicles", []) if item.get("id") == vehicle_id), None)
        if not vehicle:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found in Motive fleet")

        history_days = max(1, int(self.settings.motive_vehicle_history_days or 2))
        history_payload = []
        history_source = "unavailable"
        history_error: HTTPException | None = None
        for path_template, version in HISTORY_LOCATION_ENDPOINTS:
            try:
                path = path_template.format(vehicle_id=vehicle_id)
                history_payload = self._paginate(
                    path,
                    ("vehicle_locations",),
                    page_size=200,
                    max_pages=5,
                    extra_params=self._date_params(history_days),
                )
                history_source = version
                break
            except HTTPException as exc:
                history_error = exc
                continue

        history_points = [
            self._normalize_current_location(unwrap_record(item), {}, bool(vehicle.get("metric_units")))
            for item in unwrap_records(history_payload)
        ]
        history_points = [point for point in history_points if point]
        history_points = sort_by_recent(history_points, "located_at")

        response = {
            "fetched_at": iso_now(),
            "vehicle": vehicle,
            "history": {
                "source": history_source,
                "count": len(history_points),
                "points": history_points[:300],
            },
        }
        if history_error and not history_points:
            response["warning"] = format_http_error(
                "Could not load vehicle history",
                history_error.detail if isinstance(history_error.detail, str) else None,
                history_error.status_code,
            )
        return response

    def _date_params(self, days: int) -> dict[str, str]:
        end_date = utc_today()
        start_date = end_date - timedelta(days=days)
        return {"start_date": str(start_date), "end_date": str(end_date)}

    def _group_by_vehicle(self, items: list[dict]) -> dict[int, list[dict]]:
        grouped: defaultdict[int, list[dict]] = defaultdict(list)
        for item in items:
            vehicle_id = as_int(item.get("vehicle_id"))
            if vehicle_id is None:
                continue
            grouped[vehicle_id].append(item)
        return dict(grouped)
    def _normalize_company(self, raw: dict | None) -> dict | None:
        if not raw:
            return None
        return {
            "id": as_int(raw.get("id")),
            "company_code": first_text(raw.get("company_id")),
            "name": first_text(raw.get("name"), "Motive Fleet"),
            "street": first_text(raw.get("street")),
            "city": first_text(raw.get("city")),
            "state": first_text(raw.get("state")),
            "zip": first_text(raw.get("zip")),
            "address": ", ".join(part for part in [first_text(raw.get("street")), first_text(raw.get("city")), first_text(raw.get("state")), first_text(raw.get("zip"))] if part) or None,
            "dot_number": first_text(*(raw.get("dot_ids") or [])),
            "time_zone": first_text(raw.get("time_zone")),
            "metric_units": bool(raw.get("metric_units")),
            "subscription_plan": first_text(raw.get("subscription_plan")),
            "cycle": first_text(raw.get("cycle")),
        }

    def _normalize_user(self, raw: dict | None) -> dict:
        raw = raw or {}
        user_id = as_int(raw.get("id"))
        full_name = " ".join(part for part in [first_text(raw.get("first_name")), first_text(raw.get("last_name"))] if part).strip()
        if not full_name:
            full_name = first_text(raw.get("full_name"), raw.get("name"), raw.get("username"), raw.get("email"), f"User {user_id}" if user_id is not None else "Unknown user")
        return {
            "id": user_id,
            "full_name": full_name,
            "first_name": first_text(raw.get("first_name")),
            "last_name": first_text(raw.get("last_name")),
            "email": first_text(raw.get("email")),
            "phone": first_text(raw.get("phone")),
            "role": first_text(raw.get("role")),
            "status": first_text(raw.get("status")),
            "duty_status": first_text(raw.get("duty_status")),
            "username": first_text(raw.get("username")),
            "time_zone": first_text(raw.get("time_zone")),
            "eld_mode": first_text(raw.get("eld_mode")),
            "carrier_name": first_text(raw.get("carrier_name")),
            "driver_company_id": first_text(raw.get("driver_company_id")),
            "license_number": first_text(raw.get("drivers_license_number")),
            "license_state": first_text(raw.get("drivers_license_state")),
        }

    def _normalize_embedded_driver(self, raw: object, users_by_id: dict[int, dict]) -> dict | None:
        if raw is None:
            return None
        if isinstance(raw, dict):
            normalized = self._normalize_user(unwrap_record(raw))
            user_id = normalized.get("id")
            if user_id is not None and user_id in users_by_id:
                merged = users_by_id[user_id].copy()
                merged.update({key: value for key, value in normalized.items() if value not in (None, "")})
                return merged
            return normalized
        user_id = as_int(raw)
        if user_id is not None:
            return users_by_id.get(user_id)
        return None

    def _normalize_eld_device(self, raw: object) -> dict | None:
        item = unwrap_record(raw)
        if not item:
            return None
        vehicle = unwrap_record(item.get("vehicle"))
        return {
            "id": as_int(item.get("id")),
            "identifier": first_text(item.get("identifier")),
            "model": first_text(item.get("model")),
            "vehicle_id": as_int(vehicle.get("id")),
            "vehicle_number": first_text(vehicle.get("number")),
        }

    def _driver_name_key(self, value: object) -> str:
        return re.sub(r"\s+", " ", str(value or "").strip().lower())

    def _driver_name_from_vehicle_number(self, *values: object) -> dict | None:
        for value in values:
            text = first_text(value)
            if not text or "/" not in text:
                continue
            suffix = text.split("/", 1)[-1].strip(" -")
            if suffix and not suffix.isdigit():
                return {"id": None, "full_name": suffix}
        return None

    def _hos_seconds(self, source: dict, *keys: str) -> int | None:
        if not isinstance(source, dict):
            return None
        for key in keys:
            value = source.get(key)
            if value in (None, ""):
                continue
            parsed = as_int(value)
            if parsed is not None:
                return max(0, parsed)
            parsed_duration = duration_to_seconds(value)
            if parsed_duration > 0 or str(value).strip() in {"0", "0.0"}:
                return max(0, parsed_duration)
        return None

    def _duration_rows(self, values: object) -> list[dict]:
        if not isinstance(values, list):
            return []
        rows: list[dict] = []
        for raw in values:
            item = unwrap_record(raw)
            if not item:
                continue
            rows.append(
                {
                    "date": first_text(item.get("date"), item.get("day")),
                    "duration_seconds": self._hos_seconds(item, "duration", "seconds", "duration_seconds"),
                }
            )
        return rows

    def _driver_from_hos_record(self, item: dict, users_by_id: dict[int, dict]) -> dict:
        driver = unwrap_record(item.get("driver")) or unwrap_record(item.get("user")) or item
        normalized = self._normalize_embedded_driver(driver, users_by_id) or {}
        driver_id = normalized.get("id") or as_int(item.get("driver_id")) or as_int(item.get("user_id")) or as_int(driver.get("id"))
        driver_name = first_text(
            normalized.get("full_name"),
            item.get("driver_name"),
            item.get("driver_full_name"),
            item.get("full_name"),
            " ".join(part for part in [first_text(item.get("driver_first_name")), first_text(item.get("driver_last_name"))] if part).strip(),
            driver.get("name"),
            driver.get("full_name"),
            " ".join(part for part in [first_text(driver.get("first_name")), first_text(driver.get("last_name"))] if part).strip(),
            driver.get("email"),
        )
        merged = dict(normalized)
        merged.update({"id": driver_id, "full_name": driver_name})
        return merged

    def _normalize_hos_available_time(self, raw: dict, users_by_id: dict[int, dict]) -> dict:
        item = unwrap_record(raw)
        user = unwrap_record(item.get("user")) or unwrap_record(item.get("driver")) or item
        driver = self._driver_from_hos_record(item, users_by_id)
        available = unwrap_record(item.get("available_time")) or unwrap_record(user.get("available_time"))
        recap = unwrap_record(item.get("recap")) or unwrap_record(user.get("recap"))
        last_status = unwrap_record(item.get("last_hos_status")) or unwrap_record(user.get("last_hos_status"))
        last_cycle_reset = unwrap_record(item.get("last_cycle_reset")) or unwrap_record(user.get("last_cycle_reset"))
        return {
            "driver_id": driver.get("id"),
            "driver_name": driver.get("full_name"),
            "duty_status": first_text(item.get("duty_status"), user.get("duty_status"), last_status.get("status")),
            "available_time": {
                "drive_seconds": self._hos_seconds(available, "drive", "drive_seconds", "driving"),
                "shift_seconds": self._hos_seconds(available, "shift", "shift_seconds"),
                "cycle_seconds": self._hos_seconds(available, "cycle", "cycle_seconds"),
                "break_seconds": self._hos_seconds(available, "break", "break_seconds"),
            },
            "recap": {
                "seconds_available": self._hos_seconds(recap, "seconds_available"),
                "seconds_tomorrow": self._hos_seconds(recap, "seconds_tomorrow"),
                "on_duty_duration": self._duration_rows(recap.get("on_duty_duration")),
                "driving_duration": self._duration_rows(recap.get("driving_duration")),
            },
            "last_hos_status": {
                "status": first_text(last_status.get("status")),
                "time": first_text(last_status.get("time"), last_status.get("start_time"), last_status.get("started_at")),
            },
            "last_cycle_reset": {
                "type": first_text(last_cycle_reset.get("type")),
                "start_time": first_text(last_cycle_reset.get("start_time")),
                "end_time": first_text(last_cycle_reset.get("end_time")),
            },
            "source": "motive_available_time",
        }

    def _normalize_hos_summary(self, raw: dict, users_by_id: dict[int, dict]) -> dict:
        item = unwrap_record(raw)
        driver = self._driver_from_hos_record(item, users_by_id)
        violations = [unwrap_record(value) for value in (item.get("hos_violations") or item.get("violations") or []) if isinstance(value, dict)]
        form_errors = [unwrap_record(value) for value in (item.get("form_and_manner_errors") or item.get("form_errors") or []) if isinstance(value, dict)]
        return {
            "id": as_int(item.get("id")),
            "driver_id": driver.get("id"),
            "driver_name": driver.get("full_name"),
            "date": first_text(item.get("date"), item.get("log_date")),
            "duty_status": first_text(item.get("duty_status"), item.get("status")),
            "off_duty_seconds": self._hos_seconds(item, "off_duty_duration", "off_duty_seconds"),
            "on_duty_seconds": self._hos_seconds(item, "on_duty_duration", "on_duty_seconds"),
            "sleeper_seconds": self._hos_seconds(item, "sleeper_duration", "sleeper_seconds"),
            "driving_seconds": self._hos_seconds(item, "driving_duration", "driving_seconds"),
            "waiting_seconds": self._hos_seconds(item, "waiting_duration", "waiting_seconds"),
            "violation_count": len(violations) or as_int(item.get("violation_count")) or 0,
            "form_error_count": len(form_errors) or as_int(item.get("form_error_count")) or 0,
            "violations": [
                {
                    "type": first_text(value.get("type"), value.get("violation_type")),
                    "start_time": first_text(value.get("start_time"), value.get("started_at")),
                    "end_time": first_text(value.get("end_time"), value.get("ended_at")),
                }
                for value in violations[:6]
            ],
            "source": "motive_hours_of_service",
        }

    def _normalize_hos_log_event(self, raw: object) -> dict:
        item = unwrap_record(raw)
        return {
            "id": as_int(item.get("id")),
            "type": first_text(item.get("type"), item.get("event_type")),
            "status": first_text(item.get("status")),
            "start_time": first_text(item.get("start_time"), item.get("started_at"), item.get("time")),
            "end_time": first_text(item.get("end_time"), item.get("ended_at")),
            "duration_seconds": self._hos_seconds(item, "duration", "duration_seconds"),
            "location": first_text(item.get("location"), item.get("location_name")),
            "notes": first_text(item.get("notes"), item.get("annotation")),
        }

    def _normalize_hos_log(self, raw: dict, users_by_id: dict[int, dict]) -> dict:
        item = unwrap_record(raw)
        driver = self._driver_from_hos_record(item, users_by_id)
        vehicles = [unwrap_record(value) for value in (item.get("vehicles") or []) if isinstance(value, dict)]
        if not vehicles and item.get("vehicle"):
            vehicles = [unwrap_record(item.get("vehicle"))]
        violations = [unwrap_record(value) for value in (item.get("hos_violations") or item.get("violations") or []) if isinstance(value, dict)]
        form_errors = [unwrap_record(value) for value in (item.get("form_and_manner_errors") or item.get("form_errors") or []) if isinstance(value, dict)]
        events = [self._normalize_hos_log_event(value) for value in (item.get("events") or []) if isinstance(value, dict)]
        signed_at = first_text(item.get("driver_signed_at"), item.get("signed_at"), item.get("certified_at"), item.get("driver_signature_at"))
        return {
            "id": as_int(item.get("id")),
            "driver_id": driver.get("id"),
            "driver_name": driver.get("full_name"),
            "date": first_text(item.get("date"), item.get("log_date")),
            "start_date": first_text(item.get("start_date"), item.get("start_time")),
            "end_date": first_text(item.get("end_date"), item.get("end_time")),
            "updated_at": first_text(item.get("updated_at")),
            "signed_at": signed_at,
            "is_signed": bool(signed_at or item.get("driver_signature_url")),
            "cycle": first_text(item.get("cycle")),
            "time_zone": first_text(item.get("time_zone")),
            "eld_mode": first_text(item.get("eld_mode")),
            "vehicle_numbers": first_text(item.get("vehicle_numbers"), ", ".join(str(value.get("number")) for value in vehicles if value.get("number"))),
            "vehicle_ids": [as_int(value.get("id")) for value in vehicles if as_int(value.get("id")) is not None],
            "total_miles": as_float(item.get("total_miles")),
            "off_duty_seconds": self._hos_seconds(item, "off_duty_duration", "off_duty_seconds"),
            "on_duty_seconds": self._hos_seconds(item, "on_duty_duration", "on_duty_seconds"),
            "sleeper_seconds": self._hos_seconds(item, "sleeper_duration", "sleeper_seconds"),
            "driving_seconds": self._hos_seconds(item, "driving_duration", "driving_seconds"),
            "waiting_seconds": self._hos_seconds(item, "waiting_duration", "waiting_seconds"),
            "violation_count": len(violations) or as_int(item.get("violation_count")) or 0,
            "form_error_count": len(form_errors) or as_int(item.get("form_error_count")) or 0,
            "event_count": len(events),
            "events": events[:8],
            "source": "motive_logs",
        }

    def _group_by_driver(self, items: list[dict]) -> dict[int, list[dict]]:
        grouped: defaultdict[int, list[dict]] = defaultdict(list)
        for item in items:
            driver_id = as_int(item.get("driver_id"))
            if driver_id is not None:
                grouped[driver_id].append(item)
        return dict(grouped)

    def _group_by_driver_name(self, items: list[dict]) -> dict[str, list[dict]]:
        grouped: defaultdict[str, list[dict]] = defaultdict(list)
        for item in items:
            key = self._driver_name_key(item.get("driver_name"))
            if key:
                grouped[key].append(item)
        return dict(grouped)

    def _match_driver_record(self, candidates: list[dict | None], by_id: dict[int, dict], by_name: dict[str, dict]) -> dict | None:
        for candidate in candidates:
            driver_id = as_int((candidate or {}).get("id"))
            if driver_id is not None and driver_id in by_id:
                return by_id[driver_id]
        for candidate in candidates:
            key = self._driver_name_key((candidate or {}).get("full_name"))
            if key and key in by_name:
                return by_name[key]
        return None

    def _match_driver_records(self, candidates: list[dict | None], by_id: dict[int, list[dict]], by_name: dict[str, list[dict]]) -> list[dict]:
        matches: list[dict] = []
        seen: set[tuple[object, object, object]] = set()
        for candidate in candidates:
            driver_id = as_int((candidate or {}).get("id"))
            if driver_id is not None:
                for item in by_id.get(driver_id, []):
                    key = (item.get("source"), item.get("id"), item.get("date"))
                    if key not in seen:
                        seen.add(key)
                        matches.append(item)
        for candidate in candidates:
            name_key = self._driver_name_key((candidate or {}).get("full_name"))
            if not name_key:
                continue
            for item in by_name.get(name_key, []):
                key = (item.get("source"), item.get("id"), item.get("date"))
                if key not in seen:
                    seen.add(key)
                    matches.append(item)
        return matches

    def _format_hos_duration(self, seconds: object) -> str:
        parsed = as_int(seconds)
        if parsed is None:
            return "unknown"
        hours = parsed // 3600
        minutes = (parsed % 3600) // 60
        return f"{hours}h {minutes:02d}m"

    def _build_eld_hours_summary(self, *, driver: dict | None, availability: dict | None, hos_summaries: list[dict], hos_logs: list[dict], eld_device: dict | None) -> dict:
        latest_summary = hos_summaries[0] if hos_summaries else None
        latest_log = hos_logs[0] if hos_logs else None
        available_time = dict((availability or {}).get("available_time") or {})
        if latest_summary:
            available_time.setdefault("today_driving_seconds", latest_summary.get("driving_seconds"))
            available_time.setdefault("today_on_duty_seconds", latest_summary.get("on_duty_seconds"))

        source = "unavailable"
        if availability:
            source = "motive_available_time"
        elif latest_summary:
            source = "motive_hours_of_service"
        elif latest_log:
            source = "motive_logs"
        elif eld_device:
            source = "eld_device_only"

        warning_messages: list[str] = []
        violation_count = sum(item.get("violation_count") or 0 for item in hos_logs[:7]) + sum(item.get("violation_count") or 0 for item in hos_summaries[:7])
        unsigned_log_count = sum(1 for item in hos_logs[:7] if not item.get("is_signed"))
        for label, key in [("Drive", "drive_seconds"), ("Shift", "shift_seconds"), ("Cycle", "cycle_seconds")]:
            seconds = available_time.get(key)
            if isinstance(seconds, (int, float)):
                if seconds <= 0:
                    warning_messages.append(f"{label} clock is at zero.")
                elif seconds <= 3600:
                    warning_messages.append(f"{label} clock under 1 hour.")
        if violation_count:
            warning_messages.insert(0, f"{violation_count} recent HOS violation(s).")
        if unsigned_log_count:
            warning_messages.append(f"{unsigned_log_count} recent unsigned log(s).")

        status_label = "unavailable"
        if source not in {"unavailable", "eld_device_only"}:
            status_label = "ok"
            if violation_count or any(isinstance(available_time.get(key), (int, float)) and available_time.get(key) <= 0 for key in ("drive_seconds", "shift_seconds", "cycle_seconds")):
                status_label = "violation"
            elif warning_messages:
                status_label = "warning"
        elif source == "eld_device_only":
            status_label = "no_hos_clock"

        if source == "eld_device_only":
            summary = "Motive returned the ELD device, but no matching HOS clock for this truck or driver."
        elif status_label == "unavailable":
            summary = "No live HOS clock returned."
        elif warning_messages:
            summary = warning_messages[0]
        else:
            summary = f"{self._format_hos_duration(available_time.get('drive_seconds'))} drive / {self._format_hos_duration(available_time.get('shift_seconds'))} shift left."

        return {
            "source": source,
            "status": status_label,
            "summary": summary,
            "missing_reason": "Motive HOS returned no matching current driver clock." if source == "eld_device_only" else "",
            "driver_id": (driver or {}).get("id") or (availability or {}).get("driver_id") or (latest_summary or {}).get("driver_id") or (latest_log or {}).get("driver_id"),
            "driver_name": first_text((driver or {}).get("full_name"), (availability or {}).get("driver_name"), (latest_summary or {}).get("driver_name"), (latest_log or {}).get("driver_name")),
            "duty_status": first_text((availability or {}).get("duty_status"), (latest_summary or {}).get("duty_status"), (driver or {}).get("duty_status")),
            "available_time": available_time,
            "recap": (availability or {}).get("recap") or {},
            "last_hos_status": (availability or {}).get("last_hos_status") or {},
            "last_cycle_reset": (availability or {}).get("last_cycle_reset") or {},
            "latest_summary": latest_summary or {},
            "latest_log": latest_log or {},
            "recent_violation_count": violation_count,
            "unsigned_log_count": unsigned_log_count,
            "warnings": warning_messages[:6],
        }

    def _normalize_current_location(self, location_raw: object, vehicle_context: dict, metric_units: bool) -> dict | None:
        location = unwrap_record(location_raw)
        if not location:
            return None
        lat = as_float(location.get("lat")) or as_float(vehicle_context.get("lat"))
        lon = as_float(location.get("lon")) or as_float(vehicle_context.get("lon"))
        if lat is None or lon is None:
            return None
        speed = as_float(location.get("speed"))
        speed_mph = None
        speed_kph = None
        if speed is not None:
            if metric_units:
                speed_kph = speed
                speed_mph = round(speed * 0.621371, 1)
            else:
                speed_mph = round(speed, 1)
                speed_kph = round(speed / 0.621371, 1)
        return {
            "lat": lat,
            "lon": lon,
            "located_at": first_text(location.get("located_at"), vehicle_context.get("located_at")),
            "age_minutes": age_minutes(first_text(location.get("located_at"), vehicle_context.get("located_at"))),
            "description": first_text(location.get("description"), vehicle_context.get("description"), vehicle_context.get("location")),
            "address": first_text(location.get("description"), vehicle_context.get("description"), vehicle_context.get("location")),
            "city": first_text(location.get("city"), vehicle_context.get("city")),
            "state": first_text(location.get("state"), vehicle_context.get("state")),
            "event_type": first_text(location.get("type"), vehicle_context.get("type")),
            "bearing": as_float(location.get("bearing")),
            "speed_mph": speed_mph,
            "speed_kph": speed_kph,
            "odometer": as_float(location.get("odometer")),
            "true_odometer": as_float(location.get("true_odometer")),
            "engine_hours": as_float(location.get("engine_hours")),
            "true_engine_hours": as_float(location.get("true_engine_hours")),
            "battery_voltage": as_float(location.get("battery_voltage")),
            "fuel_sensor_reading": first_float(
                location.get("fuel"),
                location.get("fuel_sensor_reading"),
                vehicle_context.get("fuel"),
                vehicle_context.get("fuel_sensor_reading"),
            ),
            "fuel_level_percent": first_float(
                location.get("fuel_primary_remaining_percentage"),
                location.get("fuel_level_percent"),
                location.get("fuel_remaining_percentage"),
                location.get("fuel_percentage"),
                vehicle_context.get("fuel_primary_remaining_percentage"),
                vehicle_context.get("fuel_level_percent"),
                vehicle_context.get("fuel_remaining_percentage"),
                vehicle_context.get("fuel_percentage"),
            ),
            "fuel_secondary_percent": first_float(
                location.get("fuel_secondary_remaining_percentage"),
                location.get("fuel_secondary_percent"),
                vehicle_context.get("fuel_secondary_remaining_percentage"),
                vehicle_context.get("fuel_secondary_percent"),
            ),
            "range_remaining": as_float(location.get("veh_range")),
            "hvb_state_of_charge": as_float(location.get("hvb_state_of_charge")),
            "hvb_charge_status": first_text(location.get("hvb_charge_status")),
            "hvb_charge_source": first_text(location.get("hvb_charge_source")),
            "hvb_lifetime_energy_output": as_float(location.get("hvb_lifetime_energy_output")),
            "eld_device": self._normalize_eld_device(location.get("eld_device")),
        }

    def _merge_locations(self, primary: dict | None, secondary: dict | None) -> dict | None:
        if not primary and not secondary:
            return None
        merged = (secondary or {}).copy()
        for key, value in (primary or {}).items():
            if value not in (None, "", []):
                merged[key] = value
        return merged

    def _normalize_fault_code(self, raw: dict) -> dict:
        item = unwrap_record(raw)
        vehicle = unwrap_record(item.get("vehicle"))
        eld = unwrap_record(item.get("eld_device"))
        return {
            "id": as_int(item.get("id")),
            "vehicle_id": as_int(vehicle.get("id")),
            "vehicle_number": first_text(vehicle.get("number")),
            "code": first_text(item.get("code"), item.get("code_label")),
            "label": first_text(item.get("code_label"), item.get("code")),
            "description": first_text(item.get("code_description"), item.get("fmi_description")),
            "status": first_text(item.get("status"), item.get("dtc_status")),
            "severity": first_text(item.get("dtc_severity")),
            "type": first_text(item.get("type")),
            "first_observed_at": first_text(item.get("first_observed_at")),
            "last_observed_at": first_text(item.get("last_observed_at")),
            "occurrence_count": as_int(item.get("occurrence_count")) or as_int(item.get("num_observations")) or 0,
            "source_address_label": first_text(item.get("source_address_label"), item.get("source_address_name")),
            "eld_device": {
                "id": as_int(eld.get("id")),
                "identifier": first_text(eld.get("identifier")),
                "model": first_text(eld.get("model")),
            },
        }

    def _normalize_vehicle_utilization(self, raw: dict) -> dict:
        item = unwrap_record(raw)
        vehicle = unwrap_record(item.get("vehicle"))
        return {
            "vehicle_id": as_int(vehicle.get("id")),
            "vehicle_number": first_text(vehicle.get("number")),
            "last_located_at": first_text(item.get("last_located_at")),
            "utilization_percentage": as_float(item.get("utilization_percentage")) or as_float(item.get("utilization")),
            "idle_time_seconds": duration_to_seconds(item.get("idle_time")),
            "idle_fuel": as_float(item.get("idle_fuel")),
            "driving_time_seconds": duration_to_seconds(item.get("driving_time")),
            "driving_fuel": as_float(item.get("driving_fuel")),
            "total_fuel": as_float(item.get("total_fuel")),
            "total_distance_miles": distance_to_miles(item.get("total_distance")),
            "message": first_text(item.get("message")),
        }

    def _build_vehicle_mpg_summary(self, utilization: dict | None, driving_summary: dict | None) -> tuple[float | None, str]:
        utilization_summary = utilization or {}
        driving_totals = driving_summary or {}
        candidates = [
            (
                as_float(utilization_summary.get("total_distance_miles")),
                as_float(utilization_summary.get("total_fuel")),
                "Motive 7-day total distance vs total fuel",
            ),
            (
                as_float(driving_totals.get("distance_miles")),
                as_float(utilization_summary.get("driving_fuel")),
                "Motive 7-day driving distance vs driving fuel",
            ),
        ]
        for distance_miles, fuel_gallons, source in candidates:
            if distance_miles is None or fuel_gallons is None or distance_miles <= 0 or fuel_gallons <= 0:
                continue
            mpg = round(distance_miles / fuel_gallons, 2)
            if mpg > 0:
                return mpg, source
        return None, ""

    def _normalize_idle_event(self, raw: dict) -> dict:
        item = unwrap_record(raw)
        vehicle = unwrap_record(item.get("vehicle"))
        driver = unwrap_record(item.get("driver"))
        start_time = parse_datetime(item.get("start_time"))
        end_time = parse_datetime(item.get("end_time"))
        return {
            "id": as_int(item.get("id")),
            "vehicle_id": as_int(vehicle.get("id")),
            "vehicle_number": first_text(vehicle.get("number")),
            "driver_name": " ".join(part for part in [first_text(driver.get("first_name")), first_text(driver.get("last_name"))] if part).strip() or first_text(driver.get("email")),
            "start_time": first_text(item.get("start_time")),
            "end_time": first_text(item.get("end_time")),
            "duration_seconds": max(0, int((end_time - start_time).total_seconds())) if start_time and end_time else 0,
            "veh_fuel_start": as_float(item.get("veh_fuel_start")),
            "veh_fuel_end": as_float(item.get("veh_fuel_end")),
            "fuel_used": None if as_float(item.get("veh_fuel_start")) is None or as_float(item.get("veh_fuel_end")) is None else round((as_float(item.get("veh_fuel_start")) or 0) - (as_float(item.get("veh_fuel_end")) or 0), 2),
            "city": first_text(item.get("city")),
            "state": first_text(item.get("state")),
            "location": first_text(item.get("location")),
            "end_type": first_text(item.get("end_type")),
            "lat": as_float(item.get("lat")),
            "lon": as_float(item.get("lon")),
        }
    def _normalize_driving_period(self, raw: dict) -> dict:
        item = unwrap_record(raw)
        vehicle = unwrap_record(item.get("vehicle"))
        driver = unwrap_record(item.get("driver"))
        return {
            "id": as_int(item.get("id")),
            "vehicle_id": as_int(vehicle.get("id")),
            "vehicle_number": first_text(vehicle.get("number")),
            "driver_name": " ".join(part for part in [first_text(driver.get("first_name")), first_text(driver.get("last_name"))] if part).strip() or first_text(driver.get("email")),
            "status": first_text(item.get("status")),
            "type": first_text(item.get("type")),
            "start_time": first_text(item.get("start_time")),
            "end_time": first_text(item.get("end_time")),
            "duration_seconds": duration_to_seconds(item.get("duration")),
            "distance_miles": distance_to_miles(item.get("distance")),
            "origin": first_text(item.get("origin")),
            "destination": first_text(item.get("destination")),
            "origin_lat": as_float(item.get("origin_lat")),
            "origin_lon": as_float(item.get("origin_lon")),
            "destination_lat": as_float(item.get("destination_lat")),
            "destination_lon": as_float(item.get("destination_lon")),
            "start_kilometers": as_float(item.get("start_kilometers")),
            "end_kilometers": as_float(item.get("end_kilometers")),
        }

    def _normalize_performance_event(self, raw: dict) -> dict:
        item = unwrap_record(raw)
        vehicle = unwrap_record(item.get("vehicle"))
        driver = unwrap_record(item.get("driver"))
        metadata = unwrap_record(item.get("metadata"))
        camera_media = unwrap_record(item.get("camera_media"))
        return {
            "id": as_int(item.get("id")),
            "vehicle_id": as_int(vehicle.get("id")),
            "vehicle_number": first_text(vehicle.get("number")),
            "driver_name": " ".join(part for part in [first_text(driver.get("first_name")), first_text(driver.get("last_name"))] if part).strip() or first_text(driver.get("email")),
            "type": first_text(item.get("type")),
            "primary_behaviors": item.get("primary_behavior") or [],
            "secondary_behaviors": item.get("secondary_behaviors") or [],
            "positive_behaviors": item.get("positive_behaviors") or [],
            "coaching_status": first_text(item.get("coaching_status")),
            "coached_at": first_text(item.get("coached_at")),
            "start_time": first_text(item.get("start_time")),
            "end_time": first_text(item.get("end_time")),
            "duration_seconds": duration_to_seconds(item.get("duration")),
            "location": first_text(item.get("location")),
            "lat": as_float(item.get("lat")),
            "lon": as_float(item.get("lon")),
            "start_speed": as_float(item.get("start_speed")),
            "end_speed": as_float(item.get("end_speed")),
            "max_speed": as_float(item.get("max_speed")),
            "min_speed": as_float(item.get("min_speed")),
            "severity": first_text(metadata.get("severity")),
            "camera_available": as_bool(camera_media.get("available")),
        }

    def _normalize_ifta_trip(self, raw: dict) -> dict:
        item = unwrap_record(raw)
        vehicle = unwrap_record(item.get("vehicle"))
        return {
            "id": as_int(item.get("id")),
            "vehicle_id": as_int(vehicle.get("id")),
            "vehicle_number": first_text(vehicle.get("number")),
            "date": first_text(item.get("date")),
            "jurisdiction": first_text(item.get("jurisdiction")),
            "distance_miles": distance_to_miles(item.get("distance")),
            "start_odometer": as_float(item.get("start_odometer")),
            "end_odometer": as_float(item.get("end_odometer")),
            "calibrated_start_odometer": as_float(item.get("calibrated_start_odometer")),
            "calibrated_end_odometer": as_float(item.get("calibrated_end_odometer")),
            "start_lat": as_float(item.get("start_lat")),
            "start_lon": as_float(item.get("start_lon")),
            "end_lat": as_float(item.get("end_lat")),
            "end_lon": as_float(item.get("end_lon")),
            "time_zone": first_text(item.get("time_zone")),
        }

    def _normalize_fuel_purchase(self, raw: dict) -> dict:
        item = unwrap_record(raw)
        vehicle = unwrap_record(item.get("vehicle"))
        return {
            "id": as_int(item.get("id")),
            "vehicle_id": as_int(item.get("vehicle_id")) or as_int(vehicle.get("id")),
            "vehicle_number": first_text(vehicle.get("number"), item.get("vehicle_number")),
            "purchased_at": first_text(item.get("purchased_at"), item.get("transaction_time"), item.get("created_at"), item.get("updated_at")),
            "amount": as_float(item.get("amount")) or as_float(item.get("total_amount")) or as_float(item.get("cost")),
            "volume": as_float(item.get("volume")) or as_float(item.get("quantity")) or as_float(item.get("gallons")) or as_float(item.get("fuel_quantity")),
            "unit_price": as_float(item.get("price")) or as_float(item.get("unit_price")),
            "fuel_type": first_text(item.get("fuel_type"), item.get("product_name")),
            "vendor": first_text(item.get("vendor"), item.get("merchant_name"), item.get("station_name")),
            "city": first_text(item.get("city")),
            "state": first_text(item.get("state")),
        }

    def _normalize_inspection_report(self, raw: dict) -> dict:
        item = unwrap_record(raw)
        vehicle = unwrap_record(item.get("vehicle"))
        driver = unwrap_record(item.get("driver"))
        return {
            "id": as_int(item.get("id")),
            "vehicle_id": as_int(item.get("vehicle_id")) or as_int(vehicle.get("id")),
            "vehicle_number": first_text(vehicle.get("number"), item.get("vehicle_number")),
            "driver_name": " ".join(part for part in [first_text(driver.get("first_name")), first_text(driver.get("last_name"))] if part).strip() or first_text(driver.get("email")),
            "status": first_text(item.get("status"), item.get("condition"), item.get("inspection_type")),
            "submitted_at": first_text(item.get("submitted_at"), item.get("signed_at"), item.get("updated_at"), item.get("created_at")),
            "safe": as_bool(item.get("safe")),
            "external_id": first_text(item.get("external_id")),
        }

    def _normalize_form_entry(self, raw: dict) -> dict:
        item = unwrap_record(raw)
        vehicle = unwrap_record(item.get("vehicle"))
        return {
            "id": as_int(item.get("id")),
            "vehicle_id": as_int(item.get("vehicle_id")) or as_int(vehicle.get("id")),
            "vehicle_number": first_text(vehicle.get("number"), item.get("vehicle_number")),
            "form_id": first_text(item.get("form_id")),
            "form_version": as_int(item.get("form_version")),
            "dispatch_id": as_int(item.get("dispatch_id")),
            "submitted_at": first_text(item.get("submitted_at"), item.get("updated_at"), item.get("created_at")),
            "status": first_text(item.get("status")),
        }

    def _normalize_scorecard(self, raw: dict, users_by_id: dict[int, dict]) -> dict:
        item = unwrap_record(raw)
        driver = unwrap_record(item.get("driver"))
        driver_id = as_int(driver.get("id"))
        mapped_driver = users_by_id.get(driver_id) if driver_id is not None else None
        driver_name = mapped_driver.get("full_name") if mapped_driver else None
        if not driver_name:
            driver_name = " ".join(part for part in [first_text(driver.get("first_name")), first_text(driver.get("last_name"))] if part).strip() or first_text(driver.get("email"))
        return {
            "driver_id": driver_id,
            "driver_name": driver_name,
            "score": as_float(item.get("score")),
            "num_coached_events": as_int(item.get("num_coached_events")) or 0,
            "num_hard_accels": as_int(item.get("num_hard_accels")) or 0,
            "num_hard_brakes": as_int(item.get("num_hard_brakes")) or 0,
            "num_hard_corners": as_int(item.get("num_hard_corners")) or 0,
            "total_kilometers": as_float(item.get("total_kilometers")),
        }

    def _build_vehicle_summary(
        self,
        *,
        vehicle_id: int,
        base: dict,
        current_v2: dict,
        current_location: dict | None,
        users_by_id: dict[int, dict],
        faults: list[dict],
        utilization: dict | None,
        idles: list[dict],
        driving_periods: list[dict],
        performance_events: list[dict],
        ifta_trips: list[dict],
        fuel_purchases: list[dict],
        inspection_reports: list[dict],
        form_entries: list[dict],
        eld_device: dict | None,
        scorecards_by_driver: dict[int, dict],
        hos_available_by_driver_id: dict[int, dict],
        hos_available_by_driver_name: dict[str, dict],
        hos_summaries_by_driver_id: dict[int, list[dict]],
        hos_summaries_by_driver_name: dict[str, list[dict]],
        hos_logs_by_driver_id: dict[int, list[dict]],
        hos_logs_by_driver_name: dict[str, list[dict]],
    ) -> dict:
        current_driver = self._normalize_embedded_driver(base.get("current_driver"), users_by_id)
        if not current_driver:
            current_driver = self._normalize_embedded_driver(current_v2.get("current_driver"), users_by_id)
        permanent_driver = self._normalize_embedded_driver(base.get("permanent_driver"), users_by_id)
        driver_hint = self._driver_name_from_vehicle_number(base.get("number"), current_v2.get("number"))
        driver_candidates = [current_driver, permanent_driver, driver_hint]
        availability_details = unwrap_record(base.get("availability_details"))
        metric_units = bool(base.get("metric_units"))
        merged_eld = eld_device or self._normalize_eld_device(base.get("eld_device")) or (current_location or {}).get("eld_device")
        driver_score = None
        for candidate in [current_driver, permanent_driver]:
            if candidate and candidate.get("id") in scorecards_by_driver:
                driver_score = scorecards_by_driver[candidate["id"]]
                break
        hos_available = self._match_driver_record(driver_candidates, hos_available_by_driver_id, hos_available_by_driver_name)
        hos_summaries = sort_by_recent(self._match_driver_records(driver_candidates, hos_summaries_by_driver_id, hos_summaries_by_driver_name), "date")
        hos_logs = sort_by_recent(self._match_driver_records(driver_candidates, hos_logs_by_driver_id, hos_logs_by_driver_name), "date", "end_date", "updated_at")
        eld_hours = self._build_eld_hours_summary(
            driver=current_driver or permanent_driver or driver_hint,
            availability=hos_available,
            hos_summaries=hos_summaries,
            hos_logs=hos_logs,
            eld_device=merged_eld,
        )
        fault_summary = {
            "count": len(faults),
            "active_count": sum(1 for item in faults if (item.get("status") or "").lower() not in {"resolved", "inactive", "closed"}),
            "severe_count": sum(1 for item in faults if (item.get("severity") or "").lower() in {"high", "critical", "severe"}),
            "recent_fault_at": first_text(faults[0].get("last_observed_at")) if faults else None,
        }
        utilization_summary = utilization or {
            "vehicle_id": vehicle_id,
            "vehicle_number": first_text(base.get("number"), current_v2.get("number"), f"Vehicle {vehicle_id}"),
            "utilization_percentage": None,
            "idle_time_seconds": 0,
            "idle_fuel": None,
            "driving_time_seconds": 0,
            "driving_fuel": None,
            "total_fuel": None,
            "total_distance_miles": None,
            "last_located_at": current_location.get("located_at") if current_location else None,
            "message": None,
        }
        idle_summary = {
            "count": len(idles),
            "duration_seconds": sum(item.get("duration_seconds") or 0 for item in idles),
            "fuel_used": round(sum(item.get("fuel_used") or 0 for item in idles), 2) if idles else 0,
            "last_idle_end": first_text(idles[0].get("end_time")) if idles else None,
        }
        driving_summary = {
            "count": len(driving_periods),
            "duration_seconds": sum(item.get("duration_seconds") or 0 for item in driving_periods),
            "distance_miles": round(sum(item.get("distance_miles") or 0 for item in driving_periods), 1) if driving_periods else 0,
            "last_drive_end": first_text(driving_periods[0].get("end_time")) if driving_periods else None,
            "last_origin": first_text(driving_periods[0].get("origin")) if driving_periods else None,
            "last_destination": first_text(driving_periods[0].get("destination")) if driving_periods else None,
        }
        mpg, mpg_source = self._build_vehicle_mpg_summary(utilization_summary, driving_summary)
        behaviors: list[str] = []
        pending_review_count = 0
        for event in performance_events:
            if (event.get("coaching_status") or "").lower() == "pending_review":
                pending_review_count += 1
            for value in (event.get("primary_behaviors") or []) + (event.get("secondary_behaviors") or []):
                if value and value not in behaviors:
                    behaviors.append(value)
        performance_summary = {
            "count": len(performance_events),
            "pending_review_count": pending_review_count,
            "recent_event_at": first_text(performance_events[0].get("end_time")) if performance_events else None,
            "behaviors": behaviors[:8],
        }
        ifta_summary = {
            "count": len(ifta_trips),
            "distance_miles": round(sum(item.get("distance_miles") or 0 for item in ifta_trips), 1) if ifta_trips else 0,
            "jurisdictions": sorted({item.get("jurisdiction") for item in ifta_trips if item.get("jurisdiction")})[:12],
            "last_trip_date": first_text(ifta_trips[0].get("date")) if ifta_trips else None,
        }
        fuel_summary = {
            "count": len(fuel_purchases),
            "amount_total": round(sum(item.get("amount") or 0 for item in fuel_purchases), 2) if fuel_purchases else 0,
            "volume_total": round(sum(item.get("volume") or 0 for item in fuel_purchases), 2) if fuel_purchases else 0,
            "last_purchased_at": first_text(fuel_purchases[0].get("purchased_at")) if fuel_purchases else None,
            "last_vendor": first_text(fuel_purchases[0].get("vendor")) if fuel_purchases else None,
        }
        inspection_summary = {
            "count": len(inspection_reports),
            "safe_count": sum(1 for item in inspection_reports if item.get("safe") is True),
            "unsafe_count": sum(1 for item in inspection_reports if item.get("safe") is False),
            "last_submitted_at": first_text(inspection_reports[0].get("submitted_at")) if inspection_reports else None,
        }
        form_summary = {
            "count": len(form_entries),
            "last_submitted_at": first_text(form_entries[0].get("submitted_at")) if form_entries else None,
        }
        age = current_location.get("age_minutes") if current_location else None
        speed_mph = current_location.get("speed_mph") if current_location else None
        return {
            "id": vehicle_id,
            "number": first_text(base.get("number"), current_v2.get("number"), f"Vehicle {vehicle_id}"),
            "status": first_text(base.get("status")),
            "availability_status": first_text(availability_details.get("availability_status")),
            "availability_updated_at": first_text(availability_details.get("updated_at")),
            "make": first_text(base.get("make"), current_v2.get("make")),
            "model": first_text(base.get("model"), current_v2.get("model")),
            "year": first_text(base.get("year"), current_v2.get("year")),
            "vin": first_text(base.get("vin"), current_v2.get("vin")),
            "fuel_type": first_text(base.get("fuel_type"), current_v2.get("fuel_type")),
            "mpg": mpg,
            "mpg_source": mpg_source,
            "license_plate_number": first_text(base.get("license_plate_number")),
            "license_plate_state": first_text(base.get("license_plate_state")),
            "registration_expiry_date": first_text(base.get("registration_expiry_date")),
            "created_at": first_text(base.get("created_at")),
            "updated_at": first_text(base.get("updated_at")),
            "metric_units": metric_units,
            "notes": first_text(base.get("notes")),
            "ifta_enabled": as_bool(base.get("ifta")),
            "driver": current_driver,
            "permanent_driver": permanent_driver,
            "driver_scorecard": driver_score,
            "eld_device": merged_eld,
            "eld_hours": eld_hours,
            "location": current_location,
            "is_moving": bool(speed_mph is not None and speed_mph >= 5),
            "is_stale": bool(current_location is None or age is None or age > 30),
            "fault_summary": fault_summary,
            "utilization_summary": utilization_summary,
            "idle_summary": idle_summary,
            "driving_summary": driving_summary,
            "performance_summary": performance_summary,
            "ifta_summary": ifta_summary,
            "fuel_purchase_summary": fuel_summary,
            "inspection_summary": inspection_summary,
            "form_summary": form_summary,
            "previews": {
                "fault_codes": faults[:3],
                "performance_events": performance_events[:3],
                "driving_periods": driving_periods[:3],
                "idle_events": idles[:3],
                "ifta_trips": ifta_trips[:3],
                "fuel_purchases": fuel_purchases[:3],
                "inspection_reports": inspection_reports[:3],
                "form_entries": form_entries[:3],
                "hos_logs": hos_logs[:3],
            },
        }
    def _compute_metrics(self, *, company: dict | None, vehicles: list[dict], users: list[dict], faults: list[dict], performance_events: list[dict], idle_events: list[dict], driving_periods: list[dict], ifta_trips: list[dict], fuel_purchases: list[dict], inspections: list[dict], form_entries: list[dict], scorecards: list[dict]) -> dict:
        located_vehicles = [item for item in vehicles if item.get("location")]
        moving_vehicles = [item for item in vehicles if item.get("is_moving")]
        stale_vehicles = [item for item in vehicles if item.get("is_stale")]
        low_fuel_vehicles = [item for item in vehicles if (item.get("location") or {}).get("fuel_level_percent") is not None and ((item.get("location") or {}).get("fuel_level_percent") or 0) <= 25]
        hos_units = [item for item in vehicles if (item.get("eld_hours") or {}).get("source") not in {None, "", "unavailable", "eld_device_only"}]
        hos_warning_units = [item for item in vehicles if (item.get("eld_hours") or {}).get("status") in {"warning", "violation"}]
        vehicles_with_faults = [item for item in vehicles if (item.get("fault_summary") or {}).get("active_count")]
        driver_scores = [item.get("score") for item in scorecards if item.get("score") is not None]
        avg_driver_score = round(sum(driver_scores) / len(driver_scores), 1) if driver_scores else None
        active_drivers = [item for item in users if (item.get("role") or "").lower() == "driver" and (item.get("status") or "").lower() == "active"]
        return {
            "company_name": company.get("name") if company else None,
            "total_vehicles": len(vehicles),
            "located_vehicles": len(located_vehicles),
            "moving_vehicles": len(moving_vehicles),
            "stopped_vehicles": max(0, len(located_vehicles) - len(moving_vehicles)),
            "stale_vehicles": len(stale_vehicles),
            "vehicles_with_driver": sum(1 for item in vehicles if item.get("driver")),
            "low_fuel_vehicles": len(low_fuel_vehicles),
            "vehicles_with_faults": len(vehicles_with_faults),
            "active_fault_codes": sum(1 for item in faults if (item.get("status") or "").lower() not in {"resolved", "inactive", "closed"}),
            "performance_events_7d": len(performance_events),
            "pending_review_events": sum(1 for item in performance_events if (item.get("coaching_status") or "").lower() == "pending_review"),
            "idle_events_7d": len(idle_events),
            "hos_driver_clocks": len(hos_units),
            "hos_warning_units": len(hos_warning_units),
            "idle_hours_7d": round(sum((item.get("duration_seconds") or 0) for item in idle_events) / 3600, 1),
            "driving_periods_7d": len(driving_periods),
            "driving_hours_7d": round(sum((item.get("duration_seconds") or 0) for item in driving_periods) / 3600, 1),
            "driving_miles_7d": round(sum(item.get("distance_miles") or 0 for item in driving_periods), 1),
            "ifta_trips_30d": len(ifta_trips),
            "ifta_miles_30d": round(sum(item.get("distance_miles") or 0 for item in ifta_trips), 1),
            "fuel_purchases_30d": len(fuel_purchases),
            "fuel_purchase_amount_30d": round(sum(item.get("amount") or 0 for item in fuel_purchases), 2),
            "fuel_purchase_volume_30d": round(sum(item.get("volume") or 0 for item in fuel_purchases), 2),
            "inspection_reports_30d": len(inspections),
            "unsafe_inspections_30d": sum(1 for item in inspections if item.get("safe") is False),
            "form_entries_30d": len(form_entries),
            "active_drivers": len(active_drivers),
            "average_driver_score": avg_driver_score,
        }

    def _paginate(self, path: str, item_keys: tuple[str, ...], *, page_size: int = 100, max_pages: int = 20, extra_params: dict | None = None) -> list[dict]:
        items: list[dict] = []
        for page_no in range(1, max_pages + 1):
            params = {"page_no": page_no, "per_page": page_size}
            if extra_params:
                params.update(extra_params)
            payload = self._request_json(path, params=params)
            page_items = extract_list(payload, *item_keys)
            if not page_items:
                break
            items.extend(page_items)
            if len(page_items) < page_size:
                break
        return items

    def _request_json(self, path: str, params: dict | None = None, method: str = "GET", body: dict | None = None, allow_refresh: bool = True):
        headers = {"Accept": "application/json"}
        if self.auth_mode == "x-api-key":
            headers["x-api-key"] = self.settings.motive_api_key
        else:
            token = self._access_token()
            if token:
                headers["Authorization"] = f"Bearer {token}"
        headers["X-Metric-Units"] = "true" if self.settings.motive_metric_units else "false"
        if self.settings.motive_user_id is not None:
            headers["X-User-Id"] = str(self.settings.motive_user_id)

        payload_bytes = None
        if body is not None:
            payload_bytes = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        query = f"?{urlencode(params, doseq=True)}" if params else ""
        url = f"{self.settings.motive_api_base_url}{path}{query}"
        request = Request(url, data=payload_bytes, headers=headers, method=method)
        try:
            with urlopen(request, timeout=35, context=SSL_CONTEXT) as response:
                raw_text = response.read().decode("utf-8", errors="replace")
                return json.loads(raw_text) if raw_text else {}
        except HTTPError as exc:
            detail = self._extract_error_detail(exc)
            if exc.code == 401 and self.auth_mode == "oauth" and allow_refresh and self._refresh_access_token():
                return self._request_json(path, params=params, method=method, body=body, allow_refresh=False)
            raise HTTPException(status_code=exc.code, detail=detail or f"Motive API request failed with status {exc.code}") from exc
        except URLError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Could not reach Motive API: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Motive API returned invalid JSON") from exc

    def _access_token(self) -> str:
        with TOKEN_LOCK:
            runtime_access_token = clean_text(TOKEN_STATE.get("access_token"))
            expires_at = TOKEN_STATE.get("expires_at")
            if runtime_access_token and isinstance(expires_at, datetime) and expires_at <= datetime.now(timezone.utc) + timedelta(seconds=45):
                self._refresh_access_token_locked()
                runtime_access_token = clean_text(TOKEN_STATE.get("access_token"))
            if runtime_access_token:
                return runtime_access_token
            initial_token = clean_text(self.settings.motive_access_token)
            if initial_token:
                TOKEN_STATE["access_token"] = initial_token
                if self.settings.motive_refresh_token:
                    TOKEN_STATE["refresh_token"] = self.settings.motive_refresh_token
                return initial_token
        return ""

    def _refresh_access_token(self) -> bool:
        with TOKEN_LOCK:
            return self._refresh_access_token_locked()

    def _refresh_access_token_locked(self) -> bool:
        refresh_token = clean_text(TOKEN_STATE.get("refresh_token")) or clean_text(self.settings.motive_refresh_token)
        if not refresh_token or not self.settings.motive_client_id or not self.settings.motive_client_secret:
            return False
        request = Request(
            f"{self.settings.motive_oauth_base_url}/oauth/token",
            data=urlencode(
                {
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": self.settings.motive_client_id,
                    "client_secret": self.settings.motive_client_secret,
                    **({"redirect_uri": self.settings.motive_redirect_uri} if self.settings.motive_redirect_uri else {}),
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=30, context=SSL_CONTEXT) as response:
                payload = json.loads(response.read().decode("utf-8", errors="replace"))
        except Exception:
            return False
        access_token = clean_text(payload.get("access_token"))
        if not access_token:
            return False
        TOKEN_STATE["access_token"] = access_token
        TOKEN_STATE["refresh_token"] = clean_text(payload.get("refresh_token")) or refresh_token
        expires_in = as_int(payload.get("expires_in")) or 7200
        TOKEN_STATE["expires_at"] = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
        return True

    def _extract_error_detail(self, exc: HTTPError) -> str | None:
        try:
            raw = exc.read().decode("utf-8", errors="replace")
        except Exception:
            return None
        if not raw:
            return None
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return raw.strip()[:300]
        if isinstance(payload, dict):
            return first_text(payload.get("detail"), payload.get("error"), payload.get("message"), payload.get("error_message"))
        return raw.strip()[:300]



def _motive_snapshot_refresh_loop(settings: Settings) -> None:
    client = MotiveClient(settings)
    if not client.is_configured:
        return

    client.fetch_snapshot(force_refresh=False, allow_stale=True)
    interval_seconds = max(15, int(getattr(settings, "motive_background_refresh_interval_seconds", 60) or 60))
    while not SNAPSHOT_WORKER_STOP.wait(interval_seconds):
        client.fetch_snapshot(force_refresh=True, allow_stale=True)


def start_motive_snapshot_refresh_worker(settings: Settings) -> None:
    global SNAPSHOT_WORKER_THREAD
    if not getattr(settings, "motive_background_refresh_enabled", True):
        return
    with SNAPSHOT_WORKER_LOCK:
        if SNAPSHOT_WORKER_THREAD and SNAPSHOT_WORKER_THREAD.is_alive():
            return
        SNAPSHOT_WORKER_STOP.clear()
        SNAPSHOT_WORKER_THREAD = threading.Thread(
            target=_motive_snapshot_refresh_loop,
            args=(settings,),
            name="motive-snapshot-worker",
            daemon=True,
        )
        SNAPSHOT_WORKER_THREAD.start()


def stop_motive_snapshot_refresh_worker() -> None:
    global SNAPSHOT_WORKER_THREAD
    SNAPSHOT_WORKER_STOP.set()
    with SNAPSHOT_WORKER_LOCK:
        if SNAPSHOT_WORKER_THREAD and SNAPSHOT_WORKER_THREAD.is_alive():
            SNAPSHOT_WORKER_THREAD.join(timeout=2)
        SNAPSHOT_WORKER_THREAD = None
