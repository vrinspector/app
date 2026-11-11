"""Increment 14: external sign-off links, sign-off packs, witness notices."""

import base64
import io
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text
from sqlmodel import Session

from app.api.routes.signoff import send_due_reminders
from app.core import packs
from app.core.config import settings
from app.core.db import engine
from app.core.email import MemoryTransport
from app.core.signing import TOKEN_BYTES, hash_token, new_token
from app.core.weather import weather
from tests.utils.auth0 import DEFAULT_EMAIL, FakeTenant
from tests.utils.domain import (
    OUTSIDER,
    OWNER,
    V1,
    VIEWER,
    create_project,
    headers,
    invite,
)
from tests.utils.itp import apply_template, create_area, create_template
from tests.utils.s3 import FakeS3
from tests.utils.weather import FakeOpenMeteo

CLIENT_EMAIL = "client.engineer@external.example.com"


def _png() -> str:
    out = io.BytesIO()
    Image.new("RGBA", (60, 20), (46, 61, 46, 255)).save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


@pytest.fixture
def open_meteo() -> Generator[FakeOpenMeteo]:
    fake = FakeOpenMeteo()
    weather.use_transport(fake.transport)
    yield fake
    weather.use_transport(None)


def _items(itp: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {i["element_name"]: i for i in itp["items"]}


def _setup(client: TestClient, tenant: FakeTenant) -> dict[str, Any]:
    """OWNER owns a project with the concrete-pour ITP applied; the default
    user is an inspector, VIEWER a viewer. The Client engineer role has an
    external signer's email."""
    oh = headers(tenant, OWNER)
    project = create_project(client, oh)
    invite(client, oh, project["id"], DEFAULT_EMAIL, "inspector")
    invite(client, oh, project["id"], VIEWER["email"], "viewer")
    template = create_template(client, oh)
    itp = apply_template(client, oh, project["id"], template["id"])
    items = _items(itp)
    roles = {r["role_name"]: r for r in items["rebar"]["required_roles"]}
    r = client.put(
        f"{V1}/signoff-roles/{roles['Client engineer']['id']}",
        json={"signer_email": CLIENT_EMAIL},
        headers=oh,
    )
    assert r.status_code == 200
    return {
        "oh": oh,
        "ih": headers(tenant),
        "vh": headers(tenant, VIEWER),
        "xh": headers(tenant, OUTSIDER),
        "project": project,
        "template": template,
        "itp": itp,
        "items": items,
        "roles": roles,
    }


def _ready_rebar(
    client: TestClient, s: dict[str, Any], itp: dict[str, Any] | None = None
) -> None:
    """Record formwork + rebar Pass and have the owner sign as Site engineer."""
    items = _items(itp) if itp else s["items"]
    for name in ("formwork", "rebar"):
        r = client.put(
            f"{V1}/itp-items/{items[name]['id']}",
            json={"status": "pass"},
            headers=s["ih"],
        )
        assert r.status_code == 200, r.text
    r = client.post(
        f"{V1}/itp-items/{items['rebar']['id']}/signatures",
        json={"signoff_role_id": s["roles"]["Site engineer"]["id"]},
        headers=s["oh"],
    )
    assert r.status_code == 201, r.text


def _raw(link: dict[str, Any]) -> str:
    return str(link["link"]).rsplit("/sign/", 1)[1]


def test_tokens_are_long_random_and_stored_only_as_a_hash() -> None:
    raw, digest = new_token()
    assert len(raw) >= 43 and TOKEN_BYTES * 8 >= 128
    assert digest == hash_token(raw) and len(digest) == 64 and raw not in digest
    assert new_token()[0] != raw


@pytest.mark.usefixtures("open_meteo")
def test_send_links_then_sign_by_link_end_to_end(
    client: TestClient,
    tenant: FakeTenant,
    outbox: MemoryTransport,
    fake_s3: FakeS3,
) -> None:
    s = _setup(client, tenant)
    itp_id = s["itp"]["id"]
    url = f"{V1}/itps/{itp_id}/sign-links"

    # Nothing recorded yet: nobody is sent anything, and the reasons say why.
    r = client.post(url, json={}, headers=s["ih"])
    assert r.status_code == 201, r.text
    assert r.json()["links"] == []
    assert sorted(r.json()["skipped"]) == [
        "Client engineer: nothing ready to sign yet",
        "Site engineer: no signer email — add one under Sign-off roles",
    ]

    _ready_rebar(client, s)
    r = client.post(url, json={}, headers=s["ih"])
    assert r.status_code == 201, r.text
    (link,) = r.json()["links"]
    assert (
        link["role_name"] == "Client engineer" and link["signer_email"] == CLIENT_EMAIL
    )
    # Queued in the response; delivered after it (a background task).
    assert link["status"] == "active" and link["email_status"] == "queued"
    assert link["link"].startswith(f"{settings.app_public_url}/sign/")
    raw = _raw(link)
    # The link is in the email; it is never stored, and never listed again.
    (message,) = [m for m in outbox.outbox if m["To"] == CLIENT_EMAIL]
    assert message["To"] == CLIENT_EMAIL
    assert message["Subject"].startswith("Please sign ")
    body = message.get_body(("plain",)).get_content()  # type: ignore[union-attr]
    assert link["link"] in body and "Client engineer" in body
    listed = client.get(url, headers=s["vh"]).json()
    assert [x["id"] for x in listed] == [link["id"]] and listed[0]["link"] is None
    assert listed[0]["email_status"] == "sent"
    with Session(engine) as db:
        stored = db.execute(
            text("SELECT token_hash FROM external_sign_tokens")
        ).scalar()
    assert stored == hash_token(raw)

    # The signing page needs no account.
    r = client.get(f"{V1}/sign/{raw}")
    assert r.status_code == 200, r.text
    page = r.json()
    assert page["kind"] == "itp" and page["role_name"] == "Client engineer"
    assert page["project_name"] == s["project"]["name"]
    assert (page["ready_count"], page["waiting_count"], page["signed_count"]) == (
        1,
        1,
        0,
    )
    lines = {ln["requirement"]: ln for ln in page["documents"][0]["lines"]}
    assert lines["Reinforcement inspected before pour"]["sign_state"] == "ready"
    assert lines["Pour witnessed"]["sign_state"] == "waiting"
    assert "hold point" in lines["Pour witnessed"]["waiting_reason"]
    assert lines["Formwork checked against drawings"]["needs_you"] is False
    assert page["pack_url"] and "packs/itps/" in page["pack_url"]

    # Bad submissions are refused and do not use the link up.
    sign = f"{V1}/sign/{raw}"
    good = {"signer_name": "Casey Client", "signature_png": _png(), "confirm": True}
    r = client.post(sign, json={**good, "confirm": False})
    assert r.status_code == 422 and "confirm" in r.json()["detail"]
    not_png = "data:image/png;base64," + base64.b64encode(b"GIF89a" * 10).decode()
    r = client.post(sign, json={**good, "signature_png": not_png})
    assert r.status_code == 422 and "PNG" in r.json()["detail"]
    r = client.post(
        sign, json={**good, "signature_png": "data:image/png;base64,@@@" * 4}
    )
    assert r.status_code == 422 and "could not be read" in r.json()["detail"]
    r = client.post(
        sign, json={**good, "signature_png": "data:image/jpeg;base64,AAAA" * 3}
    )
    assert r.status_code == 422

    r = client.post(sign, json={**good, "gps_lat": 34.19541, "gps_lng": -82.16182})
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["signed_lines"] == 1 and result["documents"] == 1
    assert result["still_waiting"] == 1
    assert result["weather"]["description"] == "Partly cloudy"

    # The hold point is released; the signature carries the full stamp.
    itp = client.get(f"{V1}/itps/{itp_id}", headers=s["vh"]).json()
    rebar = _items(itp)["rebar"]
    assert rebar["released"] is True
    ext = next(x for x in rebar["signatures"] if x["method"] == "external_link")
    assert ext["signer_name"] == "Casey Client" and ext["signer_email"] == CLIENT_EMAIL
    assert ext["gps_lat"] == 34.19541 and ext["weather"]["temp_f"] == 61.3
    assert ext["signature_url"] and "signatures/projects/" in ext["signature_url"]
    # Two line signatures + one on the pack.
    assert itp["signature_count"] == 3
    keys = [k for k in fake_s3.objects if k.startswith("signatures/projects/")]
    assert len(keys) == 1 and fake_s3.objects[keys[0]][1] == "image/png"

    # Single use.
    r = client.get(f"{V1}/sign/{raw}")
    assert r.status_code == 410 and "already been used" in r.json()["detail"]
    assert client.post(sign, json=good).status_code == 410
    assert client.get(url, headers=s["vh"]).json()[0]["status"] == "used"
    # Unknown or mangled links.
    r = client.get(f"{V1}/sign/{raw[:-2]}xx")
    assert r.status_code == 404 and "not valid" in r.json()["detail"]


def test_link_rules_permissions_expiry_revoke_and_reminders(
    client: TestClient, tenant: FakeTenant, outbox: MemoryTransport
) -> None:
    s = _setup(client, tenant)
    itp_id = s["itp"]["id"]
    url = f"{V1}/itps/{itp_id}/sign-links"
    client_role = s["roles"]["Client engineer"]["id"]
    site_role = s["roles"]["Site engineer"]["id"]

    # Viewers read but do not send; outsiders do not see the ITP.
    assert client.post(url, json={}, headers=s["vh"]).status_code == 403
    r = client.get(url, headers=s["xh"])
    assert r.status_code == 404 and r.json()["detail"] == "ITP not found"

    # One role, explicitly.
    r = client.post(url, json={"signoff_role_id": client_role}, headers=s["ih"])
    assert r.status_code == 409 and "Nothing is ready" in r.json()["detail"]
    r = client.post(url, json={"signoff_role_id": site_role}, headers=s["ih"])
    assert r.status_code == 422 and "no signer email" in r.json()["detail"]
    r = client.post(url, json={"signer_email": "x@example.com"}, headers=s["ih"])
    assert r.status_code == 422
    r = client.post(url, json={"signoff_role_id": 999999}, headers=s["ih"])
    assert r.status_code == 422

    # Site engineer's lines are signed in the app; a link for the client
    # engineer can be sent to a different address.
    _ready_rebar(client, s)
    r = client.post(url, json={"signoff_role_id": site_role}, headers=s["ih"])
    assert r.status_code == 409 and "already signed every line" in r.json()["detail"]
    r = client.post(
        url,
        json={"signoff_role_id": client_role, "signer_email": "deputy@example.com"},
        headers=s["ih"],
    )
    assert r.status_code == 201
    first = r.json()["links"][0]
    assert first["signer_email"] == "deputy@example.com"

    # A second request for the same role replaces the first link.
    second = client.post(
        url, json={"signoff_role_id": client_role}, headers=s["ih"]
    ).json()["links"][0]
    r = client.get(f"{V1}/sign/{_raw(first)}")
    assert r.status_code == 410 and "replaced by a newer one" in r.json()["detail"]
    statuses = {x["id"]: x["status"] for x in client.get(url, headers=s["vh"]).json()}
    assert statuses == {first["id"]: "replaced", second["id"]: "active"}

    # Reminder: not straight away; then a fresh link, the old one replaced.
    remind = f"{V1}/sign-links/{second['id']}/remind"
    assert client.post(remind, headers=s["vh"]).status_code == 403
    assert client.post(remind, headers=s["xh"]).status_code == 404
    r = client.post(remind, headers=s["ih"])
    assert r.status_code == 429
    with Session(engine) as db:
        db.execute(
            text(
                "UPDATE external_sign_tokens SET created_at = now() - interval '2 days'"
            )
        )
        db.commit()
    r = client.post(remind, headers=s["ih"])
    assert r.status_code == 201, r.text
    third = r.json()
    assert third["reminder_count"] == 1 and third["link"]
    assert outbox.outbox[-1]["Subject"].startswith("Reminder: please sign")
    assert client.get(f"{V1}/sign/{_raw(second)}").status_code == 410
    assert client.post(remind, headers=s["ih"]).status_code == 409  # already replaced

    # Withdraw.
    r = client.post(f"{V1}/sign-links/{third['id']}/revoke", headers=s["ih"])
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    r = client.get(f"{V1}/sign/{_raw(third)}")
    assert r.status_code == 410 and "withdrawn" in r.json()["detail"]
    assert (
        client.post(f"{V1}/sign-links/999999/revoke", headers=s["ih"]).status_code
        == 404
    )

    # Expiry: 14 days by default.
    fourth = client.post(url, json={}, headers=s["ih"]).json()["links"][0]
    created = datetime.fromisoformat(fourth["created_at"])
    expires = datetime.fromisoformat(fourth["expires_at"])
    assert (
        timedelta(days=13, hours=23)
        < expires - created
        <= timedelta(days=14, minutes=1)
    )
    with Session(engine) as db:
        db.execute(
            text(
                "UPDATE external_sign_tokens SET expires_at = now() - interval '1 minute' "
                "WHERE id = :id"
            ),
            {"id": fourth["id"]},
        )
        db.commit()
    r = client.get(f"{V1}/sign/{_raw(fourth)}")
    assert r.status_code == 410 and "expired" in r.json()["detail"]

    # A used link cannot be withdrawn; a voided ITP sends nothing.
    fifth = client.post(url, json={}, headers=s["ih"]).json()["links"][0]
    good = {"signer_name": "C", "signature_png": _png(), "confirm": True}
    assert client.post(f"{V1}/sign/{_raw(fifth)}", json=good).status_code == 200
    r = client.post(f"{V1}/sign-links/{fifth['id']}/revoke", headers=s["ih"])
    assert r.status_code == 409
    r = client.post(f"{V1}/sign-links/{fifth['id']}/remind", headers=s["ih"])
    assert r.status_code == 409
    client.put(f"{V1}/itps/{itp_id}", json={"status": "voided"}, headers=s["oh"])
    assert client.post(url, json={}, headers=s["ih"]).status_code == 409


def test_nothing_ready_keeps_the_link(client: TestClient, tenant: FakeTenant) -> None:
    s = _setup(client, tenant)
    _ready_rebar(client, s)
    link = client.post(
        f"{V1}/itps/{s['itp']['id']}/sign-links", json={}, headers=s["ih"]
    ).json()["links"][0]
    # The client engineer signs in the app instead (signed in as themselves).
    client_user = {"sub": "auth0|client-1", "email": CLIENT_EMAIL, "name": "Casey"}
    invite(client, s["oh"], s["project"]["id"], CLIENT_EMAIL, "viewer")
    r = client.post(
        f"{V1}/itp-items/{s['items']['rebar']['id']}/signatures",
        json={"signoff_role_id": s["roles"]["Client engineer"]["id"]},
        headers=headers(tenant, client_user),
    )
    assert r.status_code == 201
    good = {"signer_name": "C", "signature_png": _png(), "confirm": True}
    r = client.post(f"{V1}/sign/{_raw(link)}", json=good)
    assert r.status_code == 409 and "Nothing is ready" in r.json()["detail"]
    assert client.get(f"{V1}/sign/{_raw(link)}").status_code == 200


def test_area_pack_one_link_one_visit_signs_every_itp(
    client: TestClient, tenant: FakeTenant, outbox: MemoryTransport
) -> None:
    s = _setup(client, tenant)
    pid = s["project"]["id"]
    area = create_area(client, s["oh"], pid, "Level 3", area_type="level")
    r = client.post(
        f"{V1}/projects/{pid}/itps/bulk",
        json={"template_id": s["template"]["id"], "area_ids": [area["id"]]},
        headers=s["oh"],
    )
    assert r.status_code == 201
    second = apply_template(
        client, s["oh"], pid, s["template"]["id"], area_id=area["id"]
    )
    first = client.get(f"{V1}/itps/{r.json()[0]['id']}", headers=s["oh"]).json()
    _ready_rebar(client, s, first)
    _ready_rebar(client, s, second)

    url = f"{V1}/areas/{area['id']}/sign-links"
    assert client.post(url, json={}, headers=s["vh"]).status_code == 403
    r = client.post(url, json={}, headers=s["ih"])
    assert r.status_code == 201, r.text
    (link,) = r.json()["links"]
    assert link["area_id"] == area["id"] and link["project_itp_id"] is None
    (message,) = [m for m in outbox.outbox if m["To"] == CLIENT_EMAIL]
    body = message.get_body(("plain",)).get_content()  # type: ignore[union-attr]
    assert "Level 3" in body and "Lines ready for you: 2" in body

    page = client.get(f"{V1}/sign/{_raw(link)}").json()
    assert page["kind"] == "area" and page["area_name"] == "Level 3"
    assert len(page["documents"]) == 2 and page["ready_count"] == 2
    good = {"signer_name": "Casey Client", "signature_png": _png(), "confirm": True}
    r = client.post(f"{V1}/sign/{_raw(link)}", json=good)
    assert r.status_code == 200 and r.json()["signed_lines"] == 2
    assert r.json()["documents"] == 2
    for itp in (first, second):
        state = client.get(f"{V1}/itps/{itp['id']}", headers=s["vh"]).json()
        assert state["open_hold_count"] == 0 and state["signature_count"] == 3

    # The area's combined pack: one PDF covering both, versioned on change.
    packs_url = f"{V1}/areas/{area['id']}/packs"
    r = client.post(packs_url, headers=s["vh"])
    assert r.status_code == 200, r.text
    pack = r.json()
    assert pack["area_id"] == area["id"] and pack["signature_count"] == 6
    assert pack["filename"].startswith("Level-3-sign-off-pack-v")
    assert client.post(packs_url, headers=s["vh"]).json()["regenerated"] is False
    assert client.get(packs_url, headers=s["xh"]).status_code == 404
    assert (
        client.post(
            f"{V1}/areas/999999/sign-links", json={}, headers=s["ih"]
        ).status_code
        == 404
    )
    empty = create_area(client, s["oh"], pid, "Level 4")
    r = client.post(f"{V1}/areas/{empty['id']}/sign-links", json={}, headers=s["ih"])
    assert r.status_code == 409 and "no ITPs" in r.json()["detail"]
    assert (
        client.get(f"{V1}/areas/{area['id']}/sign-links", headers=s["vh"]).json()[0][
            "status"
        ]
        == "used"
    )


def test_itp_pack_regenerates_only_on_change_and_keeps_versions(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3
) -> None:
    s = _setup(client, tenant)
    url = f"{V1}/itps/{s['itp']['id']}/packs"
    assert client.get(url, headers=s["vh"]).json() == []
    r = client.post(url, headers=s["vh"])
    assert r.status_code == 200, r.text
    v1 = r.json()
    assert v1["version"] == 1 and v1["regenerated"] is True
    assert (
        v1["download_url"].startswith("https://")
        and "packs/itps/" in v1["download_url"]
    )
    key = next(
        k for k in fake_s3.objects if k.startswith(f"packs/itps/{s['itp']['id']}/v1-")
    )
    pdf, content_type = fake_s3.objects[key]
    assert pdf.startswith(b"%PDF") and content_type == "application/pdf"

    again = client.post(url, headers=s["vh"]).json()
    assert again["id"] == v1["id"] and again["regenerated"] is False

    r = client.put(
        f"{V1}/itp-items/{s['items']['formwork']['id']}",
        json={"status": "pass", "notes": "Grid A–D checked"},
        headers=s["ih"],
    )
    assert r.status_code == 200
    v2 = client.post(url, headers=s["vh"]).json()
    assert v2["version"] == 2 and v2["regenerated"] is True
    assert [p["version"] for p in client.get(url, headers=s["vh"]).json()] == [2, 1]
    assert client.get(url, headers=s["xh"]).status_code == 404
    assert len([k for k in fake_s3.objects if k.startswith("packs/itps/")]) == 2


def test_signature_refreshes_the_pack_in_the_background(
    client: TestClient, tenant: FakeTenant, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ITP_PACK_AUTOREGENERATE", True)
    s = _setup(client, tenant)
    _ready_rebar(client, s)  # the in-app signature schedules the render
    listed = client.get(f"{V1}/itps/{s['itp']['id']}/packs", headers=s["vh"]).json()
    assert [p["version"] for p in listed] == [1] and listed[0]["signature_count"] == 1
    # Nothing changed since: asking for it returns the same version.
    r = client.post(f"{V1}/itps/{s['itp']['id']}/packs", headers=s["vh"])
    assert r.json()["version"] == 1 and r.json()["regenerated"] is False


@pytest.mark.usefixtures("open_meteo")
def test_pack_html_shows_lines_evidence_and_stamps(
    client: TestClient, tenant: FakeTenant
) -> None:
    s = _setup(client, tenant)
    _ready_rebar(client, s)
    link = client.post(
        f"{V1}/itps/{s['itp']['id']}/sign-links", json={}, headers=s["ih"]
    ).json()["links"][0]
    good = {
        "signer_name": "Casey <b>Client</b>",
        "signature_png": _png(),
        "confirm": True,
    }
    assert (
        client.post(
            f"{V1}/sign/{_raw(link)}", json={**good, "gps_lat": 34.2, "gps_lng": -82.1}
        ).status_code
        == 200
    )
    with Session(engine) as db:
        from app.models import ProjectItp

        itp = db.get(ProjectItp, s["itp"]["id"])
        assert itp is not None
        target = packs.itp_target(db, itp)
        content = packs.pack_content(db, target.project, target.itps, None)
        html = packs.render_html(
            content,
            version=3,
            generated_by="owner@example.com",
            generated_at=datetime.now(UTC),
        )
    assert "Reinforcement inspected before pour" in html
    assert "Casey &lt;b&gt;Client&lt;/b&gt;" in html  # escaped
    assert "Signed by email link" in html and "Signed in the app" in html
    assert "GPS 34.200000, -82.100000" in html
    assert "Partly cloudy, 61.3 °F" in html
    assert "data:image/png;base64," in html  # the drawn signature
    assert "Pack version 3" in html and "Waiting for: Client engineer" in html


def test_witness_notice(
    client: TestClient, tenant: FakeTenant, outbox: MemoryTransport
) -> None:
    s = _setup(client, tenant)
    pour = s["items"]["pour"]["id"]
    url = f"{V1}/itp-items/{pour}/witness-notice"
    body = {"planned_for": "Thu 14 Nov, 7:30 am", "message": "Pump truck booked"}
    assert client.post(url, json=body, headers=s["vh"]).status_code == 403
    r = client.post(url, json=body, headers=s["ih"])
    assert r.status_code == 200, r.text
    assert r.json() == {"sent_to": [CLIENT_EMAIL], "skipped": []}
    (message,) = [m for m in outbox.outbox if m["To"] == CLIENT_EMAIL]
    assert message["Subject"] == (
        f"Witness point notice: Pour witnessed — {s['project']['name']}"
    )
    text_body = message.get_body(("plain",)).get_content()  # type: ignore[union-attr]
    assert "Thu 14 Nov, 7:30 am" in text_body and "Pump truck booked" in text_body
    assert client.post(url, json=body, headers=s["ih"]).status_code == 429

    # Hold points too; roles without an email are reported.
    rebar = s["items"]["rebar"]["id"]
    r = client.post(f"{V1}/itp-items/{rebar}/witness-notice", json={}, headers=s["ih"])
    assert r.status_code == 200
    assert r.json()["skipped"] == [
        "Site engineer: no signer email — add one under Sign-off roles"
    ]
    assert outbox.outbox[-1]["Subject"].startswith("Hold point notice")
    # Not for other lines.
    formwork = s["items"]["formwork"]["id"]
    r = client.post(
        f"{V1}/itp-items/{formwork}/witness-notice", json={}, headers=s["ih"]
    )
    assert r.status_code == 422
    # No one to tell.
    client.put(
        f"{V1}/signoff-roles/{s['roles']['Client engineer']['id']}",
        json={"signer_email": None},
        headers=s["oh"],
    )
    with Session(engine) as db:
        db.execute(text("DELETE FROM email_send_log"))
        db.commit()
    r = client.post(url, json={}, headers=s["ih"])
    assert r.status_code == 422 and "No one to notify" in r.json()["detail"]


def test_due_reminders_reissue_waiting_links(
    client: TestClient, tenant: FakeTenant, outbox: MemoryTransport
) -> None:
    s = _setup(client, tenant)
    _ready_rebar(client, s)
    url = f"{V1}/itps/{s['itp']['id']}/sign-links"
    client.post(url, json={}, headers=s["ih"])
    with Session(engine) as db:
        assert send_due_reminders(db) == 0  # not waited long enough
        db.execute(
            text(
                "UPDATE external_sign_tokens SET created_at = now() - interval '4 days'"
            )
        )
        db.commit()
        assert send_due_reminders(db) == 1
        assert send_due_reminders(db) == 0  # the fresh link has not waited
    links = client.get(url, headers=s["vh"]).json()
    assert [(x["status"], x["reminder_count"]) for x in links] == [
        ("active", 1),
        ("replaced", 0),
    ]
    assert links[0]["email_status"] == "sent"
    assert outbox.outbox[-1]["Subject"].startswith("Reminder:")
    # At most SIGN_REMINDER_MAX reminders.
    with Session(engine) as db:
        db.execute(
            text(
                "UPDATE external_sign_tokens SET created_at = now() - interval '4 days', "
                "reminder_count = :n"
            ),
            {"n": settings.SIGN_REMINDER_MAX},
        )
        db.commit()
        assert send_due_reminders(db) == 0
