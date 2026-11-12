"""AI report drafting and ITP import (increment 16; Block 10C / 10E).

The Claude API is replaced by ``tests/utils/claude.py``. Same guardrails as
10A / 10B: a draft is never saved by itself, every call is logged with its
prompt and model version, confirmation goes through an ordinary save, and
authorization hides what the caller may not see (404).
"""

import io
import json
import zipfile
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlmodel import Session, select

from app.core import ai as ai_core
from app.core.ai import ai
from app.core.config import settings
from app.core.db import engine
from app.core.itp import DEFAULT_ROLES, parse_template_body
from app.core.itp_import import (
    DEFAULT_ROLES as IMPORT_DEFAULT_ROLES,
)
from app.core.itp_import import (
    ImportFileError,
    ItpImportDraft,
    classify_file,
    csv_text,
    draft_to_body,
    xlsx_text,
)
from app.core.reports import ReportContext, render_html
from app.models import AiSuggestion, Finding, Inspection, Project
from tests.utils.auth0 import FakeTenant
from tests.utils.claude import ITP_ANSWER, MODEL_VERSION, REPORT_ANSWER, FakeClaude
from tests.utils.domain import (
    OUTSIDER,
    V1,
    VIEWER,
    create_finding,
    create_inspection,
    create_project,
    headers,
    invite,
)
from tests.utils.s3 import FakeS3

CSV = (
    b"Activity,Check,Type,Criteria,Reference,Record\n"
    b"Pre-pour,Rebar placement checked,H,Cover 2 in,ACI 318,Checklist\n"
    b"Pre-pour,Formwork dimensions,W,,,\n"
)


@pytest.fixture
def db() -> Generator[Session]:
    with Session(engine) as session:
        yield session


@pytest.fixture
def claude(monkeypatch: pytest.MonkeyPatch) -> Generator[FakeClaude]:
    fake = FakeClaude()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key-not-real")
    ai.use_transport(fake.transport)
    yield fake
    ai.use_transport(None)


def _setup(
    client: TestClient, tenant: FakeTenant
) -> tuple[dict[str, str], dict[str, Any], dict[str, Any]]:
    h = headers(tenant)
    # Default client is "PGE", location "Greenwood, SC".
    p = create_project(client, h, name="Secret Client Plant")
    i = create_inspection(client, h, p["id"])
    create_finding(client, h, i["id"], title="Missing flange bolts", priority="high")
    create_finding(client, h, i["id"], title="Loose handrail", status="resolved")
    return h, p, i


def _xlsx(rows: list[list[str]]) -> bytes:
    """A minimal .xlsx: shared strings, one sheet, workbook + rels."""
    strings: list[str] = []
    cells_xml = []
    for r, row in enumerate(rows, start=1):
        cells = []
        for c, value in enumerate(row):
            ref = f"{chr(65 + c)}{r}"
            if value.isdigit():
                cells.append(f'<c r="{ref}"><v>{value}</v></c>')
            else:
                strings.append(value)
                cells.append(f'<c r="{ref}" t="s"><v>{len(strings) - 1}</v></c>')
        cells_xml.append(f'<row r="{r}">{"".join(cells)}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    rel_ns = (
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    )
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(
            "xl/sharedStrings.xml",
            f"<sst {ns}>" + "".join(f"<si><t>{s}</t></si>" for s in strings) + "</sst>",
        )
        z.writestr(
            "xl/workbook.xml",
            f'<workbook {ns} {rel_ns}><sheets><sheet name="ITP" sheetId="1" '
            'r:id="rId1"/></sheets></workbook>',
        )
        z.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
            'relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" '
            'Type="x"/></Relationships>',
        )
        z.writestr(
            "xl/worksheets/sheet1.xml",
            f"<worksheet {ns}><sheetData>{''.join(cells_xml)}</sheetData></worksheet>",
        )
    return out.getvalue()


def _jpeg() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (2400, 1800), (200, 200, 200)).save(out, format="JPEG")
    return out.getvalue()


def _import(
    client: TestClient,
    h: dict[str, str],
    files: list[tuple[str, bytes, str]] | None = None,
    hint: str | None = None,
) -> Any:
    files = files or [("itp.csv", CSV, "text/csv")]
    data = {"hint": hint} if hint is not None else None
    return client.post(
        f"{V1}/ai/itp-import",
        files=[("files", f) for f in files],
        data=data,
        headers=h,
    )


# --- 10C report drafting --------------------------------------------------------------


def test_report_draft_off_without_a_key(client: TestClient, tenant: FakeTenant) -> None:
    h, _, i = _setup(client, tenant)
    r = client.post(f"{V1}/ai/report-draft", json={"inspection_id": i["id"]}, headers=h)
    assert r.status_code == 503


def test_report_draft_is_logged_and_saves_nothing(
    client: TestClient, tenant: FakeTenant, claude: FakeClaude
) -> None:
    h, p, i = _setup(client, tenant)
    r = client.post(f"{V1}/ai/report-draft", json={"inspection_id": i["id"]}, headers=h)
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["kind"] == "report" and s["status"] == "draft"
    assert s["project_id"] == p["id"] and s["inspection_id"] == i["id"]
    assert s["model"] == MODEL_VERSION
    assert s["prompt_version"] == ai_core.REPORT_PROMPT_VERSION
    assert s["draft"]["summary"].count("\n\n") == 2  # paragraphs kept

    body = claude.bodies()[-1]
    assert body["tool_choice"] == {"type": "tool", "name": "record_report_summary"}
    prompt = body["messages"][0]["content"][0]["text"]
    assert "Missing flange bolts" in prompt and "priority high" in prompt
    assert "Findings recorded: 2" in prompt
    # No project or client names, no people.
    assert "Secret Client Plant" not in prompt and "PGE" not in prompt
    assert "Greenwood" not in prompt
    assert "@example.com" not in prompt

    # Nothing written to the report list.
    assert client.get(f"{V1}/reports?inspection_id={i['id']}", headers=h).json() == []
    log = client.get(f"{V1}/ai/suggestions/{s['id']}", headers=h).json()
    assert log["system_prompt"] == ai_core.REPORT_SYSTEM_PROMPT
    assert log["user_prompt"] == prompt


@pytest.mark.usefixtures("claude")
def test_report_draft_allowed_on_a_signed_off_inspection(
    client: TestClient, tenant: FakeTenant, db: Session
) -> None:
    h, _, i = _setup(client, tenant)
    inspection = db.get(Inspection, i["id"])
    assert inspection is not None
    inspection.inspection_status = "closed"
    db.add(inspection)
    db.commit()
    r = client.post(f"{V1}/ai/report-draft", json={"inspection_id": i["id"]}, headers=h)
    assert r.status_code == 201, r.text


def test_report_draft_authorization(
    client: TestClient, tenant: FakeTenant, claude: FakeClaude
) -> None:
    h, p, i = _setup(client, tenant)
    invite(client, h, p["id"], VIEWER["email"], role="viewer")
    r = client.post(
        f"{V1}/ai/report-draft",
        json={"inspection_id": i["id"]},
        headers=headers(tenant, VIEWER),
    )
    assert r.status_code == 403
    r = client.post(
        f"{V1}/ai/report-draft",
        json={"inspection_id": i["id"]},
        headers=headers(tenant, OUTSIDER),
    )
    assert r.status_code == 404
    assert claude.requests == []


def test_report_draft_failure_is_logged(
    client: TestClient, tenant: FakeTenant, claude: FakeClaude, db: Session
) -> None:
    h, _, i = _setup(client, tenant)
    claude.report_answer = {"summary": ""}
    r = client.post(f"{V1}/ai/report-draft", json={"inspection_id": i["id"]}, headers=h)
    assert r.status_code == 502
    assert "write the summary yourself" in r.json()["detail"]
    row = db.exec(select(AiSuggestion).where(AiSuggestion.kind == "report")).one()
    assert row.status == "failed" and row.draft is None


def test_report_draft_caps_findings_dropping_old_resolved_first(
    client: TestClient,
    tenant: FakeTenant,
    claude: FakeClaude,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    h, _, i = _setup(client, tenant)
    create_finding(client, h, i["id"], title="Newest open item")
    monkeypatch.setattr(settings, "AI_REPORT_MAX_FINDINGS", 2)
    r = client.post(f"{V1}/ai/report-draft", json={"inspection_id": i["id"]}, headers=h)
    assert r.status_code == 201
    prompt = claude.bodies()[-1]["messages"][0]["content"][0]["text"]
    assert "Findings recorded: 3" in prompt
    assert "1 of the oldest findings" in prompt
    assert "Loose handrail" not in prompt  # the resolved one went first
    assert "Missing flange bolts" in prompt and "Newest open item" in prompt


@pytest.mark.usefixtures("claude")
def test_confirming_a_report_draft_through_generate(
    client: TestClient, tenant: FakeTenant, db: Session
) -> None:
    h, _, i = _setup(client, tenant)
    s = client.post(
        f"{V1}/ai/report-draft", json={"inspection_id": i["id"]}, headers=h
    ).json()
    r = client.post(
        f"{V1}/reports/generate",
        json={
            "inspection_id": i["id"],
            "summary": s["draft"]["summary"],
            "ai_suggestion_id": s["id"],
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    report = r.json()
    assert report["summary"] == REPORT_ANSWER["summary"]
    assert report["ai_suggestion_id"] == s["id"]
    row = db.get(AiSuggestion, s["id"])
    assert row is not None
    db.refresh(row)
    assert row.status == "confirmed" and row.edited is False

    # The same draft cannot back a second report.
    r = client.post(
        f"{V1}/reports/generate",
        json={"inspection_id": i["id"], "summary": "x", "ai_suggestion_id": s["id"]},
        headers=h,
    )
    assert r.status_code == 409


@pytest.mark.usefixtures("claude")
def test_edited_report_draft_is_marked_edited(
    client: TestClient, tenant: FakeTenant, db: Session
) -> None:
    h, _, i = _setup(client, tenant)
    s = client.post(
        f"{V1}/ai/report-draft", json={"inspection_id": i["id"]}, headers=h
    ).json()
    r = client.post(
        f"{V1}/reports/generate",
        json={
            "inspection_id": i["id"],
            "summary": "My own words.\r\n\r\n\r\nSecond paragraph.  ",
            "ai_suggestion_id": s["id"],
        },
        headers=h,
    )
    assert r.status_code == 201
    assert r.json()["summary"] == "My own words.\n\nSecond paragraph."
    row = db.get(AiSuggestion, s["id"])
    assert row is not None
    db.refresh(row)
    assert row.status == "confirmed" and row.edited is True


@pytest.mark.usefixtures("claude")
def test_generate_refuses_bad_drafts(client: TestClient, tenant: FakeTenant) -> None:
    h, p, i = _setup(client, tenant)
    s = client.post(
        f"{V1}/ai/report-draft", json={"inspection_id": i["id"]}, headers=h
    ).json()
    # The summary text must come with the draft.
    r = client.post(
        f"{V1}/reports/generate",
        json={"inspection_id": i["id"], "ai_suggestion_id": s["id"]},
        headers=h,
    )
    assert r.status_code == 422
    # Another inspection's draft is hidden.
    other = create_inspection(client, h, p["id"], title="Other walk")
    r = client.post(
        f"{V1}/reports/generate",
        json={
            "inspection_id": other["id"],
            "summary": "x",
            "ai_suggestion_id": s["id"],
        },
        headers=h,
    )
    assert r.status_code == 404
    # A viewer may generate reports but not confirm an AI draft.
    invite(client, h, p["id"], VIEWER["email"], role="viewer")
    r = client.post(
        f"{V1}/reports/generate",
        json={"inspection_id": i["id"], "summary": "x", "ai_suggestion_id": s["id"]},
        headers=headers(tenant, VIEWER),
    )
    assert r.status_code == 403
    # A photo / voice draft is not a report draft.
    v = client.post(
        f"{V1}/ai/voice-finding",
        json={"inspection_id": i["id"], "transcript": "Bolts missing at V-101"},
        headers=h,
    ).json()
    r = client.post(
        f"{V1}/reports/generate",
        json={"inspection_id": i["id"], "summary": "x", "ai_suggestion_id": v["id"]},
        headers=h,
    )
    assert r.status_code == 422
    # A dismissed draft is refused.
    client.post(f"{V1}/ai/suggestions/{s['id']}/dismiss", headers=h)
    r = client.post(
        f"{V1}/reports/generate",
        json={"inspection_id": i["id"], "summary": "x", "ai_suggestion_id": s["id"]},
        headers=h,
    )
    assert r.status_code == 409


def test_summary_without_ai_and_blank_summary(
    client: TestClient, tenant: FakeTenant
) -> None:
    h, _, i = _setup(client, tenant)
    r = client.post(
        f"{V1}/reports/generate",
        json={"inspection_id": i["id"], "summary": "Walkdown done.\nAll good."},
        headers=h,
    )
    assert r.status_code == 201
    assert r.json()["summary"] == "Walkdown done.\n\nAll good."
    assert r.json()["ai_suggestion_id"] is None
    r = client.post(
        f"{V1}/reports/generate",
        json={"inspection_id": i["id"], "summary": "  \n "},
        headers=h,
    )
    assert r.json()["summary"] is None
    # Plain {inspection_id} still works (legacy contract).
    r = client.post(
        f"{V1}/reports/generate", json={"inspection_id": i["id"]}, headers=h
    )
    assert r.status_code == 201 and r.json()["summary"] is None


def test_report_html_prints_the_summary_and_provenance(
    client: TestClient, tenant: FakeTenant, db: Session
) -> None:
    _, p, i = _setup(client, tenant)
    project = db.get(Project, p["id"])
    inspection = db.get(Inspection, i["id"])
    assert project is not None and inspection is not None
    findings = list(db.exec(select(Finding).where(Finding.inspection_id == i["id"])))
    common: dict[str, Any] = {
        "project": project,
        "inspection": inspection,
        "findings": findings,
        "photos": [],
        "version": 1,
        "generated_by": "owner@example.com",
        "generated_at": inspection.created_at,
    }
    html = render_html(
        ReportContext(
            **common, narrative="First <b>para</b>.\n\nSecond.", narrative_ai=True
        )
    )
    assert "<p>First &lt;b&gt;para&lt;/b&gt;.</p>" in html  # escaped
    assert "<p>Second.</p>" in html
    assert "drafted with AI assistance" in html
    assert "reviewed and approved by owner@example.com" in html
    html = render_html(ReportContext(**common, narrative="Mine.", narrative_ai=False))
    assert "<p>Mine.</p>" in html and "AI assistance" not in html
    html = render_html(ReportContext(**common))
    assert "report-narrative" not in html


# --- 10E ITP import -----------------------------------------------------------------


def test_itp_import_off_without_a_key(client: TestClient, tenant: FakeTenant) -> None:
    r = _import(client, headers(tenant))
    assert r.status_code == 503


def test_itp_import_from_csv_returns_a_tidied_draft(
    client: TestClient,
    tenant: FakeTenant,
    claude: FakeClaude,
    fake_s3: FakeS3,
    db: Session,
) -> None:
    h = headers(tenant)
    r = _import(client, h, hint="  Slabs only  ")
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["kind"] == "itp_import" and s["status"] == "draft"
    assert s["project_id"] is None and s["inspection_id"] is None
    assert s["prompt_version"] == ai_core.ITP_IMPORT_PROMPT_VERSION
    assert s["source_files"] == [
        {"name": "itp.csv", "content_type": "text/csv", "size": len(CSV)}
    ]
    draft = s["draft"]
    # Empty section dropped; letters normalised; unknown role added.
    assert [sec["title"] for sec in draft["sections"]] == ["Pre-pour", "Placement"]
    placement = draft["sections"][1]["lines"]
    assert [ln["classification"] for ln in placement] == ["W", "I"]
    assert [r["name"] for r in draft["roles"]] == [
        "Contractor",
        "Engineer of record",
        "Site engineer",
    ]
    assert draft["notes"] == ITP_ANSWER["notes"]

    body = claude.bodies()[-1]
    assert body["tool_choice"]["name"] == "record_itp_draft"
    assert body["max_tokens"] >= 8000
    text = body["messages"][0]["content"][-1]["text"]
    assert "Rebar placement checked | H | Cover 2 in" in text
    assert "<note>Slabs only</note>" in text

    # The original is kept in S3, keyed by the draft.
    row = db.get(AiSuggestion, s["id"])
    assert row is not None and row.source_files is not None
    key = row.source_files[0]["s3_key"]
    assert key == f"imports/itp/{row.public_id}/1-itp.csv"
    assert fake_s3.objects[key] == (CSV, "text/csv")
    assert row.input_text == "Slabs only"


def test_itp_import_sends_pdf_and_photos_as_attachments(
    client: TestClient, tenant: FakeTenant, claude: FakeClaude
) -> None:
    pdf = b"%PDF-1.4\n% fake\n"
    r = _import(
        client,
        headers(tenant),
        files=[
            ("itp.pdf", pdf, "application/pdf"),
            ("page2.jpg", _jpeg(), "image/jpeg"),
        ],
    )
    assert r.status_code == 201, r.text
    content = claude.bodies()[-1]["messages"][0]["content"]
    assert content[0]["type"] == "document"
    assert content[0]["source"]["media_type"] == "application/pdf"
    assert content[1]["type"] == "image"
    assert content[1]["source"]["media_type"] == "image/jpeg"
    assert "Attached pdf: itp.pdf" in content[2]["text"]


def test_itp_import_reads_xlsx_cell_text(
    client: TestClient, tenant: FakeTenant, claude: FakeClaude
) -> None:
    workbook = _xlsx([["Step", "Check", "Code"], ["1", "Anchor bolts surveyed", "H"]])
    r = _import(
        client,
        headers(tenant),
        files=[
            (
                "itp.xlsx",
                workbook,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        ],
    )
    assert r.status_code == 201, r.text
    text = claude.bodies()[-1]["messages"][0]["content"][-1]["text"]
    assert "## Sheet: ITP" in text
    assert "1 | Anchor bolts surveyed | H" in text


@pytest.mark.parametrize(
    ("files", "status", "detail"),
    [
        ([("notes.docx", b"PK..", "application/msword")], 422, "isn't a file we can"),
        ([("empty.csv", b"", "text/csv")], 422, "is empty"),
        ([("fake.pdf", b"hello", "application/pdf")], 422, "readable PDF"),
        ([("old.xlsx", b"not a zip", "")], 422, "readable .xlsx"),
        (
            [("a.pdf", b"%PDF-1", "application/pdf")] * 3,
            422,
            "one ITP at a time",
        ),
    ],
)
def test_itp_import_refuses_unreadable_files(
    client: TestClient,
    tenant: FakeTenant,
    claude: FakeClaude,
    files: list[tuple[str, bytes, str]],
    status: int,
    detail: str,
) -> None:
    r = _import(client, headers(tenant), files=files)
    assert r.status_code == status
    assert detail in r.json()["detail"]
    assert claude.requests == []


def test_itp_import_size_and_count_limits(
    client: TestClient,
    tenant: FakeTenant,
    claude: FakeClaude,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    h = headers(tenant)
    monkeypatch.setattr(settings, "AI_IMPORT_MAX_FILES", 2)
    r = _import(client, h, files=[("a.csv", CSV, "text/csv")] * 3)
    assert r.status_code == 422 and "at most 2 files" in r.json()["detail"]
    monkeypatch.setattr(settings, "AI_IMPORT_MAX_BYTES", 50)
    r = _import(client, h)
    assert r.status_code == 413
    assert claude.requests == []


def test_itp_import_with_no_lines_fails_and_is_logged(
    client: TestClient, tenant: FakeTenant, claude: FakeClaude, db: Session
) -> None:
    claude.itp_answer = {"name": "x", "roles": [], "sections": [], "notes": []}
    r = _import(client, headers(tenant))
    assert r.status_code == 422
    assert "No inspection lines" in r.json()["detail"]
    row = db.exec(select(AiSuggestion).where(AiSuggestion.kind == "itp_import")).one()
    assert row.status == "failed" and row.source_files


def test_itp_import_unreadable_answer(
    client: TestClient, tenant: FakeTenant, claude: FakeClaude
) -> None:
    claude.itp_answer = {"sections": "nope"}
    r = _import(client, headers(tenant))
    assert r.status_code == 502


@pytest.mark.usefixtures("claude")
def test_import_draft_is_private_to_its_requester(
    client: TestClient, tenant: FakeTenant
) -> None:
    s = _import(client, headers(tenant)).json()
    other = headers(tenant, OUTSIDER)
    assert (
        client.get(f"{V1}/ai/suggestions/{s['id']}", headers=other).status_code == 404
    )
    r = client.post(f"{V1}/ai/suggestions/{s['id']}/dismiss", headers=other)
    assert r.status_code == 404
    r = client.post(
        f"{V1}/ai/itp-import/{s['id']}/save",
        json={"name": "Mine", "draft": s["draft"]},
        headers=other,
    )
    assert r.status_code == 404
    log = client.get(f"{V1}/ai/suggestions/{s['id']}", headers=headers(tenant))
    assert log.status_code == 200
    assert log.json()["system_prompt"] == ai_core.ITP_IMPORT_SYSTEM_PROMPT


@pytest.mark.usefixtures("claude")
def test_saving_an_import_makes_a_master_template(
    client: TestClient, tenant: FakeTenant, db: Session
) -> None:
    h = headers(tenant)
    s = _import(client, h).json()
    r = client.post(
        f"{V1}/ai/itp-import/{s['id']}/save",
        json={
            "name": s["draft"]["name"],
            "description": "Imported",
            "draft": s["draft"],
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["status"] == "draft" and t["version"] == 1
    assert t["item_count"] == 4 and t["hold_count"] == 1
    assert set(t["role_names"]) == {"Contractor", "Engineer of record", "Site engineer"}
    parsed = parse_template_body(t["body"])
    rebar = parsed.items[0]
    assert rebar.section == "Pre-pour"
    assert rebar.classification == "hold"
    assert rebar.photo_required is True
    assert rebar.acceptance_criteria == "Per drawing S-201, cover 2 in."
    assert rebar.roles == ("Engineer of record",)
    slump = parsed.items[2]
    assert slump.value_type == "number" and slump.unit == "in"
    assert parsed.items[3].classification == "information"

    row = db.get(AiSuggestion, s["id"])
    assert row is not None
    db.refresh(row)
    assert row.status == "confirmed" and row.edited is False
    assert row.template_id == t["id"]

    # The template's import log.
    logs = client.get(f"{V1}/ai/suggestions?template_id={t['id']}", headers=h).json()
    assert [x["id"] for x in logs] == [s["id"]]
    other = headers(tenant, OUTSIDER)
    r = client.get(f"{V1}/ai/suggestions?template_id={t['id']}", headers=other)
    assert r.status_code == 404
    # The template shows up in the master list and can be saved only once.
    names = [x["name"] for x in client.get(f"{V1}/itp-templates", headers=h).json()]
    assert ITP_ANSWER["name"] in names
    r = client.post(
        f"{V1}/ai/itp-import/{s['id']}/save",
        json={"name": "Again", "draft": s["draft"]},
        headers=h,
    )
    assert r.status_code == 409


@pytest.mark.usefixtures("claude")
def test_saving_an_edited_import(
    client: TestClient, tenant: FakeTenant, db: Session
) -> None:
    h = headers(tenant)
    s = _import(client, h).json()
    draft = s["draft"]
    draft["sections"][0]["lines"][1]["classification"] = "H"
    draft["sections"][1]["lines"].append(
        {"title": "Cylinders cast", "classification": "W"}
    )
    r = client.post(
        f"{V1}/ai/itp-import/{s['id']}/save",
        json={"name": "Slab ITP", "draft": draft},
        headers=h,
    )
    assert r.status_code == 201, r.text
    assert r.json()["item_count"] == 5 and r.json()["hold_count"] == 2
    row = db.get(AiSuggestion, s["id"])
    assert row is not None
    db.refresh(row)
    assert row.edited is True


@pytest.mark.usefixtures("claude")
def test_saving_an_import_refuses_empty_or_wrong_drafts(
    client: TestClient, tenant: FakeTenant
) -> None:
    h, _, i = _setup(client, tenant)
    s = _import(client, h).json()
    empty = {**s["draft"], "sections": [{"title": "A", "lines": []}]}
    r = client.post(
        f"{V1}/ai/itp-import/{s['id']}/save",
        json={"name": "Empty", "draft": empty},
        headers=h,
    )
    assert r.status_code == 422 and r.json()["detail"] == "Keep at least one line"
    report = client.post(
        f"{V1}/ai/report-draft", json={"inspection_id": i["id"]}, headers=h
    ).json()
    r = client.post(
        f"{V1}/ai/itp-import/{report['id']}/save",
        json={"name": "Wrong", "draft": s["draft"]},
        headers=h,
    )
    assert r.status_code == 422
    client.post(f"{V1}/ai/suggestions/{s['id']}/dismiss", headers=h)
    r = client.post(
        f"{V1}/ai/itp-import/{s['id']}/save",
        json={"name": "Late", "draft": s["draft"]},
        headers=h,
    )
    assert r.status_code == 409


def test_list_suggestions_needs_exactly_one_filter(
    client: TestClient, tenant: FakeTenant
) -> None:
    h = headers(tenant)
    assert client.get(f"{V1}/ai/suggestions", headers=h).status_code == 422
    r = client.get(f"{V1}/ai/suggestions?template_id=1&photo_id=1", headers=h)
    assert r.status_code == 422
    r = client.get(f"{V1}/ai/suggestions?template_id=999999", headers=h)
    assert r.status_code == 404


# --- the import helpers ------------------------------------------------------------------


def test_default_roles_stay_in_step() -> None:
    assert IMPORT_DEFAULT_ROLES == DEFAULT_ROLES


def test_draft_tidy_and_body() -> None:
    draft = ItpImportDraft.model_validate(
        {
            "name": "  Pipe   test ",
            "roles": [],
            "sections": [
                {
                    "title": "",
                    "lines": [
                        {"title": "Test pressure held", "classification": "hold point"},
                        {"title": "Test pressure held", "classification": "witness"},
                        {
                            "title": "Gauge serial",
                            "classification": "?",
                            "value_type": "text",
                            "unit": "x",
                        },
                    ],
                }
            ],
            "notes": ["  a  ", "", 3],
        }
    ).tidy()
    assert draft.name == "Pipe test"
    assert [r.name for r in draft.roles] == [n for n, _ in DEFAULT_ROLES]
    assert [ln.classification for ln in draft.sections[0].lines] == ["H", "W", "I"]
    assert draft.notes[:2] == ["a", "3"]
    assert draft.notes[2] == (
        "1 hold point named no signer; set to Owner's representative — check."
    )
    assert draft.sections[0].lines[0].roles == ["Owner's representative"]
    body = draft_to_body(draft, name="Pipe test")
    names = [e["name"] for e in body["pages"][0]["elements"]]
    assert names == ["test-pressure-held", "test-pressure-held-2", "gauge-serial"]
    assert body["pages"][0]["title"] == "Section 1"
    assert body["pages"][0]["elements"][2] == {
        "type": "text",
        "name": "gauge-serial",
        "title": "Gauge serial",
        "classification": "information",
        "unit": "x",
    }
    parsed = parse_template_body(body)
    assert len(parsed.items) == 3 and parsed.items[2].value_type == "text"


def test_file_helpers() -> None:
    assert classify_file("a/b\\scan.HEIC", None, b"x").kind == "image"
    assert classify_file("noext", "application/pdf", b"%PDF").kind == "pdf"
    assert classify_file("noext", "text/csv", b"a,b").kind == "csv"
    assert classify_file("noext", "image/png", b"x").kind == "image"
    xlsx = classify_file(
        "noext",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _xlsx([["a"]]),
    )
    assert xlsx.kind == "xlsx"
    with pytest.raises(ImportFileError):
        classify_file("noext", "application/zip", b"x")
    assert csv_text("a;b;c\n\n1;2;3\n".encode("cp1252")) == "a | b | c\n1 | 2 | 3"
    assert csv_text("Größe,é\n".encode("cp1252")) == "Größe | é"
    assert csv_text(b"single") == "single"
    with pytest.raises(ImportFileError):
        xlsx_text(_xlsx([]))
    with pytest.raises(ImportFileError):
        xlsx_text(b"nope")
    # A workbook without workbook.xml falls back to its sheet files.
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(
            "xl/worksheets/sheet1.xml",
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/'
            'main"><sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>Hi</t></is>'
            '</c><c r="C1"><v>4.5</v></c></row></sheetData></worksheet>',
        )
    assert xlsx_text(out.getvalue()) == "## Sheet: sheet1\n | Hi | 4.5"


def test_import_user_prompt_lists_attachments() -> None:
    files = [classify_file("x.pdf", "application/pdf", b"%PDF-1")]
    text = ai_core.itp_import_user_prompt(files, None)
    assert "Attached pdf: x.pdf" in text and "<note>" not in text
    assert json.dumps(ai_core.ITP_IMPORT_TOOL)  # serialisable
