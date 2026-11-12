"""Increment 14.5: drawing revisions and carried pins.

Owner decision 2026-11-10: upload Rev B over Rev A instead of a separate
drawing; pins carry forward at the same page and x / y flagged "check
position" until confirmed or moved; old revisions stay viewable read-only
with their pins as they were.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.drawing_revisions import next_revision_label, normalize_revision_label
from tests.utils.auth0 import FakeTenant
from tests.utils.domain import (
    OUTSIDER,
    OWNER,
    V1,
    VIEWER,
    create_finding,
    create_inspection,
    create_pin,
    create_project,
    headers,
    invite,
    upload_drawing,
)
from tests.utils.s3 import FakeS3


def _presign(
    client: TestClient, h: dict[str, str], project_id: int, filename: str
) -> str:
    r = client.post(
        f"{V1}/drawings/presign",
        json={
            "project_id": project_id,
            "filename": filename,
            "content_type": "application/pdf",
        },
        headers=h,
    )
    assert r.status_code == 200, r.text
    key: str = r.json()["s3_key"]
    return key


def upload_revision(
    client: TestClient,
    h: dict[str, str],
    drawing: dict[str, Any],
    filename: str = "plan-revB.pdf",
    expect: int = 201,
    **overrides: Any,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "filename": filename,
        "s3_key": _presign(client, h, drawing["project_id"], filename),
        "file_type": "pdf",
        "file_size": 2048,
    }
    body.update(overrides)
    r = client.post(f"{V1}/drawings/{drawing['id']}/revisions", json=body, headers=h)
    assert r.status_code == expect, r.text
    data: dict[str, Any] = r.json()
    return data


@pytest.mark.parametrize(
    ("current", "expected"),
    [
        (None, "B"),
        ("A", "B"),
        ("Z", "AA"),
        ("AY", "AZ"),
        ("0", "1"),
        ("9", "10"),
        ("P1", "P2"),
        ("C09", "C10"),
        ("IFC", "IFC-2"),
        ("For construction", "FOR CONSTRUCTION-2"),
    ],
)
def test_next_revision_label(current: str | None, expected: str) -> None:
    assert next_revision_label(current) == expected


def test_normalize_revision_label() -> None:
    assert normalize_revision_label(" rev. b ") == "B"
    assert normalize_revision_label("Revision 3") == "3"
    assert normalize_revision_label("rev.c") == "C"
    assert normalize_revision_label("rev2") == "2"
    assert normalize_revision_label("Review set") == "REVIEW SET"
    assert normalize_revision_label("   ") is None
    assert normalize_revision_label(None) is None
    assert normalize_revision_label("x" * 40) == "X" * 20


def test_revision_carries_pins_and_freezes_the_old_one(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant, OWNER)
    project = create_project(client, h)
    a = upload_drawing(
        client, h, project["id"], filename="site.pdf", drawing_number="C-101"
    )
    assert a["revision"] is None
    assert a["is_current"] is True
    assert a["series_id"] == a["id"]
    assert a["revision_count"] == 1
    inspection = create_inspection(client, h, project["id"])
    finding = create_finding(client, h, inspection["id"])
    p1 = create_pin(
        client,
        h,
        a["id"],
        x_pct=12.5,
        y_pct=40,
        status="punch_item",
        label="Footing F3",
        finding_id=finding["id"],
        page_number=2,
    )
    create_pin(client, h, a["id"], x_pct=80, y_pct=10, status="verified")

    b = upload_revision(client, h, a, page_width_pts=2448, page_height_pts=1584)
    assert b["revision"] == "B"
    assert b["is_current"] is True
    assert b["series_id"] == a["id"]
    assert b["title"] == a["title"]
    assert b["drawing_number"] == "C-101"
    assert b["revision_count"] == 2
    assert b["pins_to_check"] == 2
    assert b["page_width_pts"] == 2448

    # The unlabelled original became Rev A and is now superseded.
    old = client.get(f"{V1}/drawings/{a['id']}", headers=h).json()
    assert old["revision"] == "A"
    assert old["is_current"] is False
    assert old["superseded_at"] is not None
    assert old["pins_to_check"] == 0

    # Pins carried at the same page and x / y, with their links and status.
    new_pins = client.get(f"{V1}/drawings/{b['id']}/pins", headers=h).json()
    assert len(new_pins) == 2
    carried = new_pins[0]
    assert carried["carried_from_pin_id"] == p1["id"]
    assert carried["carried_from_revision"] == "A"
    assert carried["position_check"] is True
    assert (carried["x_pct"], carried["y_pct"], carried["page_number"]) == (
        12.5,
        40,
        2,
    )
    assert carried["finding_id"] == finding["id"]
    assert carried["label"] == "Footing F3"
    assert carried["status"] == "punch_item"

    # Rev A's pins are untouched and read-only.
    old_pins = client.get(f"{V1}/drawings/{a['id']}/pins", headers=h).json()
    assert [p["position_check"] for p in old_pins] == [False, False]
    r = client.put(f"{V1}/pins/{p1['id']}", json={"status": "verified"}, headers=h)
    assert r.status_code == 409
    assert "old revision" in r.json()["detail"]
    assert client.delete(f"{V1}/pins/{p1['id']}", headers=h).status_code == 409
    r = client.post(
        f"{V1}/drawings/{a['id']}/pins", json={"x_pct": 1, "y_pct": 1}, headers=h
    )
    assert r.status_code == 409
    r = client.put(f"{V1}/drawings/{a['id']}", json={"title": "Renamed"}, headers=h)
    assert r.status_code == 409
    # … but it can still be viewed.
    assert client.get(f"{V1}/drawings/{a['id']}/view-url", headers=h).status_code == 200

    # The project list shows the sheet once, at its current revision.
    listed = client.get(
        f"{V1}/drawings", params={"project_id": project["id"]}, headers=h
    ).json()
    assert [d["id"] for d in listed] == [b["id"]]
    everything = client.get(
        f"{V1}/drawings",
        params={"project_id": project["id"], "include_superseded": True},
        headers=h,
    ).json()
    assert {d["id"] for d in everything} == {a["id"], b["id"]}

    revisions = client.get(f"{V1}/drawings/{a['id']}/revisions", headers=h).json()
    assert [(r["revision"], r["is_current"]) for r in revisions] == [
        ("B", True),
        ("A", False),
    ]


def test_confirm_or_move_settles_a_carried_pin(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant, OWNER)
    project = create_project(client, h)
    a = upload_drawing(client, h, project["id"], revision="0")
    create_pin(client, h, a["id"], x_pct=10, y_pct=10)
    create_pin(client, h, a["id"], x_pct=20, y_pct=20)
    b = upload_revision(client, h, a)
    assert b["revision"] == "1"
    first, second = client.get(f"{V1}/drawings/{b['id']}/pins", headers=h).json()

    r = client.put(
        f"{V1}/pins/{first['id']}", json={"position_confirmed": True}, headers=h
    )
    assert r.status_code == 200, r.text
    assert r.json()["position_check"] is False
    assert r.json()["position_confirmed_by"] == OWNER["email"]
    assert r.json()["position_confirmed_at"] is not None
    assert (r.json()["x_pct"], r.json()["y_pct"]) == (10, 10)

    r = client.put(
        f"{V1}/pins/{second['id']}",
        json={"x_pct": 25.5, "y_pct": 18, "page_number": 1},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["position_check"] is False
    assert (r.json()["x_pct"], r.json()["y_pct"]) == (25.5, 18)

    drawing = client.get(f"{V1}/drawings/{b['id']}", headers=h).json()
    assert drawing["pins_to_check"] == 0

    # An ordinary pin can be moved too; confirming one that needs no check
    # is accepted and changes nothing.
    plain = create_pin(client, h, b["id"], x_pct=50, y_pct=50)
    r = client.put(
        f"{V1}/pins/{plain['id']}", json={"x_pct": 51, "y_pct": 49}, headers=h
    )
    assert r.status_code == 200
    assert r.json()["position_confirmed_by"] is None
    r = client.put(
        f"{V1}/pins/{plain['id']}", json={"position_confirmed": True}, headers=h
    )
    assert r.status_code == 200
    assert r.json()["position_confirmed_at"] is None
    # Out-of-range moves are refused.
    r = client.put(f"{V1}/pins/{plain['id']}", json={"x_pct": 101}, headers=h)
    assert r.status_code == 422


def test_revision_labels_and_conflicts(client: TestClient, tenant: FakeTenant) -> None:
    h = headers(tenant, OWNER)
    project = create_project(client, h)
    a = upload_drawing(client, h, project["id"], revision="rev a")
    assert a["revision"] == "A"
    b = upload_revision(client, h, a, revision="Rev C", title="Site plan IFC")
    assert b["revision"] == "C"
    assert b["title"] == "Site plan IFC"
    # Only the current revision can be revised …
    r = upload_revision(client, h, a, expect=409)
    assert "old revision" in r["detail"]
    # … and labels are unique within the sheet.
    r = upload_revision(client, h, b, revision="a", expect=409)
    assert r["detail"] == "Revision A already exists for this drawing"
    # Blank → next after the current one.
    d = upload_revision(client, h, b, revision="  ")
    assert d["revision"] == "D"
    assert d["revision_count"] == 3


def test_revision_authorization_and_key_binding(
    client: TestClient, tenant: FakeTenant
) -> None:
    owner_h = headers(tenant, OWNER)
    project = create_project(client, owner_h)
    other = create_project(client, owner_h, name="Other")
    invite(client, owner_h, project["id"], VIEWER["email"], role="viewer")
    a = upload_drawing(client, owner_h, project["id"])

    # A key outside the project's prefix looks like a missing drawing.
    r = client.post(
        f"{V1}/drawings/{a['id']}/revisions",
        json={
            "filename": "x.pdf",
            "s3_key": _presign(client, owner_h, other["id"], "x.pdf"),
            "file_type": "pdf",
        },
        headers=owner_h,
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "Drawing not found"

    body = {
        "filename": "x.pdf",
        "s3_key": _presign(client, owner_h, project["id"], "x.pdf"),
        "file_type": "pdf",
    }
    # Viewers can read revisions but not add one; outsiders see nothing.
    viewer_h = headers(tenant, VIEWER)
    r = client.post(f"{V1}/drawings/{a['id']}/revisions", json=body, headers=viewer_h)
    assert r.status_code in (403, 404)
    assert (
        client.get(f"{V1}/drawings/{a['id']}/revisions", headers=viewer_h).status_code
        == 200
    )
    outsider_h = headers(tenant, OUTSIDER)
    for method, url in (
        ("get", f"{V1}/drawings/{a['id']}/revisions"),
        ("post", f"{V1}/drawings/{a['id']}/revisions"),
    ):
        r = client.request(method, url, json=body, headers=outsider_h)
        assert r.status_code == 404
        assert r.json()["detail"] == "Drawing not found"


def test_delete_revision_only_restores_previous_and_delete_removes_sheet(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3
) -> None:
    h = headers(tenant, OWNER)
    project = create_project(client, h)
    a = upload_drawing(client, h, project["id"])
    pin = create_pin(client, h, a["id"])
    b = upload_revision(client, h, a)

    # An old revision cannot be deleted on its own.
    r = client.delete(f"{V1}/drawings/{a['id']}", headers=h)
    assert r.status_code == 409

    # Removing just Rev B brings Rev A back as current, pins as they were.
    r = client.delete(
        f"{V1}/drawings/{b['id']}", params={"revision_only": True}, headers=h
    )
    assert r.status_code == 204
    assert client.get(f"{V1}/drawings/{b['id']}", headers=h).status_code == 404
    restored = client.get(f"{V1}/drawings/{a['id']}", headers=h).json()
    assert restored["is_current"] is True
    assert restored["revision_count"] == 1
    r = client.put(f"{V1}/pins/{pin['id']}", json={"status": "verified"}, headers=h)
    assert r.status_code == 200

    # Deleting the current revision removes every revision of the sheet.
    b = upload_revision(client, h, restored)
    upload_revision(client, h, b)
    current = client.get(
        f"{V1}/drawings", params={"project_id": project["id"]}, headers=h
    ).json()
    assert len(current) == 1
    deleted_keys = len(fake_s3.deleted)
    r = client.delete(f"{V1}/drawings/{current[0]['id']}", headers=h)
    assert r.status_code == 204
    everything = client.get(
        f"{V1}/drawings",
        params={"project_id": project["id"], "include_superseded": True},
        headers=h,
    ).json()
    assert everything == []
    assert len(fake_s3.deleted) == deleted_keys + 3


def test_itp_line_lists_only_current_revision_pins(
    client: TestClient, tenant: FakeTenant
) -> None:
    from tests.utils.itp import apply_template, create_template

    h = headers(tenant, OWNER)
    project = create_project(client, h)
    master = create_template(client, h)
    itp = apply_template(client, h, project["id"], master["id"])
    item_id = itp["items"][0]["id"]
    a = upload_drawing(client, h, project["id"])
    create_pin(client, h, a["id"], itp_item_id=item_id)
    b = upload_revision(client, h, a)
    detail = client.get(f"{V1}/itps/{itp['id']}", headers=h).json()
    pins = detail["items"][0]["pins"]
    assert [p["drawing_id"] for p in pins] == [b["id"]]
