"""Weather route (Block 5, increment 10.5): Open-Meteo lookup behind inspection authz."""

import json
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app.core.weather import describe_weather_code, weather
from tests.utils.auth0 import FakeTenant
from tests.utils.domain import (
    OUTSIDER,
    V1,
    create_inspection,
    create_project,
    headers,
)
from tests.utils.weather import CURRENT, GEOCODE, FakeOpenMeteo


@pytest.fixture
def open_meteo() -> Generator[FakeOpenMeteo]:
    fake = FakeOpenMeteo()
    weather.use_transport(fake.transport)
    yield fake
    weather.use_transport(None)


def test_lookup_returns_the_legacy_fields(
    client: TestClient, tenant: FakeTenant, open_meteo: FakeOpenMeteo
) -> None:
    h = headers(tenant)
    p = create_project(client, h, location="Greenwood, SC")
    i = create_inspection(client, h, p["id"])

    r = client.get(
        f"{V1}/weather",
        params={"location": "Greenwood, SC", "inspection_id": i["id"]},
        headers=h,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # The fields the deployed SPA reads …
    assert body["description"] == "Partly cloudy"
    assert body["temp_f"] == 61.3
    assert body["humidity"] == 72
    assert body["wind_mph"] == 6.8
    assert body["weather_code"] == 2
    # … plus the resolved place and the observation time.
    assert body["location"] == "Greenwood, South Carolina, US"
    assert body["observed_at"] == "2026-11-08T09:15"

    geocode, forecast = open_meteo.requests
    assert geocode.url.host == "geocoding-api.open-meteo.com"
    assert geocode.url.params["name"] == "Greenwood, SC"
    assert forecast.url.host == "api.open-meteo.com"
    assert forecast.url.params["latitude"] == "34.1954"
    assert forecast.url.params["temperature_unit"] == "fahrenheit"
    assert forecast.url.params["wind_speed_unit"] == "mph"
    assert "weather_code" in forecast.url.params["current"]


def test_location_defaults_to_the_project_and_is_cached(
    client: TestClient, tenant: FakeTenant, open_meteo: FakeOpenMeteo
) -> None:
    h = headers(tenant)
    p = create_project(client, h, location="Richmond, VA")
    i = create_inspection(client, h, p["id"])

    r = client.get(f"{V1}/weather", params={"inspection_id": i["id"]}, headers=h)
    assert r.status_code == 200, r.text
    assert open_meteo.requests[0].url.params["name"] == "Richmond, VA"
    assert len(open_meteo.requests) == 2

    # Same place again (different spacing/case): served from the cache.
    r = client.get(
        f"{V1}/weather",
        params={"inspection_id": i["id"], "location": "  richmond,   va "},
        headers=h,
    )
    assert r.status_code == 200
    assert len(open_meteo.requests) == 2


def test_project_without_location_is_404(
    client: TestClient, tenant: FakeTenant, open_meteo: FakeOpenMeteo
) -> None:
    h = headers(tenant)
    p = create_project(client, h, location=None)
    i = create_inspection(client, h, p["id"])

    r = client.get(f"{V1}/weather", params={"inspection_id": i["id"]}, headers=h)
    assert r.status_code == 404
    assert r.json()["detail"] == "Project has no location"
    assert open_meteo.requests == []


def test_non_member_gets_object_hiding_404(
    client: TestClient, tenant: FakeTenant, open_meteo: FakeOpenMeteo
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    i = create_inspection(client, h, p["id"])

    r = client.get(
        f"{V1}/weather",
        params={"inspection_id": i["id"], "location": "Greenwood, SC"},
        headers=headers(tenant, OUTSIDER),
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "Inspection not found"
    assert open_meteo.requests == []

    r = client.get(f"{V1}/weather", params={"location": "Greenwood, SC"}, headers=h)
    assert r.status_code == 422  # inspection_id is required


def test_unknown_place_and_provider_failures(
    client: TestClient, tenant: FakeTenant, open_meteo: FakeOpenMeteo
) -> None:
    h = headers(tenant)
    p = create_project(client, h, location="Nowhere In Particular 12345")
    i = create_inspection(client, h, p["id"])

    open_meteo.geocode = {"results": []}
    r = client.get(f"{V1}/weather", params={"inspection_id": i["id"]}, headers=h)
    assert r.status_code == 404
    assert r.json()["detail"] == "Location not found: Nowhere In Particular 12345"

    open_meteo.geocode = GEOCODE
    open_meteo.fail_with = 500
    r = client.get(f"{V1}/weather", params={"inspection_id": i["id"]}, headers=h)
    assert r.status_code == 503
    assert r.json()["detail"] == "Weather service unavailable"

    open_meteo.fail_with = None
    open_meteo.timeout = True
    r = client.get(f"{V1}/weather", params={"inspection_id": i["id"]}, headers=h)
    assert r.status_code == 503

    # A failure is not cached: once the provider is back, the reading comes
    # through and an unknown code still gets a readable description.
    open_meteo.timeout = False
    open_meteo.current = {
        "current": {**CURRENT["current"], "weather_code": 42, "time": None}
    }
    r = client.get(f"{V1}/weather", params={"inspection_id": i["id"]}, headers=h)
    assert r.status_code == 200
    assert r.json()["description"] == "Weather code 42"
    assert r.json()["observed_at"] is None


def test_wmo_descriptions_cover_the_published_codes() -> None:
    for code, text in (
        (0, "Clear sky"),
        (3, "Overcast"),
        (63, "Moderate rain"),
        (95, "Thunderstorm"),
    ):
        assert describe_weather_code(code) == text
    # The table round-trips through JSON (what the frontend vocab mirrors).
    assert (
        json.loads(json.dumps(describe_weather_code(99)))
        == "Thunderstorm with heavy hail"
    )
