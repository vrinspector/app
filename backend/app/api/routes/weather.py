"""Weather route (Block 5), ported for increment 10.5.

Legacy contract (deployed SPA, July 2026):

    GET /weather?location=<project location>&inspection_id=<id>
        → {description, temp_f, humidity, wind_mph, weather_code}

The SPA called it from the inspection screen with the project's ``location``
text and treated any failure as "no badge". Here the same query string is
accepted under ``/api/v1``:

* ``inspection_id`` is required and authorized like every other object: a
  non-member gets 404 ``Inspection not found`` (object hiding). It is also
  the fallback source of the location — when ``location`` is omitted the
  project's stored location is used — so the screen does not have to pass
  the text around.
* ``location`` empty on both counts → 404 ``Project has no location``.
* An unknown place → 404 ``Location not found: …``; the provider down or
  slow → 503 ``Weather service unavailable``. The screen hides the badge on
  any error, as the SPA did.

Nothing is written: the reading is looked up (and cached for a few minutes
in ``app.core.weather``), not stored on the inspection.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Query, status

from app.api.authz import get_authorized_inspection, not_found
from app.api.deps import CurrentUser, SessionDep
from app.core.weather import WeatherError, WeatherReading, weather
from app.models import Project

router = APIRouter(prefix="/weather", tags=["weather"])


@router.get("", response_model=WeatherReading)
def read_weather(
    session: SessionDep,
    current_user: CurrentUser,
    inspection_id: int = Query(..., ge=1),
    location: str | None = Query(default=None, max_length=200),
) -> Any:
    inspection = get_authorized_inspection(session, inspection_id, current_user)

    place = (location or "").strip()
    if not place:
        project = session.get(Project, inspection.project_id)
        place = ((project.location if project else None) or "").strip()
    if not place:
        raise not_found("Project has no location")

    try:
        return weather.lookup(place)
    except WeatherError as exc:
        if exc.not_found:
            raise not_found(exc.detail) from exc
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=exc.detail
        ) from exc
