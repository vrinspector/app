"""Outbound email (increment 13.5): member invites, send log, resend."""

from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.core.email import MemoryTransport
from app.models import EmailSendLog
from tests.utils.auth0 import DEFAULT_EMAIL, FakeTenant
from tests.utils.domain import (
    OUTSIDER,
    OWNER,
    V1,
    create_project,
    headers,
    invite,
)


def _bodies(message: EmailMessage) -> tuple[str, str]:
    text_part = message.get_body(preferencelist=("plain",))
    html_part = message.get_body(preferencelist=("html",))
    assert text_part is not None and html_part is not None
    return text_part.get_content(), html_part.get_content()


def _log(client: TestClient, h: dict[str, str], project_id: int, **params: Any) -> Any:
    r = client.get(f"{V1}/projects/{project_id}/emails", headers=h, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_invite_sends_branded_email_and_logs_it(
    client: TestClient, tenant: FakeTenant, outbox: MemoryTransport
) -> None:
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h, name="Greenwood Plant")  # client "PGE"
    m = invite(client, owner_h, p["id"], "New.Person@Example.com", role="viewer")

    # Response shape is unchanged by the email.
    assert set(m) == {
        "id",
        "public_id",
        "project_id",
        "email",
        "user_email",
        "user_sub",
        "role",
        "invited_by",
        "created_at",
    }

    assert len(outbox.outbox) == 1
    message = outbox.outbox[0]
    assert message["To"] == "new.person@example.com"
    assert message["Subject"] == "You've been added to Greenwood Plant on VR Inspector"
    assert str(settings.EMAILS_FROM_EMAIL) in message["From"]
    assert message["Message-ID"]
    text, html = _bodies(message)
    link = f"{settings.app_public_url}/projects/{p['id']}"
    for body in (text, html):
        assert OWNER["email"] in body
        assert "Greenwood Plant" in body
        assert "PGE" in body
        assert "Viewer" in body
        assert link in body
        assert "new.person@example.com" in body
    assert f'href="{link}"' in html
    assert "#2e3d2e" in html  # brand band (v2.51 forest green)

    rows = _log(client, owner_h, p["id"])
    assert len(rows) == 1
    row = rows[0]
    assert row["email_type"] == "member_invite"
    assert row["related_id"] == m["id"]
    assert row["recipient"] == "new.person@example.com"
    assert row["status"] == "sent"
    assert row["error"] is None
    assert row["triggered_by"] == OWNER["email"]
    assert row["sent_at"] is not None
    with Session(engine) as db:
        stored = db.exec(select(EmailSendLog)).one()
        assert stored.message_id == message["Message-ID"]


def test_project_name_cannot_inject_markup(
    client: TestClient, tenant: FakeTenant, outbox: MemoryTransport
) -> None:
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h, name='<script>alert("x")</script> Plant')
    invite(client, owner_h, p["id"], "a@example.com")
    _text, html = _bodies(outbox.outbox[0])
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_failed_delivery_is_recorded_and_invite_still_succeeds(
    client: TestClient, tenant: FakeTenant, outbox: MemoryTransport
) -> None:
    outbox.fail_with = ConnectionRefusedError("[Errno 111] Connection refused")
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h)
    m = invite(client, owner_h, p["id"], "b@example.com")

    row = _log(client, owner_h, p["id"])[0]
    assert row["status"] == "failed"
    assert "Connection refused" in row["error"]
    assert row["sent_at"] is None
    members = client.get(f"{V1}/projects/{p['id']}/members", headers=owner_h).json()
    assert m["id"] in [x["id"] for x in members]

    # A failed invite can be resent straight away (no cooldown).
    outbox.fail_with = None
    r = client.post(
        f"{V1}/projects/{p['id']}/members/{m['id']}/invite-email", headers=owner_h
    )
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "queued"  # as returned; delivered after
    rows = _log(client, owner_h, p["id"], related_id=m["id"])
    assert [x["status"] for x in rows] == ["sent", "failed"]
    assert len(outbox.outbox) == 1


def test_unconfigured_smtp_logs_skipped(
    client: TestClient,
    tenant: FakeTenant,
    outbox: MemoryTransport,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SMTP_HOST", None)
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h)
    invite(client, owner_h, p["id"], "c@example.com")
    assert outbox.outbox == []
    row = _log(client, owner_h, p["id"])[0]
    assert row["status"] == "skipped"
    assert row["error"] == "Email is not configured on this server"


def test_resend_cooldown_and_rules(
    client: TestClient, tenant: FakeTenant, outbox: MemoryTransport
) -> None:
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h)
    m = invite(client, owner_h, p["id"], "d@example.com")
    url = f"{V1}/projects/{p['id']}/members/{m['id']}/invite-email"

    r = client.post(url, headers=owner_h)
    assert r.status_code == 429
    assert "just sent" in r.json()["detail"]

    # Age the last invite past the cooldown → resend allowed.
    with Session(engine) as db:
        row = db.exec(select(EmailSendLog)).one()
        row.created_at = datetime.now(UTC) - timedelta(
            seconds=settings.INVITE_RESEND_COOLDOWN_SECONDS + 5
        )
        db.add(row)
        db.commit()
    r = client.post(url, headers=owner_h)
    assert r.status_code == 202
    assert len(outbox.outbox) == 2

    # The owner row is never sent an invite; unknown / other-project ids are 404.
    members = client.get(f"{V1}/projects/{p['id']}/members", headers=owner_h).json()
    owner_row = next(x for x in members if x["role"] == "owner")
    r = client.post(
        f"{V1}/projects/{p['id']}/members/{owner_row['id']}/invite-email",
        headers=owner_h,
    )
    assert r.status_code == 400
    r = client.post(
        f"{V1}/projects/{p['id']}/members/424242/invite-email", headers=owner_h
    )
    assert r.status_code == 404
    other = create_project(client, owner_h, name="Other")
    r = client.post(
        f"{V1}/projects/{other['id']}/members/{m['id']}/invite-email",
        headers=owner_h,
    )
    assert r.status_code == 404


def test_email_log_is_owner_only_and_filterable(
    client: TestClient, tenant: FakeTenant
) -> None:
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h)
    a = invite(client, owner_h, p["id"], DEFAULT_EMAIL, role="inspector")
    invite(client, owner_h, p["id"], "e@example.com", role="viewer")

    assert len(_log(client, owner_h, p["id"])) == 2
    assert len(_log(client, owner_h, p["id"], email_type="member_invite")) == 2
    only_a = _log(client, owner_h, p["id"], related_id=a["id"])
    assert [x["recipient"] for x in only_a] == [DEFAULT_EMAIL]
    r = client.get(
        f"{V1}/projects/{p['id']}/emails",
        headers=owner_h,
        params={"email_type": "spam"},
    )
    assert r.status_code == 422

    # The default identity is an inspector on this project → 403, not 404.
    inspector_h = tenant.auth_headers()
    r = client.get(f"{V1}/projects/{p['id']}/emails", headers=inspector_h)
    assert r.status_code == 403
    r = client.post(
        f"{V1}/projects/{p['id']}/members/{a['id']}/invite-email",
        headers=inspector_h,
    )
    assert r.status_code == 403
    # Outsiders cannot tell the project exists.
    r = client.get(f"{V1}/projects/{p['id']}/emails", headers=headers(tenant, OUTSIDER))
    assert r.status_code == 404
    r = client.get(f"{V1}/projects/{p['id']}/emails")
    assert r.status_code == 401


def test_log_outlives_project_and_member(
    client: TestClient, tenant: FakeTenant
) -> None:
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h)
    m = invite(client, owner_h, p["id"], "f@example.com")
    r = client.delete(f"{V1}/projects/{p['id']}/members/{m['id']}", headers=owner_h)
    assert r.status_code == 204
    assert len(_log(client, owner_h, p["id"])) == 1
    r = client.delete(f"{V1}/projects/{p['id']}", headers=owner_h)
    assert r.status_code == 204
    with Session(engine) as db:
        row = db.exec(select(EmailSendLog)).one()
        assert row.project_id is None
        assert row.recipient == "f@example.com"
        assert row.status == "sent"
