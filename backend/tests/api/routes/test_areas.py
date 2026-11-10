"""Increment 13: project areas (levels, lots, stages, chainages)."""

from fastapi.testclient import TestClient

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


def test_areas_add_bulk_rename_reorder_nest(
    client: TestClient, tenant: FakeTenant
) -> None:
    oh, ih, vh = headers(tenant, OWNER), headers(tenant), headers(tenant, VIEWER)
    project = create_project(client, oh)
    pid = project["id"]
    invite(client, oh, pid, DEFAULT_EMAIL, "inspector")
    invite(client, oh, pid, VIEWER["email"], "viewer")
    url = f"{V1}/projects/{pid}/areas"

    assert client.post(url, json={"name": "Podium"}, headers=vh).status_code == 403
    podium = create_area(client, ih, pid, "  Podium ", area_type="stage")
    assert podium["name"] == "Podium" and podium["sort_order"] == 10
    assert podium["itp_count"] == 0 and podium["signed"] is False

    r = client.post(
        f"{url}/bulk",
        json={
            "prefix": "Level",
            "start": 1,
            "end": 12,
            "area_type": "level",
            "parent_area_id": podium["id"],
        },
        headers=ih,
    )
    assert r.status_code == 201, r.text
    levels = r.json()
    assert [a["name"] for a in levels][:3] == ["Level 1", "Level 2", "Level 3"]
    assert len(levels) == 12 and levels[-1]["name"] == "Level 12"
    assert {a["parent_area_id"] for a in levels} == {podium["id"]}
    assert levels[0]["sort_order"] == 20

    bad = {"prefix": "Lot", "start": 5, "end": 1}
    assert client.post(f"{url}/bulk", json=bad, headers=ih).status_code == 422
    big = {"prefix": "Lot", "start": 1, "end": 201}
    assert client.post(f"{url}/bulk", json=big, headers=ih).status_code == 422

    listed = client.get(url, headers=vh).json()
    assert len(listed) == 13 and listed[0]["id"] == podium["id"]

    # Reorder: every id exactly once.
    ids = [a["id"] for a in listed]
    new_order = ids[1:] + ids[:1]
    r = client.put(f"{url}/order", json={"area_ids": new_order}, headers=ih)
    assert [a["id"] for a in r.json()] == new_order
    r = client.put(f"{url}/order", json={"area_ids": new_order[:-1]}, headers=ih)
    assert r.status_code == 422
    r = client.put(
        f"{url}/order", json={"area_ids": [*new_order[:-1], new_order[0]]}, headers=ih
    )
    assert r.status_code == 422

    # Rename / retype / re-parent, with cycle and foreign-parent checks.
    aurl = f"{V1}/areas/{podium['id']}"
    assert client.put(aurl, json={}, headers=ih).status_code == 400
    r = client.put(aurl, json={"name": "Tower A", "area_type": "other"}, headers=ih)
    assert r.json()["name"] == "Tower A" and r.json()["area_type"] == "other"
    r = client.put(aurl, json={"parent_area_id": levels[0]["id"]}, headers=ih)
    assert r.status_code == 422 and "inside itself" in r.json()["detail"]
    r = client.put(aurl, json={"parent_area_id": podium["id"]}, headers=ih)
    assert r.status_code == 422
    r = client.put(
        f"{V1}/areas/{levels[0]['id']}", json={"parent_area_id": None}, headers=ih
    )
    assert r.json()["parent_area_id"] is None
    oh2 = headers(tenant, OUTSIDER)
    other = create_project(client, oh2)
    foreign = create_area(client, oh2, other["id"], "Elsewhere")
    r = client.put(aurl, json={"parent_area_id": foreign["id"]}, headers=ih)
    assert r.status_code == 404
    assert client.get(aurl, headers=oh2).status_code == 404
    assert client.get(aurl, headers=vh).json()["name"] == "Tower A"
    assert client.get(url, headers=oh2).status_code == 404


def test_delete_area_keeps_unsigned_itps_and_refuses_signed(
    client: TestClient, tenant: FakeTenant
) -> None:
    oh = headers(tenant, OWNER)
    pid = create_project(client, oh)["id"]
    template = create_template(client, oh)
    lot1 = create_area(client, oh, pid, "Lot 1", area_type="lot")
    lot2 = create_area(client, oh, pid, "Lot 2", area_type="lot")
    child = create_area(client, oh, pid, "Lot 1A", parent_area_id=lot1["id"])
    unsigned = apply_template(client, oh, pid, template["id"], area_id=lot1["id"])
    signed = apply_template(client, oh, pid, template["id"], area_id=lot2["id"])

    # Sign the hold point of Lot 2's ITP (owner signs roles without an email).
    rebar = next(i for i in signed["items"] if i["element_name"] == "rebar")
    client.put(f"{V1}/itp-items/{rebar['id']}", json={"status": "pass"}, headers=oh)
    role = rebar["required_roles"][0]
    r = client.post(
        f"{V1}/itp-items/{rebar['id']}/signatures",
        json={"signoff_role_id": role["id"]},
        headers=oh,
    )
    assert r.status_code == 201
    rolled = {
        a["id"]: a for a in client.get(f"{V1}/projects/{pid}/areas", headers=oh).json()
    }
    assert (
        rolled[lot2["id"]]["signed"] is True and rolled[lot2["id"]]["done_count"] == 1
    )

    r = client.delete(f"{V1}/areas/{lot2['id']}", headers=oh)
    assert r.status_code == 409 and "signed" in r.json()["detail"]

    assert client.delete(f"{V1}/areas/{lot1['id']}", headers=oh).status_code == 204
    kept = client.get(f"{V1}/itps/{unsigned['id']}", headers=oh).json()
    assert kept["area_id"] is None
    assert (
        client.get(f"{V1}/areas/{child['id']}", headers=oh).json()["parent_area_id"]
        is None
    )

    # Deleting the whole project still goes through (owner decision 38).
    assert client.delete(f"{V1}/projects/{pid}", headers=oh).status_code == 204
