"""Increment 14: signing-link helpers, readiness reasons, stamps, packs."""

import base64
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import sign_reminders
from app.api.itp_state import load_itp_state
from app.core import packs
from app.core.db import engine
from app.core.signing import (
    MAX_SIGNATURE_BYTES,
    PNG_MAGIC,
    SignatureImageError,
    decode_signature_png,
    link_status,
    role_lines,
    weather_stamp,
)
from app.core.weather import weather
from app.models import ExternalSignToken, Project, ProjectArea, ProjectItp
from tests.utils.auth0 import FakeTenant
from tests.utils.domain import OWNER, V1, create_project, headers
from tests.utils.itp import apply_template, create_template
from tests.utils.weather import FakeOpenMeteo


def test_link_status_covers_every_state() -> None:
    now = datetime.now(UTC)
    token = ExternalSignToken(
        token_hash="a" * 64,
        signoff_role_id=1,
        signer_email="x@example.com",
        expires_at=now + timedelta(days=1),
    )
    assert link_status(token, now) == "active"
    token.expires_at = now - timedelta(seconds=1)
    assert link_status(token, now) == "expired"
    token.revoked, token.revoked_reason = True, "withdrawn"
    assert link_status(token, now) == "revoked"
    token.revoked_reason = "replaced"
    assert link_status(token, now) == "replaced"
    token.used_at = now
    assert link_status(token, now) == "used"


def test_signature_png_is_checked() -> None:
    def url(data: bytes) -> str:
        return "data:image/png;base64," + base64.b64encode(data).decode()

    assert decode_signature_png(url(PNG_MAGIC + b"x")) == PNG_MAGIC + b"x"
    with pytest.raises(SignatureImageError, match="too large"):
        decode_signature_png(url(PNG_MAGIC + b"x" * MAX_SIGNATURE_BYTES))
    with pytest.raises(SignatureImageError, match="PNG"):
        decode_signature_png(url(b"GIF89a"))


def test_weather_stamp_is_best_effort() -> None:
    assert weather_stamp(None) is None
    assert weather_stamp(Project(name="P", location="  ")) is None
    # The autouse fixture makes Open-Meteo answer 503: no stamp, no error.
    assert weather_stamp(Project(name="P", location="Greenwood, SC")) is None
    fake = FakeOpenMeteo()
    weather.use_transport(fake.transport)
    stamp = weather_stamp(Project(name="P", location="Greenwood, SC"))
    assert stamp is not None and stamp["source"] == "open-meteo"
    assert packs.weather_summary(stamp) == (
        "Partly cloudy, 61.3 °F, 72 % humidity, wind 6.8 mph — "
        "Greenwood, South Carolina, US"
    )
    assert packs.weather_summary({"description": "x"}) is None
    assert packs.weather_summary(None) is None


def _itp(
    client: TestClient, tenant: FakeTenant, body: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, str]]:
    oh = headers(tenant, OWNER)
    project = create_project(client, oh)
    template = create_template(client, oh, body=body)
    return apply_template(client, oh, project["id"], template["id"]), oh


def test_waiting_reasons(client: TestClient, tenant: FakeTenant) -> None:
    body = {
        "signoffRoles": [{"name": "Engineer", "party": "client"}],
        "pages": [
            {
                "name": "p",
                "elements": [
                    {
                        "type": "radiogroup",
                        "name": name,
                        "title": name,
                        "classification": "witness",
                        "signoffRoles": ["Engineer"],
                        **extra,
                    }
                    for name, extra in (
                        ("pending", {}),
                        ("failed", {}),
                        ("nophoto", {"photoRequired": True}),
                        ("ok", {}),
                    )
                ],
            }
        ],
    }
    itp, oh = _itp(client, tenant, body)
    ids = {i["element_name"]: i["id"] for i in itp["items"]}
    for name, result in (("failed", "fail"), ("ok", "na")):
        r = client.put(
            f"{V1}/itp-items/{ids[name]}", json={"status": result}, headers=oh
        )
        assert r.status_code == 200, r.text
    with Session(engine) as db:
        row = db.get(ProjectItp, itp["id"])
        assert row is not None
        state = load_itp_state(db, row)
        role_id = state.items[0].roles[0].id or 0
        # Force the photo line to Pass without a photo, as legacy data could be.
        state.item(ids["nophoto"]).item.status = "pass"
        reasons = {
            rl.line.item.element_name: (rl.sign_state, rl.reason)
            for rl in role_lines([state], role_id)
        }
    assert reasons["pending"] == ("waiting", "Not recorded on site yet")
    assert reasons["failed"][1].startswith("Recorded as failed")
    assert reasons["nophoto"] == ("waiting", "Photo evidence still to be added")
    assert reasons["ok"] == ("ready", None)


def test_background_regeneration_skips_missing_rows_and_swallows_errors(
    client: TestClient, tenant: FakeTenant, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "ITP_PACK_AUTOREGENERATE", True)
    from tests.utils.itp import CONCRETE_POUR

    itp, oh = _itp(client, tenant, CONCRETE_POUR)
    packs.regenerate_in_background([999999], [999999], "test")  # nothing to do

    def boom(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("renderer down")

    monkeypatch.setattr(packs, "html_to_pdf", boom)
    with Session(engine) as db:
        area = ProjectArea(project_id=itp["project_id"], name="Lot 1")
        db.add(area)
        db.commit()
        db.refresh(area)
        area_id = area.id or 0
    packs.regenerate_in_background([itp["id"]], [area_id], "test")  # logged, not raised
    assert client.get(f"{V1}/itps/{itp['id']}/packs", headers=oh).json() == []


def test_sign_reminders_entry_point(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[Session] = []

    def fake(db: Session) -> int:
        calls.append(db)
        return 2

    monkeypatch.setattr(sign_reminders, "send_due_reminders", fake)
    assert sign_reminders.main() == 2 and len(calls) == 1
