"""Inspections routes + Block 8B sign-off (increment 04)."""

from fastapi.testclient import TestClient

from tests.utils.auth0 import DEFAULT_EMAIL, FakeTenant
from tests.utils.domain import (
    OUTSIDER,
    OWNER,
    V1,
    VIEWER,
    create_finding,
    create_inspection,
    create_project,
    headers,
    invite,
)


def test_create_and_list_inspections_legacy_shape(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    first = create_inspection(client, h, p["id"], title="Day 1")
    second = create_inspection(
        client, h, p["id"], title="Day 2", inspection_type="civil"
    )

    assert first["status"] == "open"
    assert first["inspection_status"] == "open"
    assert first["signed_off_by"] is None and first["signed_off_at"] is None
    # The SPA's create sends inspection_type; its list card reads `type`.
    assert first["inspection_type"] == "piping"
    assert first["type"] == "piping"

    listed = client.get(f"{V1}/inspections", params={"project_id": p["id"]}, headers=h)
    assert listed.status_code == 200
    assert [i["title"] for i in listed.json()] == ["Day 2", "Day 1"]  # newest first
    assert listed.json()[0]["type"] == "civil"
    assert second["project_id"] == p["id"]

    one = client.get(f"{V1}/inspections/{first['id']}", headers=h)
    assert one.status_code == 200
    assert one.json()["id"] == first["id"]


def test_inspections_require_membership_and_hide_objects(
    client: TestClient, tenant: FakeTenant
) -> None:
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h)
    i = create_inspection(client, owner_h, p["id"])

    out_h = headers(tenant, OUTSIDER)
    r = client.get(f"{V1}/inspections", params={"project_id": p["id"]}, headers=out_h)
    assert r.status_code == 404
    assert r.json()["detail"] == "Project not found"
    r = client.get(f"{V1}/inspections/{i['id']}", headers=out_h)
    assert r.status_code == 404
    assert r.json()["detail"] == "Inspection not found"
    r = client.post(
        f"{V1}/inspections",
        json={"project_id": p["id"], "title": "Sneaky", "status": "open"},
        headers=out_h,
    )
    assert r.status_code == 404
    r = client.patch(f"{V1}/inspections/{i['id']}/signoff", headers=out_h)
    assert r.status_code == 404
    r = client.delete(f"{V1}/inspections/{i['id']}", headers=out_h)
    assert r.status_code == 404
    # project_id is required on the list route
    assert client.get(f"{V1}/inspections", headers=owner_h).status_code == 422


def test_viewer_is_read_only(client: TestClient, tenant: FakeTenant) -> None:
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h)
    i = create_inspection(client, owner_h, p["id"])
    invite(client, owner_h, p["id"], VIEWER["email"], role="viewer")
    viewer_h = headers(tenant, VIEWER)

    assert (
        client.get(f"{V1}/inspections/{i['id']}", headers=viewer_h).status_code == 200
    )
    r = client.post(
        f"{V1}/inspections",
        json={"project_id": p["id"], "title": "Nope", "status": "open"},
        headers=viewer_h,
    )
    assert r.status_code == 403
    assert (
        client.patch(
            f"{V1}/inspections/{i['id']}/signoff", headers=viewer_h
        ).status_code
        == 403
    )


def test_update_inspection(client: TestClient, tenant: FakeTenant) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    i = create_inspection(client, h, p["id"])

    r = client.put(f"{V1}/inspections/{i['id']}", json={}, headers=h)
    assert r.status_code == 400
    r = client.put(
        f"{V1}/inspections/{i['id']}",
        json={"title": "Pipe rack walkdown — rev B", "notes": "Wind 12 mph"},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["title"] == "Pipe rack walkdown — rev B"
    assert r.json()["notes"] == "Wind 12 mph"
    assert r.json()["inspector"] == "S. Roberts"
    r = client.put(
        f"{V1}/inspections/{i['id']}", json={"inspection_type": "nuclear"}, headers=h
    )
    assert r.status_code == 422


def test_signoff_locks_findings_and_reopen_unlocks(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    i = create_inspection(client, h, p["id"])
    f = create_finding(client, h, i["id"])

    r = client.patch(f"{V1}/inspections/{i['id']}/signoff", headers=h)
    assert r.status_code == 200
    signed = r.json()
    assert signed["inspection_status"] == "closed"
    assert signed["status"] == "closed"
    assert signed["signed_off_by"] == DEFAULT_EMAIL
    assert signed["signed_off_at"] is not None

    # Findings are locked while signed off (SPA disables "+ Log Finding").
    r = client.post(
        f"{V1}/findings",
        json={
            "inspection_id": i["id"],
            "title": "Late",
            "priority": "low",
            "status": "open",
        },
        headers=h,
    )
    assert r.status_code == 409
    r = client.patch(
        f"{V1}/findings/{f['id']}/status", json={"status": "in-progress"}, headers=h
    )
    assert r.status_code == 409
    r = client.patch(
        f"{V1}/findings/{f['id']}/resolve", json={"resolution_notes": "x"}, headers=h
    )
    assert r.status_code == 409
    r = client.put(f"{V1}/findings/{f['id']}", json={"title": "Edited"}, headers=h)
    assert r.status_code == 409
    assert client.delete(f"{V1}/findings/{f['id']}", headers=h).status_code == 409
    # Reading is still fine.
    assert (
        client.get(
            f"{V1}/findings", params={"inspection_id": i["id"]}, headers=h
        ).status_code
        == 200
    )

    r = client.patch(f"{V1}/inspections/{i['id']}/reopen", headers=h)
    assert r.status_code == 200
    reopened = r.json()
    assert reopened["inspection_status"] == "open"
    assert reopened["status"] == "open"
    assert reopened["signed_off_by"] is None and reopened["signed_off_at"] is None

    r = client.patch(
        f"{V1}/findings/{f['id']}/status", json={"status": "in-progress"}, headers=h
    )
    assert r.status_code == 200


def test_delete_inspection_cascades(client: TestClient, tenant: FakeTenant) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    i = create_inspection(client, h, p["id"])
    f = create_finding(client, h, i["id"])
    assert client.delete(f"{V1}/inspections/{i['id']}", headers=h).status_code == 204
    assert client.get(f"{V1}/inspections/{i['id']}", headers=h).status_code == 404
    assert client.get(f"{V1}/findings/{f['id']}", headers=h).status_code == 404
