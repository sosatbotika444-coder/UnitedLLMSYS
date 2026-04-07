from __future__ import annotations

from textwrap import dedent

try:
    from openai import OpenAI
except ModuleNotFoundError:
    OpenAI = None

from app.config import get_settings

settings = get_settings()
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = settings.openrouter_model
DEFAULT_APP_NAME = settings.openrouter_app_name
DEFAULT_APP_URL = settings.openrouter_app_url
DEFAULT_OPENROUTER_API_KEY = settings.openrouter_api_key
UNITEDLANE_IDENTITY = "UnitedLane"

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


def get_openrouter_client(api_key: str | None = None):
    resolved_key = api_key or DEFAULT_OPENROUTER_API_KEY
    if not resolved_key:
        raise ValueError("OPENROUTER_API_KEY is not set")
    if OpenAI is None:
        raise RuntimeError("openai package is not installed")

    return OpenAI(
        base_url=OPENROUTER_BASE_URL,
        api_key=resolved_key,
    )


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
    try:
        client = get_openrouter_client(api_key=api_key)
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

UNITEDLANE_CHAT_SYSTEM_PROMPT = """You are UnitedLane, the company AI assistant for the United Lane platform.

Identity rules:
1. If asked who you are, answer exactly: I am UnitedLane Assistant for the United Lane platform.
2. Always speak in polished, warm, helpful English.
3. Never claim to be human.
4. Never describe yourself as a generic chatbot detached from the company.

Capability rules:
1. You can help with routing, fuel planning, dispatch, trucking operations, load coordination, station analysis, driver communication, customer-facing writing, business productivity, and general day-to-day questions.
2. When the user asks about routes, stations, pricing, dispatch, or trucking, prioritize practical transportation guidance first.
3. When the user asks broader questions, answer helpfully in a professional UnitedLane tone instead of refusing.
4. If a request is high-risk or specialized, give cautious general guidance and suggest consulting the appropriate licensed professional when needed.

Style rules:
1. Keep answers clear, useful, and commercially polished.
2. Prefer direct recommendations, summaries, and next steps over abstract theory.
3. When route or station details are missing, make a reasonable assumption and say what extra detail would improve the answer.
4. If site context is provided, use it naturally in the response.
"""


def build_unitedlane_chat_messages(message: str, context: str = "") -> list[dict[str, str]]:
    user_message = message.strip()
    if context.strip():
        user_message = f"Context from the United Lane website:\n{context.strip()}\n\nUser question:\n{user_message}"
    return [
        {"role": "system", "content": UNITEDLANE_CHAT_SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]


def generate_unitedlane_chat_reply(message: str, context: str = "", model: str = DEFAULT_MODEL, api_key: str | None = None) -> str:
    fallback = (
        "I am UnitedLane Assistant for the United Lane platform. I can help with routing, fuel planning, dispatch, operations communication, "
        "and general day-to-day questions in a practical UnitedLane style."
    )
    try:
        client = get_openrouter_client(api_key=api_key)
        response = client.chat.completions.create(
            model=model,
            messages=build_unitedlane_chat_messages(message=message, context=context),
            extra_headers={
                "HTTP-Referer": DEFAULT_APP_URL,
                "X-Title": DEFAULT_APP_NAME,
            },
        )
        content = response.choices[0].message.content or ""
        return content.strip() or fallback
    except Exception:
        return fallback
