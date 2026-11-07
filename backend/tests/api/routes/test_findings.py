"""Findings routes + Block 8A defect repair workflow (increment 04)."""

from fastapi.testclient import TestClient

from tests.utils.auth0 import DEFAULT_EMAIL, FakeTenant
from tests.utils.domain import (
    OUTSIDER,
    OWNER,
    V1,
    create_finding,
    create_inspection,
    create_project,
    headers,
)


def test_create_and_list_findings_legacy_shape(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    i = create_inspection(client, h, p["id"])
    f1 = create_finding(client, h, i["id"], title="First")
    f2 = create_finding(
        client, h, i["id"], title="Second", priority="low", location_ref=None
    )

    assert f1["status"] == "open"
    assert f1["priority"] == "high"
    assert f1["location_ref"] == "Grid C-4"
    assert f1["resolved_by"] is None and f1["resolved_at"] is None
    assert f1["resolution_notes"] is None
    assert f2["priority"] == "low"

    listed = client.get(f"{V1}/findings", params={"inspection_id": i["id"]}, headers=h)
    assert listed.status_code == 200
    assert [f["title"] for f in listed.json()] == ["Second", "First"]

    one = client.get(f"{V1}/findings/{f1['id']}", headers=h)
    assert one.status_code == 200 and one.json()["id"] == f1["id"]

    # Validation mirrors the SPA's select lists.
    r = client.post(
        f"{V1}/findings",
        json={"inspection_id": i["id"], "title": "X", "priority": "urgent"},
        headers=h,
    )
    assert r.status_code == 422
    assert client.get(f"{V1}/findings", headers=h).status_code == 422


def test_findings_hidden_from_non_members(
    client: TestClient, tenant: FakeTenant
) -> None:
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h)
    i = create_inspection(client, owner_h, p["id"])
    f = create_finding(client, owner_h, i["id"])

    out_h = headers(tenant, OUTSIDER)
    r = client.get(f"{V1}/findings", params={"inspection_id": i["id"]}, headers=out_h)
    assert r.status_code == 404 and r.json()["detail"] == "Inspection not found"
    r = client.get(f"{V1}/findings/{f['id']}", headers=out_h)
    assert r.status_code == 404 and r.json()["detail"] == "Finding not found"
    r = client.post(
        f"{V1}/findings",
        json={"inspection_id": i["id"], "title": "Sneaky"},
        headers=out_h,
    )
    assert r.status_code == 404
    r = client.patch(
        f"{V1}/findings/{f['id']}/status", json={"status": "resolved"}, headers=out_h
    )
    assert r.status_code == 404
    r = client.patch(f"{V1}/findings/{f['id']}/resolve", json={}, headers=out_h)
    assert r.status_code == 404
    assert client.delete(f"{V1}/findings/{f['id']}", headers=out_h).status_code == 404
    assert client.get(f"{V1}/findings/999999", headers=owner_h).status_code == 404


def test_defect_repair_workflow(client: TestClient, tenant: FakeTenant) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    i = create_inspection(client, h, p["id"])
    f = create_finding(client, h, i["id"])

    # open → in-progress
    r = client.patch(
        f"{V1}/findings/{f['id']}/status", json={"status": "in-progress"}, headers=h
    )
    assert r.status_code == 200
    assert r.json()["status"] == "in-progress"

    # resolve with notes records who/when
    r = client.patch(
        f"{V1}/findings/{f['id']}/resolve",
        json={"resolution_notes": "U-bolt installed and torqued"},
        headers=h,
    )
    assert r.status_code == 200
    resolved = r.json()
    assert resolved["status"] == "resolved"
    assert resolved["resolved_by"] == DEFAULT_EMAIL
    assert resolved["resolved_at"] is not None
    assert resolved["resolution_notes"] == "U-bolt installed and torqued"

    # reopen clears the resolution stamp
    r = client.patch(
        f"{V1}/findings/{f['id']}/status", json={"status": "open"}, headers=h
    )
    assert r.status_code == 200
    reopened = r.json()
    assert reopened["status"] == "open"
    assert reopened["resolved_by"] is None and reopened["resolved_at"] is None

    # resolving through /status stamps too; /resolve with null notes clears notes
    r = client.patch(
        f"{V1}/findings/{f['id']}/status", json={"status": "resolved"}, headers=h
    )
    assert r.status_code == 200
    assert r.json()["resolved_by"] == DEFAULT_EMAIL
    r = client.patch(
        f"{V1}/findings/{f['id']}/resolve", json={"resolution_notes": None}, headers=h
    )
    assert r.status_code == 200
    assert r.json()["resolution_notes"] is None

    r = client.patch(
        f"{V1}/findings/{f['id']}/status", json={"status": "closed"}, headers=h
    )
    assert r.status_code == 422


def test_update_and_delete_finding(client: TestClient, tenant: FakeTenant) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    i = create_inspection(client, h, p["id"])
    f = create_finding(client, h, i["id"])

    assert client.put(f"{V1}/findings/{f['id']}", json={}, headers=h).status_code == 400
    r = client.put(
        f"{V1}/findings/{f['id']}",
        json={"priority": "medium", "description": None},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["priority"] == "medium"
    assert r.json()["description"] is None
    assert r.json()["title"] == f["title"]

    assert client.delete(f"{V1}/findings/{f['id']}", headers=h).status_code == 204
    assert client.get(f"{V1}/findings/{f['id']}", headers=h).status_code == 404


def test_create_finding_already_resolved_is_stamped(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    i = create_inspection(client, h, p["id"])
    f = create_finding(client, h, i["id"], status="resolved")
    assert f["status"] == "resolved"
    assert f["resolved_by"] == DEFAULT_EMAIL
