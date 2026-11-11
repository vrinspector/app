"""Increment 13.8: ITP document numbers, project codes, the three-shot set."""

from typing import Any

from fastapi.testclient import TestClient

from tests.utils.auth0 import DEFAULT_EMAIL, FakeTenant
from tests.utils.domain import (
    OWNER,
    V1,
    create_inspection,
    create_project,
    headers,
    invite,
)
from tests.utils.itp import apply_template, create_area, create_template

THREE_SHOT_TEMPLATE: dict[str, Any] = {
    "title": "Rebar",
    "signoffRoles": ["Contractor"],
    "pages": [
        {
            "name": "rebar",
            "title": "Rebar inspection",
            "elements": [
                {
                    "type": "radiogroup",
                    "name": "rebar",
                    "title": "Rebar inspected before pour",
                    "classification": "H",
                    "signoffRoles": ["Contractor"],
                    "photoSet": "three_shot",
                },
                {
                    "type": "radiogroup",
                    "name": "cleanup",
                    "title": "Forms clean",
                    "classification": "I",
                },
            ],
        }
    ],
}


def _numbers(client: TestClient, h: dict[str, str], project_id: int) -> list[str]:
    r = client.get(f"{V1}/projects/{project_id}/itps", headers=h)
    assert r.status_code == 200, r.text
    return [i["doc_number"] for i in r.json()]


def test_doc_numbers_follow_the_project_code(
    client: TestClient, tenant: FakeTenant
) -> None:
    oh = headers(tenant, OWNER)
    project = create_project(client, oh, name="Landfill Cell 4")
    pid = project["id"]
    assert project["code"] is None and project["itp_code"] == "LC4"
    template = create_template(client, oh)

    first = apply_template(client, oh, pid, template["id"])
    assert (first["seq"], first["doc_number"]) == (1, "ITP-LC4-001")
    second = apply_template(client, oh, pid, template["id"])
    assert second["doc_number"] == "ITP-LC4-002"

    # Bulk apply continues the sequence, one number per area.
    areas = [create_area(client, oh, pid, f"Level {n}")["id"] for n in (1, 2)]
    r = client.post(
        f"{V1}/projects/{pid}/itps/bulk",
        json={"template_id": template["id"], "area_ids": areas},
        headers=oh,
    )
    assert r.status_code == 201, r.text
    assert [i["doc_number"] for i in r.json()] == ["ITP-LC4-003", "ITP-LC4-004"]

    # A deleted ITP leaves a gap; its number is not given out again.
    assert client.delete(f"{V1}/itps/{second['id']}", headers=oh).status_code == 204
    third = apply_template(client, oh, pid, template["id"])
    assert third["doc_number"] == "ITP-LC4-005"

    # Another project starts at 1.
    other = create_project(client, oh, name="Riverside", code="rv")
    assert other["itp_code"] == "RV"
    assert (
        apply_template(client, oh, other["id"], template["id"])["doc_number"]
        == "ITP-RV-001"
    )

    # The owner sets a code: every number is re-labelled, the sequence stays.
    r = client.put(f"{V1}/projects/{pid}", json={"code": " lf-c4 "}, headers=oh)
    assert r.status_code == 200, r.text
    assert (r.json()["code"], r.json()["itp_code"]) == ("LF-C4", "LF-C4")
    assert _numbers(client, oh, pid) == [
        "ITP-LF-C4-001",
        "ITP-LF-C4-003",
        "ITP-LF-C4-004",
        "ITP-LF-C4-005",
    ]
    detail = client.get(f"{V1}/itps/{first['id']}", headers=oh).json()
    assert detail["doc_number"] == "ITP-LF-C4-001"
    refs = client.get(f"{V1}/projects/{pid}/itp-items", headers=oh).json()
    assert {ref["doc_number"] for ref in refs} == {
        "ITP-LF-C4-001",
        "ITP-LF-C4-003",
        "ITP-LF-C4-004",
        "ITP-LF-C4-005",
    }
    area_view = client.get(f"{V1}/projects/{pid}/itps?area_id={areas[0]}", headers=oh)
    assert [i["doc_number"] for i in area_view.json()] == ["ITP-LF-C4-003"]

    # Bad codes are refused; other edits leave the code alone; "" clears it.
    r = client.put(f"{V1}/projects/{pid}", json={"code": "LF/C4"}, headers=oh)
    assert r.status_code == 422
    r = client.put(f"{V1}/projects/{pid}", json={"client": "County"}, headers=oh)
    assert r.json()["code"] == "LF-C4"
    r = client.put(f"{V1}/projects/{pid}", json={"code": ""}, headers=oh)
    assert r.status_code == 200, r.text
    assert (r.json()["code"], r.json()["itp_code"]) == (None, "LC4")
    r = client.put(f"{V1}/projects/{pid}", json={"code": None}, headers=oh)
    assert r.status_code == 200


def test_only_owners_set_the_code(client: TestClient, tenant: FakeTenant) -> None:
    oh = headers(tenant, OWNER)
    project = create_project(client, oh)
    invite(client, oh, project["id"], DEFAULT_EMAIL, "inspector")
    r = client.put(
        f"{V1}/projects/{project['id']}", json={"code": "GW"}, headers=headers(tenant)
    )
    assert r.status_code == 403


def _upload(
    client: TestClient,
    h: dict[str, str],
    item_id: int,
    slot: str | None,
    **extra: Any,
) -> Any:
    r = client.post(
        f"{V1}/photos/presign",
        json={"itp_item_id": item_id, "filename": "a.jpg"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    body: dict[str, Any] = {
        "itp_item_id": item_id,
        "s3_key": r.json()["s3_key"],
        "filename": "a.jpg",
        **extra,
    }
    if slot is not None:
        body["shot_slot"] = slot
    return client.post(f"{V1}/photos", json=body, headers=h)


def test_three_shot_set(client: TestClient, tenant: FakeTenant) -> None:
    oh = headers(tenant, OWNER)
    project = create_project(client, oh)
    template = create_template(client, oh, name="Rebar", body=THREE_SHOT_TEMPLATE)
    itp = apply_template(client, oh, project["id"], template["id"])
    rebar, cleanup = itp["items"]
    assert rebar["photo_set"] == "three_shot" and rebar["photo_required"] is False
    assert rebar["shot_slots"] == [] and rebar["evidenced"] is False
    assert cleanup["photo_set"] is None and cleanup["evidenced"] is True
    url = f"{V1}/itp-items/{rebar['id']}"

    r = client.put(url, json={"status": "pass"}, headers=oh)
    assert r.status_code == 409
    assert "Context, Intermediate, Close-up with scale" in r.json()["detail"]

    # Slots only on a three-shot line; never on site photos; only known names.
    inspection = create_inspection(client, oh, project["id"])
    r = client.post(
        f"{V1}/photos",
        json={
            "inspection_id": inspection["id"],
            "s3_key": f"photos/inspections/{inspection['id']}/x.jpg",
            "shot_slot": "context",
        },
        headers=oh,
    )
    assert r.status_code == 422
    assert _upload(client, oh, rebar["id"], "wide").status_code == 422

    context = _upload(
        client, oh, rebar["id"], "context", captured_at="2026-11-11T08:15:00-05:00"
    )
    assert context.status_code == 201, context.text
    assert context.json()["shot_slot"] == "context"
    assert context.json()["captured_at"].startswith("2026-11-11T13:15:00")
    extra_context = _upload(client, oh, rebar["id"], "context").json()
    _upload(client, oh, rebar["id"], "intermediate")
    # An unlabelled extra photo does not fill a slot.
    assert _upload(client, oh, rebar["id"], None).status_code == 201

    r = client.put(url, json={"status": "pass"}, headers=oh)
    assert r.status_code == 409
    assert "still missing: Close-up with scale" in r.json()["detail"]
    line = client.get(f"{V1}/itps/{itp['id']}", headers=oh).json()["items"][0]
    assert line["shot_slots"] == ["context", "intermediate"]
    assert line["photo_count"] == 4 and line["evidenced"] is False

    closeup = _upload(client, oh, rebar["id"], "closeup").json()
    r = client.put(url, json={"status": "pass"}, headers=oh)
    assert r.status_code == 200, r.text
    assert r.json()["evidenced"] is True
    assert r.json()["shot_slots"] == ["context", "intermediate", "closeup"]

    # A slot's last photo stays while the line is passed; a spare one can go.
    r = client.delete(f"{V1}/photos/{closeup['id']}", headers=oh)
    assert r.status_code == 409 and "pending" in r.json()["detail"]
    assert (
        client.delete(f"{V1}/photos/{extra_context['id']}", headers=oh).status_code
        == 204
    )
    r = client.delete(f"{V1}/photos/{context.json()['id']}", headers=oh)
    assert r.status_code == 409

    role_id = rebar["required_roles"][0]["id"]
    r = client.post(f"{url}/signatures", json={"signoff_role_id": role_id}, headers=oh)
    assert r.status_code == 201, r.text


def test_three_shot_set_is_checked_again_at_signing(
    client: TestClient, tenant: FakeTenant
) -> None:
    oh = headers(tenant, OWNER)
    project = create_project(client, oh)
    template = create_template(client, oh, name="Rebar", body=THREE_SHOT_TEMPLATE)
    itp = apply_template(client, oh, project["id"], template["id"])
    rebar = itp["items"][0]
    url = f"{V1}/itp-items/{rebar['id']}"
    photos = [
        _upload(client, oh, rebar["id"], slot).json()
        for slot in ("context", "intermediate", "closeup")
    ]
    assert client.put(url, json={"status": "pass"}, headers=oh).status_code == 200
    # Back to pending, a slot photo removed, then passed again is refused …
    assert client.put(url, json={"status": "pending"}, headers=oh).status_code == 200
    assert (
        client.delete(f"{V1}/photos/{photos[1]['id']}", headers=oh).status_code == 204
    )
    r = client.put(url, json={"status": "pass"}, headers=oh)
    assert r.status_code == 409 and "Intermediate" in r.json()["detail"]
    # … and N/A needs no photos, but cannot be signed into a pass either.
    assert client.put(url, json={"status": "na"}, headers=oh).status_code == 200
    role_id = rebar["required_roles"][0]["id"]
    r = client.post(f"{url}/signatures", json={"signoff_role_id": role_id}, headers=oh)
    assert r.status_code == 201, r.text
