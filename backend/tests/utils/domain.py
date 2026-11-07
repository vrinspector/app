"""Helpers that drive the ported routes the way the deployed SPA does."""

from typing import Any

from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.auth0 import FakeTenant

V1 = settings.API_V1_STR

# Two more identities besides the tenant's default inspector.
OWNER = {"sub": "auth0|owner-0001", "email": "owner@example.com", "name": "Olive Owner"}
OUTSIDER = {
    "sub": "auth0|outsider-0001",
    "email": "outsider@example.com",
    "name": "Oscar Outsider",
}
VIEWER = {
    "sub": "auth0|viewer-0001",
    "email": "viewer@example.com",
    "name": "Vi Viewer",
}


def headers(tenant: FakeTenant, who: dict[str, str] | None = None) -> dict[str, str]:
    if who is None:
        return tenant.auth_headers()
    return tenant.auth_headers(sub=who["sub"], email=who["email"], name=who["name"])


def create_project(
    client: TestClient, h: dict[str, str], **overrides: Any
) -> dict[str, Any]:
    body = {
        "name": "Greenwood Plant",
        "client": "PGE",
        "location": "Greenwood, SC",
        "status": "active",
        "created_by": "Inspector",  # literal the SPA sends
    }
    body.update(overrides)
    r = client.post(f"{V1}/projects", json=body, headers=h)
    assert r.status_code == 201, r.text
    data: dict[str, Any] = r.json()
    return data


def invite(
    client: TestClient,
    h: dict[str, str],
    project_id: int,
    email: str,
    role: str = "inspector",
) -> dict[str, Any]:
    r = client.post(
        f"{V1}/projects/{project_id}/members",
        json={"email": email, "role": role},
        headers=h,
    )
    assert r.status_code == 201, r.text
    data: dict[str, Any] = r.json()
    return data


def create_inspection(
    client: TestClient, h: dict[str, str], project_id: int, **overrides: Any
) -> dict[str, Any]:
    body = {
        "project_id": project_id,
        "title": "Pipe rack walkdown",
        "inspection_type": "piping",
        "inspector": "S. Roberts",
        "notes": None,
        "status": "open",
    }
    body.update(overrides)
    r = client.post(f"{V1}/inspections", json=body, headers=h)
    assert r.status_code == 201, r.text
    data: dict[str, Any] = r.json()
    return data


def create_finding(
    client: TestClient, h: dict[str, str], inspection_id: int, **overrides: Any
) -> dict[str, Any]:
    body = {
        "inspection_id": inspection_id,
        "title": "Missing U-bolt at support PS-12",
        "description": 'Line 6"-P-1203 unsupported between PS-11 and PS-13',
        "priority": "high",
        "location_ref": "Grid C-4",
        "status": "open",
    }
    body.update(overrides)
    r = client.post(f"{V1}/findings", json=body, headers=h)
    assert r.status_code == 201, r.text
    data: dict[str, Any] = r.json()
    return data


def upload_drawing(
    client: TestClient,
    h: dict[str, str],
    project_id: int,
    filename: str = "P&ID-1203.pdf",
    **overrides: Any,
) -> dict[str, Any]:
    """The SPA's ``handleDrawingUpload``: presign → PUT to S3 (skipped) → register."""
    r = client.post(
        f"{V1}/drawings/presign",
        json={
            "project_id": project_id,
            "filename": filename,
            "content_type": "application/pdf",
        },
        headers=h,
    )
    assert r.status_code == 200, r.text
    presign = r.json()
    body = {
        "project_id": project_id,
        "s3_key": presign["s3_key"],
        "filename": filename,
        "title": filename.rsplit(".", 1)[0],
        "discipline": "general",
        "file_type": (filename.rsplit(".", 1)[-1] or "png").lower(),
        "file_size": 48213,
        "uploaded_by": "Test Inspector",  # display name the SPA sends
    }
    body.update(overrides)
    r = client.post(f"{V1}/drawings", json=body, headers=h)
    assert r.status_code == 201, r.text
    data: dict[str, Any] = r.json()
    return data


def create_pin(
    client: TestClient, h: dict[str, str], drawing_id: int, **overrides: Any
) -> dict[str, Any]:
    body = {"x_pct": 42.5, "y_pct": 17.25, "status": "not_started", "page_number": 1}
    body.update(overrides)
    r = client.post(f"{V1}/drawings/{drawing_id}/pins", json=body, headers=h)
    assert r.status_code == 201, r.text
    data: dict[str, Any] = r.json()
    return data


def upload_photo(
    client: TestClient,
    h: dict[str, str],
    inspection_id: int,
    filename: str = "IMG_0001.jpg",
) -> dict[str, Any]:
    """The SPA's three-step flow: presign → PUT to S3 (skipped) → register."""
    r = client.post(
        f"{V1}/photos/presign",
        json={
            "inspection_id": inspection_id,
            "filename": filename,
            "content_type": "image/jpeg",
        },
        headers=h,
    )
    assert r.status_code == 200, r.text
    presign = r.json()
    r = client.post(
        f"{V1}/photos",
        json={
            "inspection_id": inspection_id,
            "s3_key": presign["s3_key"],
            "filename": filename,
            "uploaded_by": "Test Inspector",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    data: dict[str, Any] = r.json()
    return data
