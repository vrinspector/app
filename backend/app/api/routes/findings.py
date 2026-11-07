"""Findings (Block 2) and the defect repair workflow (Block 8A), ported to SQLModel.

Legacy contract (deployed SPA, July 2026):

    GET   /findings?inspection_id=N   → list
    POST  /findings                   → 201 finding
    GET   /findings/{id}              → finding
    PUT   /findings/{id}              → finding
    DELETE /findings/{id}             → 204
    PATCH /findings/{id}/status       → finding   body {status}
    PATCH /findings/{id}/resolve      → finding   body {resolution_notes}

Status vocabulary: ``open`` → ``in-progress`` → ``resolved`` (and back via
``status``). Resolving records who/when; leaving ``resolved`` clears them.
All writes are refused with 409 while the inspection is signed off (Block 8B).
"""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import col, select

from app.api.authz import (
    WRITE_ROLES,
    current_email,
    ensure_inspection_open,
    get_authorized_finding,
    get_authorized_inspection,
)
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    Finding,
    FindingCreate,
    FindingPublic,
    FindingResolve,
    FindingStatusUpdate,
    FindingUpdate,
)

router = APIRouter(prefix="/findings", tags=["findings"])


@router.get("", response_model=list[FindingPublic])
def list_findings(
    session: SessionDep,
    current_user: CurrentUser,
    inspection_id: int = Query(...),
) -> Any:
    get_authorized_inspection(session, inspection_id, current_user)
    stmt = (
        select(Finding)
        .where(Finding.inspection_id == inspection_id)
        .order_by(col(Finding.created_at).desc(), col(Finding.id).desc())
    )
    return list(session.exec(stmt).all())


@router.post("", response_model=FindingPublic, status_code=status.HTTP_201_CREATED)
def create_finding(
    payload: FindingCreate, session: SessionDep, current_user: CurrentUser
) -> Any:
    inspection = get_authorized_inspection(
        session, payload.inspection_id, current_user, roles=WRITE_ROLES
    )
    ensure_inspection_open(inspection)
    finding = Finding(
        inspection_id=payload.inspection_id,
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        location_ref=payload.location_ref,
        status=payload.status,
    )
    if payload.status == "resolved":
        _mark_resolved(finding, current_user_email=current_email(current_user))
    session.add(finding)
    session.commit()
    session.refresh(finding)
    return finding


@router.get("/{finding_id}", response_model=FindingPublic)
def read_finding(
    finding_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    finding, _ = get_authorized_finding(session, finding_id, current_user)
    return finding


@router.put("/{finding_id}", response_model=FindingPublic)
def update_finding(
    finding_id: int,
    payload: FindingUpdate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    finding, inspection = get_authorized_finding(
        session, finding_id, current_user, roles=WRITE_ROLES
    )
    ensure_inspection_open(inspection)
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update"
        )
    finding.sqlmodel_update(updates)
    session.add(finding)
    session.commit()
    session.refresh(finding)
    return finding


@router.delete("/{finding_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_finding(
    finding_id: int, session: SessionDep, current_user: CurrentUser
) -> None:
    finding, inspection = get_authorized_finding(
        session, finding_id, current_user, roles=WRITE_ROLES
    )
    ensure_inspection_open(inspection)
    session.delete(finding)  # pins referencing it go to finding_id = NULL
    session.commit()


def _mark_resolved(
    finding: Finding, *, current_user_email: str, notes: str | None = None
) -> None:
    finding.status = "resolved"
    finding.resolved_by = current_user_email
    finding.resolved_at = datetime.now(UTC)
    if notes is not None:
        finding.resolution_notes = notes


def _clear_resolution(finding: Finding) -> None:
    finding.resolved_by = None
    finding.resolved_at = None


@router.patch("/{finding_id}/status", response_model=FindingPublic)
def set_finding_status(
    finding_id: int,
    payload: FindingStatusUpdate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    """Block 8A: move a finding between open / in-progress / resolved."""
    finding, inspection = get_authorized_finding(
        session, finding_id, current_user, roles=WRITE_ROLES
    )
    ensure_inspection_open(inspection)
    if payload.status == "resolved":
        _mark_resolved(finding, current_user_email=current_email(current_user))
    else:
        finding.status = payload.status
        _clear_resolution(finding)
    session.add(finding)
    session.commit()
    session.refresh(finding)
    return finding


@router.patch("/{finding_id}/resolve", response_model=FindingPublic)
def resolve_finding(
    finding_id: int,
    payload: FindingResolve,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    """Block 8A: resolve with optional notes; records who and when."""
    finding, inspection = get_authorized_finding(
        session, finding_id, current_user, roles=WRITE_ROLES
    )
    ensure_inspection_open(inspection)
    _mark_resolved(
        finding,
        current_user_email=current_email(current_user),
        notes=payload.resolution_notes,
    )
    if payload.resolution_notes is None:
        finding.resolution_notes = None
    session.add(finding)
    session.commit()
    session.refresh(finding)
    return finding
