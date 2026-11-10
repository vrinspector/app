"""Increment 13.7: new accounts start with the starter ITP library."""

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
    "Piping pressure test",
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
    assert concrete["item_count"] == 27 and concrete["hold_count"] == 8
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
    assert len(_list(client, oh, include_archived="true")) == 4


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
    assert itp["item_count"] == 27 and itp["open_hold_count"] == 8
    items = {i["element_name"]: i for i in itp["items"]}

    cover = items["clear-cover"]
    assert cover["classification"] == "hold" and cover["photo_required"] is True
    assert cover["value_type"] == "number" and cover["value_unit"] == "in"
    assert cover["section"] == "3 Rebar inspection"
    assert "verify before issue" in cover["acceptance_criteria"]
    assert cover["reference_doc"] == "ACI 318 §20.5.1.3; ACI 117"
    assert [r["role_name"] for r in cover["required_roles"]] == [
        "Third-party inspector"
    ]

    temperature = items["concrete-temperature"]
    assert temperature["value_type"] == "number" and temperature["value_max"] == 95
    assert [r["role_name"] for r in items["pre-pour-release"]["required_roles"]] == [
        "Contractor",
        "Owner's representative",
    ]

    # The first lines (before any hold point) can be recorded straight away;
    # the line after the first rebar hold point is blocked.
    assert items["mix-design"]["blocked_by_item_id"] is None
    assert items["bar-spacing"]["blocked_by_item_id"] == items["bar-size-grade"]["id"]


def test_seeding_is_off_when_the_setting_is_off(
    client: TestClient, tenant: FakeTenant
) -> None:
    assert _list(client, headers(tenant, OWNER)) == []


def test_seed_function_adds_once_per_account() -> None:
    user = AuthUser(sub="auth0|seed-direct-0001", email="seed@example.com")
    with Session(engine) as session:
        assert seed_starter_library(session, user, user.email) == 4
    with Session(engine) as session:
        assert seed_starter_library(session, user, user.email) == 0
