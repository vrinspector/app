"""Dashboard roll-up (Block 6) — increment 04."""

from fastapi.testclient import TestClient

from tests.utils.auth0 import FakeTenant
from tests.utils.domain import (
    OWNER,
    V1,
    create_finding,
    create_inspection,
    create_project,
    headers,
    upload_photo,
)


def test_dashboard_empty(client: TestClient, tenant: FakeTenant) -> None:
    r = client.get(f"{V1}/dashboard", headers=headers(tenant))
    assert r.status_code == 200
    assert r.json() == {
        "summary": {
            "total_projects": 0,
            "total_inspections": 0,
            "open_findings": 0,
            "high_priority_findings": 0,
            "total_photos": 0,
        },
        "projects": [],
        "recent_inspections": [],
    }
    assert client.get(f"{V1}/dashboard").status_code == 401


def test_dashboard_rollup_scoped_to_membership(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant)
    busy = create_project(client, h, name="Busy")
    quiet = create_project(client, h, name="Quiet")
    # Another user's project must not leak into the caller's numbers.
    other = create_project(client, headers(tenant, OWNER), name="Theirs")
    oi = create_inspection(client, headers(tenant, OWNER), other["id"])
    create_finding(client, headers(tenant, OWNER), oi["id"])

    i1 = create_inspection(client, h, busy["id"], title="Walk 1", inspector="A")
    i2 = create_inspection(client, h, busy["id"], title="Walk 2", inspector="B")
    create_finding(client, h, i1["id"], priority="high")  # open, high
    f_med = create_finding(client, h, i1["id"], priority="medium")  # open
    f_res = create_finding(client, h, i2["id"], priority="high")  # will be resolved
    client.patch(f"{V1}/findings/{f_res['id']}/resolve", json={}, headers=h)
    client.patch(
        f"{V1}/findings/{f_med['id']}/status", json={"status": "in-progress"}, headers=h
    )
    upload_photo(client, h, i1["id"])
    upload_photo(client, h, i2["id"])
    upload_photo(client, h, i2["id"])

    r = client.get(f"{V1}/dashboard", headers=h)
    assert r.status_code == 200
    data = r.json()
    assert data["summary"] == {
        "total_projects": 2,
        "total_inspections": 2,
        "open_findings": 2,  # in-progress counts as open; resolved does not
        "high_priority_findings": 1,
        "total_photos": 3,
    }

    by_name = {p["name"]: p for p in data["projects"]}
    assert set(by_name) == {"Busy", "Quiet"}
    assert data["projects"][0]["name"] == "Quiet"  # newest project first
    b = by_name["Busy"]
    assert b["id"] == busy["id"]
    assert b["client"] == "PGE"
    assert b["inspection_count"] == 2
    assert b["open_finding_count"] == 2
    assert b["high_finding_count"] == 1
    assert b["photo_count"] == 3
    assert b["last_inspected"] == i2["created_at"][:10]
    q = by_name["Quiet"]
    assert q["id"] == quiet["id"]
    assert (
        q["inspection_count"],
        q["open_finding_count"],
        q["high_finding_count"],
        q["photo_count"],
    ) == (0, 0, 0, 0)
    assert q["last_inspected"] == "Never"

    recent = data["recent_inspections"]
    assert [x["title"] for x in recent] == ["Walk 2", "Walk 1"]
    assert recent[0]["project_name"] == "Busy"
    assert recent[0]["inspector"] == "B"
    assert recent[0]["finding_count"] == 1
    assert recent[1]["finding_count"] == 2
    assert recent[0]["created_at"] == i2["created_at"]
