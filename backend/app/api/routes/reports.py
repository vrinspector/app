"""Inspection reports (Block 4): PDF generation to S3, ported for increment 10.

Legacy contract (deployed SPA, July 2026):

    POST /reports/generate   body {inspection_id} → {download_url, ...}

The SPA opened ``download_url`` in a new tab. The legacy route's source did
not survive, so the document itself is rebuilt (``app/core/reports.py``); the
request body and the ``download_url`` field are kept so the screen talks to
the same contract. Rebuild additions (ADR-009 "versions kept in S3"):

    GET  /reports?inspection_id=N → every version, newest first, each with
                                    a presigned ``download_url``
    GET  /reports/{id}            → one version

Every generation writes a new PDF under
``reports/inspections/{inspection_id}/v{n}-{uuid}.pdf`` and records it as
version *n*; nothing is overwritten. Generation is synchronous (the legacy
behaviour; a report takes a second or two). Regenerate-on-change as a
background task is scheduled with the ITP pack in increment 14.

Authorization follows the other routers: any member of the project can
generate and read reports (a report is a read-out of the record); non-members
get 404 ``Inspection not found`` / ``Report not found``.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Query, status
from sqlalchemy import func
from sqlmodel import col, select

from app.api.authz import (
    current_email,
    get_authorized_inspection,
    not_found,
    require_project_member,
)
from app.api.deps import CurrentUser, SessionDep
from app.core.reports import ReportContext, render_pdf
from app.core.storage import storage
from app.models import (
    Finding,
    Inspection,
    InspectionReport,
    Photo,
    Project,
    ReportGenerateRequest,
    ReportPublic,
)

router = APIRouter(prefix="/reports", tags=["reports"])


def _public(report: InspectionReport) -> ReportPublic:
    data = report.model_dump()
    data["download_url"] = storage.presign_get(report.s3_key)
    return ReportPublic.model_validate(data)


def _safe_filename(inspection: Inspection, version: int) -> str:
    stem = "".join(
        ch if ch.isalnum() or ch in "-_ " else "" for ch in inspection.title
    ).strip()
    stem = "-".join(stem.split())[:60] or f"inspection-{inspection.id}"
    return f"{stem}-report-v{version}.pdf"


@router.post(
    "/generate", response_model=ReportPublic, status_code=status.HTTP_201_CREATED
)
def generate_report(
    payload: ReportGenerateRequest, session: SessionDep, current_user: CurrentUser
) -> Any:
    inspection = get_authorized_inspection(session, payload.inspection_id, current_user)
    project = session.get(Project, inspection.project_id)
    assert project is not None and inspection.id is not None

    findings = list(
        session.exec(
            select(Finding)
            .where(Finding.inspection_id == inspection.id)
            .order_by(col(Finding.created_at), col(Finding.id))
        ).all()
    )
    photos = list(
        session.exec(
            select(Photo)
            .where(Photo.inspection_id == inspection.id)
            .order_by(col(Photo.created_at), col(Photo.id))
        ).all()
    )
    last_version = session.exec(
        select(func.max(InspectionReport.version)).where(
            InspectionReport.inspection_id == inspection.id
        )
    ).one()
    version = int(last_version or 0) + 1
    generated_by = current_email(current_user)
    generated_at = datetime.now(UTC)

    pdf = render_pdf(
        ReportContext(
            project=project,
            inspection=inspection,
            findings=findings,
            photos=photos,
            version=version,
            generated_by=generated_by,
            generated_at=generated_at,
        )
    )

    key = f"{storage.report_prefix(inspection.id)}v{version}-{uuid.uuid4().hex}.pdf"
    storage.put_object(key, pdf, "application/pdf")

    report = InspectionReport(
        inspection_id=inspection.id,
        version=version,
        s3_key=key,
        filename=_safe_filename(inspection, version),
        file_size=len(pdf),
        finding_count=len(findings),
        photo_count=len(photos),
        generated_by=generated_by,
    )
    session.add(report)
    session.commit()
    session.refresh(report)
    return _public(report)


@router.get("", response_model=list[ReportPublic])
def list_reports(
    session: SessionDep,
    current_user: CurrentUser,
    inspection_id: int = Query(...),
) -> Any:
    get_authorized_inspection(session, inspection_id, current_user)
    stmt = (
        select(InspectionReport)
        .where(InspectionReport.inspection_id == inspection_id)
        .order_by(col(InspectionReport.version).desc())
    )
    return [_public(r) for r in session.exec(stmt).all()]


@router.get("/{report_id}", response_model=ReportPublic)
def read_report(report_id: int, session: SessionDep, current_user: CurrentUser) -> Any:
    report = session.get(InspectionReport, report_id)
    if report is None:
        raise not_found("Report not found")
    inspection = session.get(Inspection, report.inspection_id)
    if inspection is None:  # pragma: no cover - FK guarantees the parent
        raise not_found("Report not found")
    require_project_member(
        session, inspection.project_id, current_user, detail="Report not found"
    )
    return _public(report)
