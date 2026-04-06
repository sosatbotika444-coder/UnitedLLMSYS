from __future__ import annotations

import json
import os
from typing import Any

from openai import OpenAI

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = os.getenv("OPENROUTER_MODEL", "qwen/qwen-3.6-plus:free")
DEFAULT_APP_NAME = os.getenv("OPENROUTER_APP_NAME", "UnitedLLMSYS")
DEFAULT_APP_URL = os.getenv("OPENROUTER_APP_URL", "http://localhost:8000")

STATION_PRICE_SYSTEM_PROMPT = """You are a fuel price lookup assistant.

Your job is to find the real current retail fuel price for the gas station located at or nearest to the provided coordinates.

Rules:
1. Use web search and current online sources whenever possible.
2. Prioritize official station pages, official brand pages, map listings with visible timestamps, and reputable fuel price aggregators.
3. Match the station to the coordinates as strictly as possible. If multiple nearby stations exist, choose the closest one and mention the distance in meters when available.
4. Return only valid JSON.
5. If the exact price cannot be verified, set price to null and explain why in notes.
6. Never invent prices.
7. Prefer USD per gallon unless the source clearly uses another unit. If another unit is used, preserve it in unit.
8. Include the source URL when available.
9. Include how fresh the price is using source_timestamp if available.

JSON schema:
{
  "found": true,
  "station_name": "string or null",
  "brand": "string or null",
  "address": "string or null",
  "latitude": 0.0,
  "longitude": 0.0,
  "fuel_type": "string",
  "price": 0.0,
  "currency": "USD",
  "unit": "gallon",
  "source": "string or null",
  "source_url": "string or null",
  "source_timestamp": "string or null",
  "distance_meters": 0,
  "confidence": "high|medium|low",
  "notes": "string"
}

If nothing reliable is found, still return valid JSON with:
- found = false
- price = null
- confidence = "low"
- notes explaining what was checked."""


def get_openrouter_client(api_key: str | None = None) -> OpenAI:
    resolved_key = api_key or os.getenv("OPENROUTER_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not resolved_key:
        raise ValueError("OPENROUTER_API_KEY is not set")

    return OpenAI(
        base_url=OPENROUTER_BASE_URL,
        api_key=resolved_key,
    )


def build_station_price_prompt(
    latitude: float,
    longitude: float,
    fuel_type: str = "diesel",
    search_radius_meters: int = 1000,
    country_hint: str = "USA",
) -> str:
    return (
        "Find the current fuel price for the gas station located at or nearest to these coordinates. "
        f"Coordinates: latitude={latitude}, longitude={longitude}. "
        f"Fuel type: {fuel_type}. "
        f"Search radius: {search_radius_meters} meters. "
        f"Country hint: {country_hint}. "
        "Use up-to-date online sources and verify the station identity against the coordinates before giving a price. "
        "If several stations are nearby, return the closest one with the most trustworthy current price source. "
        "Return only JSON matching the schema from the system message."
    )


def build_station_price_messages(
    latitude: float,
    longitude: float,
    fuel_type: str = "diesel",
    search_radius_meters: int = 1000,
    country_hint: str = "USA",
) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": STATION_PRICE_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": build_station_price_prompt(
                latitude=latitude,
                longitude=longitude,
                fuel_type=fuel_type,
                search_radius_meters=search_radius_meters,
                country_hint=country_hint,
            ),
        },
    ]


def build_station_price_request(
    latitude: float,
    longitude: float,
    fuel_type: str = "diesel",
    model: str = DEFAULT_MODEL,
    search_radius_meters: int = 1000,
    country_hint: str = "USA",
) -> dict[str, Any]:
    return {
        "model": model,
        "messages": build_station_price_messages(
            latitude=latitude,
            longitude=longitude,
            fuel_type=fuel_type,
            search_radius_meters=search_radius_meters,
            country_hint=country_hint,
        ),
        "response_format": {"type": "json_object"},
        "extra_headers": {
            "HTTP-Referer": DEFAULT_APP_URL,
            "X-Title": DEFAULT_APP_NAME,
        },
        "extra_body": {
            "plugins": [{"id": "web"}],
        },
    }


def lookup_station_price(
    latitude: float,
    longitude: float,
    fuel_type: str = "diesel",
    model: str = DEFAULT_MODEL,
    search_radius_meters: int = 1000,
    country_hint: str = "USA",
    api_key: str | None = None,
) -> dict[str, Any]:
    client = get_openrouter_client(api_key=api_key)
    request_payload = build_station_price_request(
        latitude=latitude,
        longitude=longitude,
        fuel_type=fuel_type,
        model=model,
        search_radius_meters=search_radius_meters,
        country_hint=country_hint,
    )
    response = client.chat.completions.create(**request_payload)
    content = response.choices[0].message.content or "{}"
    return json.loads(content)


if __name__ == "__main__":
    sample = build_station_price_request(
        latitude=41.8781,
        longitude=-87.6298,
        fuel_type="diesel",
    )
    print(json.dumps(sample, indent=2))
