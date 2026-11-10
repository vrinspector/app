"""Increment 13.6: ITP line evidence — criteria, photos, measured values."""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.db import engine
from tests.utils.auth0 import DEFAULT_EMAIL, FakeTenant
from tests.utils.domain import (
    OUTSIDER,
    OWNER,
    V1,
    VIEWER,
    create_inspection,
    create_project,
    headers,
    invite,
)
from tests.utils.itp import apply_template, create_template

EVIDENCE_TEMPLATE: dict[str, Any] = {
    "title": "Rebar and pour",
    "signoffRoles": ["Contractor", "Owner's representative"],
    "pages": [
        {
            "name": "rebar",
            "title": "Rebar inspection",
            "elements": [
                {
                    "type": "radiogroup",
                    "name": "spacing",
                    "title": "Bar spacing",
                    "classification": "H",
                    "signoffRoles": ["Contractor", "Owner's representative"],
                    "acceptanceCriteria": "Within ±1 in of the shop drawing",
                    "reference": "ACI 117 §2.2",
                    "recordRequired": "Photo of tape on bars",
                    "photoRequired": True,
                },
                {
                    "type": "text",
                    "name": "cover",
                    "title": "Clear cover",
                    "inputType": "number",
                    "classification": "R",
                    "unit": "in",
                    "min": 1.5,
                    "max": 3,
                },
                {
                    "type": "comment",
                    "name": "tickets",
                    "title": "Batch ticket numbers",
                    "classification": "review",
                },
                {
                    "type": "radiogroup",
                    "name": "curing",
                    "title": "Curing started",
                    "classification": "information",
                },
            ],
        }
    ],
}


def _setup(client: TestClient, tenant: FakeTenant) -> dict[str, Any]:
    oh = headers(tenant, OWNER)
    project = create_project(client, oh)
    invite(client, oh, project["id"], DEFAULT_EMAIL, "inspector")
    invite(client, oh, project["id"], VIEWER["email"], "viewer")
    template = create_template(
        client, oh, name="Rebar and pour", body=EVIDENCE_TEMPLATE
    )
    itp = apply_template(client, oh, project["id"], template["id"])
    return {
        "oh": oh,
        "ih": headers(tenant),
        "vh": headers(tenant, VIEWER),
        "xh": headers(tenant, OUTSIDER),
        "project": project,
        "itp": itp,
        "items": {i["element_name"]: i for i in itp["items"]},
    }


def _upload(
    client: TestClient, h: dict[str, str], item_id: int, filename: str = "a.jpg"
) -> Any:
    r = client.post(
        f"{V1}/photos/presign",
        json={"itp_item_id": item_id, "filename": filename},
        headers=h,
    )
    if r.status_code != 200:
        return r
    key = r.json()["s3_key"]
    assert key.startswith(f"photos/itp-items/{item_id}/")
    return client.post(
        f"{V1}/photos",
        json={"itp_item_id": item_id, "s3_key": key, "filename": filename},
        headers=h,
    )


def test_import_copies_evidence_and_vocabulary(
    client: TestClient, tenant: FakeTenant
) -> None:
    s = _setup(client, tenant)
    items = s["items"]
    spacing = items["spacing"]
    assert spacing["classification"] == "hold"
    assert spacing["acceptance_criteria"] == "Within ±1 in of the shop drawing"
    assert spacing["reference_doc"] == "ACI 117 §2.2"
    assert spacing["record_required"] == "Photo of tape on bars"
    assert spacing["photo_required"] is True and spacing["photo_count"] == 0
    assert spacing["value_type"] is None

    cover = items["cover"]
    assert cover["classification"] == "review"
    assert (cover["value_type"], cover["value_unit"]) == ("number", "in")
    assert (cover["value_min"], cover["value_max"]) == (1.5, 3.0)
    assert items["tickets"]["value_type"] == "text"
    assert items["curing"]["classification"] == "information"
    assert items["curing"]["value_type"] is None

    # Default party for the default role names.
    roles = client.get(
        f"{V1}/projects/{s['project']['id']}/signoff-roles", headers=s["oh"]
    ).json()
    assert {r["role_name"]: r["party"] for r in roles} == {
        "Contractor": "contractor",
        "Owner's representative": "client",
    }


def test_photo_required_blocks_pass_and_signing(
    client: TestClient, tenant: FakeTenant
) -> None:
    s = _setup(client, tenant)
    spacing = s["items"]["spacing"]
    url = f"{V1}/itp-items/{spacing['id']}"

    r = client.put(url, json={"status": "pass"}, headers=s["ih"])
    assert r.status_code == 409 and "photo on file" in r.json()["detail"]
    # Fail and N/A do not need the photo.
    assert client.put(url, json={"status": "fail"}, headers=s["ih"]).status_code == 200
    assert (
        client.put(url, json={"status": "pending"}, headers=s["ih"]).status_code == 200
    )

    # Viewers and outsiders cannot add evidence; the key is bound to the line.
    assert _upload(client, s["vh"], spacing["id"]).status_code == 403
    assert _upload(client, s["xh"], spacing["id"]).status_code == 404
    r = client.post(
        f"{V1}/photos",
        json={"itp_item_id": spacing["id"], "s3_key": "photos/itp-items/999/x.jpg"},
        headers=s["ih"],
    )
    assert r.status_code == 404

    first = _upload(client, s["ih"], spacing["id"])
    assert first.status_code == 201, first.text
    photo = first.json()
    assert photo["itp_item_id"] == spacing["id"] and photo["inspection_id"] is None
    assert photo["view_url"]

    r = client.put(url, json={"status": "pass"}, headers=s["ih"])
    assert r.status_code == 200, r.text
    assert r.json()["photo_count"] == 1

    # Listing, reading and the object hiding of line photos.
    listed = client.get(
        f"{V1}/photos?itp_item_id={spacing['id']}", headers=s["vh"]
    ).json()
    assert [p["id"] for p in listed] == [photo["id"]]
    assert client.get(f"{V1}/photos/{photo['id']}", headers=s["vh"]).status_code == 200
    assert client.get(f"{V1}/photos/{photo['id']}", headers=s["xh"]).status_code == 404
    assert (
        client.get(
            f"{V1}/photos?itp_item_id={spacing['id']}", headers=s["xh"]
        ).status_code
        == 404
    )

    # The last required photo of a passed line stays.
    r = client.delete(f"{V1}/photos/{photo['id']}", headers=s["ih"])
    assert r.status_code == 409 and "pending" in r.json()["detail"]
    second = _upload(client, s["ih"], spacing["id"], "b.jpg").json()
    assert (
        client.delete(f"{V1}/photos/{second['id']}", headers=s["ih"]).status_code == 204
    )

    # Sign both roles (owner signs roles without an email): hold released.
    roles = {r["role_name"]: r["id"] for r in spacing["required_roles"]}
    for role_id in roles.values():
        r = client.post(
            f"{url}/signatures", json={"signoff_role_id": role_id}, headers=s["oh"]
        )
        assert r.status_code == 201, r.text
    itp = client.get(f"{V1}/itps/{s['itp']['id']}", headers=s["oh"]).json()
    assert itp["items"][0]["released"] is True

    # Once signed, the evidence is locked.
    assert _upload(client, s["ih"], spacing["id"]).status_code == 409
    r = client.delete(f"{V1}/photos/{photo['id']}", headers=s["oh"])
    assert r.status_code == 409 and "signed" in r.json()["detail"]


def test_signing_needs_the_photo_still_on_file(
    client: TestClient, tenant: FakeTenant
) -> None:
    s = _setup(client, tenant)
    spacing = s["items"]["spacing"]
    photo = _upload(client, s["ih"], spacing["id"]).json()
    url = f"{V1}/itp-items/{spacing['id']}"
    assert client.put(url, json={"status": "pass"}, headers=s["ih"]).status_code == 200
    # Simulate the photo vanishing behind the API's back.
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM photos WHERE id = :id"), {"id": photo["id"]})
    role_id = spacing["required_roles"][0]["id"]
    r = client.post(
        f"{url}/signatures", json={"signoff_role_id": role_id}, headers=s["oh"]
    )
    assert r.status_code == 409 and "photo on file" in r.json()["detail"]


def test_evidence_is_refused_past_a_hold_point_and_on_closed_itps(
    client: TestClient, tenant: FakeTenant
) -> None:
    s = _setup(client, tenant)
    cover = s["items"]["cover"]
    r = _upload(client, s["ih"], cover["id"])
    assert r.status_code == 409 and "Bar spacing" in r.json()["detail"]
    r = client.put(
        f"{V1}/itp-items/{cover['id']}",
        json={"measured_value": "2"},
        headers=s["ih"],
    )
    assert r.status_code == 409 and "Bar spacing" in r.json()["detail"]

    # A voided ITP takes no photos.
    client.put(
        f"{V1}/itps/{s['itp']['id']}", json={"status": "voided"}, headers=s["oh"]
    )
    r = _upload(client, s["ih"], s["items"]["spacing"]["id"])
    assert r.status_code == 409 and "voided" in r.json()["detail"]


def test_measured_values(client: TestClient, tenant: FakeTenant) -> None:
    s = _setup(client, tenant)
    # Release the hold point so later lines can be recorded.
    spacing = s["items"]["spacing"]
    _upload(client, s["ih"], spacing["id"])
    client.put(
        f"{V1}/itp-items/{spacing['id']}", json={"status": "pass"}, headers=s["ih"]
    )
    for role in spacing["required_roles"]:
        client.post(
            f"{V1}/itp-items/{spacing['id']}/signatures",
            json={"signoff_role_id": role["id"]},
            headers=s["oh"],
        )

    def put(name: str, body: dict[str, Any]) -> Any:
        return client.put(
            f"{V1}/itp-items/{s['items'][name]['id']}", json=body, headers=s["ih"]
        )

    r = put("cover", {"measured_value": "two"})
    assert r.status_code == 422 and "not a number" in r.json()["detail"]
    r = put("cover", {"measured_value": " 2.50 ", "status": "pass"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["measured_value"] == "2.5" and body["out_of_tolerance"] is False
    assert body["status"] == "pass"
    r = put("cover", {"measured_value": "1,250"})
    assert r.json()["measured_value"] == "1250" and r.json()["out_of_tolerance"]
    assert put("cover", {"measured_value": "1.25"}).json()["out_of_tolerance"]
    r = put("cover", {"measured_value": ""})
    assert r.json()["measured_value"] is None and r.json()["out_of_tolerance"] is None

    r = put("tickets", {"measured_value": "  T-1041, T-1042 "})
    assert r.json()["measured_value"] == "T-1041, T-1042"
    assert r.json()["out_of_tolerance"] is None

    r = put("curing", {"measured_value": "x"})
    assert r.status_code == 422 and "measured value" in r.json()["detail"]
    # Clearing an absent value is a no-op, not an error.
    assert put("curing", {"measured_value": None, "notes": "ok"}).status_code == 200


def test_photo_parent_rules(client: TestClient, tenant: FakeTenant) -> None:
    s = _setup(client, tenant)
    inspection = create_inspection(client, s["oh"], s["project"]["id"])
    item_id = s["items"]["spacing"]["id"]
    both = {"inspection_id": inspection["id"], "itp_item_id": item_id}
    r = client.post(
        f"{V1}/photos/presign", json={**both, "filename": "a.jpg"}, headers=s["ih"]
    )
    assert r.status_code == 422
    r = client.post(f"{V1}/photos/presign", json={"filename": "a.jpg"}, headers=s["ih"])
    assert r.status_code == 422
    assert client.get(f"{V1}/photos", headers=s["ih"]).status_code == 422
    r = client.post(
        f"{V1}/photos",
        json={
            "itp_item_id": item_id,
            "finding_id": 1,
            "s3_key": f"photos/itp-items/{item_id}/a.jpg",
        },
        headers=s["ih"],
    )
    assert r.status_code == 422 and "finding" in r.json()["detail"]


def test_default_signoff_roles(client: TestClient, tenant: FakeTenant) -> None:
    oh = headers(tenant, OWNER)
    project = create_project(client, oh)
    invite(client, oh, project["id"], DEFAULT_EMAIL, "inspector")
    url = f"{V1}/projects/{project['id']}/signoff-roles"
    assert client.post(f"{url}/defaults", headers=headers(tenant)).status_code == 403
    client.post(
        url, json={"role_name": "contractor", "party": "contractor"}, headers=oh
    )
    r = client.post(f"{url}/defaults", headers=oh)
    assert r.status_code == 200, r.text
    assert [(x["role_name"], x["party"]) for x in r.json()] == [
        ("contractor", "contractor"),
        ("Owner's representative", "client"),
        ("Third-party inspector", "engineer"),
    ]
    # Running it again adds nothing.
    assert len(client.post(f"{url}/defaults", headers=oh).json()) == 3
