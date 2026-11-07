"""Projects + members routes (increment 04) — contract and authorization."""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.db import engine
from app.models import ProjectMember
from tests.utils.auth0 import DEFAULT_EMAIL, DEFAULT_SUB, FakeTenant
from tests.utils.domain import (
    OUTSIDER,
    OWNER,
    V1,
    VIEWER,
    create_project,
    headers,
    invite,
)


def test_create_project_returns_legacy_shape_and_makes_creator_owner(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    # Shape the SPA reads: id, name, client, location, status (+ rebuild public_id).
    assert set(p) >= {
        "id",
        "public_id",
        "name",
        "client",
        "location",
        "status",
        "created_by",
        "created_at",
        "updated_at",
    }
    assert isinstance(p["id"], int)
    assert p["status"] == "active"
    # The SPA sends created_by:"Inspector"; the API records the verified identity.
    assert p["created_by"] == DEFAULT_EMAIL

    members = client.get(f"{V1}/projects/{p['id']}/members", headers=h).json()
    assert [(m["email"], m["role"]) for m in members] == [(DEFAULT_EMAIL, "owner")]
    assert members[0]["user_sub"] == DEFAULT_SUB
    assert members[0]["invited_by"] == DEFAULT_EMAIL


def test_list_projects_is_scoped_to_membership(
    client: TestClient, tenant: FakeTenant
) -> None:
    mine = create_project(client, headers(tenant), name="Mine")
    theirs = create_project(client, headers(tenant, OWNER), name="Theirs")

    listed = client.get(f"{V1}/projects", headers=headers(tenant)).json()
    assert [p["id"] for p in listed] == [mine["id"]]

    # Non-members get 404 (object hiding), not 403.
    r = client.get(f"{V1}/projects/{theirs['id']}", headers=headers(tenant))
    assert r.status_code == 404
    assert r.json()["detail"] == "Project not found"
    r = client.get(f"{V1}/projects/{theirs['id']}/members", headers=headers(tenant))
    assert r.status_code == 404
    r = client.get(f"{V1}/projects/999999", headers=headers(tenant))
    assert r.status_code == 404


def test_list_projects_requires_auth(client: TestClient) -> None:
    assert client.get(f"{V1}/projects").status_code == 401


def test_project_validation(client: TestClient, tenant: FakeTenant) -> None:
    h = headers(tenant)
    r = client.post(f"{V1}/projects", json={"name": ""}, headers=h)
    assert r.status_code == 422
    r = client.post(f"{V1}/projects", json={"name": "X", "status": "bogus"}, headers=h)
    assert r.status_code == 422


def test_update_and_delete_project_owner_only(
    client: TestClient, tenant: FakeTenant
) -> None:
    owner_h = headers(tenant, OWNER)
    insp_h = headers(tenant)
    p = create_project(client, owner_h)
    invite(client, owner_h, p["id"], DEFAULT_EMAIL, role="inspector")

    r = client.put(
        f"{V1}/projects/{p['id']}", json={"status": "on_hold"}, headers=insp_h
    )
    assert r.status_code == 403

    r = client.put(f"{V1}/projects/{p['id']}", json={}, headers=owner_h)
    assert r.status_code == 400
    assert r.json()["detail"] == "No fields to update"

    r = client.put(
        f"{V1}/projects/{p['id']}",
        json={"status": "on_hold", "location": "Abbeville, SC"},
        headers=owner_h,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "on_hold"
    assert r.json()["location"] == "Abbeville, SC"
    assert r.json()["name"] == p["name"]

    r = client.delete(f"{V1}/projects/{p['id']}", headers=insp_h)
    assert r.status_code == 403
    r = client.delete(f"{V1}/projects/{p['id']}", headers=owner_h)
    assert r.status_code == 204
    assert client.get(f"{V1}/projects/{p['id']}", headers=owner_h).status_code == 404
    with Session(engine) as db:
        assert db.exec(select(ProjectMember)).all() == []


# --- Members (Block 7) -------------------------------------------------------


def test_member_invite_list_remove(client: TestClient, tenant: FakeTenant) -> None:
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h)

    m = invite(client, owner_h, p["id"], "  New.Member@Example.com ", role="viewer")
    # Emails are normalized; the SPA reads m.id / m.email / m.role.
    assert m["email"] == "new.member@example.com"
    assert m["user_email"] == m["email"]
    assert m["role"] == "viewer"
    assert m["user_sub"] is None
    assert m["invited_by"] == OWNER["email"]

    listed = client.get(f"{V1}/projects/{p['id']}/members", headers=owner_h).json()
    assert [x["email"] for x in listed] == [OWNER["email"], "new.member@example.com"]

    # Duplicate (case-insensitive) → 409
    r = client.post(
        f"{V1}/projects/{p['id']}/members",
        json={"email": "NEW.MEMBER@example.com", "role": "inspector"},
        headers=owner_h,
    )
    assert r.status_code == 409

    # Invalid inputs → 422
    r = client.post(
        f"{V1}/projects/{p['id']}/members",
        json={"email": "not-an-email", "role": "inspector"},
        headers=owner_h,
    )
    assert r.status_code == 422
    r = client.post(
        f"{V1}/projects/{p['id']}/members",
        json={"email": "x@example.com", "role": "admin"},
        headers=owner_h,
    )
    assert r.status_code == 422

    # Owners cannot be removed; unknown member ids are 404.
    owner_row = listed[0]
    r = client.delete(
        f"{V1}/projects/{p['id']}/members/{owner_row['id']}", headers=owner_h
    )
    assert r.status_code == 400
    r = client.delete(f"{V1}/projects/{p['id']}/members/424242", headers=owner_h)
    assert r.status_code == 404

    r = client.delete(f"{V1}/projects/{p['id']}/members/{m['id']}", headers=owner_h)
    assert r.status_code == 204
    listed = client.get(f"{V1}/projects/{p['id']}/members", headers=owner_h).json()
    assert [x["email"] for x in listed] == [OWNER["email"]]


def test_member_management_is_owner_only_but_listing_is_for_all_members(
    client: TestClient, tenant: FakeTenant
) -> None:
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h)
    invite(client, owner_h, p["id"], DEFAULT_EMAIL, role="inspector")
    v = invite(client, owner_h, p["id"], VIEWER["email"], role="viewer")

    insp_h = headers(tenant)
    assert (
        client.get(f"{V1}/projects/{p['id']}/members", headers=insp_h).status_code
        == 200
    )
    r = client.post(
        f"{V1}/projects/{p['id']}/members",
        json={"email": "someone@example.com", "role": "inspector"},
        headers=insp_h,
    )
    assert r.status_code == 403
    r = client.delete(f"{V1}/projects/{p['id']}/members/{v['id']}", headers=insp_h)
    assert r.status_code == 403

    # A member of another project cannot remove this project's member by id.
    other = create_project(client, headers(tenant, OUTSIDER))
    r = client.delete(
        f"{V1}/projects/{other['id']}/members/{v['id']}",
        headers=headers(tenant, OUTSIDER),
    )
    assert r.status_code == 404


def test_invited_member_sees_project_and_gets_sub_anchored_on_first_visit(
    client: TestClient, tenant: FakeTenant
) -> None:
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h)
    invite(client, owner_h, p["id"], DEFAULT_EMAIL.upper(), role="inspector")

    # Before the invitee signs in, the row has only the email.
    with Session(engine) as db:
        row = db.exec(
            select(ProjectMember).where(ProjectMember.user_email == DEFAULT_EMAIL)
        ).one()
        assert row.user_sub is None

    # Email-matched access works (legacy rule) and records the Auth0 sub.
    r = client.get(f"{V1}/projects/{p['id']}", headers=headers(tenant))
    assert r.status_code == 200
    with Session(engine) as db:
        row = db.exec(
            select(ProjectMember).where(ProjectMember.user_email == DEFAULT_EMAIL)
        ).one()
        assert row.user_sub == DEFAULT_SUB

    # From now on the sub alone is enough, even if the token carries no email.
    r = client.get(f"{V1}/projects/{p['id']}", headers=tenant.auth_headers(email=None))
    assert r.status_code == 200
    listed = client.get(
        f"{V1}/projects", headers=tenant.auth_headers(email=None)
    ).json()
    assert [x["id"] for x in listed] == [p["id"]]
