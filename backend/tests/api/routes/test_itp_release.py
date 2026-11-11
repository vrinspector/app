"""Increment 13.9: release lines — Approved / Approved with conditions / Rejected."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.itp import TemplateError, parse_template_body
from tests.utils.auth0 import FakeTenant
from tests.utils.domain import OWNER, V1, create_project, headers
from tests.utils.itp import apply_template, create_template

RELEASE_TEMPLATE: dict[str, Any] = {
    "title": "Pour",
    "signoffRoles": ["Contractor", "Owner's representative"],
    "pages": [
        {
            "name": "pre-pour",
            "title": "Pre-pour",
            "elements": [
                {
                    "type": "radiogroup",
                    "name": "forms",
                    "title": "Forms clean",
                    "classification": "W",
                },
                {
                    "type": "radiogroup",
                    "name": "release",
                    "title": "Pre-pour release (in writing)",
                    "classification": "H",
                    "signoffRoles": ["Contractor", "Owner's representative"],
                    "resultScale": "release",
                    "approvedLabel": "Approved to pour",
                },
                {
                    "type": "radiogroup",
                    "name": "slump",
                    "title": "Slump",
                    "classification": "W",
                },
            ],
        }
    ],
}


def _setup(client: TestClient, tenant: FakeTenant) -> dict[str, Any]:
    oh = headers(tenant, OWNER)
    project = create_project(client, oh)
    template = create_template(client, oh, body=RELEASE_TEMPLATE)
    itp = apply_template(client, oh, project["id"], template["id"])
    items = {i["element_name"]: i for i in itp["items"]}
    return {"oh": oh, "itp": itp, "items": items}


def test_parser_reads_result_scale_and_label() -> None:
    parsed = parse_template_body(RELEASE_TEMPLATE)
    release = parsed.items[1]
    assert (release.result_scale, release.approved_label) == (
        "release",
        "Approved to pour",
    )
    assert parsed.items[0].result_scale is None

    def body(**extra: Any) -> dict[str, Any]:
        q = {"type": "radiogroup", "name": "a", "classification": "W", **extra}
        return {"pages": [{"elements": [q]}]}

    assert parse_template_body(body(resultScale=" Release ")).items[0].result_scale == (
        "release"
    )
    assert parse_template_body(body(resultScale="none")).items[0].result_scale is None
    for bad in ("approve", 3):
        with pytest.raises(TemplateError, match="resultScale"):
            parse_template_body(body(resultScale=bad))
    with pytest.raises(TemplateError, match="approvedLabel needs"):
        parse_template_body(body(approvedLabel="Approved to pour"))
    with pytest.raises(TemplateError, match="longer than 60"):
        parse_template_body(body(resultScale="release", approvedLabel="x" * 61))


def test_release_line_records_the_three_way_result(
    client: TestClient, tenant: FakeTenant
) -> None:
    s = _setup(client, tenant)
    oh, items = s["oh"], s["items"]
    release = items["release"]
    assert release["result_scale"] == "release"
    assert release["approved_label"] == "Approved to pour"
    assert (release["conditions"], release["result_label"]) == (None, None)
    assert items["forms"]["result_scale"] is None
    url = f"{V1}/itp-items/{release['id']}"

    # N/A is not a release result.
    r = client.put(url, json={"status": "na"}, headers=oh)
    assert r.status_code == 422 and "not N/A" in r.json()["detail"]
    # Conditions need an approval.
    r = client.put(url, json={"conditions": "Clean the joint"}, headers=oh)
    assert r.status_code == 422 and "approval" in r.json()["detail"]

    # Approved with conditions: pass + written conditions.
    r = client.put(
        url,
        json={
            "status": "pass",
            "conditions": "  1. Re-tie bars at C7\n2. Clean joint  ",
        },
        headers=oh,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pass"
    assert body["conditions"] == "1. Re-tie bars at C7\n2. Clean joint"
    assert body["result_label"] == "Approved with conditions"

    # Clearing the conditions leaves a plain approval in the line's words.
    r = client.put(url, json={"conditions": "  "}, headers=oh)
    assert r.json()["conditions"] is None
    assert r.json()["result_label"] == "Approved to pour"

    # Rejected clears any conditions.
    client.put(url, json={"conditions": "Re-tie bars"}, headers=oh)
    r = client.put(url, json={"status": "fail", "notes": "Mud on bars"}, headers=oh)
    assert r.json()["conditions"] is None
    assert r.json()["result_label"] == "Rejected"
    r = client.put(url, json={"status": "fail", "conditions": "x"}, headers=oh)
    assert r.status_code == 422

    # An ordinary line takes no conditions.
    r = client.put(
        f"{V1}/itp-items/{items['forms']['id']}",
        json={"status": "pass", "conditions": "Something"},
        headers=oh,
    )
    assert r.status_code == 422 and "release line" in r.json()["detail"]
    r = client.put(
        f"{V1}/itp-items/{items['forms']['id']}",
        json={"status": "pass", "conditions": None},
        headers=oh,
    )
    assert r.status_code == 200 and r.json()["result_label"] is None


def test_conditional_release_is_signed_releases_the_hold_and_then_is_frozen(
    client: TestClient, tenant: FakeTenant
) -> None:
    s = _setup(client, tenant)
    oh, items = s["oh"], s["items"]
    release = items["release"]
    assert items["slump"]["blocked_by_item_id"] == release["id"]
    url = f"{V1}/itp-items/{release['id']}"
    r = client.put(
        url, json={"status": "pass", "conditions": "Clean joint"}, headers=oh
    )
    assert r.status_code == 200
    for role in release["required_roles"]:
        r = client.post(
            f"{url}/signatures", json={"signoff_role_id": role["id"]}, headers=oh
        )
        assert r.status_code == 201, r.text

    itp = client.get(f"{V1}/itps/{s['itp']['id']}", headers=oh).json()
    by_name = {i["element_name"]: i for i in itp["items"]}
    assert by_name["release"]["released"] is True
    assert by_name["release"]["result_label"] == "Approved with conditions"
    assert by_name["slump"]["blocked_by_item_id"] is None

    # Signed: the conditions (and the result) can no longer change.
    r = client.put(url, json={"conditions": "Something else"}, headers=oh)
    assert r.status_code == 409 and "signed" in r.json()["detail"]
    r = client.put(url, json={"status": "fail"}, headers=oh)
    assert r.status_code == 409
    # Repeating the same conditions is not a change.
    r = client.put(url, json={"conditions": "Clean joint"}, headers=oh)
    assert r.status_code == 200
