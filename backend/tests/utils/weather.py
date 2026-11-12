"""Fake Open-Meteo for the weather badge and the signature weather stamp."""

from typing import Any

import httpx

GEOCODE = {
    "results": [
        {
            "name": "Greenwood",
            "latitude": 34.1954,
            "longitude": -82.1618,
            "admin1": "South Carolina",
            "country_code": "US",
        }
    ]
}
CURRENT = {
    "current": {
        "time": "2026-11-08T09:15",
        "temperature_2m": 61.3,
        "relative_humidity_2m": 72.0,
        "wind_speed_10m": 6.8,
        "weather_code": 2,
    }
}


class FakeOpenMeteo:
    """Answers the two Open-Meteo calls and records every request."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.geocode: dict[str, Any] | None = GEOCODE
        self.current: dict[str, Any] | None = CURRENT
        self.fail_with: int | None = None
        self.timeout = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.timeout:
            raise httpx.ConnectTimeout("simulated timeout", request=request)
        if self.fail_with is not None:
            return httpx.Response(self.fail_with, request=request)
        if "geocoding" in request.url.host:
            return httpx.Response(200, json=self.geocode or {"results": []})
        return httpx.Response(200, json=self.current or {})

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)
