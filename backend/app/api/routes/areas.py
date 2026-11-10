"""Project areas — levels, lots, stages, chainages (increment 13).

Owner decision 2026-11-08: one template applied across a project's areas,
each area with its own frozen ITP copy and (increment 14) one combined pack.

    GET    /projects/{id}/areas            → areas in order, each with an ITP roll-up
    POST   /projects/{id}/areas            → 201 area (appended)
    POST   /projects/{id}/areas/bulk       → 201 a numbered series ("Level 1"–"Level 12")
    PUT    /projects/{id}/areas/order      → areas in the new order
    GET    /areas/{id}                     → area with roll-up
    PUT    /areas/{id}                     → rename / retype / re-parent
    DELETE /areas/{id}                     → 204; 409 when any of its ITPs is signed

Reads are open to every member; changes need owner or inspector. A parent
area must be in the same project and may not create a cycle. Deleting an
area keeps its unsigned ITPs as whole-project ITPs and moves its child areas
to the top level (database ``SET NULL``, owner decision 37); a signed ITP stops
the delete (database guard ``vri_guard_area_delete``).
"""

from typing import Any

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.api.authz import (
    WRITE_ROLES,
    current_email,
    ensure_area_in_project,
    get_authorized_area,
    get_authorized_project,
)
from app.api.deps import CurrentUser, SessionDep
from app.api.itp_state import load_itp_states, states_by_area
from app.models import (
    AreaBulkCreate,
    AreaCreate,
    AreaOrder,
    AreaPublic,
    AreaUpdate,
    ProjectArea,
    ProjectItp,
)

router = APIRouter(tags=["areas"])

MAX_BULK = 200


def _publics(db: Session, areas: list[ProjectArea]) -> list[AreaPublic]:
    ids = [a.id for a in areas]
    itps = (
        db.exec(select(ProjectItp).where(col(ProjectItp.area_id).in_(ids))).all()
        if ids
        else []
    )
    grouped = states_by_area(load_itp_states(db, itps))
    result = []
    for area in areas:
        assert area.id is not None
        states = grouped.get(area.id, [])
        result.append(
            AreaPublic.model_validate(
                area,
                update={
                    "itp_count": len(states),
                    "complete_count": sum(
                        1 for s in states if s.itp.status == "complete"
                    ),
                    "item_count": sum(len(s.items) for s in states),
                    "done_count": sum(s.done_count for s in states),
                    "open_hold_count": sum(len(s.open_holds) for s in states),
                    "signed": any(s.signature_count for s in states),
                },
            )
        )
    return result


def _ordered(db: Session, project_id: int) -> list[ProjectArea]:
    return list(
        db.exec(
            select(ProjectArea)
            .where(ProjectArea.project_id == project_id)
            .order_by(col(ProjectArea.sort_order), col(ProjectArea.id))
        ).all()
    )


def _next_sort(db: Session, project_id: int) -> int:
    top = db.exec(
        select(func.max(ProjectArea.sort_order)).where(
            ProjectArea.project_id == project_id
        )
    ).one()
    return (top or 0) + 10


def _check_parent(
    db: Session, project_id: int, parent_id: int | None, area_id: int | None = None
) -> None:
    if parent_id is None:
        return
    parent: ProjectArea | None = ensure_area_in_project(db, parent_id, project_id)
    seen: set[int] = set()
    while parent is not None:
        if parent.id == area_id:
            raise HTTPException(
                status_code=422, detail="An area cannot sit inside itself"
            )
        assert parent.id is not None
        if parent.id in seen:  # pragma: no cover - cycles are never stored
            break
        seen.add(parent.id)
        parent = (
            db.get(ProjectArea, parent.parent_area_id)
            if parent.parent_area_id
            else None
        )


@router.get("/projects/{project_id}/areas", response_model=list[AreaPublic])
def list_areas(project_id: int, session: SessionDep, current_user: CurrentUser) -> Any:
    get_authorized_project(session, project_id, current_user)
    return _publics(session, _ordered(session, project_id))


@router.post(
    "/projects/{project_id}/areas",
    response_model=AreaPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_area(
    project_id: int,
    payload: AreaCreate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    get_authorized_project(session, project_id, current_user, roles=WRITE_ROLES)
    _check_parent(session, project_id, payload.parent_area_id)
    area = ProjectArea(
        project_id=project_id,
        name=payload.name.strip(),
        area_type=payload.area_type,
        parent_area_id=payload.parent_area_id,
        sort_order=_next_sort(session, project_id),
        created_by=current_email(current_user),
    )
    session.add(area)
    session.commit()
    session.refresh(area)
    return _publics(session, [area])[0]


@router.post(
    "/projects/{project_id}/areas/bulk",
    response_model=list[AreaPublic],
    status_code=status.HTTP_201_CREATED,
)
def bulk_create_areas(
    project_id: int,
    payload: AreaBulkCreate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    """``{prefix: "Level", start: 1, end: 12}`` → Level 1 … Level 12, in order."""
    get_authorized_project(session, project_id, current_user, roles=WRITE_ROLES)
    if payload.end < payload.start:
        raise HTTPException(
            status_code=422, detail="The last number is before the first"
        )
    count = payload.end - payload.start + 1
    if count > MAX_BULK:
        raise HTTPException(
            status_code=422, detail=f"Add at most {MAX_BULK} areas at a time"
        )
    _check_parent(session, project_id, payload.parent_area_id)
    sort = _next_sort(session, project_id)
    prefix = payload.prefix.strip()
    created = []
    for offset, number in enumerate(range(payload.start, payload.end + 1)):
        area = ProjectArea(
            project_id=project_id,
            name=f"{prefix} {number}"[:255],
            area_type=payload.area_type,
            parent_area_id=payload.parent_area_id,
            sort_order=sort + offset * 10,
            created_by=current_email(current_user),
        )
        session.add(area)
        created.append(area)
    session.commit()
    for area in created:
        session.refresh(area)
    return _publics(session, created)


@router.put("/projects/{project_id}/areas/order", response_model=list[AreaPublic])
def reorder_areas(
    project_id: int,
    payload: AreaOrder,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    """The full list of the project's area ids, in the order wanted."""
    get_authorized_project(session, project_id, current_user, roles=WRITE_ROLES)
    areas = {a.id or 0: a for a in _ordered(session, project_id)}
    if sorted(payload.area_ids) != sorted(areas) or len(set(payload.area_ids)) != len(
        payload.area_ids
    ):
        raise HTTPException(
            status_code=422,
            detail="Send every area of the project exactly once",
        )
    for index, area_id in enumerate(payload.area_ids):
        areas[area_id].sort_order = (index + 1) * 10
        session.add(areas[area_id])
    session.commit()
    return _publics(session, _ordered(session, project_id))


@router.get("/areas/{area_id}", response_model=AreaPublic)
def read_area(area_id: int, session: SessionDep, current_user: CurrentUser) -> Any:
    return _publics(session, [get_authorized_area(session, area_id, current_user)])[0]


@router.put("/areas/{area_id}", response_model=AreaPublic)
def update_area(
    area_id: int,
    payload: AreaUpdate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    area = get_authorized_area(session, area_id, current_user, roles=WRITE_ROLES)
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if updates.get("name"):
        area.name = updates["name"].strip()
    if updates.get("area_type"):
        area.area_type = updates["area_type"]
    if "parent_area_id" in updates:
        _check_parent(session, area.project_id, updates["parent_area_id"], area.id)
        area.parent_area_id = updates["parent_area_id"]
    session.add(area)
    session.commit()
    session.refresh(area)
    return _publics(session, [area])[0]


@router.delete("/areas/{area_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_area(area_id: int, session: SessionDep, current_user: CurrentUser) -> None:
    area = get_authorized_area(session, area_id, current_user, roles=WRITE_ROLES)
    session.delete(area)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This area has signed ITPs and cannot be deleted",
        ) from exc
