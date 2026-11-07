"""Photo routes: presigned S3 upload flow (increment 04)."""

import logging

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.storage import storage
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
    upload_photo,
)
from tests.utils.s3 import FakeS3


def test_presign_is_bound_to_inspection_and_bucket(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    i = create_inspection(client, h, p["id"])

    r = client.post(
        f"{V1}/photos/presign",
        json={
            "inspection_id": i["id"],
            "filename": "IMG_0007.JPG",
            "content_type": "image/jpeg",
        },
        headers=h,
    )
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"upload_url", "s3_key"}
    assert body["s3_key"].startswith(f"photos/inspections/{i['id']}/")
    assert body["s3_key"].endswith(".jpg")
    assert "X-Amz-Signature=fake-put" in body["upload_url"]
    method, params, expires = fake_s3.presigned[-1]
    assert method == "put_object"
    assert params == {
        "Bucket": settings.S3_BUCKET,
        "Key": body["s3_key"],
        "ContentType": "image/jpeg",
    }
    assert expires == settings.S3_PRESIGN_PUT_SECONDS

    # Unknown extensions get no extension (never a path, never a user string).
    r = client.post(
        f"{V1}/photos/presign",
        json={"inspection_id": i["id"], "filename": "../../etc/passwd.exe"},
        headers=h,
    )
    assert r.status_code == 200
    key = r.json()["s3_key"]
    assert (
        key.startswith(f"photos/inspections/{i['id']}/")
        and "." not in key.rsplit("/", 1)[1]
    )


def test_register_list_view_delete(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    i = create_inspection(client, h, p["id"])

    photo = upload_photo(client, h, i["id"], filename="rack.jpg")
    assert photo["inspection_id"] == i["id"]
    assert photo["filename"] == "rack.jpg"
    # SPA sends uploaded_by (display name); the API records the verified identity.
    assert photo["uploaded_by"] == DEFAULT_EMAIL
    assert photo["view_url"].startswith("https://") and "fake-get" in photo["view_url"]

    second = upload_photo(client, h, i["id"], filename="valve.png")
    listed = client.get(f"{V1}/photos", params={"inspection_id": i["id"]}, headers=h)
    assert listed.status_code == 200
    assert [x["filename"] for x in listed.json()] == ["valve.png", "rack.jpg"]
    for row in listed.json():
        assert row["view_url"] and "fake-get" in row["view_url"]
    method, params, expires = fake_s3.presigned[-1]
    assert method == "get_object" and expires == settings.S3_PRESIGN_GET_SECONDS
    assert params["Bucket"] == settings.S3_BUCKET

    one = client.get(f"{V1}/photos/{second['id']}", headers=h)
    assert one.status_code == 200 and one.json()["s3_key"] == second["s3_key"]

    r = client.delete(f"{V1}/photos/{photo['id']}", headers=h)
    assert r.status_code == 204
    assert (settings.S3_BUCKET, photo["s3_key"]) in fake_s3.deleted
    assert client.get(f"{V1}/photos/{photo['id']}", headers=h).status_code == 404
    assert client.get(f"{V1}/photos", headers=h).status_code == 422


def test_register_rejects_keys_outside_the_inspection_prefix(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    i = create_inspection(client, h, p["id"])
    other = create_inspection(client, h, p["id"], title="Other")

    for bad_key in (
        f"photos/inspections/{other['id']}/abc.jpg",  # someone else's inspection
        "drawings/projects/1/abc.pdf",
        "photos/abc.jpg",
        "/etc/passwd",
    ):
        r = client.post(
            f"{V1}/photos",
            json={"inspection_id": i["id"], "s3_key": bad_key, "filename": "x.jpg"},
            headers=h,
        )
        assert r.status_code == 404, bad_key


def test_photos_hidden_from_non_members_and_viewers_read_only(
    client: TestClient, tenant: FakeTenant
) -> None:
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h)
    i = create_inspection(client, owner_h, p["id"])
    photo = upload_photo(client, owner_h, i["id"])
    invite(client, owner_h, p["id"], VIEWER["email"], role="viewer")

    out_h = headers(tenant, OUTSIDER)
    r = client.post(
        f"{V1}/photos/presign",
        json={"inspection_id": i["id"], "filename": "x.jpg"},
        headers=out_h,
    )
    assert r.status_code == 404
    r = client.get(f"{V1}/photos", params={"inspection_id": i["id"]}, headers=out_h)
    assert r.status_code == 404
    r = client.get(f"{V1}/photos/{photo['id']}", headers=out_h)
    assert r.status_code == 404 and r.json()["detail"] == "Photo not found"
    assert client.delete(f"{V1}/photos/{photo['id']}", headers=out_h).status_code == 404

    viewer_h = headers(tenant, VIEWER)
    assert client.get(f"{V1}/photos/{photo['id']}", headers=viewer_h).status_code == 200
    r = client.post(
        f"{V1}/photos/presign",
        json={"inspection_id": i["id"], "filename": "x.jpg"},
        headers=viewer_h,
    )
    assert r.status_code == 403
    assert (
        client.delete(f"{V1}/photos/{photo['id']}", headers=viewer_h).status_code == 403
    )


def test_delete_still_removes_row_when_s3_delete_fails(
    client: TestClient,
    tenant: FakeTenant,
    fake_s3: FakeS3,
    caplog: pytest.LogCaptureFixture,
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    i = create_inspection(client, h, p["id"])
    photo = upload_photo(client, h, i["id"])
    fake_s3.fail_delete = True
    with caplog.at_level(logging.WARNING, logger="app.core.storage"):
        assert client.delete(f"{V1}/photos/{photo['id']}", headers=h).status_code == 204
    assert "S3 delete failed" in caplog.text
    assert client.get(f"{V1}/photos/{photo['id']}", headers=h).status_code == 404


def test_storage_helpers() -> None:
    assert storage.safe_extension("a.PNG", frozenset({".png"})) == ".png"
    assert storage.safe_extension("a.exe", frozenset({".png"})) == ""
    assert storage.safe_extension(None, frozenset({".png"})) == ""
    assert storage.drawing_prefix(7) == "drawings/projects/7/"
    assert storage.photo_prefix(3) == "photos/inspections/3/"
    assert storage.bucket == settings.S3_BUCKET
