"""AI capture assistance (increment 15; Block 10A photo analysis, 10B voice-to-finding).

The Claude API is replaced by ``tests/utils/claude.py``; nothing reaches the
network. Covers the guardrails: drafts are never saved by themselves, every
call is logged with prompt + model version, confirmation goes through the
ordinary routes, and authorization hides other projects' objects (404).
"""

import base64
import io
import json
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core import ai as ai_core
from app.core.ai import AiError, ai, prepare_image
from app.core.config import settings
from tests.utils.auth0 import DEFAULT_EMAIL, FakeTenant
from tests.utils.claude import MODEL_VERSION, PHOTO_ANSWER, VOICE_ANSWER, FakeClaude
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
from tests.utils.itp import apply_template, create_template
from tests.utils.s3 import FakeS3


@pytest.fixture
def claude(monkeypatch: pytest.MonkeyPatch) -> Generator[FakeClaude]:
    fake = FakeClaude()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key-not-real")
    ai.use_transport(fake.transport)
    yield fake
    ai.use_transport(None)


def _jpeg(width: int = 3000, height: int = 2000) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), (120, 90, 60)).save(out, format="JPEG")
    return out.getvalue()


def _setup(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3
) -> tuple[dict[str, str], dict[str, Any], dict[str, Any], dict[str, Any]]:
    h = headers(tenant)
    p = create_project(client, h)
    i = create_inspection(client, h, p["id"])
    photo = upload_photo(client, h, i["id"])
    fake_s3.objects[photo["s3_key"]] = (_jpeg(), "image/jpeg")
    return h, p, i, photo


# --- status --------------------------------------------------------------------


def test_status_off_without_a_key(client: TestClient, tenant: FakeTenant) -> None:
    r = client.get(f"{V1}/ai/status", headers=headers(tenant))
    assert r.status_code == 200
    assert r.json() == {
        "enabled": False,
        "model": None,
        "daily_limit": settings.AI_DAILY_LIMIT_PER_USER,
        "used_today": 0,
    }


def test_routes_refuse_when_off(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3
) -> None:
    h, _, i, photo = _setup(client, tenant, fake_s3)
    r = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=h
    )
    assert r.status_code == 503
    assert r.json()["detail"] == "AI assistance is not set up"
    r = client.post(
        f"{V1}/ai/voice-finding",
        json={"inspection_id": i["id"], "transcript": "Bolt missing"},
        headers=h,
    )
    assert r.status_code == 503


@pytest.mark.usefixtures("claude")
def test_status_on_with_a_key(client: TestClient, tenant: FakeTenant) -> None:
    body = client.get(f"{V1}/ai/status", headers=headers(tenant)).json()
    assert body["enabled"] is True
    assert body["model"] == settings.AI_MODEL


# --- 10A photo analysis ------------------------------------------------------------


def test_photo_analysis_returns_a_logged_draft(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3, claude: FakeClaude
) -> None:
    h, p, i, photo = _setup(client, tenant, fake_s3)
    r = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=h
    )
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["kind"] == "photo"
    assert s["status"] == "draft"
    assert s["photo_id"] == photo["id"]
    assert s["inspection_id"] == i["id"] and s["project_id"] == p["id"]
    assert s["model"] == MODEL_VERSION  # the version that answered, not the alias
    assert s["prompt_version"] == ai_core.PHOTO_PROMPT_VERSION
    assert s["draft"]["category"] == "defect"
    assert [d["type"] for d in s["draft"]["defects"]] == ["corrosion", "crack"]
    assert s["draft"]["severity"] == "medium"
    assert s["requested_by"] == DEFAULT_EMAIL

    # The request: one forced tool, the downscaled image, the context, the key.
    (request,) = claude.requests
    assert request.headers["x-api-key"] == "test-key-not-real"
    assert request.headers["anthropic-version"] == ai_core.ANTHROPIC_VERSION
    body = json.loads(request.content)
    assert body["model"] == settings.AI_MODEL
    assert body["tool_choice"] == {"type": "tool", "name": "record_photo_analysis"}
    image, prompt = body["messages"][0]["content"]
    assert image["source"]["media_type"] == "image/jpeg"
    sent = Image.open(io.BytesIO(base64.b64decode(image["source"]["data"])))
    assert max(sent.size) == settings.AI_IMAGE_MAX_EDGE
    assert "Inspection type: piping" in prompt["text"]

    # Nothing is filed until the inspector confirms.
    got = client.get(f"{V1}/photos/{photo['id']}", headers=h).json()
    assert got["category"] is None and got["defect_tags"] is None

    # The full log row.
    log = client.get(f"{V1}/ai/suggestions/{s['id']}", headers=h).json()
    assert log["system_prompt"] == ai_core.PHOTO_SYSTEM_PROMPT
    assert log["user_prompt"] == prompt["text"]
    assert log["input_tokens"] == 1234 and log["output_tokens"] == 210
    assert log["finding_id"] is None
    listed = client.get(
        f"{V1}/ai/suggestions", params={"photo_id": photo["id"]}, headers=h
    ).json()
    assert [row["id"] for row in listed] == [s["id"]]


@pytest.mark.usefixtures("claude")
def test_confirm_photo_tags_unedited_and_edited(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3
) -> None:
    h, _, _, photo = _setup(client, tenant, fake_s3)
    s = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=h
    ).json()

    r = client.put(
        f"{V1}/photos/{photo['id']}/tags",
        json={
            "category": "defect",
            "defect_tags": ["crack", "corrosion"],
            "severity": "medium",
            "ai_suggestion_id": s["id"],
        },
        headers=h,
    )
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["category"] == "defect"
    assert got["defect_tags"] == ["crack", "corrosion"]
    assert got["severity"] == "medium"
    assert got["tags_confirmed_by"] == DEFAULT_EMAIL
    assert got["ai_suggestion_id"] == s["id"]
    log = client.get(f"{V1}/ai/suggestions/{s['id']}", headers=h).json()
    assert log["status"] == "confirmed" and log["edited"] is False
    assert log["decided_by"] == DEFAULT_EMAIL

    # A second analysis, confirmed with a change → edited.
    s2 = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=h
    ).json()
    r = client.put(
        f"{V1}/photos/{photo['id']}/tags",
        json={
            "category": "defect",
            "defect_tags": ["corrosion"],
            "severity": "high",
            "ai_suggestion_id": s2["id"],
        },
        headers=h,
    )
    assert r.status_code == 200
    log = client.get(f"{V1}/ai/suggestions/{s2['id']}", headers=h).json()
    assert log["edited"] is True

    # Clearing the filing by hand.
    r = client.put(f"{V1}/photos/{photo['id']}/tags", json={}, headers=h)
    got = r.json()
    assert got["category"] is None and got["defect_tags"] is None
    assert got["tags_confirmed_by"] is None and got["ai_suggestion_id"] is None


def test_file_photo_by_hand_without_ai(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3
) -> None:
    h, _, _, photo = _setup(client, tenant, fake_s3)
    r = client.put(
        f"{V1}/photos/{photo['id']}/tags",
        json={"category": "progress", "defect_tags": ["damage", "damage"]},
        headers=h,
    )
    assert r.status_code == 200
    assert r.json()["defect_tags"] == ["damage"]
    r = client.put(
        f"{V1}/photos/{photo['id']}/tags", json={"category": "selfie"}, headers=h
    )
    assert r.status_code == 422


@pytest.mark.usefixtures("claude")
def test_photo_draft_can_be_logged_as_a_finding(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3
) -> None:
    h, _, i, photo = _setup(client, tenant, fake_s3)
    s = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=h
    ).json()
    r = client.post(
        f"{V1}/findings",
        json={
            "inspection_id": i["id"],
            "title": PHOTO_ANSWER["title"],
            "description": PHOTO_ANSWER["description"],
            "priority": "medium",
            "ai_suggestion_id": s["id"],
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    finding = r.json()
    assert finding["ai_suggestion_id"] == s["id"]
    log = client.get(f"{V1}/ai/suggestions/{s['id']}", headers=h).json()
    assert log["status"] == "confirmed" and log["edited"] is False
    assert log["finding_id"] == finding["id"]
    # The same draft can still confirm the photo's tags …
    r = client.put(
        f"{V1}/photos/{photo['id']}/tags",
        json={"category": "defect", "ai_suggestion_id": s["id"]},
        headers=h,
    )
    assert r.status_code == 200
    # … but backs only one finding.
    r = client.post(
        f"{V1}/findings",
        json={"inspection_id": i["id"], "title": "Again", "ai_suggestion_id": s["id"]},
        headers=h,
    )
    assert r.status_code == 409


def test_photo_analysis_refusals(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3, claude: FakeClaude
) -> None:
    h, _, i, photo = _setup(client, tenant, fake_s3)
    # Missing photo file in S3.
    other = upload_photo(client, h, i["id"], filename="gone.jpg")
    r = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": other["id"]}, headers=h
    )
    assert r.status_code == 404
    # Unknown photo id.
    r = client.post(f"{V1}/ai/photo-analysis", json={"photo_id": 999999}, headers=h)
    assert r.status_code == 404
    # Unreadable bytes with a type the model would not take.
    fake_s3.objects[other["s3_key"]] = (b"not an image", "image/heic")
    r = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": other["id"]}, headers=h
    )
    assert r.status_code == 422
    assert "format" in r.json()["detail"]
    # Signed-off inspection.
    client.patch(f"{V1}/inspections/{i['id']}/signoff", headers=h)
    r = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=h
    )
    assert r.status_code == 409
    r = client.put(
        f"{V1}/photos/{photo['id']}/tags", json={"category": "defect"}, headers=h
    )
    assert r.status_code == 409
    assert len(claude.requests) == 0


def test_model_failures_are_logged_as_failed(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3, claude: FakeClaude
) -> None:
    h, _, i, photo = _setup(client, tenant, fake_s3)

    claude.fail_with = 500
    r = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=h
    )
    assert r.status_code == 502
    claude.fail_with = 429
    r = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=h
    )
    assert r.status_code == 503
    claude.fail_with = None
    claude.timeout = True
    r = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=h
    )
    assert r.status_code == 502
    claude.timeout = False
    claude.no_tool = True
    r = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=h
    )
    assert r.status_code == 502
    claude.no_tool = False
    claude.photo_answer = {"category": "nonsense", "defects": []}
    r = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=h
    )
    assert r.status_code == 502
    assert "file the photo yourself" in r.json()["detail"]
    claude.voice_answer = {"title": "", "status": "open"}
    r = client.post(
        f"{V1}/ai/voice-finding",
        json={"inspection_id": i["id"], "transcript": "Something"},
        headers=h,
    )
    assert r.status_code == 502

    rows = client.get(
        f"{V1}/ai/suggestions", params={"photo_id": photo["id"]}, headers=h
    ).json()
    assert len(rows) == 5
    assert {row["status"] for row in rows} == {"failed"}
    assert all(row["error"] for row in rows)
    # A failed draft cannot be confirmed or dismissed.
    r = client.put(
        f"{V1}/photos/{photo['id']}/tags",
        json={"category": "defect", "ai_suggestion_id": rows[0]["id"]},
        headers=h,
    )
    assert r.status_code == 409
    r = client.post(f"{V1}/ai/suggestions/{rows[0]['id']}/dismiss", headers=h)
    assert r.status_code == 409


def test_no_defects_means_no_severity(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3, claude: FakeClaude
) -> None:
    h, _, _, photo = _setup(client, tenant, fake_s3)
    claude.photo_answer = {
        "category": "progress",
        "defects": [],
        "severity": "high",
        "title": "",
        "description": "",
    }
    s = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=h
    ).json()
    assert s["draft"]["severity"] is None
    assert s["draft"]["defects"] == []


# --- 10B voice-to-finding -------------------------------------------------------------


def test_voice_finding_drafts_and_confirms(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3, claude: FakeClaude
) -> None:
    h, _, i, _ = _setup(client, tenant, fake_s3)
    transcript = "valve v 101 two of eight flange bolts missing pipe rack gridline c4"
    r = client.post(
        f"{V1}/ai/voice-finding",
        json={"inspection_id": i["id"], "transcript": transcript},
        headers=h,
    )
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["kind"] == "voice" and s["status"] == "draft"
    assert s["draft"] == VOICE_ANSWER
    body = claude.bodies()[0]
    assert body["tool_choice"]["name"] == "record_finding_draft"
    assert transcript in body["messages"][0]["content"][0]["text"]
    log = client.get(f"{V1}/ai/suggestions/{s['id']}", headers=h).json()
    assert log["input_text"] == transcript

    # Not saved until the inspector saves it.
    assert (
        client.get(
            f"{V1}/findings", params={"inspection_id": i["id"]}, headers=h
        ).json()
        == []
    )

    r = client.post(
        f"{V1}/findings",
        json={
            "inspection_id": i["id"],
            **VOICE_ANSWER,
            "title": "Missing flange bolts at V-101 (4 of 8)",  # edited
            "ai_suggestion_id": s["id"],
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    finding = r.json()
    assert finding["discipline"] == "pid"
    assert finding["priority"] == "high"
    assert finding["ai_suggestion_id"] == s["id"]
    log = client.get(f"{V1}/ai/suggestions/{s['id']}", headers=h).json()
    assert log["status"] == "confirmed" and log["edited"] is True
    assert log["finding_id"] == finding["id"]
    rows = client.get(
        f"{V1}/ai/suggestions", params={"finding_id": finding["id"]}, headers=h
    ).json()
    assert [row["id"] for row in rows] == [s["id"]]
    # A finding without a draft has an empty log.
    plain = create_finding(client, h, i["id"])
    assert (
        client.get(
            f"{V1}/ai/suggestions", params={"finding_id": plain["id"]}, headers=h
        ).json()
        == []
    )


def test_voice_finding_keeps_the_given_location(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3, claude: FakeClaude
) -> None:
    h, _, i, _ = _setup(client, tenant, fake_s3)
    claude.voice_answer = {**VOICE_ANSWER, "location_ref": None}
    s = client.post(
        f"{V1}/ai/voice-finding",
        json={
            "inspection_id": i["id"],
            "transcript": "bolts missing",
            "location_ref": "Pin #7 — Site plan",
        },
        headers=h,
    ).json()
    assert s["draft"]["location_ref"] == "Pin #7 — Site plan"
    assert (
        "Location already filled in: Pin #7"
        in claude.bodies()[0]["messages"][0]["content"][0]["text"]
    )


def test_voice_finding_validation(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3, claude: FakeClaude
) -> None:
    h, _, i, _ = _setup(client, tenant, fake_s3)
    r = client.post(
        f"{V1}/ai/voice-finding",
        json={"inspection_id": i["id"], "transcript": "   "},
        headers=h,
    )
    assert r.status_code == 422
    r = client.post(
        f"{V1}/ai/voice-finding",
        json={"inspection_id": i["id"], "transcript": "x" * 4001},
        headers=h,
    )
    assert r.status_code == 422
    assert claude.requests == []


@pytest.mark.usefixtures("claude")
def test_dismiss_and_wrong_use_of_drafts(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3
) -> None:
    h, p, i, photo = _setup(client, tenant, fake_s3)
    voice = client.post(
        f"{V1}/ai/voice-finding",
        json={"inspection_id": i["id"], "transcript": "bolts"},
        headers=h,
    ).json()
    # A voice draft cannot file a photo.
    r = client.put(
        f"{V1}/photos/{photo['id']}/tags",
        json={"category": "defect", "ai_suggestion_id": voice["id"]},
        headers=h,
    )
    assert r.status_code == 422
    # A draft from another inspection is invisible.
    other = create_inspection(client, h, p["id"], title="Other walk")
    r = client.post(
        f"{V1}/findings",
        json={
            "inspection_id": other["id"],
            "title": "x",
            "ai_suggestion_id": voice["id"],
        },
        headers=h,
    )
    assert r.status_code == 404
    # A photo draft only confirms its own photo.
    s = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=h
    ).json()
    second = upload_photo(client, h, i["id"], filename="two.jpg")
    r = client.put(
        f"{V1}/photos/{second['id']}/tags",
        json={"category": "defect", "ai_suggestion_id": s["id"]},
        headers=h,
    )
    assert r.status_code == 422

    r = client.post(f"{V1}/ai/suggestions/{voice['id']}/dismiss", headers=h)
    assert r.status_code == 200
    assert r.json()["status"] == "dismissed"
    r = client.post(
        f"{V1}/findings",
        json={"inspection_id": i["id"], "title": "x", "ai_suggestion_id": voice["id"]},
        headers=h,
    )
    assert r.status_code == 409
    r = client.post(f"{V1}/ai/suggestions/{voice['id']}/dismiss", headers=h)
    assert r.status_code == 409
    r = client.get(f"{V1}/ai/suggestions", headers=h)
    assert r.status_code == 422


def test_authorization_hides_and_restricts(
    client: TestClient, tenant: FakeTenant, fake_s3: FakeS3, claude: FakeClaude
) -> None:
    owner_h = headers(tenant, OWNER)
    p = create_project(client, owner_h)
    i = create_inspection(client, owner_h, p["id"])
    photo = upload_photo(client, owner_h, i["id"])
    fake_s3.objects[photo["s3_key"]] = (_jpeg(400, 300), "image/jpeg")
    s = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=owner_h
    ).json()
    invite(client, owner_h, p["id"], VIEWER["email"], role="viewer")

    out_h = headers(tenant, OUTSIDER)
    for method, url, body in (
        ("post", f"{V1}/ai/photo-analysis", {"photo_id": photo["id"]}),
        (
            "post",
            f"{V1}/ai/voice-finding",
            {"inspection_id": i["id"], "transcript": "x"},
        ),
        ("get", f"{V1}/ai/suggestions/{s['id']}", None),
        ("post", f"{V1}/ai/suggestions/{s['id']}/dismiss", None),
        ("put", f"{V1}/photos/{photo['id']}/tags", {"category": "defect"}),
    ):
        r = client.request(method, url, json=body, headers=out_h)
        assert r.status_code == 404, (url, r.text)

    viewer_h = headers(tenant, VIEWER)
    # Viewers can read the log but not ask for or act on drafts.
    assert (
        client.get(f"{V1}/ai/suggestions/{s['id']}", headers=viewer_h).status_code
        == 200
    )
    for method, url, body in (
        ("post", f"{V1}/ai/photo-analysis", {"photo_id": photo["id"]}),
        (
            "post",
            f"{V1}/ai/voice-finding",
            {"inspection_id": i["id"], "transcript": "x"},
        ),
        ("post", f"{V1}/ai/suggestions/{s['id']}/dismiss", None),
        ("put", f"{V1}/photos/{photo['id']}/tags", {"category": "defect"}),
    ):
        r = client.request(method, url, json=body, headers=viewer_h)
        assert r.status_code in (403, 404), (url, r.text)
    assert len(claude.requests) == 1


@pytest.mark.usefixtures("claude")
def test_daily_limit(
    client: TestClient,
    tenant: FakeTenant,
    fake_s3: FakeS3,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "AI_DAILY_LIMIT_PER_USER", 2)
    h, _, i, _ = _setup(client, tenant, fake_s3)
    for _ in range(2):
        r = client.post(
            f"{V1}/ai/voice-finding",
            json={"inspection_id": i["id"], "transcript": "bolts"},
            headers=h,
        )
        assert r.status_code == 201
    r = client.post(
        f"{V1}/ai/voice-finding",
        json={"inspection_id": i["id"], "transcript": "bolts"},
        headers=h,
    )
    assert r.status_code == 429
    assert client.get(f"{V1}/ai/status", headers=h).json()["used_today"] == 2


@pytest.mark.usefixtures("claude")
def test_itp_line_photos_are_not_analysed(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant)
    p = create_project(client, h)
    template = create_template(client, h)
    itp = apply_template(client, h, p["id"], template["id"])
    item_id = itp["items"][0]["id"]
    r = client.post(
        f"{V1}/photos/presign",
        json={
            "itp_item_id": item_id,
            "filename": "a.jpg",
            "content_type": "image/jpeg",
        },
        headers=h,
    )
    key = r.json()["s3_key"]
    r = client.post(
        f"{V1}/photos", json={"itp_item_id": item_id, "s3_key": key}, headers=h
    )
    photo = r.json()
    r = client.post(
        f"{V1}/ai/photo-analysis", json={"photo_id": photo["id"]}, headers=h
    )
    assert r.status_code == 422
    r = client.put(
        f"{V1}/photos/{photo['id']}/tags", json={"category": "defect"}, headers=h
    )
    assert r.status_code == 422


# --- unit: image preparation and the disabled client ----------------------------------


def test_prepare_image_passes_small_known_types_through() -> None:
    # Undecodable by Pillow but a type the model takes: sent as is.
    media, data = prepare_image(b"GIF89a-not-really", "image/gif")
    assert media == "image/gif"
    assert base64.b64decode(data) == b"GIF89a-not-really"


def test_prepare_image_converts_png_with_alpha() -> None:
    out = io.BytesIO()
    Image.new("RGBA", (50, 40), (1, 2, 3, 128)).save(out, format="PNG")
    media, data = prepare_image(out.getvalue(), "image/png")
    assert media == "image/jpeg"
    assert Image.open(io.BytesIO(base64.b64decode(data))).size == (50, 40)


def test_disabled_client_raises() -> None:
    with pytest.raises(AiError) as info:
        ai.structure_transcript("x", {})
    assert info.value.status_code == 503
