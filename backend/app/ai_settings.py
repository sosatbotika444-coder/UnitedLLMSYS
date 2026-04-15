from __future__ import annotations

import logging
import re
from textwrap import dedent

try:
    from openai import APIStatusError, OpenAI
except ModuleNotFoundError:
    APIStatusError = None
    OpenAI = None

from app.config import get_settings

settings = get_settings()
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = settings.openrouter_model
DEFAULT_CHAT_MODEL = settings.openrouter_chat_model
DEFAULT_CHAT_MAX_OUTPUT_TOKENS = settings.openrouter_chat_max_output_tokens
DEFAULT_APP_NAME = settings.openrouter_app_name
DEFAULT_APP_URL = settings.openrouter_app_url
DEFAULT_OPENROUTER_API_KEY = settings.openrouter_api_key
UNITEDLANE_IDENTITY = "UnitedLane"
UNITEDLANE_CHAT_IDENTITY = "Safety Team"
CHAT_IMAGE_DATA_URL_PATTERN = re.compile(r"^data:(image/(?:png|jpeg|webp|gif));base64,[A-Za-z0-9+/=\s]+$")
CHAT_IMAGE_MAX_DATA_URL_LENGTH = 8_000_000
CHAT_IMAGE_DECLINE_PATTERNS = (
    re.compile(r"\b(?:can(?:not|'t)|unable to|do not|don't|currently can't)\b.{0,80}\b(?:view|see|analy[sz]e|inspect)\b.{0,30}\bimage", re.IGNORECASE),
    re.compile(r"\b(?:if|once)\s+you\s+describe\b.{0,80}\b(?:image|content)\b", re.IGNORECASE),
)
UNITEDLANE_CHAT_PROVIDER_UNAVAILABLE_MESSAGE = "Safety Team couldn't reach OpenRouter right now. Please retry in a moment."
UNITEDLANE_IMAGE_ANALYSIS_UNAVAILABLE_MESSAGE = (
    "Safety Team couldn't analyze the attached image right now. Please retry in a moment or upload a smaller PNG, JPEG, WEBP, or GIF image."
)
logger = logging.getLogger(__name__)


class UnitedLaneChatProviderError(RuntimeError):
    pass


class UnitedLaneImageAnalysisUnavailableError(UnitedLaneChatProviderError):
    pass

STATION_PRICE_SYSTEM_PROMPT = """You are a US fuel price lookup assistant.

Your job is to find the most accurate current retail fuel price for a gas station in the United States based on either:
- exact coordinates, or
- a US street address, city, state, ZIP, or station name query.

Source priority:
1. GasBuddy
2. Official station or brand pages
3. Google Maps business listing
4. Apple Maps, Bing Maps, MapQuest, Yelp, Waze, and other reputable local listings
5. Other reputable fuel-price aggregators

Rules:
1. Use web search and current online sources whenever possible.
2. Prefer the station nearest to the provided coordinates or the best exact match for the provided US address.
3. Check GasBuddy first. If GasBuddy does not show a trustworthy price, cross-check with official station pages or other reputable map/listing sources.
4. If multiple stations match, choose the closest exact match and clearly say which station you selected.
5. Return a short normal text answer for a human, not JSON.
6. Never invent a price. If no trustworthy current price is available, say that the price could not be confirmed.
7. Prefer USD per gallon unless the source clearly uses another unit.
8. Mention the exact source used, and if possible include how recent the posted price is.
9. If the user gives coordinates, include the nearest station address if found.
10. If the user gives an address, confirm the matched station or nearest gas station at that address.
11. The answer must stay practical and concise.
12. You may mention 1 or 2 backup sources checked, but keep the final answer compact.

Answer format:
Station: <station name or unknown>
Fuel: <fuel type>
Price: <$X.XXX/gal or not confirmed>
Address: <full address or nearest location>
Source: <GasBuddy or other source used>
Updated: <timestamp if known>
Notes: <short explanation mentioning cross-check if relevant>
"""

UNITEDLANE_ROUTE_SYSTEM_PROMPT = """You are UnitedLane, an AI driving assistant for the United Lane website.

Identity rules:
1. You must always speak in polished, warm, very polite English.
2. If anyone asks who you are, answer: I am UnitedLane, your AI route and fuel assistant.
3. Never claim to be a human.
4. You help drivers reach a selected fuel stop with calm, detailed, practical guidance.

Response rules:
1. Write in natural text, not JSON.
2. Be detailed, but keep the wording useful and easy to follow.
3. Mention the selected station name, address, why it was chosen, and any price information if available.
4. Explain how to begin from the starting point, stay on the main route, when to leave for the fuel stop, and what to do after arrival.
5. If exact turn-by-turn street instructions are unavailable, say that the live map should be used for final turn details.
6. End with a reassuring closing sentence.
"""


def get_openrouter_client(api_key: str | None = None, timeout_seconds: float | None = None):
    resolved_key = api_key or DEFAULT_OPENROUTER_API_KEY
    if not resolved_key:
        raise ValueError("OPENROUTER_API_KEY is not set")
    if OpenAI is None:
        raise RuntimeError("openai package is not installed")

    client_options = {
        "base_url": OPENROUTER_BASE_URL,
        "api_key": resolved_key,
    }
    if timeout_seconds is not None:
        client_options["timeout"] = timeout_seconds
    return OpenAI(**client_options)


def build_station_price_prompt(
    fuel_type: str = "diesel",
    latitude: float | None = None,
    longitude: float | None = None,
    address: str | None = None,
    search_radius_meters: int = 1000,
    country_hint: str = "USA",
) -> str:
    location_parts: list[str] = []
    if latitude is not None and longitude is not None:
        location_parts.append(f"Coordinates: latitude={latitude}, longitude={longitude}.")
        location_parts.append(f"Search radius: {search_radius_meters} meters.")
    if address:
        location_parts.append(f"US address or place query: {address}.")

    if not location_parts:
        raise ValueError("Either coordinates or address must be provided")

    return (
        "Find the current fuel price for the best matching gas station in the United States. "
        + " ".join(location_parts)
        + f" Fuel type: {fuel_type}. Country hint: {country_hint}. "
        + "Check GasBuddy first, then verify with official station pages or reputable map/listing sources when possible. "
        + "If several stations are nearby, choose the closest exact match with the most trustworthy current price. "
        + "Answer in normal readable text using the format from the system message."
    )


def build_station_price_messages(
    fuel_type: str = "diesel",
    latitude: float | None = None,
    longitude: float | None = None,
    address: str | None = None,
    search_radius_meters: int = 1000,
    country_hint: str = "USA",
) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": STATION_PRICE_SYSTEM_PROMPT},
        {
            "role": "user", "content": build_station_price_prompt(
                fuel_type=fuel_type,
                latitude=latitude,
                longitude=longitude,
                address=address,
                search_radius_meters=search_radius_meters,
                country_hint=country_hint,
            ),
        },
    ]


def build_station_price_request(
    fuel_type: str = "diesel",
    latitude: float | None = None,
    longitude: float | None = None,
    address: str | None = None,
    model: str = DEFAULT_MODEL,
    search_radius_meters: int = 1000,
    country_hint: str = "USA",
) -> dict:
    return {
        "model": model,
        "messages": build_station_price_messages(
            fuel_type=fuel_type,
            latitude=latitude,
            longitude=longitude,
            address=address,
            search_radius_meters=search_radius_meters,
            country_hint=country_hint,
        ),
        "extra_headers": {
            "HTTP-Referer": DEFAULT_APP_URL,
            "X-Title": DEFAULT_APP_NAME,
        },
        "extra_body": {
            "plugins": [{"id": "web"}],
        },
    }


def lookup_station_price(
    fuel_type: str = "diesel",
    latitude: float | None = None,
    longitude: float | None = None,
    address: str | None = None,
    model: str = DEFAULT_MODEL,
    search_radius_meters: int = 1000,
    country_hint: str = "USA",
    api_key: str | None = None,
) -> str:
    client = get_openrouter_client(api_key=api_key)
    request_payload = build_station_price_request(
        fuel_type=fuel_type,
        latitude=latitude,
        longitude=longitude,
        address=address,
        model=model,
        search_radius_meters=search_radius_meters,
        country_hint=country_hint,
    )
    response = client.chat.completions.create(**request_payload)
    return response.choices[0].message.content or "No response from model."


def lookup_station_price_by_coordinates(
    latitude: float,
    longitude: float,
    fuel_type: str = "diesel",
    search_radius_meters: int = 1000,
    model: str = DEFAULT_MODEL,
    api_key: str | None = None,
) -> str:
    return lookup_station_price(
        fuel_type=fuel_type,
        latitude=latitude,
        longitude=longitude,
        search_radius_meters=search_radius_meters,
        model=model,
        api_key=api_key,
    )


def lookup_station_price_by_address(
    address: str,
    fuel_type: str = "diesel",
    model: str = DEFAULT_MODEL,
    api_key: str | None = None,
) -> str:
    return lookup_station_price(
        fuel_type=fuel_type,
        address=address,
        model=model,
        api_key=api_key,
    )


def build_unitedlane_route_guidance_fallback(
    *,
    origin_label: str,
    destination_label: str,
    station_name: str,
    station_address: str,
    fuel_type: str,
    price_text: str,
    off_route_miles: float | None,
    detour_time_minutes: int | None,
    map_link: str,
) -> str:
    off_route_text = f"about {off_route_miles:.1f} miles off your route" if off_route_miles is not None else "a short distance off your route"
    detour_text = f"roughly {detour_time_minutes} minutes of detour time" if detour_time_minutes is not None else "a brief detour"
    return dedent(
        f"""
        Hello, this is UnitedLane, your AI route and fuel assistant.

        Please begin from {origin_label} and stay on your current route toward {destination_label}. I recommend stopping at {station_name}, located at {station_address}, because it is one of the strongest nearby fuel options and sits {off_route_text} with {detour_text}. For {fuel_type.lower()}, the current price status is {price_text}.

        As you drive, remain on the main route until the live map shows your fuel-stop exit approaching. When you are close to the stop, move into the correct lane early, take the exit shown on the map, and follow local road signs for the final approach into the station. Once you arrive, confirm the station name and address before pulling in.

        After fueling, you can continue your trip by reopening the same map route and merging back toward {destination_label}. For the final street-level turns, please rely on the live map here: {map_link}

        If you would like, you can follow the map directly and use this guidance as a calm overview so the trip feels easier and more comfortable.
        """
    ).strip()


def build_unitedlane_route_messages(
    *,
    origin_label: str,
    destination_label: str,
    station_name: str,
    station_address: str,
    fuel_type: str,
    price_text: str,
    off_route_miles: float | None,
    detour_time_minutes: int | None,
    map_link: str,
) -> list[dict[str, str]]:
    user_prompt = dedent(
        f"""
        Please write a detailed but practical driving guidance message for the United Lane website.

        Starting point: {origin_label}
        Final destination: {destination_label}
        Recommended fuel stop: {station_name}
        Fuel stop address: {station_address}
        Fuel type requested: {fuel_type}
        Fuel price status: {price_text}
        Off-route distance: {off_route_miles if off_route_miles is not None else 'unknown'} miles
        Detour time: {detour_time_minutes if detour_time_minutes is not None else 'unknown'} minutes
        Live map link: {map_link}

        Requirements:
        - Speak as UnitedLane.
        - Be very polite.
        - Write in English only.
        - Explain clearly how the driver should head out, stay on the route, prepare for the stop, arrive at the station, and continue after fueling.
        - Mention that the live map should be used for the final live turn details.
        - Do not use bullet points.
        """
    ).strip()
    return [
        {"role": "system", "content": UNITEDLANE_ROUTE_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def generate_unitedlane_route_guidance(
    *,
    origin_label: str,
    destination_label: str,
    station_name: str,
    station_address: str,
    fuel_type: str,
    price_text: str,
    off_route_miles: float | None,
    detour_time_minutes: int | None,
    map_link: str,
    model: str = DEFAULT_MODEL,
    api_key: str | None = None,
) -> str:
    fallback = build_unitedlane_route_guidance_fallback(
        origin_label=origin_label,
        destination_label=destination_label,
        station_name=station_name,
        station_address=station_address,
        fuel_type=fuel_type,
        price_text=price_text,
        off_route_miles=off_route_miles,
        detour_time_minutes=detour_time_minutes,
        map_link=map_link,
    )
    if not settings.route_guidance_ai_enabled:
        return fallback

    try:
        client = get_openrouter_client(api_key=api_key, timeout_seconds=settings.route_guidance_ai_timeout_seconds)
        response = client.chat.completions.create(
            model=model,
            messages=build_unitedlane_route_messages(
                origin_label=origin_label,
                destination_label=destination_label,
                station_name=station_name,
                station_address=station_address,
                fuel_type=fuel_type,
                price_text=price_text,
                off_route_miles=off_route_miles,
                detour_time_minutes=detour_time_minutes,
                map_link=map_link,
            ),
            extra_headers={
                "HTTP-Referer": DEFAULT_APP_URL,
                "X-Title": DEFAULT_APP_NAME,
            },
        )
        content = response.choices[0].message.content or ""
        return content.strip() or fallback
    except Exception:
        return fallback


if __name__ == "__main__":
    print(lookup_station_price_by_address("Times Square, New York, NY", fuel_type="diesel"))

UNITEDLANE_CHAT_SYSTEM_PROMPT = """You are Safety Team, the internal trucking safety assistant for the United Lane platform.

Identity rules:
1. If asked who you are, answer exactly: I am Safety Team for the United Lane platform.
2. Speak as an experienced fleet safety and risk-reduction support team.
3. Always use polished, clear, professional English.
4. Never claim to be human.
5. Never describe yourself as a generic chatbot detached from the company.
6. Do not present yourself as a lawyer, law enforcement officer, or regulator.

Mission rules:
1. Your main job is to help dispatchers, drivers, managers, and operations staff with truck safety, incident response, driver coaching, and practical risk reduction.
2. You should answer as the company's Safety Team first, even when the question is broad.
3. You can still help with writing, summaries, image review, and operational communication, but your framing should stay safety-aware.

Core knowledge areas:
1. Pre-trip and post-trip inspections, DVIR, defect logging, maintenance escalation, and out-of-service warning signs.
2. HOS and ELD basics, fatigue risk, rest planning, and log accuracy at a general operational level.
3. Safe following distance, speed management, lane changes, merging, turns, backing, parking, intersections, work zones, night driving, mountain driving, and adverse weather driving.
4. Cargo securement basics, load shift warning signs, trailer safety, brake and tire concerns, lights, air system issues, and visible mechanical red flags.
5. Accident, incident, and near-miss response: scene safety, emergency escalation, reporting sequence, photos, witness details, and supervisor handoff.
6. Driver coaching notes, corrective action language, toolbox talks, safety reminders, and dispatch-to-driver safety messaging.
7. FMCSA/DOT-style best practices in a general sense, without inventing company-specific or jurisdiction-specific rules.

Behavior rules:
1. Prioritize immediate safety first. If a person, vehicle, roadway, cargo, or scene may be unsafe, say the safest immediate action before anything else.
2. Prefer structured answers such as: Immediate action, risk check, who to notify, documentation, next steps.
3. If the user asks about company policy, discipline, legal exposure, or an exact regulation you cannot verify, explain the general best-practice answer and say that the company SOP or jurisdiction should confirm the final rule.
4. Never invent exact legal citations, penalties, inspection outcomes, or company procedures.
5. If an image is attached, inspect it like a safety review: identify visible hazards, damage, missing securement, documentation concerns, and what cannot be confirmed from the image alone.
6. If the user needs a driver-facing message, make it short, respectful, and ready to send.
7. If the user needs a manager-facing message, make it clear, accountable, and operational.

Style rules:
1. Be calm, direct, practical, and safety-first.
2. Prefer concise checklists, numbered steps, and recommended next actions over abstract theory.
3. Make the answer easy for a dispatcher or safety manager to use immediately.
4. When useful, finish with a short section titled: Send this to the driver.
"""


def normalize_chat_image_data_url(image_data_url: str = "") -> str:
    normalized = (image_data_url or "").strip()
    if not normalized:
        return ""
    if len(normalized) > CHAT_IMAGE_MAX_DATA_URL_LENGTH:
        raise ValueError("Attached image is too large. Please upload a smaller PNG, JPEG, WEBP, or GIF image.")
    if not CHAT_IMAGE_DATA_URL_PATTERN.match(normalized):
        raise ValueError("Attached image must be a PNG, JPEG, WEBP, or GIF file encoded as a data URL.")
    return normalized


def build_unitedlane_chat_headers() -> dict[str, str]:
    return {
        "HTTP-Referer": DEFAULT_APP_URL,
        "X-OpenRouter-Title": DEFAULT_APP_NAME,
        "X-Title": DEFAULT_APP_NAME,
    }


def chat_reply_declines_image_analysis(content: str) -> bool:
    normalized = " ".join((content or "").split())
    if not normalized:
        return True
    return any(pattern.search(normalized) for pattern in CHAT_IMAGE_DECLINE_PATTERNS)


def build_unitedlane_chat_provider_error(exc: Exception, image_requested: bool, model: str) -> UnitedLaneChatProviderError:
    status_code = getattr(exc, "status_code", None)
    lowered = str(exc).lower()

    if status_code == 402:
        return UnitedLaneChatProviderError(
            "OpenRouter rejected the assistant request because of credits or token limits. "
            f"Current safe max_tokens: {DEFAULT_CHAT_MAX_OUTPUT_TOKENS}. "
            "Add credits or switch OPENROUTER_CHAT_MODEL to another model."
        )
    if status_code == 429:
        return UnitedLaneChatProviderError("OpenRouter is rate-limiting Safety Team right now. Please retry in a moment.")
    if status_code == 400 and image_requested:
        return UnitedLaneImageAnalysisUnavailableError(
            "OpenRouter rejected the attached image for the configured assistant model. "
            "Please retry or upload a smaller PNG, JPEG, WEBP, or GIF image."
        )
    if status_code == 400:
        return UnitedLaneChatProviderError("OpenRouter rejected this assistant request. Please retry with a shorter message.")
    if status_code and status_code >= 500:
        return UnitedLaneChatProviderError("OpenRouter is temporarily unavailable. Please retry in a moment.")
    if image_requested and ("image" in lowered or "vision" in lowered):
        return UnitedLaneImageAnalysisUnavailableError(UNITEDLANE_IMAGE_ANALYSIS_UNAVAILABLE_MESSAGE)
    return UnitedLaneChatProviderError(
        f"Safety Team request failed for model {model}. Please retry in a moment."
    )


def build_unitedlane_chat_user_text(message: str, context: str = "", image_name: str = "") -> str:
    user_message = message.strip()
    if not user_message:
        user_message = "Please analyze the attached image in a practical Safety Team style."

    parts: list[str] = []
    if context.strip():
        parts.append(f"Context from the United Lane website:\n{context.strip()}")
    if image_name.strip():
        parts.append(f"Attached image filename: {image_name.strip()}")
    parts.append(f"User question:\n{user_message}")
    return "\n\n".join(parts) if len(parts) > 1 else user_message


def build_unitedlane_chat_messages(message: str, context: str = "", image_data_url: str = "", image_name: str = "") -> list[dict[str, object]]:
    user_text = build_unitedlane_chat_user_text(message=message, context=context, image_name=image_name)
    normalized_image_data_url = normalize_chat_image_data_url(image_data_url)

    if normalized_image_data_url:
        user_content = [
            {"type": "text", "text": user_text},
            {"type": "image_url", "image_url": {"url": normalized_image_data_url}},
        ]
    else:
        user_content = user_text

    return [
        {"role": "system", "content": UNITEDLANE_CHAT_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


def coerce_openrouter_message_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text_value = item.get("text")
                if isinstance(text_value, str) and text_value.strip():
                    parts.append(text_value.strip())
        return "\n\n".join(parts).strip()
    return ""


def generate_unitedlane_chat_reply(
    message: str,
    context: str = "",
    image_data_url: str = "",
    image_name: str = "",
    model: str = DEFAULT_CHAT_MODEL,
    api_key: str | None = None,
) -> str:
    resolved_model = (model or DEFAULT_CHAT_MODEL).strip() or DEFAULT_CHAT_MODEL
    normalized_image_data_url = normalize_chat_image_data_url(image_data_url)
    image_requested = bool(normalized_image_data_url)

    try:
        client = get_openrouter_client(api_key=api_key)
        response = client.chat.completions.create(
            model=resolved_model,
            max_tokens=DEFAULT_CHAT_MAX_OUTPUT_TOKENS,
            extra_headers=build_unitedlane_chat_headers(),
            messages=build_unitedlane_chat_messages(
                message=message,
                context=context,
                image_data_url=normalized_image_data_url,
                image_name=image_name,
            ),
        )
    except ValueError:
        raise
    except Exception as exc:
        if APIStatusError is not None and isinstance(exc, APIStatusError):
            raise build_unitedlane_chat_provider_error(exc, image_requested=image_requested, model=resolved_model) from exc
        logger.warning("Safety Team request failed for model %s.", resolved_model, exc_info=True)
        raise UnitedLaneChatProviderError(UNITEDLANE_CHAT_PROVIDER_UNAVAILABLE_MESSAGE) from exc

    content = coerce_openrouter_message_text(response.choices[0].message.content)
    if not content.strip():
        raise UnitedLaneChatProviderError("OpenRouter returned an empty Safety Team reply. Please retry in a moment.")
    if image_requested and chat_reply_declines_image_analysis(content):
        raise UnitedLaneImageAnalysisUnavailableError(
            f"The configured assistant model {resolved_model} did not analyze the attached image. "
            "Set OPENROUTER_CHAT_MODEL to a vision-capable OpenRouter model or retry with available credits."
        )
    return content.strip()
