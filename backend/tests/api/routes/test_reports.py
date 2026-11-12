"""Inspection report routes (increment 10): PDF versions in S3."""

import io

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core import reports as report_module
from app.core.config import settings
from app.core.db import engine
from tests.utils.auth0 import DEFAULT_EMAIL, FakeTenant
from tests.utils.domain import (
    OUTSIDER,
    OWNER,
    V1,
    VIEWER,
    create_finding,
    create_inspection,
    create_project,
    headers,
    invite,
    upload_photo,
)
from tests.utils.s3 import FakeS3


def _jpeg(width: int = 1600, height: int = 1200) -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (width, height), (46, 61, 46)).save(out, format="JPEG")
    return out.getvalue()


def _pdf_text(pdf: bytes) -> str:
    """The PDF with its zlib-compressed streams inflated, so object dictionaries that
    WeasyPrint packs into object streams (pages, fonts) can be asserted on."""
    import re
    import zlib

    assert pdf.startswith(b"%PDF-")
    out = pdf
    for match in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", pdf, re.S):
        try:
            out += b"\n" + zlib.decompress(match.group(1))
        except zlib.error:
            continue
    return out.decode("latin-1")


def test_generate_report_writes_a_versioned_pdf_to_s3(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3
) -> None:
    h = headers(tenant)
    p = create_project(client, h, name="Greenwood Plant")
    i = create_inspection(client, h, p["id"], title="Pipe rack walkdown #1")
    f1 = create_finding(client, h, i["id"], title="Missing U-bolt", priority="high")
    create_finding(
        client, h, i["id"], title="Paint touch-up", priority="low", location_ref=None
    )
    client.patch(
        f"{V1}/findings/{f1['id']}/resolve",
        json={"resolution_notes": "Bolt installed"},
        headers=h,
    )
    photo = upload_photo(client, h, i["id"], filename="IMG_0007.jpg")
    fake_s3.objects[photo["s3_key"]] = (_jpeg(), "image/jpeg")
    # A second photo whose object is missing from S3 → placeholder, not a failure.
    upload_photo(client, h, i["id"], filename="IMG_0008.jpg")

    r = client.post(
        f"{V1}/reports/generate", json={"inspection_id": i["id"]}, headers=h
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["inspection_id"] == i["id"]
    assert body["version"] == 1
    assert body["finding_count"] == 2
    assert body["photo_count"] == 2
    assert body["generated_by"] == DEFAULT_EMAIL
    assert body["filename"] == "Pipe-rack-walkdown-1-report-v1.pdf"
    assert body["s3_key"].startswith(f"reports/inspections/{i['id']}/v1-")
    assert body["s3_key"].endswith(".pdf")
    # The SPA's contract: a presigned download URL for the PDF.
    assert "X-Amz-Signature=fake-get" in body["download_url"]
    method, params, expires = fake_s3.presigned[-1]
    assert method == "get_object"
    assert params == {"Bucket": settings.S3_BUCKET, "Key": body["s3_key"]}
    assert expires == settings.S3_PRESIGN_GET_SECONDS

    # The PDF itself landed in the bucket with the right content type.
    pdf, content_type = fake_s3.objects[body["s3_key"]]
    assert content_type == "application/pdf"
    assert body["file_size"] == len(pdf)
    text_ = _pdf_text(pdf)
    assert (
        text_.count("/Type /Page\n")
        + text_.count("/Type /Page>>")
        + text_.count("/Type /Page/")
        >= 1
    )
    # One embedded image: the photo that could be read.
    assert text_.count("/Subtype /Image") + text_.count("/Subtype/Image") == 1

    # Each generation is a new version; the list is newest first.
    r = client.post(
        f"{V1}/reports/generate", json={"inspection_id": i["id"]}, headers=h
    )
    assert r.status_code == 201
    assert r.json()["version"] == 2
    r = client.get(f"{V1}/reports", params={"inspection_id": i["id"]}, headers=h)
    assert r.status_code == 200
    versions = [row["version"] for row in r.json()]
    assert versions == [2, 1]
    assert all(row["download_url"] for row in r.json())
    assert len([k for k in fake_s3.objects if k.startswith("reports/")]) == 2

    r = client.get(f"{V1}/reports/{body['id']}", headers=h)
    assert r.status_code == 200
    assert r.json()["version"] == 1


def test_report_html_reflects_the_record(
    client: TestClient, tenant: FakeTenant
) -> None:
    """The layout source (before WeasyPrint) carries every field the screen shows."""
    from datetime import UTC, datetime

    from sqlmodel import Session, select

    from app.models import Finding, Inspection, Photo, Project

    h = headers(tenant)
    p = create_project(client, h, name="Greenwood Plant")
    i = create_inspection(
        client, h, p["id"], title="Night shift walkdown", notes="Rain all day"
    )
    f = create_finding(client, h, i["id"], title="Missing U-bolt", priority="high")
    create_finding(client, h, i["id"], title="Low item", priority="low")
    client.patch(
        f"{V1}/findings/{f['id']}/resolve",
        json={"resolution_notes": "Bolt installed"},
        headers=h,
    )
    client.patch(f"{V1}/inspections/{i['id']}/signoff", headers=h)
    upload_photo(client, h, i["id"], filename="IMG_0009.jpg")

    with Session(engine) as session:
        inspection = session.get(Inspection, i["id"])
        assert inspection is not None
        project = session.get(Project, p["id"])
        assert project is not None
        findings = list(
            session.exec(select(Finding).where(Finding.inspection_id == i["id"]))
        )
        photos = list(session.exec(select(Photo).where(Photo.inspection_id == i["id"])))
        html = report_module.render_html(
            report_module.ReportContext(
                project=project,
                inspection=inspection,
                findings=findings,
                photos=photos,
                version=3,
                generated_by="stacey@example.com",
                generated_at=datetime(2026, 11, 8, 8, 0, tzinfo=UTC),
            )
        )

    assert "Night shift walkdown" in html
    assert "Greenwood Plant" in html and "PGE" in html
    assert "Report version 3" in html
    assert "Nov 08, 2026 08:00 UTC" in html
    assert "Signed off by <strong>" + DEFAULT_EMAIL in html
    assert "Rain all day" in html
    # High-priority findings sort first; resolution is shown with its notes.
    assert html.index("Missing U-bolt") < html.index("Low item")
    assert "Bolt installed" in html
    assert "Resolved by " + DEFAULT_EMAIL in html
    # Summary tiles: 2 findings, 1 open, 1 resolved, 0 high (the high one is resolved).
    assert '<div class="n">2</div><div class="l">Findings</div>' in html
    assert '<div class="n">1</div><div class="l">Open</div>' in html
    assert '<div class="n">1</div><div class="l">Resolved</div>' in html
    assert '<div class="n">0</div><div class="l">High priority</div>' in html
    # The photo object is not in the fake bucket → placeholder.
    assert "IMG_0009.jpg" in html
    assert "Photo unavailable" in html


def test_reports_follow_membership_and_hide_objects(
    client: TestClient, tenant: FakeTenant
) -> None:
    owner_h = headers(tenant, OWNER)
    viewer_h = headers(tenant, VIEWER)
    out_h = headers(tenant, OUTSIDER)
    p = create_project(client, owner_h)
    invite(client, owner_h, p["id"], VIEWER["email"], role="viewer")
    i = create_inspection(client, owner_h, p["id"])

    # Viewers can generate and read a report: it is a read-out of the record.
    r = client.post(
        f"{V1}/reports/generate", json={"inspection_id": i["id"]}, headers=viewer_h
    )
    assert r.status_code == 201, r.text
    report = r.json()
    assert report["generated_by"] == VIEWER["email"]
    r = client.get(f"{V1}/reports", params={"inspection_id": i["id"]}, headers=viewer_h)
    assert r.status_code == 200 and len(r.json()) == 1

    # Non-members: 404 object hiding, same detail strings as the other routers.
    r = client.post(
        f"{V1}/reports/generate", json={"inspection_id": i["id"]}, headers=out_h
    )
    assert r.status_code == 404 and r.json()["detail"] == "Inspection not found"
    r = client.get(f"{V1}/reports", params={"inspection_id": i["id"]}, headers=out_h)
    assert r.status_code == 404 and r.json()["detail"] == "Inspection not found"
    r = client.get(f"{V1}/reports/{report['id']}", headers=out_h)
    assert r.status_code == 404 and r.json()["detail"] == "Report not found"
    r = client.get(f"{V1}/reports/999999", headers=owner_h)
    assert r.status_code == 404 and r.json()["detail"] == "Report not found"
    r = client.post(
        f"{V1}/reports/generate", json={"inspection_id": 999999}, headers=owner_h
    )
    assert r.status_code == 404


def test_deleting_the_inspection_removes_its_report_rows(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    i = create_inspection(client, h, p["id"])
    r = client.post(
        f"{V1}/reports/generate", json={"inspection_id": i["id"]}, headers=h
    )
    assert r.status_code == 201
    r = client.delete(f"{V1}/inspections/{i['id']}", headers=h)
    assert r.status_code == 204
    with engine.connect() as conn:
        count = conn.execute(text("SELECT count(*) FROM inspection_reports")).scalar()
    assert count == 0


def test_unreadable_photo_bytes_render_as_placeholder(fake_s3: FakeS3) -> None:
    assert report_module.thumbnail_data_uri(b"not an image") is None
    uri = report_module.thumbnail_data_uri(_jpeg(3000, 2000))
    assert uri is not None and uri.startswith("data:image/jpeg;base64,")
    # Downscaled: a 3000 px JPEG becomes at most THUMBNAIL_EDGE wide.
    import base64

    from PIL import Image

    with Image.open(io.BytesIO(base64.b64decode(uri.split(",", 1)[1]))) as image:
        assert max(image.size) == report_module.THUMBNAIL_EDGE
    fake_s3.fail_get = True
    from app.core.storage import storage

    assert storage.get_object("photos/inspections/1/x.jpg") is None
