"""Increments 13.7 / 13.9: new accounts start with the starter ITP library."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.auth import AuthUser
from app.core.config import settings
from app.core.db import engine
from app.core.itp_library import seed_starter_library
from tests.utils.auth0 import FakeTenant
from tests.utils.domain import OUTSIDER, OWNER, V1, create_project, headers
from tests.utils.itp import apply_template, create_template

STARTER_NAMES = [
    "Cast-in-place concrete",
    "Earthwork and compaction",
    "Underground conduit / duct bank before backfill",
    "Structural steel connections",
    "Piping pressure test (hydrostatic)",
    "Electrical pre-energization",
    "Instrument calibration",
    "Pre-commissioning readiness (per system)",
    "Cold commissioning (per system)",
    "Hot commissioning (per system)",
    "Ready for startup (RFSU)",
]


@pytest.fixture
def starter_library(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ITP_STARTER_LIBRARY", True)


def _list(client: TestClient, h: dict[str, str], **query: Any) -> list[dict[str, Any]]:
    r = client.get(f"{V1}/itp-templates", params=query, headers=h)
    assert r.status_code == 200, r.text
    data: list[dict[str, Any]] = r.json()
    return data


@pytest.mark.usefixtures("starter_library")
def test_a_new_account_starts_with_the_starters_once(
    client: TestClient, tenant: FakeTenant
) -> None:
    oh = headers(tenant, OWNER)
    first = _list(client, oh)
    assert [t["name"] for t in first] == STARTER_NAMES
    assert all(t["status"] == "published" and t["version"] == 1 for t in first)
    assert all(t["created_by"] == OWNER["email"] for t in first)
    concrete = first[0]
    assert concrete["item_count"] == 48 and concrete["hold_count"] == 7
    assert concrete["role_names"] == [
        "Contractor",
        "Owner's representative",
        "Third-party inspector",
    ]

    # Listing again does not add them a second time.
    assert [t["id"] for t in _list(client, oh)] == [t["id"] for t in first]

    # Another account gets its own copies; neither sees the other's.
    xh = headers(tenant, OUTSIDER)
    theirs = _list(client, xh)
    assert [t["name"] for t in theirs] == STARTER_NAMES
    assert not {t["id"] for t in theirs} & {t["id"] for t in first}


@pytest.mark.usefixtures("starter_library")
def test_starters_are_ordinary_masters_and_are_not_re_added(
    client: TestClient, tenant: FakeTenant
) -> None:
    oh = headers(tenant, OWNER)
    starters = _list(client, oh)
    for t in starters:
        r = client.patch(
            f"{V1}/itp-templates/{t['id']}/status",
            json={"status": "archived"},
            headers=oh,
        )
        assert r.status_code == 200
    # Archiving every starter leaves an empty list — they do not come back.
    assert _list(client, oh) == []
    assert len(_list(client, oh, include_archived="true")) == len(STARTER_NAMES)


@pytest.mark.usefixtures("starter_library")
def test_an_account_that_already_has_masters_is_left_alone(
    client: TestClient, tenant: FakeTenant
) -> None:
    oh = headers(tenant, OWNER)
    mine = create_template(client, oh)
    assert [t["id"] for t in _list(client, oh)] == [mine["id"]]


@pytest.mark.usefixtures("starter_library")
def test_concrete_starter_imports_with_its_line_evidence(
    client: TestClient, tenant: FakeTenant
) -> None:
    oh = headers(tenant, OWNER)
    concrete = _list(client, oh)[0]
    project = create_project(client, oh)
    itp = apply_template(client, oh, project["id"], concrete["id"])
    assert itp["title"] == "Cast-in-place concrete"
    assert itp["item_count"] == 48 and itp["open_hold_count"] == 7
    items = {i["element_name"]: i for i in itp["items"]}

    cover = items["concrete-cover"]
    assert cover["classification"] == "hold" and cover["photo_required"] is True
    assert cover["value_type"] == "number" and cover["value_unit"] == "in"
    assert cover["section"] == "3 Reinforcement (hold points)"
    assert "verify before issue" in cover["acceptance_criteria"]
    assert cover["reference_doc"].startswith("Field guide Checklist A-1 item 8")
    assert [r["role_name"] for r in cover["required_roles"]] == [
        "Third-party inspector"
    ]
    spacing = items["rebar-size-spacing"]
    assert spacing["photo_set"] == "three_shot" and spacing["value_type"] == "text"

    curing = items["cylinder-curing"]
    assert (curing["value_min"], curing["value_max"]) == (60, 80)
    release = items["pre-pour-release"]
    assert release["result_scale"] == "release"
    assert release["approved_label"] == "Approved to pour"
    assert release["result_label"] is None
    assert [r["role_name"] for r in release["required_roles"]] == [
        "Contractor",
        "Owner's representative",
    ]

    # The lines before the first hold point can be recorded straight away;
    # the line after the first rebar hold point is blocked.
    assert items["rebar-submittals"]["blocked_by_item_id"] is None
    assert items["shoring"]["blocked_by_item_id"] is None
    assert items["mix-design"]["blocked_by_item_id"] == spacing["id"]
    assert items["concrete-cover"]["blocked_by_item_id"] == spacing["id"]


def test_seeding_is_off_when_the_setting_is_off(
    client: TestClient, tenant: FakeTenant
) -> None:
    assert _list(client, headers(tenant, OWNER)) == []


def test_seed_function_adds_once_per_account() -> None:
    user = AuthUser(sub="auth0|seed-direct-0001", email="seed@example.com")
    with Session(engine) as session:
        assert seed_starter_library(session, user, user.email) == len(STARTER_NAMES)
    with Session(engine) as session:
        assert seed_starter_library(session, user, user.email) == 0
