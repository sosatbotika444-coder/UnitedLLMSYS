import re

DRIVER_EMAIL_DOMAIN = "drivers.unitedlane.com"
DRIVER_EMAIL_PREFIX = "driver+"


def normalize_driver_name(value: object) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def make_driver_email(vehicle_id: int | str) -> str:
    safe_vehicle_id = re.sub(r"[^0-9a-zA-Z_-]+", "", str(vehicle_id or "").strip())
    return f"{DRIVER_EMAIL_PREFIX}{safe_vehicle_id}@{DRIVER_EMAIL_DOMAIN}"


def parse_driver_vehicle_id(email: str | None) -> int | None:
    text = str(email or "").strip().lower()
    prefix = DRIVER_EMAIL_PREFIX
    suffix = f"@{DRIVER_EMAIL_DOMAIN}"
    if not text.startswith(prefix) or not text.endswith(suffix):
        return None
    raw_vehicle_id = text[len(prefix):-len(suffix)]
    if not raw_vehicle_id.isdigit():
        return None
    return int(raw_vehicle_id)
