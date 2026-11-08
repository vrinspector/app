"""Weather lookup (Block 5), ported for increment 10.5.

The deployed SPA calls ``GET /api/weather?location=<project location>&
inspection_id=<id>`` and shows ``description``, ``temp_f``, ``humidity``,
``wind_mph`` and a WMO ``weather_code`` above the photos on the inspection
screen. The legacy route's source did not survive the transfer, but the
response fields and the plan line name the provider: Open-Meteo, no API key.

Two public calls, both free and keyless:

* geocoding — ``https://geocoding-api.open-meteo.com/v1/search?name=…`` turns
  the free-text project location ("Greenwood, SC") into coordinates;
* forecast — ``https://api.open-meteo.com/v1/forecast?…&current=…`` returns
  the current conditions in °F and mph.

Readings are cached in process per location for ``WEATHER_CACHE_SECONDS``
(Open-Meteo refreshes its model output every 15 minutes), so a crew opening
the same inspection repeatedly costs one upstream call. Nothing is stored in
the database (``docs/DATA_MODEL.md``: no weather table is evidenced).

The HTTP client is injectable (``weather.use_transport``) so the test suite
never reaches the network, the same pattern as ``Storage.use_client``.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx
from pydantic import BaseModel

from app.core.config import settings

logger = logging.getLogger(__name__)

# WMO weather interpretation codes (WW), as Open-Meteo documents them. The
# SPA bucketed the code for its icon (≤1 sun, ≤3 cloud, otherwise rain), so
# the code is returned alongside the text.
WMO_DESCRIPTIONS: dict[int, str] = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


def describe_weather_code(code: int) -> str:
    return WMO_DESCRIPTIONS.get(code, f"Weather code {code}")


class WeatherReading(BaseModel):
    """The fields the legacy SPA reads, plus where the reading is for."""

    description: str
    temp_f: float
    humidity: int
    wind_mph: float
    weather_code: int
    # Rebuild additions: the place the geocoder resolved and when the
    # provider observed the conditions (ISO 8601, provider local time).
    location: str
    observed_at: str | None = None


class WeatherError(Exception):
    """A lookup that could not produce a reading; ``detail`` is user-facing."""

    def __init__(self, detail: str, *, not_found: bool = False) -> None:
        super().__init__(detail)
        self.detail = detail
        self.not_found = not_found


@dataclass
class _CacheEntry:
    reading: WeatherReading
    expires_at: float


class WeatherService:
    def __init__(self) -> None:
        self._transport: httpx.BaseTransport | None = None
        self._cache: dict[str, _CacheEntry] = {}

    # -- test seam -------------------------------------------------------
    def use_transport(self, transport: httpx.BaseTransport | None) -> None:
        """Route HTTP through ``transport`` (tests); ``None`` restores the default."""
        self._transport = transport
        self._cache.clear()

    def clear_cache(self) -> None:
        self._cache.clear()

    # -- lookup ----------------------------------------------------------
    def lookup(self, location: str) -> WeatherReading:
        key = " ".join(location.split()).casefold()
        if not key:
            raise WeatherError("Location is required", not_found=True)

        now = time.monotonic()
        cached = self._cache.get(key)
        if cached is not None and cached.expires_at > now:
            return cached.reading

        reading = self._fetch(location.strip())
        self._cache[key] = _CacheEntry(
            reading=reading, expires_at=now + settings.WEATHER_CACHE_SECONDS
        )
        return reading

    def _client(self) -> httpx.Client:
        return httpx.Client(
            timeout=httpx.Timeout(settings.WEATHER_TIMEOUT_SECONDS),
            transport=self._transport,
            headers={"User-Agent": "vrinspector-api"},
        )

    def _fetch(self, location: str) -> WeatherReading:
        try:
            with self._client() as client:
                place = self._geocode(client, location)
                current = self._current(client, place)
        except httpx.HTTPError as exc:
            logger.warning("weather lookup failed for %r: %s", location, exc)
            raise WeatherError("Weather service unavailable") from exc
        return self._reading(place, current)

    def _geocode(self, client: httpx.Client, location: str) -> dict[str, Any]:
        r = client.get(
            settings.WEATHER_GEOCODING_URL,
            params={"name": location, "count": 1, "language": "en", "format": "json"},
        )
        r.raise_for_status()
        results = r.json().get("results") or []
        if not results:
            raise WeatherError(f"Location not found: {location}", not_found=True)
        place: dict[str, Any] = results[0]
        return place

    def _current(self, client: httpx.Client, place: dict[str, Any]) -> dict[str, Any]:
        r = client.get(
            settings.WEATHER_FORECAST_URL,
            params={
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
                "temperature_unit": "fahrenheit",
                "wind_speed_unit": "mph",
                "timezone": "auto",
            },
        )
        r.raise_for_status()
        current: dict[str, Any] | None = r.json().get("current")
        if not current:
            raise WeatherError("Weather service returned no current conditions")
        return current

    @staticmethod
    def _reading(place: dict[str, Any], current: dict[str, Any]) -> WeatherReading:
        parts = [place.get("name"), place.get("admin1"), place.get("country_code")]
        code = int(current.get("weather_code") or 0)
        return WeatherReading(
            description=describe_weather_code(code),
            temp_f=round(float(current["temperature_2m"]), 1),
            humidity=int(round(float(current["relative_humidity_2m"]))),
            wind_mph=round(float(current["wind_speed_10m"]), 1),
            weather_code=code,
            location=", ".join(str(p) for p in parts if p),
            observed_at=current.get("time"),
        )


weather = WeatherService()
