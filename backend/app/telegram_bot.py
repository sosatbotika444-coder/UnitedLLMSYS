from __future__ import annotations

import json
import math
import re
import ssl
import uuid
from dataclasses import dataclass
from io import BytesIO
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import certifi
from PIL import Image, ImageDraw, ImageFont
from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.auth import hash_password, normalize_email, normalize_username
from app.config import get_settings
from app.models import FullRoadTrip, Load, TelegramDriverProfile, User
from app.motive import MotiveClient
from app.routes.fuel_authorizations import create_authorization_record
from app.routes.navigation import route_assistant
from app.schemas import FuelAuthorizationCreate, RouteAssistantRequest, RouteAssistantResponse


settings = get_settings()
ssl_context = ssl.create_default_context(cafile=certifi.where())
motive_client = MotiveClient(settings)
ROUTE_COLORS = ["#1D4ED8", "#0F766E", "#EA580C"]
SKIP_TOKENS = {"/skip", "skip", "-"}
OFF_TOKENS = {"off", "none", "no", "0"}
BOT_TANK_CAPACITY_GALLONS = 200.0
BOT_BUTTON_ROUTE = "Build Route"
BOT_BUTTON_REPEAT = "Repeat Route"
BOT_BUTTON_STATUS = "Status"
BOT_BUTTON_PROFILE = "Profile"
BOT_BUTTON_RESET = "Reset"
BOT_BUTTON_HELP = "Help"
BOT_KEYBOARD_ROWS = (
    (BOT_BUTTON_ROUTE, BOT_BUTTON_REPEAT, BOT_BUTTON_STATUS),
    (BOT_BUTTON_PROFILE, BOT_BUTTON_RESET, BOT_BUTTON_HELP),
)
WIZARD_STEPS = (
    "origin",
    "destination",
    "mpg",
    "fuel_percentage",
    "price_target",
)


@dataclass
class RouteBuildBundle:
    chat_id: str
    image_bytes: bytes
    caption: str
    details: str


def bot_enabled() -> bool:
    return bool(settings.telegram_bot_enabled and settings.telegram_bot_token)


def _telegram_api_url(method: str) -> str:
    return f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}"


def _http_json(url: str, payload: dict | None = None) -> dict:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(url, data=data, headers=headers, method="POST")
    with urlopen(request, timeout=30, context=ssl_context) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def _encode_multipart_formdata(fields: dict[str, object], files: list[tuple[str, str, str, bytes]]) -> tuple[bytes, str]:
    boundary = f"----UnitedLaneTelegram{uuid.uuid4().hex}"
    body = bytearray()
    for key, value in fields.items():
        if value is None:
            continue
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"))
        body.extend(str(value).encode("utf-8"))
        body.extend(b"\r\n")
    for field_name, filename, content_type, content in files:
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(
            f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'.encode("utf-8")
        )
        body.extend(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
        body.extend(content)
        body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def telegram_api_request(method: str, payload: dict | None = None, files: list[tuple[str, str, str, bytes]] | None = None) -> dict:
    if not bot_enabled():
        raise RuntimeError("Telegram bot is not enabled.")
    url = _telegram_api_url(method)
    try:
        if files:
            body, content_type = _encode_multipart_formdata(payload or {}, files)
            request = Request(url, data=body, method="POST", headers={"Content-Type": content_type, "Accept": "application/json"})
            with urlopen(request, timeout=60, context=ssl_context) as response:
                data = json.loads(response.read().decode("utf-8", errors="replace"))
        else:
            data = _http_json(url, payload or {})
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Telegram API {method} failed: HTTP {exc.code} {detail}") from exc
    except Exception as exc:
        raise RuntimeError(f"Telegram API {method} failed: {exc}") from exc

    if not data.get("ok"):
        raise RuntimeError(f"Telegram API {method} failed: {data.get('description', 'Unknown error')}")
    return data


def send_message(chat_id: str, text: str) -> None:
    telegram_api_request(
        "sendMessage",
        {
            "chat_id": chat_id,
            "text": text[:4096],
            "disable_web_page_preview": True,
            "reply_markup": telegram_reply_keyboard(),
        },
    )


def send_chat_action(chat_id: str, action: str) -> None:
    telegram_api_request("sendChatAction", {"chat_id": chat_id, "action": action})


def send_route_photo(chat_id: str, image_bytes: bytes, caption: str) -> None:
    telegram_api_request(
        "sendPhoto",
        {"chat_id": chat_id, "caption": caption[:1024]},
        files=[("photo", "route-plan.png", "image/png", image_bytes)],
    )


def register_webhook_if_configured() -> dict:
    if not bot_enabled():
        return {"enabled": False, "registered": False, "reason": "TELEGRAM_BOT_ENABLED is false or token is missing."}
    if not settings.telegram_bot_auto_set_webhook:
        return {"enabled": True, "registered": False, "reason": "Auto webhook registration is disabled."}
    if not settings.telegram_webhook_base_url:
        return {"enabled": True, "registered": False, "reason": "TELEGRAM_WEBHOOK_BASE_URL is missing."}

    payload = {
        "url": f"{settings.telegram_webhook_base_url}/api/telegram/webhook",
        "allowed_updates": ["message"],
        "max_connections": 20,
    }
    if settings.telegram_webhook_secret:
        payload["secret_token"] = settings.telegram_webhook_secret
    result = telegram_api_request("setWebhook", payload)
    return {"enabled": True, "registered": bool(result.get("result")), "url": payload["url"]}


def get_webhook_info() -> dict:
    if not bot_enabled():
        return {"enabled": False}
    result = telegram_api_request("getWebhookInfo")
    return {"enabled": True, "info": result.get("result", {})}


def verify_webhook_secret(header_value: str | None) -> bool:
    expected = settings.telegram_webhook_secret.strip()
    if not expected:
        return True
    return (header_value or "").strip() == expected


def clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def normalize_step_value(value: object) -> str:
    return clean_text(value).casefold()


BUTTON_COMMAND_ALIASES = {
    normalize_step_value(BOT_BUTTON_ROUTE): "/route",
    normalize_step_value(BOT_BUTTON_REPEAT): "/reroute",
    normalize_step_value(BOT_BUTTON_STATUS): "/status",
    normalize_step_value(BOT_BUTTON_PROFILE): "/profile",
    normalize_step_value(BOT_BUTTON_RESET): "/reset",
    normalize_step_value(BOT_BUTTON_HELP): "/help",
}


def button_command_alias(text: str) -> str | None:
    return BUTTON_COMMAND_ALIASES.get(normalize_step_value(text))


def extract_command_argument(text: str) -> str:
    return clean_text(str(text or "").partition(" ")[2])


def telegram_reply_keyboard() -> dict:
    return {
        "keyboard": [[{"text": label} for label in row] for row in BOT_KEYBOARD_ROWS],
        "resize_keyboard": True,
        "is_persistent": True,
        "input_field_placeholder": "Send A -> B or tap a quick action",
    }


def parse_route_pair(text: str) -> tuple[str, str] | None:
    match = re.match(r"^\s*(.+?)\s*(?:->|=>|→)\s*(.+?)\s*$", text)
    if not match:
        return None
    origin = clean_text(match.group(1))
    destination = clean_text(match.group(2))
    if len(origin) < 2 or len(destination) < 2:
        return None
    return origin, destination


def parse_positive_float(text: str) -> float | None:
    try:
        value = float(text.replace(",", "."))
    except ValueError:
        return None
    if not math.isfinite(value) or value <= 0:
        return None
    return round(value, 3)


def parse_percentage_float(text: str) -> float | None:
    normalized = text.replace("%", "").strip()
    value = parse_positive_float(normalized)
    if value is None or value > 100:
        return None
    return round(value, 1)


def gallons_from_percentage(value: float) -> float:
    return round(BOT_TANK_CAPACITY_GALLONS * (value / 100.0), 1)


def percentage_from_gallons(value: float | None) -> float:
    gallons = max(0.0, min(BOT_TANK_CAPACITY_GALLONS, float(value or 0.0)))
    return round((gallons / BOT_TANK_CAPACITY_GALLONS) * 100.0, 1)


def should_skip(text: str) -> bool:
    return normalize_step_value(text) in SKIP_TOKENS


def should_disable_price_target(text: str) -> bool:
    return normalize_step_value(text) in OFF_TOKENS


def format_duration(seconds: int | None) -> str:
    if seconds is None:
        return "-"
    hours = int(seconds // 3600)
    minutes = int(round((seconds % 3600) / 60))
    if hours <= 0:
        return f"{minutes}m"
    return f"{hours}h {minutes:02d}m"


def format_miles(meters: int | float | None) -> str:
    if meters is None:
        return "-"
    return f"{float(meters) * 0.000621371:.1f} mi"


def format_money(value: float | None) -> str:
    if value is None:
        return "-"
    return f"${value:,.2f}"


def format_price(value: float | None) -> str:
    if value is None:
        return "-"
    return f"${value:.3f}/gal"


def compact_truck_value(value: object) -> str:
    return re.sub(r"[^0-9a-zA-Z]+", "", str(value or "").strip().casefold())


def truck_lookup_keys(value: object) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    values: list[str] = []
    variants = [text, text.split("/", 1)[0]]
    variants.extend(re.split(r"[\s/#-]+", text))
    variants.extend(re.findall(r"\d+", text))
    for item in variants:
        normalized = compact_truck_value(item)
        if normalized and normalized not in values:
            values.append(normalized)
        if normalized.isdigit():
            stripped = normalized.lstrip("0")
            if stripped and stripped not in values:
                values.append(stripped)
    return values


def google_maps_route_link(plan: RouteAssistantResponse) -> str:
    origin = f"{plan.origin.lat},{plan.origin.lon}"
    destination = f"{plan.destination.lat},{plan.destination.lon}"
    waypoints: list[str] = []
    if plan.fuel_strategy and plan.fuel_strategy.status == "planned":
        for item in plan.fuel_strategy.stops[:3]:
            waypoints.append(f"{item.stop.lat},{item.stop.lon}")
    elif plan.selected_stop:
        waypoints.append(f"{plan.selected_stop.lat},{plan.selected_stop.lon}")
    params = {
        "api": 1,
        "origin": origin,
        "destination": destination,
        "travelmode": "driving",
    }
    if waypoints:
        params["waypoints"] = "|".join(waypoints)
    return f"https://www.google.com/maps/dir/?{urlencode(params)}"


def shortest_text(*values: object) -> str:
    for value in values:
        text = clean_text(value)
        if text:
            return text
    return ""


def find_motive_truck_defaults(truck_number: str) -> dict:
    lookup_keys = truck_lookup_keys(truck_number)
    if not lookup_keys:
        return {}
    snapshot = motive_client.fetch_snapshot(force_refresh=False, allow_stale=True)
    for vehicle in snapshot.get("vehicles") or []:
        candidate_keys = truck_lookup_keys(vehicle.get("number")) + truck_lookup_keys(vehicle.get("id")) + truck_lookup_keys(vehicle.get("license_plate_number"))
        if not any(item in candidate_keys for item in lookup_keys):
            continue
        location = vehicle.get("location") or {}
        detail = motive_client.fetch_vehicle_detail(int(vehicle.get("id")), force_refresh=False) if vehicle.get("id") else {}
        fuel_percent = location.get("fuel_level_percent")
        try:
            fuel_percent = float(fuel_percent) if fuel_percent not in (None, "") else None
        except (TypeError, ValueError):
            fuel_percent = None
        tank_capacity = None
        for value in (
            detail.get("tank_capacity_gallons"),
            detail.get("fuel_tank_capacity_gallons"),
            (detail.get("specs") or {}).get("tank_capacity_gallons") if isinstance(detail.get("specs"), dict) else None,
        ):
            try:
                if value not in (None, "") and float(value) > 0:
                    tank_capacity = float(value)
                    break
            except (TypeError, ValueError):
                continue
        mpg = detail.get("mpg")
        try:
            mpg = float(mpg) if mpg not in (None, "") else None
        except (TypeError, ValueError):
            mpg = None
        current_fuel_gallons = None
        if tank_capacity and fuel_percent is not None:
            current_fuel_gallons = round(tank_capacity * (fuel_percent / 100.0), 1)
        driver = vehicle.get("resolved_driver") or vehicle.get("driver") or vehicle.get("permanent_driver") or {}
        return {
            "vehicle_id": int(vehicle.get("id")) if vehicle.get("id") else None,
            "truck_number": shortest_text(vehicle.get("number"), truck_number),
            "driver_name": shortest_text(driver.get("full_name"), detail.get("driver_name")),
            "tank_capacity_gallons": tank_capacity,
            "mpg": mpg,
            "current_fuel_gallons": current_fuel_gallons,
            "fuel_percent": fuel_percent,
        }
    return {}


def find_db_truck_defaults(db: Session, truck_number: str) -> dict:
    term = truck_number.strip()
    if not term:
        return {}
    like_term = f"%{term}%"
    trip = db.scalar(
        select(FullRoadTrip)
        .where(FullRoadTrip.truck_number.ilike(like_term))
        .order_by(FullRoadTrip.updated_at.desc(), FullRoadTrip.id.desc())
    )
    if trip:
        return {
            "vehicle_id": trip.vehicle_id,
            "truck_number": trip.truck_number,
            "driver_name": trip.driver_name,
            "tank_capacity_gallons": trip.tank_capacity_gallons or None,
            "mpg": trip.mpg or None,
            "current_fuel_gallons": trip.current_fuel_gallons or None,
        }
    load = db.scalar(
        select(Load)
        .where(Load.truck.ilike(like_term))
        .order_by(Load.id.desc())
    )
    if load:
        current_fuel = None
        try:
            fuel_level = float(load.fuel_level)
            tank_capacity = float(load.tank_capacity)
            current_fuel = round(tank_capacity * (fuel_level / 100.0), 1)
        except (TypeError, ValueError):
            current_fuel = None
        try:
            mpg = float(load.mpg)
        except (TypeError, ValueError):
            mpg = None
        try:
            tank = float(load.tank_capacity)
        except (TypeError, ValueError):
            tank = None
        return {
            "vehicle_id": load.vehicle_id,
            "truck_number": load.truck,
            "driver_name": load.driver,
            "tank_capacity_gallons": tank,
            "mpg": mpg,
            "current_fuel_gallons": current_fuel,
        }
    return {}


def apply_truck_defaults(db: Session, profile: TelegramDriverProfile, truck_number: str) -> dict:
    merged: dict = {}
    try:
        merged.update(find_motive_truck_defaults(truck_number))
    except Exception:
        pass
    db_defaults = find_db_truck_defaults(db, truck_number)
    for key, value in db_defaults.items():
        if merged.get(key) in (None, "", 0):
            merged[key] = value

    profile.truck_number = shortest_text(merged.get("truck_number"), truck_number, profile.truck_number)
    if merged.get("vehicle_id"):
        profile.vehicle_id = merged["vehicle_id"]
    if merged.get("driver_name"):
        profile.driver_name = merged["driver_name"]
    if merged.get("tank_capacity_gallons"):
        profile.tank_capacity_gallons = float(merged["tank_capacity_gallons"])
    if merged.get("mpg"):
        profile.mpg = float(merged["mpg"])
    if merged.get("current_fuel_gallons"):
        profile.default_current_fuel_gallons = float(merged["current_fuel_gallons"])
    db.commit()
    db.refresh(profile)
    return merged


def truck_defaults_ready(profile: TelegramDriverProfile) -> bool:
    return bool(
        profile.truck_number
        and profile.default_current_fuel_gallons > 0
        and profile.tank_capacity_gallons > 0
        and profile.mpg > 0
    )


def format_price_target_value(value: float | None) -> str:
    if value is None:
        return "off"
    return f"${value:.3f}/gal"


def last_route_label(profile: TelegramDriverProfile) -> str:
    if profile.last_origin and profile.last_destination:
        return f"{profile.last_origin} -> {profile.last_destination}"
    return "not built yet"


def truck_binding_label(profile: TelegramDriverProfile) -> str:
    if not profile.truck_number:
        return "not bound"
    parts = [profile.truck_number]
    if profile.driver_name:
        parts.append(profile.driver_name)
    if profile.vehicle_id:
        parts.append(f"vehicle #{profile.vehicle_id}")
    return " | ".join(parts)


def wizard_state_label(profile: TelegramDriverProfile) -> str:
    if profile.active_step == "building":
        return "building smart route"
    if profile.active_step in WIZARD_STEPS:
        draft = dict(profile.pending_payload or {})
        route_bits = []
        if draft.get("origin"):
            route_bits.append(str(draft.get("origin")))
        if draft.get("destination"):
            route_bits.append(str(draft.get("destination")))
        route_label = f" | {' -> '.join(route_bits)}" if route_bits else ""
        return f"waiting for {profile.active_step}{route_label}"
    return "idle"


def profile_header(profile: TelegramDriverProfile) -> str:
    operator = shortest_text(profile.first_name, profile.telegram_username, "dispatcher")
    return f"Operator: {operator}"


def profile_summary(profile: TelegramDriverProfile) -> str:
    fuel_percentage = percentage_from_gallons(profile.default_current_fuel_gallons)
    return "\n".join(
        [
            "Saved route profile",
            profile_header(profile),
            f"Truck: {truck_binding_label(profile)}",
            f"Fuel: {fuel_percentage:.1f}% of {BOT_TANK_CAPACITY_GALLONS:.0f} gal",
            f"MPG: {profile.mpg:.2f}",
            f"Target: {format_price_target_value(profile.price_target)}",
            f"Last route: {last_route_label(profile)}",
        ]
    )


def status_message(profile: TelegramDriverProfile) -> str:
    fuel_percentage = percentage_from_gallons(profile.default_current_fuel_gallons)
    return "\n".join(
        [
            "United Lane Telegram control panel",
            profile_header(profile),
            f"Truck: {truck_binding_label(profile)}",
            f"Profile: Fuel {fuel_percentage:.1f}% | Tank {BOT_TANK_CAPACITY_GALLONS:.0f} gal | MPG {profile.mpg:.2f} | Target {format_price_target_value(profile.price_target)}",
            f"Last route: {last_route_label(profile)}",
            f"Wizard: {wizard_state_label(profile)}",
            "",
            "Quick actions:",
            "- /route to build a fresh smart route",
            "- /reroute to reuse the last lane",
            "- /truck 5188 to bind and sync a truck",
            "- Send Point A -> Point B anytime",
        ]
    )


def help_message(profile: TelegramDriverProfile) -> str:
    return "\n".join(
        [
            "United Lane smart route bot",
            "",
            "Commands:",
            "/route - start full route wizard",
            "/reroute - rebuild the last saved lane",
            "/status - open the control panel summary",
            "/profile - show saved truck, MPG, fuel, and target",
            "/truck 5188 - bind a truck and sync defaults from fleet/load data",
            "/reset - cancel the current wizard",
            "/help - show this message",
            "",
            "Quick format:",
            "Chicago, IL -> Dallas, TX",
            "",
            "The bot asks only for MPG and fuel % of a fixed 200 gal tank. Use /skip to keep saved values.",
            "",
            profile_summary(profile),
        ]
    )


def route_wizard_intro(profile: TelegramDriverProfile) -> str:
    return "\n".join(
        [
            "Route wizard started.",
            "Send A -> B or go step by step.",
            f"Truck: {truck_binding_label(profile)}",
            route_profile_status(profile),
            "",
            prompt_for_step(profile, "origin"),
        ]
    )


def start_repeat_route(db: Session, profile: TelegramDriverProfile) -> bool:
    origin = clean_text(profile.last_origin)
    destination = clean_text(profile.last_destination)
    if len(origin) < 2 or len(destination) < 2:
        return False
    profile.tank_capacity_gallons = BOT_TANK_CAPACITY_GALLONS
    profile.pending_payload = {"origin": origin, "destination": destination}
    profile.active_step = "mpg"
    db.commit()
    db.refresh(profile)
    return True


def truck_binding_message(profile: TelegramDriverProfile, merged: dict) -> str:
    synced_fields = []
    if merged.get("driver_name"):
        synced_fields.append(f"driver {merged['driver_name']}")
    if merged.get("vehicle_id"):
        synced_fields.append(f"vehicle #{merged['vehicle_id']}")
    if merged.get("fuel_percent") is not None:
        synced_fields.append(f"fuel {float(merged['fuel_percent']):.1f}%")
    if merged.get("mpg"):
        synced_fields.append(f"MPG {float(merged['mpg']):.2f}")
    if merged.get("tank_capacity_gallons"):
        synced_fields.append(f"tank {float(merged['tank_capacity_gallons']):.0f} gal")

    lines = [
        f"Truck saved: {profile.truck_number}",
        f"Current binding: {truck_binding_label(profile)}",
    ]
    if synced_fields:
        lines.append("Synced defaults: " + " | ".join(synced_fields))
    else:
        lines.append("No live fleet defaults were found, so the bot kept the saved profile values.")
    lines.append("")
    lines.append(profile_summary(profile))
    return "\n".join(lines)


def prompt_for_step(profile: TelegramDriverProfile, step: str) -> str:
    if step == "origin":
        return "Send point A. Example: Chicago, IL"
    if step == "destination":
        draft = dict(profile.pending_payload or {})
        origin = clean_text(draft.get("origin"))
        origin_line = f"Point A saved: {origin}\n" if origin else ""
        return f"{origin_line}Send point B. Example: Dallas, TX"
    if step == "mpg":
        return f"Route profile: {route_profile_status(profile)}\nSend truck MPG. Current saved: {profile.mpg:.2f}. Use /skip to keep it."
    if step == "fuel_percentage":
        draft = dict(profile.pending_payload or {})
        current = percentage_from_gallons(profile.default_current_fuel_gallons)
        mpg = draft.get("mpg") or profile.mpg
        return f"MPG ready: {float(mpg):.2f}\nSend fuel % for a {BOT_TANK_CAPACITY_GALLONS:.0f} gal tank. Current saved: {current:.1f}%. Use /skip to keep it."
    if step == "price_target":
        draft = dict(profile.pending_payload or {})
        current = format_price_target_value(profile.price_target)
        fuel_percentage = draft.get("fuel_percentage")
        fuel_line = f"Fuel ready: {float(fuel_percentage):.1f}%\n" if fuel_percentage is not None else ""
        return f"{fuel_line}{route_profile_status(profile)}\nTarget price: send value, /skip for {current}, or off."
    return "Send the next value."


def ensure_bot_user(db: Session) -> User:
    username = normalize_username(settings.telegram_bot_system_username) or "telegram.bot"
    email = normalize_email(settings.telegram_bot_system_email or f"{username}@system.unitedlanesys.local")
    user = db.scalar(select(User).where(or_(func.lower(User.username) == username, func.lower(User.email) == email)))
    if user is None:
        user = User(
            email=email,
            username=username,
            full_name="Telegram Bot",
            department="fuel",
            hashed_password=hash_password("telegram-bot-only"),
            is_banned=False,
            ban_reason="",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    user.email = email
    user.username = username
    user.full_name = user.full_name or "Telegram Bot"
    user.department = "fuel"
    user.is_banned = False
    user.ban_reason = ""
    db.commit()
    db.refresh(user)
    return user


def get_or_create_profile(db: Session, chat_id: str, user_payload: dict) -> TelegramDriverProfile:
    profile = db.scalar(select(TelegramDriverProfile).where(TelegramDriverProfile.chat_id == chat_id))
    if profile is None:
        profile = TelegramDriverProfile(
            chat_id=chat_id,
            telegram_user_id=str(user_payload.get("id") or ""),
            telegram_username=clean_text(user_payload.get("username")),
            first_name=clean_text(user_payload.get("first_name")),
            last_name=clean_text(user_payload.get("last_name")),
        )
        db.add(profile)
    else:
        profile.telegram_user_id = str(user_payload.get("id") or profile.telegram_user_id or "")
        profile.telegram_username = clean_text(user_payload.get("username")) or profile.telegram_username
        profile.first_name = clean_text(user_payload.get("first_name")) or profile.first_name
        profile.last_name = clean_text(user_payload.get("last_name")) or profile.last_name
    db.commit()
    db.refresh(profile)
    return profile


def reset_wizard(db: Session, profile: TelegramDriverProfile) -> None:
    profile.active_step = ""
    profile.pending_payload = {}
    db.commit()
    db.refresh(profile)


def start_route_wizard(db: Session, profile: TelegramDriverProfile) -> None:
    profile.tank_capacity_gallons = BOT_TANK_CAPACITY_GALLONS
    profile.active_step = "origin"
    profile.pending_payload = {}
    db.commit()
    db.refresh(profile)


def build_route_request(profile: TelegramDriverProfile) -> RouteAssistantRequest:
    draft = dict(profile.pending_payload or {})
    origin = clean_text(draft.get("origin"))
    destination = clean_text(draft.get("destination"))
    current_fuel_gallons = float(draft.get("current_fuel_gallons") or profile.default_current_fuel_gallons)
    mpg = float(draft.get("mpg") or profile.mpg)
    price_target = draft.get("price_target")
    if price_target is None:
        price_target = profile.price_target
    return RouteAssistantRequest(
        origin=origin,
        destination=destination,
        vehicle_id=profile.vehicle_id,
        vehicle_number=profile.truck_number or "",
        driver_name=profile.driver_name or "",
        vehicle_type=profile.vehicle_type or "Truck",
        fuel_type=profile.fuel_type or "Auto Diesel",
        current_fuel_gallons=current_fuel_gallons,
        tank_capacity_gallons=BOT_TANK_CAPACITY_GALLONS,
        mpg=mpg,
        allow_no_fuel=False,
        allow_missing_cost=True,
        allow_unattended=False,
        sort_by="best",
        price_target=price_target,
        start_range="",
        full_range="",
        amenities=[],
        affiliations=[],
    )


def route_profile_status(profile: TelegramDriverProfile) -> str:
    parts = [
        f"Fuel {percentage_from_gallons(profile.default_current_fuel_gallons):.1f}%",
        f"Tank {BOT_TANK_CAPACITY_GALLONS:.0f} gal",
        f"MPG {profile.mpg:.2f}",
    ]
    return " | ".join(parts)


def consume_step_input(db: Session, profile: TelegramDriverProfile, text: str) -> tuple[bool, str | None]:
    draft = dict(profile.pending_payload or {})
    step = profile.active_step
    cleaned = clean_text(text)

    if step == "origin":
        if len(cleaned) < 2:
            return False, "Point A is too short. Send a city, address, or coordinates."
        draft["origin"] = cleaned
        profile.pending_payload = draft
        profile.active_step = "destination"
    elif step == "destination":
        if len(cleaned) < 2:
            return False, "Point B is too short. Send a city, address, or coordinates."
        draft["destination"] = cleaned
        profile.pending_payload = draft
        profile.active_step = "mpg"
    elif step == "mpg":
        if should_skip(cleaned):
            draft["mpg"] = profile.mpg
        else:
            value = parse_positive_float(cleaned)
            if value is None:
                return False, "MPG must be a positive number."
            draft["mpg"] = value
        profile.pending_payload = draft
        profile.active_step = "fuel_percentage"
    elif step == "fuel_percentage":
        if should_skip(cleaned):
            draft["current_fuel_gallons"] = profile.default_current_fuel_gallons
            draft["fuel_percentage"] = percentage_from_gallons(profile.default_current_fuel_gallons)
        else:
            value = parse_percentage_float(cleaned)
            if value is None:
                return False, "Fuel % must be between 0 and 100."
            draft["fuel_percentage"] = value
            draft["current_fuel_gallons"] = gallons_from_percentage(value)
        profile.pending_payload = draft
        profile.active_step = "price_target"
    elif step == "price_target":
        if should_skip(cleaned):
            draft["price_target"] = profile.price_target
        elif should_disable_price_target(cleaned):
            draft["price_target"] = None
        else:
            value = parse_positive_float(cleaned)
            if value is None:
                return False, "Price target must be a positive number, or send off."
            draft["price_target"] = value
        profile.pending_payload = draft
        profile.active_step = "building"
    else:
        return False, "No active route wizard. Send /route to start."

    db.commit()
    db.refresh(profile)
    return True, None


def map_mercator_x(lon: float, zoom: float) -> float:
    world_size = 256.0 * (2.0 ** zoom)
    return ((lon + 180.0) / 360.0) * world_size


def map_mercator_y(lat: float, zoom: float) -> float:
    world_size = 256.0 * (2.0 ** zoom)
    lat = max(min(lat, 85.05112878), -85.05112878)
    sin_lat = math.sin(math.radians(lat))
    return (0.5 - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)) * world_size


def choose_zoom(points: list[tuple[float, float]], width: int, height: int, padding: int) -> int:
    if len(points) <= 1:
        return 9
    lats = [lat for lat, _lon in points]
    lons = [lon for _lat, lon in points]
    min_lon, max_lon = min(lons), max(lons)
    min_lat, max_lat = min(lats), max(lats)
    lon_fraction = max((max_lon - min_lon) / 360.0, 0.000001)
    max_world_width = max(width - (padding * 2), 64)
    zoom_x = math.log2(max_world_width / (256.0 * lon_fraction))

    top_y = map_mercator_y(max_lat, 0)
    bottom_y = map_mercator_y(min_lat, 0)
    y_fraction = max(abs(bottom_y - top_y) / 256.0, 0.000001)
    max_world_height = max(height - (padding * 2), 64)
    zoom_y = math.log2(max_world_height / (256.0 * y_fraction))
    zoom = int(max(2, min(18, math.floor(min(zoom_x, zoom_y)))))
    return zoom


def project_to_image(lat: float, lon: float, center_lat: float, center_lon: float, zoom: int, width: int, height: int) -> tuple[float, float]:
    x = map_mercator_x(lon, zoom)
    y = map_mercator_y(lat, zoom)
    center_x = map_mercator_x(center_lon, zoom)
    center_y = map_mercator_y(center_lat, zoom)
    return (x - center_x) + (width / 2.0), (y - center_y) + (height / 2.0)


def fetch_static_map(center_lat: float, center_lon: float, zoom: int, width: int, height: int) -> Image.Image | None:
    if not settings.tomtom_api_key:
        return None
    query = urlencode(
        {
            "key": settings.tomtom_api_key,
            "zoom": zoom,
            "center": f"{center_lon:.6f},{center_lat:.6f}",
            "format": "png",
            "layer": "basic",
            "style": "main",
            "width": width,
            "height": height,
            "view": "Unified",
            "language": "en-US",
        }
    )
    request = Request(f"https://api.tomtom.com/map/1/staticimage?{query}", method="GET", headers={"Accept": "image/png"})
    try:
        with urlopen(request, timeout=30, context=ssl_context) as response:
            return Image.open(BytesIO(response.read())).convert("RGBA")
    except Exception:
        return None


def build_fallback_map(width: int, height: int) -> Image.Image:
    image = Image.new("RGBA", (width, height), "#F7FAFC")
    draw = ImageDraw.Draw(image)
    for x in range(0, width, 96):
        draw.line([(x, 0), (x, height)], fill="#E2E8F0", width=1)
    for y in range(0, height, 96):
        draw.line([(0, y), (width, y)], fill="#E2E8F0", width=1)
    return image


def draw_marker(draw: ImageDraw.ImageDraw, point: tuple[float, float], fill: str, outline: str, label: str | None = None) -> None:
    x, y = point
    radius = 9
    draw.ellipse([(x - radius, y - radius), (x + radius, y + radius)], fill=fill, outline=outline, width=2)
    if label:
        font = ImageFont.load_default()
        draw.text((x + 12, y - 10), label, fill="#111827", font=font)


def route_points_for_image(plan: RouteAssistantResponse) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = [(plan.origin.lat, plan.origin.lon), (plan.destination.lat, plan.destination.lon)]
    for route in plan.routes:
        points.extend((point.lat, point.lon) for point in route.points)
    if plan.selected_stop:
        points.append((plan.selected_stop.lat, plan.selected_stop.lon))
    if plan.fuel_strategy:
        for item in plan.fuel_strategy.stops:
            points.append((item.stop.lat, item.stop.lon))
    return points


def render_route_image(plan: RouteAssistantResponse) -> bytes:
    width = max(640, min(2048, int(settings.telegram_route_image_width or 1280)))
    height = max(480, min(2048, int(settings.telegram_route_image_height or 720)))
    padding = 72
    points = route_points_for_image(plan)
    center_lat = sum(lat for lat, _lon in points) / len(points)
    center_lon = sum(lon for _lat, lon in points) / len(points)
    zoom = choose_zoom(points, width, height, padding)
    image = fetch_static_map(center_lat, center_lon, zoom, width, height) or build_fallback_map(width, height)
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()

    for index, route in enumerate(plan.routes):
        projected = [
            project_to_image(point.lat, point.lon, center_lat, center_lon, zoom, width, height)
            for point in route.points
        ]
        if len(projected) >= 2:
            draw.line(projected, fill=ROUTE_COLORS[index % len(ROUTE_COLORS)], width=8 if index == 0 else 5, joint="curve")

    origin_point = project_to_image(plan.origin.lat, plan.origin.lon, center_lat, center_lon, zoom, width, height)
    destination_point = project_to_image(plan.destination.lat, plan.destination.lon, center_lat, center_lon, zoom, width, height)
    draw_marker(draw, origin_point, "#10B981", "#064E3B", "A")
    draw_marker(draw, destination_point, "#EF4444", "#7F1D1D", "B")

    if plan.selected_stop:
        stop_point = project_to_image(plan.selected_stop.lat, plan.selected_stop.lon, center_lat, center_lon, zoom, width, height)
        draw_marker(draw, stop_point, "#F59E0B", "#92400E", plan.selected_stop.brand or plan.selected_stop.name or "Fuel")

    if plan.fuel_strategy:
        for item in plan.fuel_strategy.stops:
            stop_point = project_to_image(item.stop.lat, item.stop.lon, center_lat, center_lon, zoom, width, height)
            draw_marker(draw, stop_point, "#1D4ED8", "#172554", str(item.sequence))

    draw.rounded_rectangle([(24, 24), (width - 24, 126)], radius=18, fill=(255, 255, 255, 220), outline="#CBD5E1", width=2)
    draw.text((42, 40), "United Lane Smart Route", fill="#0F172A", font=font)
    draw.text(
        (42, 62),
        f"{plan.origin.label} -> {plan.destination.label}",
        fill="#111827",
        font=font,
    )
    primary_route = plan.routes[0] if plan.routes else None
    meta = []
    if primary_route:
        meta.append(f"Distance {format_miles(primary_route.distance_meters)}")
        meta.append(f"Drive {format_duration(primary_route.travel_time_seconds)}")
    if plan.fuel_strategy:
        meta.append(f"Smart stops {plan.fuel_strategy.stop_count}")
        meta.append(f"Fuel {format_money(plan.fuel_strategy.estimated_fuel_cost)}")
    draw.text((42, 88), " | ".join(meta), fill="#1F2937", font=font)

    stream = BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def build_route_caption(plan: RouteAssistantResponse, approval_code: str | None, truck_number: str) -> str:
    primary_route = plan.routes[0] if plan.routes else None
    lines = [
        "Smart Fuel Route",
        f"{plan.origin.label} -> {plan.destination.label}",
    ]
    if clean_text(truck_number):
        lines.append(f"Truck: {truck_number}")
    if primary_route:
        lines.append(f"{format_miles(primary_route.distance_meters)} | {format_duration(primary_route.travel_time_seconds)}")
    if plan.fuel_strategy:
        if plan.fuel_strategy.status == "direct":
            lines.append("No fuel stop needed")
        else:
            lines.append(
                f"{plan.fuel_strategy.stop_count} fuel stop(s) | {format_money(plan.fuel_strategy.estimated_fuel_cost)}"
            )
    if approval_code:
        lines.append(f"Approval: {approval_code}")
    return "\n".join(lines)


def build_route_details(plan: RouteAssistantResponse, approval_record, truck_number: str = "") -> str:
    lines: list[str] = []
    primary_route = plan.routes[0] if plan.routes else None
    route_link = google_maps_route_link(plan)
    if clean_text(truck_number):
        lines.append(f"Truck: {truck_number}")
    if primary_route:
        lines.append(f"Route: {format_miles(primary_route.distance_meters)} | {format_duration(primary_route.travel_time_seconds)}")
    if plan.fuel_strategy:
        if plan.fuel_strategy.status == "direct":
            lines.append("Fuel: enough to finish without fueling.")
        else:
            lines.append(f"Fuel: {plan.fuel_strategy.stop_count} stop(s) | est {format_money(plan.fuel_strategy.estimated_fuel_cost)}")
            for item in plan.fuel_strategy.stops[:3]:
                lines.append(
                    f"{item.sequence}. {item.stop.brand or item.stop.name} | "
                    f"{item.stop.city or item.stop.address} | "
                    f"{item.gallons_to_buy:.1f} gal | "
                    f"{format_price(item.auto_diesel_price or item.stop.price or item.stop.auto_diesel_price)}"
                )
    elif plan.selected_stop:
        lines.append(
            f"Fuel stop: {plan.selected_stop.brand or plan.selected_stop.name} | "
            f"{plan.selected_stop.city or plan.selected_stop.address} | "
            f"{format_price(plan.selected_stop.price or plan.selected_stop.auto_diesel_price)}"
        )

    if approval_record is not None:
        lines.append(f"Approval: {approval_record.approval_code}")
    lines.append(f"Google Maps: {route_link}")
    return "\n".join(part for part in lines if clean_text(part))


def maybe_create_fuel_authorization(db: Session, bot_user: User, payload: RouteAssistantRequest, plan: RouteAssistantResponse):
    if not plan.fuel_strategy or plan.fuel_strategy.status != "planned" or not plan.fuel_strategy.stops:
        return None
    stop_plan = plan.fuel_strategy.stops[0]
    stop = stop_plan.stop
    create_payload = FuelAuthorizationCreate(
        routing_request_id=plan.routing_request_id,
        vehicle_id=payload.vehicle_id,
        vehicle_number=payload.vehicle_number,
        driver_name=payload.driver_name,
        origin_label=plan.origin.label,
        destination_label=plan.destination.label,
        route_id=plan.fuel_strategy.route_id or (plan.routes[0].id if plan.routes else ""),
        route_label=plan.fuel_strategy.route_label or (plan.routes[0].label if plan.routes else ""),
        station_id=stop.id,
        station_name=stop.name,
        station_brand=stop.brand,
        station_address=stop.address,
        station_city=stop.city,
        station_state=stop.state_code or "",
        station_postal_code=stop.postal_code or "",
        station_lat=stop.lat,
        station_lon=stop.lon,
        station_source_url=stop.source_url or "",
        station_map_link=plan.station_map_link or "",
        fuel_type=payload.fuel_type,
        planned_gallons=stop_plan.gallons_to_buy,
        planned_amount=stop_plan.estimated_cost,
        planned_price_per_gallon=stop_plan.auto_diesel_price or stop.price or stop.auto_diesel_price,
        price_target=payload.price_target,
        fuel_before_gallons=stop_plan.fuel_before_gallons,
        fuel_after_gallons=stop_plan.fuel_after_gallons,
        route_miles=stop_plan.route_miles,
        miles_to_next=stop_plan.miles_to_next,
        safety_buffer_miles=stop_plan.safety_buffer_miles,
        dispatcher_note=stop_plan.reason,
        source="telegram_bot",
        policy_snapshot={"channel": "telegram"},
        station_snapshot=stop.model_dump(),
        strategy_snapshot=plan.fuel_strategy.model_dump(),
    )
    return create_authorization_record(db, bot_user, create_payload)


def persist_profile_after_route(db: Session, profile: TelegramDriverProfile, payload: RouteAssistantRequest, plan: RouteAssistantResponse) -> None:
    profile.truck_number = payload.vehicle_number or profile.truck_number
    profile.driver_name = payload.driver_name or profile.driver_name
    profile.vehicle_id = payload.vehicle_id or profile.vehicle_id
    profile.vehicle_type = payload.vehicle_type
    profile.fuel_type = payload.fuel_type
    profile.default_current_fuel_gallons = payload.current_fuel_gallons or profile.default_current_fuel_gallons
    profile.tank_capacity_gallons = BOT_TANK_CAPACITY_GALLONS
    profile.mpg = payload.mpg or profile.mpg
    profile.price_target = payload.price_target
    profile.last_origin = payload.origin
    profile.last_destination = payload.destination
    profile.last_routing_request_id = plan.routing_request_id
    profile.active_step = ""
    profile.pending_payload = {}
    db.commit()
    db.refresh(profile)


def build_route_bundle(profile_id: int) -> RouteBuildBundle:
    from app.database import SessionLocal

    with SessionLocal() as db:
        profile = db.get(TelegramDriverProfile, profile_id)
        if not profile:
            raise RuntimeError("Truck profile was not found. Send /route to start again.")

        try:
            payload = build_route_request(profile)
        except Exception as exc:
            reset_wizard(db, profile)
            raise RuntimeError("The route wizard data is incomplete. Send /route to start again.") from exc

        try:
            bot_user = ensure_bot_user(db)
            plan = route_assistant(payload, current_user=bot_user, db=db)
            approval_record = maybe_create_fuel_authorization(db, bot_user, payload, plan)
            image_bytes = render_route_image(plan)
            persist_profile_after_route(db, profile, payload, plan)
            return RouteBuildBundle(
                chat_id=profile.chat_id,
                image_bytes=image_bytes,
                caption=build_route_caption(plan, getattr(approval_record, "approval_code", None), payload.vehicle_number),
                details=build_route_details(plan, approval_record, payload.vehicle_number),
            )
        except HTTPException as exc:
            reset_wizard(db, profile)
            detail = exc.detail if isinstance(exc.detail, str) else "Route build failed."
            raise RuntimeError(f"Route build failed: {detail}") from exc
        except Exception as exc:
            reset_wizard(db, profile)
            raise RuntimeError(f"Route build failed: {exc}") from exc


def execute_route_build(chat_id: str, profile_id: int) -> None:
    try:
        send_chat_action(chat_id, "typing")
        bundle = build_route_bundle(profile_id)
        send_chat_action(chat_id, "upload_photo")
        send_route_photo(chat_id, bundle.image_bytes, bundle.caption)
        send_message(chat_id, bundle.details)
    except Exception as exc:
        send_message(chat_id, f"{exc}\n\nSend /route and try again.")


def handle_command(db: Session, profile: TelegramDriverProfile, chat_id: str, text: str) -> None:
    command = normalize_step_value(text.split()[0])
    if command in {"/start", "/help", "/menu"}:
        reset_wizard(db, profile)
        send_message(chat_id, help_message(profile))
        return
    if command == "/profile":
        send_message(chat_id, profile_summary(profile))
        return
    if command == "/status":
        send_message(chat_id, status_message(profile))
        return
    if command == "/truck":
        truck_number = extract_command_argument(text)
        if not truck_number:
            send_message(chat_id, f"Use /truck 5188 to bind a truck.\nCurrent binding: {truck_binding_label(profile)}")
            return
        merged = apply_truck_defaults(db, profile, truck_number)
        send_message(chat_id, truck_binding_message(profile, merged))
        return
    if command == "/reset":
        reset_wizard(db, profile)
        send_message(chat_id, "Current wizard cleared. Send /route to start again.")
        return
    if command == "/reroute":
        if not start_repeat_route(db, profile):
            send_message(chat_id, "No saved last route yet. Build one with /route first.")
            return
        send_message(chat_id, "Last route loaded.\n" + prompt_for_step(profile, "mpg"))
        return
    if command == "/route":
        start_route_wizard(db, profile)
        send_message(chat_id, route_wizard_intro(profile))
        return
    send_message(chat_id, "Unknown command. Send /help for instructions.")


def handle_text(db: Session, profile: TelegramDriverProfile, chat_id: str, text: str) -> None:
    alias_command = button_command_alias(text)
    if alias_command:
        handle_command(db, profile, chat_id, alias_command)
        return

    if profile.active_step == "building":
        send_message(chat_id, "A route is already building. Wait for the result or send /reset.")
        return

    quick_route = parse_route_pair(text)
    if quick_route:
        origin, destination = quick_route
        profile.pending_payload = {"origin": origin, "destination": destination}
        profile.active_step = "mpg"
        db.commit()
        db.refresh(profile)
        send_message(chat_id, f"Saved route points: {origin} -> {destination}\n" + prompt_for_step(profile, "mpg"))
        return

    if profile.active_step and profile.active_step in WIZARD_STEPS:
        ok, error_text = consume_step_input(db, profile, text)
        if not ok:
            send_message(chat_id, error_text or "Value is invalid. Try again.")
            return
        if profile.active_step == "building":
            send_message(chat_id, "Building smart route and fuel plan. Please wait...")
            execute_route_build(chat_id, profile.id)
            return
        send_message(chat_id, prompt_for_step(profile, profile.active_step))
        return

    send_message(chat_id, "Use the quick buttons below, send /route, or send Point A -> Point B.")


def handle_telegram_update(update: dict) -> None:
    message = update.get("message")
    if not isinstance(message, dict):
        return

    chat = message.get("chat") or {}
    if clean_text(chat.get("type")) not in {"private", ""}:
        return

    text = clean_text(message.get("text"))
    if not text:
        return

    chat_id = str(chat.get("id") or "")
    if not chat_id:
        return

    from app.database import SessionLocal

    with SessionLocal() as db:
        profile = get_or_create_profile(db, chat_id, message.get("from") or {})
        if text.startswith("/"):
            handle_command(db, profile, chat_id, text)
            return
        handle_text(db, profile, chat_id, text)
