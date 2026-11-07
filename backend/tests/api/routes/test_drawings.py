"""Drawings + pins (increment 05): Block 8D/8E router port.

The first two tests are the legacy ``test_drawings_authorization.py`` suite
(``vrinspector/backend`` → ``staging_snapshot_20260716/``) ported from its
fake-DB harness to the real routes: the same fixture (project 1 with two
members, project 2 with another; one drawing and one pin each), the same
allowed-member walk and the same non-member object-hiding assertions, with
the legacy ``detail`` strings.
"""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import settings
from app.core.db import engine
from tests.utils.auth0 import DEFAULT_EMAIL, FakeTenant
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

# Identities of the legacy harness: project 1 = {owner, member}, project 2 = {other}.
MEMBER = {
    "sub": "auth0|member-0001",
    "email": "member@example.com",
    "name": "Mel Member",
}
OTHER = {"sub": "auth0|other-0001", "email": "other@example.com", "name": "Otto Other"}


def legacy_fixture(client: TestClient, tenant: FakeTenant) -> dict[str, Any]:
    """Recreate the legacy ``FakeDB`` world through the API."""
    owner_h = headers(tenant, OWNER)
    other_h = headers(tenant, OTHER)
    p1 = create_project(client, owner_h, name="P1")
    invite(client, owner_h, p1["id"], MEMBER["email"], role="inspector")
    p2 = create_project(client, other_h, name="P2")
    d10 = upload_drawing(client, owner_h, p1["id"], filename="p1.pdf", title="P1")
    d20 = upload_drawing(client, other_h, p2["id"], filename="p2.pdf", title="P2")
    pin100 = create_pin(client, owner_h, d10["id"], x_pct=10, y_pct=20)
    pin200 = create_pin(
        client, other_h, d20["id"], x_pct=30, y_pct=40, status="verified"
    )
    return {
        "p1": p1,
        "p2": p2,
        "d10": d10,
        "d20": d20,
        "pin100": pin100,
        "pin200": pin200,
    }


def test_allowed_member_paths(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3
) -> None:
    """Legacy ``test_allowed_member_paths``: a plain member can do everything."""
    w = legacy_fixture(client, tenant)
    u = headers(tenant, MEMBER)
    p1, d10, pin100 = w["p1"]["id"], w["d10"]["id"], w["pin100"]["id"]

    r = client.post(
        f"{V1}/drawings/presign",
        json={
            "project_id": p1,
            "filename": "plan.pdf",
            "content_type": "application/pdf",
        },
        headers=u,
    )
    assert r.status_code == 200
    presign = r.json()
    assert set(presign) == {"upload_url", "s3_key"}
    assert presign["s3_key"].startswith(f"drawings/projects/{p1}/")
    assert presign["s3_key"].endswith(".pdf")
    assert presign["upload_url"].startswith(
        f"https://{settings.S3_BUCKET}.s3.test/drawings/projects/{p1}/"
    )
    assert "fake-put" in presign["upload_url"]
    method, params, expires = fake_s3.presigned[-1]
    assert method == "put_object"
    assert params == {
        "Bucket": settings.S3_BUCKET,
        "Key": presign["s3_key"],
        "ContentType": "application/pdf",
    }
    assert expires == settings.S3_PRESIGN_PUT_SECONDS == 600

    r = client.post(
        f"{V1}/drawings",
        json={
            "project_id": p1,
            "title": "New",
            "filename": "new.pdf",
            "s3_key": presign["s3_key"],
            "file_type": "pdf",
        },
        headers=u,
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["project_id"] == p1
    assert created["uploaded_by"] == MEMBER["email"]
    assert created["discipline"] == "general" and created["file_type"] == "pdf"
    assert created["page_width_pts"] is None and created["public_id"]

    listed = client.get(f"{V1}/drawings", params={"project_id": p1}, headers=u)
    assert listed.status_code == 200 and listed.json()
    assert [d["id"] for d in listed.json()] == [created["id"], d10]  # newest first

    assert client.get(f"{V1}/drawings/{d10}", headers=u).json()["id"] == d10

    r = client.get(f"{V1}/drawings/{d10}/view-url", headers=u)
    assert r.status_code == 200 and set(r.json()) == {"view_url"}
    assert r.json()["view_url"].startswith(
        f"https://{settings.S3_BUCKET}.s3.test/drawings/projects/{p1}/"
    )
    method, params, expires = fake_s3.presigned[-1]
    assert method == "get_object" and params["Key"] == w["d10"]["s3_key"]
    assert expires == settings.S3_PRESIGN_GET_SECONDS == 3600

    r = client.put(f"{V1}/drawings/{d10}", json={"title": "Updated"}, headers=u)
    assert r.status_code == 200 and r.json()["title"] == "Updated"

    r = client.patch(
        f"{V1}/drawings/{d10}/dimensions",
        json={"page_width_pts": 612, "page_height_pts": 792},
        headers=u,
    )
    assert r.status_code == 200
    assert r.json() == {"id": d10, "page_width_pts": 612, "page_height_pts": 792}
    assert (
        client.get(f"{V1}/drawings/{d10}", headers=u).json()["page_height_pts"] == 792
    )

    pins = client.get(f"{V1}/drawings/{d10}/pins", headers=u).json()
    assert pins[0]["id"] == pin100 and pins[0]["x_pct"] == 10 and pins[0]["y_pct"] == 20

    r = client.post(
        f"{V1}/drawings/{d10}/pins",
        json={"x_pct": 1, "y_pct": 2, "status": "verified"},
        headers=u,
    )
    assert r.status_code == 201, r.text
    pin = r.json()
    assert pin["drawing_id"] == d10 and pin["created_by"] == MEMBER["email"]
    assert pin["status"] == "verified" and pin["page_number"] == 1
    assert pin["finding_id"] is None and pin["discipline_data"] is None

    assert client.delete(f"{V1}/pins/{pin['id']}", headers=u).status_code == 204
    assert client.get(f"{V1}/pins/{pin['id']}", headers=u).status_code == 404

    assert client.delete(f"{V1}/drawings/{created['id']}", headers=u).status_code == 204
    assert client.get(f"{V1}/drawings/{created['id']}", headers=u).status_code == 404
    assert (settings.S3_BUCKET, created["s3_key"]) in fake_s3.deleted


def assert_404(r: Any, detail: str) -> None:
    assert r.status_code == 404, (r.status_code, r.text)
    assert r.json()["detail"] == detail


def test_denied_non_member_paths_object_hide(
    client: TestClient, tenant: FakeTenant
) -> None:
    """Legacy ``test_denied_non_member_paths_object_hide``: 404, never 403."""
    w = legacy_fixture(client, tenant)
    u = headers(tenant, MEMBER)  # member of project 1 only
    p1, p2, d20, pin200 = (
        w["p1"]["id"],
        w["p2"]["id"],
        w["d20"]["id"],
        w["pin200"]["id"],
    )

    assert_404(
        client.post(
            f"{V1}/drawings/presign",
            json={"project_id": p2, "filename": "x.pdf"},
            headers=u,
        ),
        "Project not found",
    )
    assert_404(
        client.get(f"{V1}/drawings", params={"project_id": p2}, headers=u),
        "Project not found",
    )
    assert_404(
        client.post(
            f"{V1}/drawings",
            json={
                "project_id": p2,
                "title": "Bad",
                "filename": "bad.pdf",
                "s3_key": f"drawings/projects/{p2}/bad.pdf",
            },
            headers=u,
        ),
        "Project not found",
    )
    # Member of project 1 registering a key under project 2's prefix.
    assert_404(
        client.post(
            f"{V1}/drawings",
            json={
                "project_id": p1,
                "title": "Bad",
                "filename": "bad.pdf",
                "s3_key": f"drawings/projects/{p2}/bad.pdf",
            },
            headers=u,
        ),
        "Drawing not found",
    )
    assert_404(client.get(f"{V1}/drawings/{d20}", headers=u), "Drawing not found")
    assert_404(
        client.get(f"{V1}/drawings/{d20}/view-url", headers=u), "Drawing not found"
    )
    assert_404(
        client.put(f"{V1}/drawings/{d20}", json={"title": "Nope"}, headers=u),
        "Drawing not found",
    )
    assert_404(
        client.patch(
            f"{V1}/drawings/{d20}/dimensions",
            json={"page_width_pts": 1, "page_height_pts": 1},
            headers=u,
        ),
        "Drawing not found",
    )
    assert_404(client.get(f"{V1}/drawings/{d20}/pins", headers=u), "Drawing not found")
    assert_404(
        client.post(
            f"{V1}/drawings/{d20}/pins", json={"x_pct": 1, "y_pct": 2}, headers=u
        ),
        "Drawing not found",
    )
    assert_404(client.get(f"{V1}/pins/{pin200}", headers=u), "Pin not found")
    assert_404(
        client.put(f"{V1}/pins/{pin200}", json={"status": "verified"}, headers=u),
        "Pin not found",
    )
    assert_404(client.delete(f"{V1}/pins/{pin200}", headers=u), "Pin not found")
    assert_404(client.delete(f"{V1}/drawings/{d20}", headers=u), "Drawing not found")

    # Nothing was touched: project 2's owner still sees both objects unchanged.
    other_h = headers(tenant, OTHER)
    assert client.get(f"{V1}/drawings/{d20}", headers=other_h).json()["title"] == "P2"
    assert (
        client.get(f"{V1}/pins/{pin200}", headers=other_h).json()["status"]
        == "verified"
    )

    # Unknown ids read the same as hidden ones.
    assert_404(client.get(f"{V1}/drawings/999999", headers=u), "Drawing not found")
    assert_404(client.get(f"{V1}/pins/999999", headers=u), "Pin not found")
    assert client.get(f"{V1}/drawings/{d20}").status_code == 401


def test_presign_key_safety_and_register_prefix_binding(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    other = create_project(client, h, name="Other")

    # Unknown extensions get no extension (never a path, never a user string).
    r = client.post(
        f"{V1}/drawings/presign",
        json={"project_id": p["id"], "filename": "../../etc/passwd.dwg"},
        headers=h,
    )
    assert r.status_code == 200
    key = r.json()["s3_key"]
    assert key.startswith(f"drawings/projects/{p['id']}/")
    assert "." not in key.rsplit("/", 1)[1]
    # Default content type is the SPA's fallback.
    assert (
        client.post(
            f"{V1}/drawings/presign",
            json={"project_id": p["id"], "filename": "x.PNG"},
            headers=h,
        )
        .json()["s3_key"]
        .endswith(".png")
    )

    for bad_key in (
        f"drawings/projects/{other['id']}/abc.pdf",  # another project of mine
        f"photos/inspections/{p['id']}/abc.pdf",
        "drawings/abc.pdf",
        f"xdrawings/projects/{p['id']}/abc.pdf",
        "/etc/passwd",
    ):
        r = client.post(
            f"{V1}/drawings",
            json={
                "project_id": p["id"],
                "title": "Bad",
                "filename": "bad.pdf",
                "s3_key": bad_key,
            },
            headers=h,
        )
        assert_404(r, "Drawing not found")
    assert (
        client.get(f"{V1}/drawings", params={"project_id": p["id"]}, headers=h).json()
        == []
    )


def test_register_stores_spa_fields_and_verified_uploader(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    d = upload_drawing(
        client,
        h,
        p["id"],
        filename="E-101 Rev C.pdf",
        drawing_number="E-101",
        discipline="electrical",
        page_width_pts=2592,
        page_height_pts=1728,
    )
    assert d["title"] == "E-101 Rev C" and d["drawing_number"] == "E-101"
    assert d["discipline"] == "electrical" and d["file_type"] == "pdf"
    assert d["file_size"] == 48213
    assert d["page_width_pts"] == 2592 and d["page_height_pts"] == 1728
    assert d["uploaded_by"] == DEFAULT_EMAIL  # not "Test Inspector"
    assert d["view_url"] is None and d["thumbnail_url"] is None
    assert d["created_at"] and d["updated_at"]

    # Vocabulary is enforced at the API layer (the legacy app stored any string).
    for bad in (
        {"discipline": "plumbing"},
        {"file_type": "dwg"},
        {"file_size": -1},
        {"title": ""},
    ):
        body = {
            "project_id": p["id"],
            "title": "X",
            "filename": "x.pdf",
            "s3_key": f"drawings/projects/{p['id']}/x.pdf",
            **bad,
        }
        assert client.post(f"{V1}/drawings", json=body, headers=h).status_code == 422, (
            bad
        )


def test_list_filters_by_discipline_and_requires_project_id(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    upload_drawing(client, h, p["id"], filename="a.pdf", discipline="pid")
    upload_drawing(client, h, p["id"], filename="b.png", discipline="grading")
    upload_drawing(client, h, p["id"], filename="c.pdf", discipline="pid")

    r = client.get(f"{V1}/drawings", params={"project_id": p["id"]}, headers=h)
    assert [d["filename"] for d in r.json()] == ["c.pdf", "b.png", "a.pdf"]
    r = client.get(
        f"{V1}/drawings", params={"project_id": p["id"], "discipline": "pid"}, headers=h
    )
    assert [d["filename"] for d in r.json()] == ["c.pdf", "a.pdf"]
    r = client.get(
        f"{V1}/drawings",
        params={"project_id": p["id"], "discipline": "other"},
        headers=h,
    )
    assert r.json() == []
    assert client.get(f"{V1}/drawings", headers=h).status_code == 422
    r = client.get(
        f"{V1}/drawings",
        params={"project_id": p["id"], "discipline": "nope"},
        headers=h,
    )
    assert r.status_code == 422


def test_update_and_dimensions(client: TestClient, tenant: FakeTenant) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    d = upload_drawing(client, h, p["id"])

    r = client.put(f"{V1}/drawings/{d['id']}", json={}, headers=h)
    assert r.status_code == 400 and r.json()["detail"] == "No fields to update"
    # Legacy semantics: nulls are "not sent", so an all-null body is empty too.
    r = client.put(
        f"{V1}/drawings/{d['id']}", json={"title": None, "discipline": None}, headers=h
    )
    assert r.status_code == 400

    r = client.put(
        f"{V1}/drawings/{d['id']}",
        json={
            "drawing_number": "P-1203",
            "discipline": "pid",
            "thumbnail_url": "https://cdn.example/thumb.png",
        },
        headers=h,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["drawing_number"] == "P-1203" and body["discipline"] == "pid"
    assert body["thumbnail_url"] == "https://cdn.example/thumb.png"
    assert body["title"] == d["title"]  # untouched
    assert body["updated_at"] >= d["updated_at"]

    r = client.patch(
        f"{V1}/drawings/{d['id']}/dimensions",
        json={"page_width_pts": 1224.5, "page_height_pts": 792},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json() == {"id": d["id"], "page_width_pts": 1224.5, "page_height_pts": 792}
    for bad in ({"page_width_pts": 0, "page_height_pts": 1}, {"page_width_pts": 1}):
        r = client.patch(f"{V1}/drawings/{d['id']}/dimensions", json=bad, headers=h)
        assert r.status_code == 422, bad


def test_pins_page_aware_linking_and_update(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    d = upload_drawing(client, h, p["id"])
    insp = create_inspection(client, h, p["id"])
    finding = create_finding(client, h, insp["id"])
    foreign = create_project(client, h, name="Foreign")
    foreign_insp = create_inspection(client, h, foreign["id"])
    foreign_finding = create_finding(client, h, foreign_insp["id"])

    # The SPA's placePin body, page-aware (Block 8E).
    a = create_pin(client, h, d["id"], x_pct=12.345, y_pct=67.891, page_number=3)
    assert a["page_number"] == 3 and a["x_pct"] == 12.345 and a["y_pct"] == 67.891
    assert a["created_by"] == DEFAULT_EMAIL and a["status"] == "not_started"
    b = create_pin(
        client,
        h,
        d["id"],
        finding_id=finding["id"],
        tag_number="PS-12",
        label="Missing U-bolt",
        status="punch_item",
        notes="see finding",
    )
    assert b["finding_id"] == finding["id"] and b["tag_number"] == "PS-12"

    pins = client.get(f"{V1}/drawings/{d['id']}/pins", headers=h).json()
    assert [x["id"] for x in pins] == [a["id"], b["id"]]  # ORDER BY id

    # Pins cannot link to a finding outside the drawing's project.
    for fid in (foreign_finding["id"], 999999):
        r = client.post(
            f"{V1}/drawings/{d['id']}/pins",
            json={"x_pct": 1, "y_pct": 1, "finding_id": fid},
            headers=h,
        )
        assert_404(r, "Finding not found")
        r = client.put(f"{V1}/pins/{a['id']}", json={"finding_id": fid}, headers=h)
        assert_404(r, "Finding not found")

    # Validation: percentages 0–100, 1-indexed pages, known statuses.
    for bad in (
        {"x_pct": 101, "y_pct": 1},
        {"x_pct": -0.5, "y_pct": 1},
        {"x_pct": 1},
        {"x_pct": 1, "y_pct": 1, "page_number": 0},
        {"x_pct": 1, "y_pct": 1, "status": "done"},
    ):
        r = client.post(f"{V1}/drawings/{d['id']}/pins", json=bad, headers=h)
        assert r.status_code == 422, bad

    # Update: status/notes change, finding link set then explicitly cleared.
    r = client.put(f"{V1}/pins/{a['id']}", json={}, headers=h)
    assert r.status_code == 400
    r = client.put(
        f"{V1}/pins/{a['id']}",
        json={
            "status": "verified",
            "notes": "checked 7 Nov",
            "finding_id": finding["id"],
        },
        headers=h,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "verified" and body["notes"] == "checked 7 Nov"
    assert body["finding_id"] == finding["id"]
    assert body["x_pct"] == 12.345 and body["page_number"] == 3  # immovable
    r = client.put(f"{V1}/pins/{a['id']}", json={"finding_id": None}, headers=h)
    assert r.status_code == 200 and r.json()["finding_id"] is None
    assert r.json()["status"] == "verified"
    one = client.get(f"{V1}/pins/{a['id']}", headers=h).json()
    assert one["drawing_id"] == d["id"] and one["notes"] == "checked 7 Nov"

    # Deleting the finding unlinks (SET NULL); deleting the drawing cascades.
    assert client.delete(f"{V1}/findings/{finding['id']}", headers=h).status_code == 204
    assert client.get(f"{V1}/pins/{b['id']}", headers=h).json()["finding_id"] is None
    assert client.delete(f"{V1}/drawings/{d['id']}", headers=h).status_code == 204
    assert client.get(f"{V1}/pins/{a['id']}", headers=h).status_code == 404
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM inspection_pins")).scalar() == 0


def test_drawings_hidden_from_outsiders_and_viewers_read_only(
    client: TestClient, tenant: FakeTenant
) -> None:
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h)
    d = upload_drawing(client, owner_h, p["id"])
    pin = create_pin(client, owner_h, d["id"])
    invite(client, owner_h, p["id"], VIEWER["email"], role="viewer")

    out_h = headers(tenant, OUTSIDER)
    assert_404(
        client.get(f"{V1}/drawings", params={"project_id": p["id"]}, headers=out_h),
        "Project not found",
    )
    assert_404(
        client.get(f"{V1}/drawings/{d['id']}", headers=out_h), "Drawing not found"
    )
    assert_404(client.delete(f"{V1}/pins/{pin['id']}", headers=out_h), "Pin not found")

    viewer_h = headers(tenant, VIEWER)
    assert client.get(f"{V1}/drawings/{d['id']}", headers=viewer_h).status_code == 200
    assert (
        client.get(f"{V1}/drawings/{d['id']}/view-url", headers=viewer_h).status_code
        == 200
    )
    assert (
        client.get(f"{V1}/drawings/{d['id']}/pins", headers=viewer_h).status_code == 200
    )
    assert client.get(f"{V1}/pins/{pin['id']}", headers=viewer_h).status_code == 200
    forbidden = [
        client.post(
            f"{V1}/drawings/presign",
            json={"project_id": p["id"], "filename": "x.pdf"},
            headers=viewer_h,
        ),
        client.post(
            f"{V1}/drawings",
            json={
                "project_id": p["id"],
                "title": "X",
                "filename": "x.pdf",
                "s3_key": f"drawings/projects/{p['id']}/x.pdf",
            },
            headers=viewer_h,
        ),
        client.put(f"{V1}/drawings/{d['id']}", json={"title": "X"}, headers=viewer_h),
        client.patch(
            f"{V1}/drawings/{d['id']}/dimensions",
            json={"page_width_pts": 1, "page_height_pts": 1},
            headers=viewer_h,
        ),
        client.post(
            f"{V1}/drawings/{d['id']}/pins",
            json={"x_pct": 1, "y_pct": 1},
            headers=viewer_h,
        ),
        client.put(
            f"{V1}/pins/{pin['id']}", json={"status": "verified"}, headers=viewer_h
        ),
        client.delete(f"{V1}/pins/{pin['id']}", headers=viewer_h),
        client.delete(f"{V1}/drawings/{d['id']}", headers=viewer_h),
    ]
    for r in forbidden:
        assert r.status_code == 403, (r.request.method, r.request.url, r.text)
    # Still there.
    assert client.get(f"{V1}/pins/{pin['id']}", headers=owner_h).status_code == 200


def test_delete_still_removes_row_when_s3_delete_fails(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    d = upload_drawing(client, h, p["id"])
    fake_s3.fail_delete = True
    assert client.delete(f"{V1}/drawings/{d['id']}", headers=h).status_code == 204
    assert client.get(f"{V1}/drawings/{d['id']}", headers=h).status_code == 404
