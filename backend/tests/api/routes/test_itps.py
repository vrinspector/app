"""Increment 13: ITP templates, sign-off roles, project ITPs, lines, pins."""

from typing import Any

from fastapi.testclient import TestClient

from tests.utils.auth0 import DEFAULT_EMAIL, FakeTenant
from tests.utils.domain import (
    OUTSIDER,
    OWNER,
    V1,
    VIEWER,
    create_pin,
    create_project,
    headers,
    invite,
    upload_drawing,
)
from tests.utils.itp import CONCRETE_POUR, apply_template, create_area, create_template


def _setup(client: TestClient, tenant: FakeTenant) -> dict[str, Any]:
    """OWNER owns a project; the default user is an inspector, VIEWER a viewer."""
    oh = headers(tenant, OWNER)
    project = create_project(client, oh)
    invite(client, oh, project["id"], DEFAULT_EMAIL, "inspector")
    invite(client, oh, project["id"], VIEWER["email"], "viewer")
    template = create_template(client, oh)
    return {
        "oh": oh,
        "ih": headers(tenant),
        "vh": headers(tenant, VIEWER),
        "project": project,
        "template": template,
    }


def _items(itp: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {i["element_name"]: i for i in itp["items"]}


# ── Templates ───────────────────────────────────────────────────────────────


def test_templates_are_private_versioned_and_validated(
    client: TestClient, tenant: FakeTenant
) -> None:
    oh, ih = headers(tenant, OWNER), headers(tenant)
    t = create_template(client, oh)
    assert t["version"] == 1 and t["item_count"] == 5 and t["hold_count"] == 1
    assert t["role_names"] == ["Site engineer", "Client engineer"]
    assert [v["version"] for v in t["versions"]] == [1]

    # Another account can neither list nor read it (object hiding).
    assert client.get(f"{V1}/itp-templates", headers=ih).json() == []
    r = client.get(f"{V1}/itp-templates/{t['id']}", headers=ih)
    assert r.status_code == 404 and r.json()["detail"] == "Template not found"

    # Invalid body → 422 with a readable reason.
    r = client.post(
        f"{V1}/itp-templates",
        json={
            "name": "Bad",
            "body": {"pages": [{"elements": [{"type": "text", "name": "a"}]}]},
        },
        headers=oh,
    )
    assert r.status_code == 422 and "classification" in r.json()["detail"]

    # Editing adds v2; v1 stays as it was and can no longer be edited.
    r = client.put(
        f"{V1}/itp-templates/{t['id']}", json={"name": "Concrete pour v2"}, headers=oh
    )
    assert r.status_code == 201, r.text
    v2 = r.json()
    assert v2["version"] == 2 and v2["template_key"] == t["template_key"]
    assert v2["description"] == "Slab pour, AS 3600" and v2["status"] == "published"
    assert [v["version"] for v in v2["versions"]] == [2, 1]
    assert (
        client.get(f"{V1}/itp-templates/{t['id']}", headers=oh).json()["name"]
        == "Concrete pour"
    )
    r = client.put(f"{V1}/itp-templates/{t['id']}", json={"name": "x"}, headers=oh)
    assert r.status_code == 409 and "v2" in r.json()["detail"]
    assert (
        client.put(f"{V1}/itp-templates/{v2['id']}", json={}, headers=oh).status_code
        == 400
    )
    bad: dict[str, Any] = {"body": {"pages": []}}
    assert (
        client.put(f"{V1}/itp-templates/{v2['id']}", json=bad, headers=oh).status_code
        == 422
    )

    listed = client.get(f"{V1}/itp-templates", headers=oh).json()
    assert [x["id"] for x in listed] == [v2["id"]]

    # Archive hides it from the default list.
    r = client.patch(
        f"{V1}/itp-templates/{v2['id']}/status", json={"status": "archived"}, headers=oh
    )
    assert r.json()["status"] == "archived"
    assert client.get(f"{V1}/itp-templates", headers=oh).json() == []
    listed = client.get(f"{V1}/itp-templates?include_archived=true", headers=oh).json()
    assert len(listed) == 1


# ── Import, frozen copy, roles ──────────────────────────────────────────────


def test_import_makes_a_frozen_copy_with_lines_and_roles(
    client: TestClient, tenant: FakeTenant
) -> None:
    s = _setup(client, tenant)
    pid, tid = s["project"]["id"], s["template"]["id"]
    itp = apply_template(client, s["oh"], pid, tid)
    assert itp["title"] == "Concrete pour" and itp["status"] == "not_started"
    assert itp["template_version"] == 1 and itp["area_id"] is None
    assert (
        itp["item_count"] == 5
        and itp["hold_count"] == 1
        and itp["open_hold_count"] == 1
    )
    items = _items(itp)
    assert items["rebar"]["classification"] == "hold"
    assert [r["role_name"] for r in items["rebar"]["required_roles"]] == [
        "Site engineer",
        "Client engineer",
    ]
    assert items["rebar"]["released"] is False
    assert items["formwork"]["blocked_by_item_id"] is None
    assert items["cover"]["blocked_by_item_id"] == items["rebar"]["id"]
    assert itp["completion_blockers"][0] == "5 lines still to record"

    roles = client.get(f"{V1}/projects/{pid}/signoff-roles", headers=s["vh"]).json()
    assert [(r["role_name"], r["party"], r["item_count"]) for r in roles] == [
        ("Site engineer", "contractor", 1),
        ("Client engineer", "client", 2),
    ]

    # Editing the master never reaches the copy; a second import reuses roles.
    changed = {**CONCRETE_POUR, "title": "Changed"}
    changed["pages"] = [CONCRETE_POUR["pages"][1]]
    client.put(f"{V1}/itp-templates/{tid}", json={"body": changed}, headers=s["oh"])
    again = client.get(f"{V1}/itps/{itp['id']}", headers=s["vh"]).json()
    assert again["body"] == CONCRETE_POUR and again["item_count"] == 5
    second = apply_template(client, s["oh"], pid, tid, title="Pour 2")
    assert second["title"] == "Pour 2"
    assert (
        len(client.get(f"{V1}/projects/{pid}/signoff-roles", headers=s["oh"]).json())
        == 2
    )

    listed = client.get(f"{V1}/projects/{pid}/itps", headers=s["vh"]).json()
    assert [x["id"] for x in listed] == [itp["id"], second["id"]]
    refs = client.get(f"{V1}/projects/{pid}/itp-items", headers=s["vh"]).json()
    assert len(refs) == 10 and refs[1]["classification"] == "hold"


def test_import_permissions_and_object_hiding(
    client: TestClient, tenant: FakeTenant
) -> None:
    s = _setup(client, tenant)
    pid, tid = s["project"]["id"], s["template"]["id"]
    # Viewer cannot apply; outsider cannot see the project.
    r = client.post(
        f"{V1}/projects/{pid}/itps", json={"template_id": tid}, headers=s["vh"]
    )
    assert r.status_code == 403
    oh2 = headers(tenant, OUTSIDER)
    r = client.post(f"{V1}/projects/{pid}/itps", json={"template_id": tid}, headers=oh2)
    assert r.status_code == 404
    # Masters are per account: the owner's is hidden from the inspector.
    r = client.post(
        f"{V1}/projects/{pid}/itps", json={"template_id": tid}, headers=s["ih"]
    )
    assert r.status_code == 404 and r.json()["detail"] == "Template not found"
    own = create_template(client, s["ih"])
    itp = apply_template(client, s["ih"], pid, own["id"])
    assert client.get(f"{V1}/itps/{itp['id']}", headers=oh2).status_code == 404
    # Area from another project → 404; archived template → 409.
    other = create_project(client, oh2)
    foreign = create_area(client, oh2, other["id"], "Elsewhere")
    r = client.post(
        f"{V1}/projects/{pid}/itps",
        json={"template_id": own["id"], "area_id": foreign["id"]},
        headers=s["ih"],
    )
    assert r.status_code == 404 and r.json()["detail"] == "Area not found"
    client.patch(
        f"{V1}/itp-templates/{own['id']}/status",
        json={"status": "archived"},
        headers=s["ih"],
    )
    r = client.post(
        f"{V1}/projects/{pid}/itps", json={"template_id": own["id"]}, headers=s["ih"]
    )
    assert r.status_code == 409


def test_bulk_apply_creates_one_copy_per_area(
    client: TestClient, tenant: FakeTenant
) -> None:
    s = _setup(client, tenant)
    pid, tid = s["project"]["id"], s["template"]["id"]
    r = client.post(
        f"{V1}/projects/{pid}/areas/bulk",
        json={"prefix": "Level", "start": 1, "end": 3, "area_type": "level"},
        headers=s["ih"],
    )
    areas = r.json()
    ids = [a["id"] for a in areas]
    r = client.post(
        f"{V1}/projects/{pid}/itps/bulk",
        json={"template_id": tid, "area_ids": [*ids, ids[0]]},
        headers=s["oh"],
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert [c["title"] for c in created] == [
        "Concrete pour — Level 1",
        "Concrete pour — Level 2",
        "Concrete pour — Level 3",
    ]
    assert [c["area_name"] for c in created] == ["Level 1", "Level 2", "Level 3"]
    only = client.get(
        f"{V1}/projects/{pid}/itps?area_id={ids[1]}", headers=s["vh"]
    ).json()
    assert [x["area_id"] for x in only] == [ids[1]]
    rolled = client.get(f"{V1}/projects/{pid}/areas", headers=s["vh"]).json()
    assert [
        (a["itp_count"], a["item_count"], a["open_hold_count"]) for a in rolled
    ] == [(1, 5, 1)] * 3
    # All or none: an unknown area rolls the whole request back.
    r = client.post(
        f"{V1}/projects/{pid}/itps/bulk",
        json={"template_id": tid, "area_ids": [ids[0], 999999]},
        headers=s["oh"],
    )
    assert r.status_code == 404
    assert len(client.get(f"{V1}/projects/{pid}/itps", headers=s["vh"]).json()) == 3
    # A single apply into an area names it after the area.
    one = apply_template(client, s["oh"], pid, tid, area_id=ids[2])
    assert one["title"] == "Concrete pour — Level 3"


# ── Recording, hold points, sign-off, completion ────────────────────────────


def test_hold_point_blocks_until_every_required_role_signs(
    client: TestClient, tenant: FakeTenant
) -> None:
    s = _setup(client, tenant)
    pid = s["project"]["id"]
    itp = apply_template(client, s["oh"], pid, s["template"]["id"])
    items = _items(itp)
    roles = {r["role_name"]: r for r in items["rebar"]["required_roles"]}

    def put(name: str, body: dict[str, Any], h: dict[str, str] = s["ih"]) -> Any:
        return client.put(f"{V1}/itp-items/{items[name]['id']}", json=body, headers=h)

    # Viewers cannot record; nothing to update → 400.
    assert put("formwork", {"status": "pass"}, s["vh"]).status_code == 403
    assert put("formwork", {}).status_code == 400

    r = put("formwork", {"status": "pass", "notes": "Checked grid A–D"})
    assert r.status_code == 200 and r.json()["status"] == "pass"
    assert (
        client.get(f"{V1}/itps/{itp['id']}", headers=s["vh"]).json()["status"]
        == "in_progress"
    )

    # Past the hold point: refused.
    r = put("cover", {"status": "pass"})
    assert r.status_code == 409 and "Reinforcement inspected" in r.json()["detail"]
    # Notes are still allowed on a blocked line.
    assert put("cover", {"notes": "40 mm expected"}).status_code == 200

    def sign(name: str, role: str, h: dict[str, str]) -> Any:
        return client.post(
            f"{V1}/itp-items/{items[name]['id']}/signatures",
            json={
                "signoff_role_id": roles[role]["id"],
                "gps_lat": 34.1,
                "gps_lng": -82.2,
            },
            headers=h,
        )

    # Must be recorded Pass/N/A first.
    r = sign("rebar", "Site engineer", s["oh"])
    assert r.status_code == 409 and "Pass or N/A" in r.json()["detail"]
    assert put("rebar", {"status": "pass"}).status_code == 200

    # Role without an email: only an owner signs it.
    r = sign("rebar", "Site engineer", s["ih"])
    assert r.status_code == 403 and "project owner" in r.json()["detail"]
    r = sign("rebar", "Site engineer", s["oh"])
    assert r.status_code == 201, r.text
    sig = r.json()
    assert sig["method"] == "in_app" and sig["role_name"] == "Site engineer"
    assert sig["signer_email"] == OWNER["email"] and sig["gps_lat"] == 34.1
    assert sign("rebar", "Site engineer", s["oh"]).status_code == 409

    # Role with an email: only that person, whatever their project role.
    r = client.put(
        f"{V1}/signoff-roles/{roles['Client engineer']['id']}",
        json={"signer_email": VIEWER["email"]},
        headers=s["oh"],
    )
    assert r.status_code == 200
    r = sign("rebar", "Client engineer", s["oh"])
    assert r.status_code == 403 and VIEWER["email"] in r.json()["detail"]

    # Not a required role of this line → 422.
    r = client.post(
        f"{V1}/itp-items/{items['formwork']['id']}/signatures",
        json={"signoff_role_id": roles["Site engineer"]["id"]},
        headers=s["oh"],
    )
    assert r.status_code == 422

    # Still blocked, completion lists the waiting role.
    state = client.get(f"{V1}/itps/{itp['id']}", headers=s["vh"]).json()
    assert any("waiting for Client engineer" in b for b in state["completion_blockers"])
    r = client.put(
        f"{V1}/itps/{itp['id']}", json={"status": "complete"}, headers=s["ih"]
    )
    assert r.status_code == 409 and "Not ready to complete" in r.json()["detail"]

    assert sign("rebar", "Client engineer", s["vh"]).status_code == 201
    state = client.get(f"{V1}/itps/{itp['id']}", headers=s["vh"]).json()
    rebar = _items(state)["rebar"]
    assert rebar["released"] is True and len(rebar["signatures"]) == 2
    assert state["open_hold_count"] == 0 and state["signature_count"] == 2

    # A signed line keeps its result.
    r = put("rebar", {"status": "fail"})
    assert r.status_code == 409 and "signed" in r.json()["detail"]

    # Now the rest can be recorded; a fail blocks completion.
    for name in ("cover", "pour"):
        assert put(name, {"status": "pass"}).status_code == 200
    assert put("cylinders", {"status": "fail"}).status_code == 200
    r = client.put(
        f"{V1}/itps/{itp['id']}", json={"status": "complete"}, headers=s["ih"]
    )
    assert r.status_code == 409 and "failed" in r.json()["detail"]
    assert put("cylinders", {"status": "pass"}).status_code == 200
    r = client.put(
        f"{V1}/itps/{itp['id']}", json={"status": "complete"}, headers=s["ih"]
    )
    assert r.status_code == 200 and r.json()["completion_blockers"] == []

    # Complete is read-only until reopened; signed ITP cannot be deleted.
    r = put("formwork", {"status": "fail"})
    assert r.status_code == 409 and "complete" in r.json()["detail"]
    r = client.delete(f"{V1}/itps/{itp['id']}", headers=s["ih"])
    assert r.status_code == 409 and "void" in r.json()["detail"]

    # Void is owner-only, and a voided ITP refuses changes and signatures.
    r = client.put(f"{V1}/itps/{itp['id']}", json={"status": "voided"}, headers=s["ih"])
    assert r.status_code == 403
    r = client.put(f"{V1}/itps/{itp['id']}", json={"status": "voided"}, headers=s["oh"])
    assert r.status_code == 200
    assert put("formwork", {"notes": "x"}).status_code == 409
    r = sign("pour", "Client engineer", s["vh"])
    assert r.status_code == 409
    r = client.put(
        f"{V1}/itps/{itp['id']}", json={"status": "in_progress"}, headers=s["oh"]
    )
    assert r.status_code == 200


def test_itp_update_and_delete(client: TestClient, tenant: FakeTenant) -> None:
    s = _setup(client, tenant)
    pid = s["project"]["id"]
    area = create_area(client, s["ih"], pid, "Lot 7", area_type="lot")
    itp = apply_template(client, s["oh"], pid, s["template"]["id"])
    url = f"{V1}/itps/{itp['id']}"
    assert client.put(url, json={}, headers=s["ih"]).status_code == 400
    r = client.put(
        url, json={"title": "Slab S3", "area_id": area["id"]}, headers=s["ih"]
    )
    assert r.json()["title"] == "Slab S3" and r.json()["area_name"] == "Lot 7"
    r = client.put(url, json={"area_id": None}, headers=s["ih"])
    assert r.json()["area_id"] is None
    assert client.put(url, json={"area_id": 999999}, headers=s["ih"]).status_code == 404
    assert client.delete(url, headers=s["vh"]).status_code == 403
    assert client.delete(url, headers=s["ih"]).status_code == 204
    assert client.get(url, headers=s["ih"]).status_code == 404


def test_signoff_role_management(client: TestClient, tenant: FakeTenant) -> None:
    s = _setup(client, tenant)
    pid = s["project"]["id"]
    url = f"{V1}/projects/{pid}/signoff-roles"
    body = {"role_name": "Superintendent", "party": "contractor"}
    assert client.post(url, json=body, headers=s["ih"]).status_code == 403
    r = client.post(url, json=body, headers=s["oh"])
    assert r.status_code == 201 and r.json()["item_count"] == 0
    role = r.json()
    r = client.post(url, json={"role_name": "superintendent "}, headers=s["oh"])
    assert r.status_code == 409
    client.post(
        url,
        json={"role_name": "Engineer of record", "party": "engineer"},
        headers=s["oh"],
    )
    rurl = f"{V1}/signoff-roles/{role['id']}"
    assert client.put(rurl, json={}, headers=s["oh"]).status_code == 400
    r = client.put(rurl, json={"role_name": "Engineer of Record"}, headers=s["oh"])
    assert r.status_code == 409
    r = client.put(
        rurl,
        json={
            "role_name": "Site super",
            "party": "client",
            "signer_email": "s@example.com",
        },
        headers=s["oh"],
    )
    assert r.json()["signer_email"] == "s@example.com" and r.json()["party"] == "client"
    r = client.put(rurl, json={"signer_email": None}, headers=s["oh"])
    assert r.json()["signer_email"] is None
    assert client.delete(rurl, headers=s["oh"]).status_code == 204
    assert client.delete(rurl, headers=s["oh"]).status_code == 404

    # A role that lines still need cannot be deleted.
    apply_template(client, s["oh"], pid, s["template"]["id"])
    needed = client.get(url, headers=s["oh"]).json()[-1]
    r = client.delete(f"{V1}/signoff-roles/{needed['id']}", headers=s["oh"])
    assert r.status_code == 409
    r = client.delete(
        f"{V1}/signoff-roles/{needed['id']}", headers=headers(tenant, OUTSIDER)
    )
    assert r.status_code == 404 and r.json()["detail"] == "Sign-off role not found"


def test_pins_link_to_itp_items_both_ways(
    client: TestClient, tenant: FakeTenant
) -> None:
    s = _setup(client, tenant)
    pid = s["project"]["id"]
    itp = apply_template(client, s["oh"], pid, s["template"]["id"])
    rebar = _items(itp)["rebar"]
    drawing = upload_drawing(client, s["ih"], pid)
    pin = create_pin(
        client, s["ih"], drawing["id"], itp_item_id=rebar["id"], label="S3 slab"
    )
    assert pin["itp_item_id"] == rebar["id"]

    state = client.get(f"{V1}/itps/{itp['id']}", headers=s["vh"]).json()
    pins = _items(state)["rebar"]["pins"]
    assert pins == [
        {
            "id": pin["id"],
            "drawing_id": drawing["id"],
            "drawing_title": drawing["title"],
            "page_number": 1,
            "label": "S3 slab",
            "tag_number": None,
            "status": "not_started",
        }
    ]

    # Unlink with null; relink; an item of another project is hidden.
    r = client.put(
        f"{V1}/pins/{pin['id']}", json={"itp_item_id": None}, headers=s["ih"]
    )
    assert r.json()["itp_item_id"] is None
    r = client.put(
        f"{V1}/pins/{pin['id']}", json={"itp_item_id": rebar["id"]}, headers=s["ih"]
    )
    assert r.json()["itp_item_id"] == rebar["id"]
    oh2 = headers(tenant, OUTSIDER)
    other = create_project(client, oh2)
    other_itp = apply_template(
        client, oh2, other["id"], create_template(client, oh2)["id"]
    )
    foreign = other_itp["items"][0]["id"]
    r = client.put(
        f"{V1}/pins/{pin['id']}", json={"itp_item_id": foreign}, headers=s["ih"]
    )
    assert r.status_code == 404 and r.json()["detail"] == "ITP item not found"
    r = client.post(
        f"{V1}/drawings/{drawing['id']}/pins",
        json={"x_pct": 1, "y_pct": 1, "itp_item_id": foreign},
        headers=s["ih"],
    )
    assert r.status_code == 404
    # Outsiders cannot touch the item.
    r = client.put(f"{V1}/itp-items/{rebar['id']}", json={"notes": "x"}, headers=oh2)
    assert r.status_code == 404 and r.json()["detail"] == "ITP item not found"

    # Deleting the (unsigned) ITP detaches the pin rather than deleting it.
    assert client.delete(f"{V1}/itps/{itp['id']}", headers=s["ih"]).status_code == 204
    assert (
        client.get(f"{V1}/pins/{pin['id']}", headers=s["ih"]).json()["itp_item_id"]
        is None
    )
