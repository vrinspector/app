"""Inspections (Block 1/2) and sign-off (Block 8B), ported to SQLModel.

Legacy contract (deployed SPA, July 2026):

    GET   /inspections?project_id=N     → list (each row also carries ``type``)
    POST  /inspections                  → 201 inspection
    GET   /inspections/{id}             → inspection
    PUT   /inspections/{id}             → inspection
    DELETE /inspections/{id}            → 204
    PATCH /inspections/{id}/signoff     → inspection (``inspection_status`` = closed)
    PATCH /inspections/{id}/reopen      → inspection (``inspection_status`` = open)

Sign-off locks the inspection's findings (see ``authz.ensure_inspection_open``).
"""

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import col, select

from app.api.authz import (
    WRITE_ROLES,
    current_email,
    get_authorized_inspection,
    require_project_member,
)
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    Inspection,
    InspectionCreate,
    InspectionPublic,
    InspectionUpdate,
)

router = APIRouter(prefix="/inspections", tags=["inspections"])


def _public(inspection: Inspection) -> InspectionPublic:
    return InspectionPublic.from_inspection(inspection)


@router.get("", response_model=list[InspectionPublic])
def list_inspections(
    session: SessionDep,
    current_user: CurrentUser,
    project_id: int = Query(...),
) -> Any:
    require_project_member(session, project_id, current_user)
    stmt = (
        select(Inspection)
        .where(Inspection.project_id == project_id)
        .order_by(col(Inspection.created_at).desc(), col(Inspection.id).desc())
    )
    return [_public(i) for i in session.exec(stmt).all()]


@router.post("", response_model=InspectionPublic, status_code=status.HTTP_201_CREATED)
def create_inspection(
    payload: InspectionCreate, session: SessionDep, current_user: CurrentUser
) -> Any:
    require_project_member(session, payload.project_id, current_user, roles=WRITE_ROLES)
    inspection = Inspection(
        project_id=payload.project_id,
        title=payload.title,
        inspection_type=payload.inspection_type,
        inspector=payload.inspector,
        notes=payload.notes,
        status=payload.status,
    )
    session.add(inspection)
    session.commit()
    session.refresh(inspection)
    return _public(inspection)


@router.get("/{inspection_id}", response_model=InspectionPublic)
def read_inspection(
    inspection_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    return _public(get_authorized_inspection(session, inspection_id, current_user))


@router.put("/{inspection_id}", response_model=InspectionPublic)
def update_inspection(
    inspection_id: int,
    payload: InspectionUpdate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    inspection = get_authorized_inspection(
        session, inspection_id, current_user, roles=WRITE_ROLES
    )
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update"
        )
    inspection.sqlmodel_update(updates)
    session.add(inspection)
    session.commit()
    session.refresh(inspection)
    return _public(inspection)


@router.delete("/{inspection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inspection(
    inspection_id: int, session: SessionDep, current_user: CurrentUser
) -> None:
    inspection = get_authorized_inspection(
        session, inspection_id, current_user, roles=WRITE_ROLES
    )
    session.delete(inspection)
    session.commit()


@router.patch("/{inspection_id}/signoff", response_model=InspectionPublic)
def signoff_inspection(
    inspection_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    """Block 8B: close the inspection and lock its findings."""
    inspection = get_authorized_inspection(
        session, inspection_id, current_user, roles=WRITE_ROLES
    )
    inspection.inspection_status = "closed"
    inspection.status = "closed"
    inspection.signed_off_by = current_email(current_user)
    inspection.signed_off_at = datetime.now(UTC)
    session.add(inspection)
    session.commit()
    session.refresh(inspection)
    return _public(inspection)


@router.patch("/{inspection_id}/reopen", response_model=InspectionPublic)
def reopen_inspection(
    inspection_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    inspection = get_authorized_inspection(
        session, inspection_id, current_user, roles=WRITE_ROLES
    )
    inspection.inspection_status = "open"
    inspection.status = "open"
    inspection.signed_off_by = None
    inspection.signed_off_at = None
    session.add(inspection)
    session.commit()
    session.refresh(inspection)
    return _public(inspection)
