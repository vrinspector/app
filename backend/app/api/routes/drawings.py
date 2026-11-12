"""Drawings + inspection pins (Block 8D/8E), ported to SQLModel.

Porting spec: ``vrinspector/backend`` → ``staging_snapshot_20260716/
staging_drawings_block8e.py`` (the only legacy router that survived in source
form) and its local authorization regression suite, which is ported to pytest
in ``tests/api/routes/test_drawings.py``.

Legacy contract (deployed SPA, July 2026):

    POST   /drawings/presign                body {project_id, filename, content_type}
                                            → {upload_url, s3_key}
    POST   /drawings                        → 201 drawing (s3_key must be project-bound)
    GET    /drawings?project_id=N[&discipline=] → list, newest first
    GET    /drawings/{id}                   → drawing
    PUT    /drawings/{id}                   → drawing   (400 when no fields)
    DELETE /drawings/{id}                   → 204       (pins cascade)
    PATCH  /drawings/{id}/dimensions        → {id, page_width_pts, page_height_pts}
    GET    /drawings/{id}/view-url          → {view_url}   presigned GET, 1 h
    GET    /drawings/{id}/pins              → list ordered by id
    POST   /drawings/{id}/pins              → 201 pin
    DELETE /pins/{id}                       → 204

Rebuild additions (the legacy module declared ``PinUpdate`` but exposed no
route for it): ``GET /pins/{id}`` and ``PUT /pins/{id}``.

Increment 14.5 — drawing revisions (owner decision 2026-11-10):

    GET    /drawings?project_id=N[&include_superseded=true]
                                            → current revisions only by default
    GET    /drawings/{id}/revisions         → the sheet's revisions, newest first
    POST   /drawings/{id}/revisions         → 201 the new current revision; every
                                              pin is carried over at the same page
                                              and x / y with ``position_check``
    DELETE /drawings/{id}[?revision_only=true]
                                            → the whole sheet, or just the current
                                              revision (the previous one becomes
                                              current again)
    PUT    /pins/{id}                       → also moves a pin (x_pct / y_pct /
                                              page_number) or confirms a carried
                                              one (``position_confirmed: true``)

An old revision is read-only: its pins cannot be added, changed or deleted
and its details cannot be edited (409). Existing drawings are one-revision
sheets, so the legacy routes behave exactly as before for them.

Authorization hardening carried over unchanged: every object is reached
through project membership; missing and unauthorized objects both return
**404** with the legacy ``detail`` strings; the presigned upload key is bound
to the project prefix ``drawings/projects/{project_id}/`` and a registration
whose key lies outside it is refused as "Drawing not found"; attribution
(``uploaded_by`` / ``created_by``) is the verified Auth0 identity, never the
value the client sends. Files never touch the API server (Hard Rule 8).
"""

import uuid
from collections.abc import Sequence
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import aliased
from sqlmodel import Session, col, select

from app.api.authz import (
    WRITE_ROLES,
    current_email,
    ensure_finding_in_project,
    ensure_itp_item_in_project,
    get_authorized_drawing,
    get_authorized_pin,
    get_authorized_project,
    not_found,
)
from app.api.deps import CurrentUser, SessionDep
from app.core.drawing_revisions import next_revision_label, normalize_revision_label
from app.core.storage import DRAWING_EXTENSIONS, storage
from app.models import (
    Drawing,
    DrawingCreate,
    DrawingDimensionsPublic,
    DrawingDimensionsUpdate,
    DrawingDiscipline,
    DrawingPresignRequest,
    DrawingPresignResponse,
    DrawingPublic,
    DrawingRevisionCreate,
    DrawingUpdate,
    DrawingViewUrl,
    InspectionPin,
    PinCreate,
    PinPublic,
    PinUpdate,
    get_datetime_utc,
)

router = APIRouter(tags=["drawings"])


def _no_fields() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update"
    )


OLD_REVISION_DETAIL = (
    "This is an old revision of the drawing; it is kept read-only. "
    "Open the current revision to make changes."
)


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def ensure_current_revision(drawing: Drawing) -> None:
    """Old revisions keep their pins exactly as they were (increment 14.5)."""
    if drawing.superseded_at is not None:
        raise _conflict(OLD_REVISION_DETAIL)


def _series(drawing: Drawing) -> int:
    assert drawing.id is not None
    return drawing.series_id if drawing.series_id is not None else drawing.id


def drawings_public(
    session: Session, drawings: Sequence[Drawing]
) -> list[DrawingPublic]:
    """Drawings with their revision count and pins still to check."""
    if not drawings:
        return []
    series_ids = {_series(d) for d in drawings}
    drawing_ids = [d.id for d in drawings]
    counts = dict(
        session.exec(
            select(col(Drawing.series_id), func.count())
            .where(col(Drawing.series_id).in_(series_ids))
            .group_by(col(Drawing.series_id))
        ).all()
    )
    to_check = dict(
        session.exec(
            select(col(InspectionPin.drawing_id), func.count())
            .where(col(InspectionPin.drawing_id).in_(drawing_ids))
            .where(col(InspectionPin.position_check).is_(True))
            .group_by(col(InspectionPin.drawing_id))
        ).all()
    )
    result = []
    for drawing in drawings:
        assert drawing.id is not None
        public = DrawingPublic.model_validate(drawing)
        public.series_id = _series(drawing)
        public.revision_count = int(counts.get(_series(drawing), 1))
        public.pins_to_check = int(to_check.get(drawing.id, 0))
        result.append(public)
    return result


def drawing_public(session: Session, drawing: Drawing) -> DrawingPublic:
    return drawings_public(session, [drawing])[0]


def pins_public(session: Session, pins: Sequence[InspectionPin]) -> list[PinPublic]:
    """Pins with the revision label of the drawing a carried pin came from."""
    carried_ids = {p.carried_from_pin_id for p in pins if p.carried_from_pin_id}
    labels: dict[int, str | None] = {}
    if carried_ids:
        source = aliased(InspectionPin)
        rows = session.exec(
            select(col(source.id), col(Drawing.revision))
            .join(Drawing, col(Drawing.id) == col(source.drawing_id))
            .where(col(source.id).in_(carried_ids))
        ).all()
        labels = {pin_id: label for pin_id, label in rows if pin_id is not None}
    result = []
    for pin in pins:
        public = PinPublic.model_validate(pin)
        if pin.carried_from_pin_id is not None:
            public.carried_from_revision = labels.get(pin.carried_from_pin_id)
        result.append(public)
    return result


def pin_public(session: Session, pin: InspectionPin) -> PinPublic:
    return pins_public(session, [pin])[0]


# ── Drawings ────────────────────────────────────────────────────────────────


@router.post("/drawings/presign", response_model=DrawingPresignResponse)
def presign_drawing_upload(
    payload: DrawingPresignRequest, session: SessionDep, current_user: CurrentUser
) -> Any:
    get_authorized_project(session, payload.project_id, current_user, roles=WRITE_ROLES)
    ext = storage.safe_extension(payload.filename, DRAWING_EXTENSIONS)
    key = f"{storage.drawing_prefix(payload.project_id)}{uuid.uuid4().hex}{ext}"
    return DrawingPresignResponse(
        upload_url=storage.presign_put(key, payload.content_type), s3_key=key
    )


@router.post(
    "/drawings", response_model=DrawingPublic, status_code=status.HTTP_201_CREATED
)
def create_drawing(
    payload: DrawingCreate, session: SessionDep, current_user: CurrentUser
) -> Any:
    get_authorized_project(session, payload.project_id, current_user, roles=WRITE_ROLES)
    if not payload.s3_key.startswith(storage.drawing_prefix(payload.project_id)):
        # Legacy ``_validate_project_s3_key``: a key outside the project's
        # prefix is treated like an object the caller cannot see.
        raise not_found("Drawing not found")
    drawing = Drawing.model_validate(
        payload,
        update={
            "uploaded_by": current_email(current_user),
            "revision": normalize_revision_label(payload.revision),
        },
    )
    session.add(drawing)
    session.flush()
    drawing.series_id = drawing.id
    session.commit()
    session.refresh(drawing)
    return drawing_public(session, drawing)


@router.get("/drawings", response_model=list[DrawingPublic])
def list_drawings(
    session: SessionDep,
    current_user: CurrentUser,
    project_id: int = Query(...),
    discipline: DrawingDiscipline | None = Query(None),
    include_superseded: bool = Query(
        False, description="Also list old revisions (increment 14.5)."
    ),
) -> Any:
    get_authorized_project(session, project_id, current_user)
    stmt = select(Drawing).where(Drawing.project_id == project_id)
    if discipline:
        stmt = stmt.where(Drawing.discipline == discipline)
    if not include_superseded:
        stmt = stmt.where(col(Drawing.superseded_at).is_(None))
    stmt = stmt.order_by(col(Drawing.created_at).desc(), col(Drawing.id).desc())
    return drawings_public(session, session.exec(stmt).all())


@router.get("/drawings/{drawing_id}", response_model=DrawingPublic)
def read_drawing(
    drawing_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    return drawing_public(
        session, get_authorized_drawing(session, drawing_id, current_user)
    )


# ── Revisions (increment 14.5) ──────────────────────────────────────────────


@router.get("/drawings/{drawing_id}/revisions", response_model=list[DrawingPublic])
def list_drawing_revisions(
    drawing_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    drawing = get_authorized_drawing(session, drawing_id, current_user)
    stmt = (
        select(Drawing)
        .where(Drawing.series_id == _series(drawing))
        .where(Drawing.project_id == drawing.project_id)
        .order_by(col(Drawing.created_at).desc(), col(Drawing.id).desc())
    )
    return drawings_public(session, session.exec(stmt).all())


@router.post(
    "/drawings/{drawing_id}/revisions",
    response_model=DrawingPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_drawing_revision(
    drawing_id: int,
    payload: DrawingRevisionCreate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    """Upload Rev B over Rev A: the new file becomes the current revision and
    every pin is carried over at the same page and x / y, flagged for a
    position check; Rev A stays as it was, read-only."""
    drawing = get_authorized_drawing(
        session, drawing_id, current_user, roles=WRITE_ROLES
    )
    if not payload.s3_key.startswith(storage.drawing_prefix(drawing.project_id)):
        raise not_found("Drawing not found")
    # Serialize concurrent revisions of the same sheet.
    locked = session.exec(
        select(Drawing).where(Drawing.id == drawing_id).with_for_update()
    ).one()
    session.refresh(locked)
    ensure_current_revision(locked)
    series_id = _series(locked)
    existing = set(
        session.exec(
            select(col(Drawing.revision)).where(Drawing.series_id == series_id)
        ).all()
    )
    if locked.revision is None and existing <= {None}:
        # An unlabelled original counts as Rev A once it is revised.
        locked.revision = "A"
        existing = {"A"}
    label = normalize_revision_label(payload.revision) or next_revision_label(
        locked.revision
    )
    if label in existing:
        raise _conflict(f"Revision {label} already exists for this drawing")
    now = get_datetime_utc()
    locked.superseded_at = now
    locked.series_id = series_id
    session.add(locked)
    session.flush()
    revised = Drawing(
        project_id=locked.project_id,
        title=payload.title or locked.title,
        drawing_number=(
            payload.drawing_number
            if payload.drawing_number is not None
            else locked.drawing_number
        ),
        discipline=locked.discipline,
        filename=payload.filename,
        s3_key=payload.s3_key,
        file_type=payload.file_type,
        file_size=payload.file_size,
        page_width_pts=payload.page_width_pts,  # type: ignore[arg-type]
        page_height_pts=payload.page_height_pts,  # type: ignore[arg-type]
        uploaded_by=current_email(current_user),
        series_id=series_id,
        revision=label,
    )
    session.add(revised)
    session.flush()
    assert revised.id is not None
    old_pins = session.exec(
        select(InspectionPin)
        .where(InspectionPin.drawing_id == locked.id)
        .order_by(col(InspectionPin.id))
    ).all()
    for pin in old_pins:
        session.add(
            InspectionPin(
                drawing_id=revised.id,
                finding_id=pin.finding_id,
                itp_item_id=pin.itp_item_id,
                tag_number=pin.tag_number,
                label=pin.label,
                x_pct=pin.x_pct,
                y_pct=pin.y_pct,
                status=pin.status,
                notes=pin.notes,
                discipline_data=pin.discipline_data,
                page_number=pin.page_number,
                created_by=pin.created_by,
                carried_from_pin_id=pin.id,
                position_check=True,
            )
        )
    session.commit()
    session.refresh(revised)
    return drawing_public(session, revised)


@router.put("/drawings/{drawing_id}", response_model=DrawingPublic)
def update_drawing(
    drawing_id: int,
    payload: DrawingUpdate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    drawing = get_authorized_drawing(
        session, drawing_id, current_user, roles=WRITE_ROLES
    )
    # Legacy: ``{k: v for k, v in payload if v is not None}`` → 400 when empty.
    updates = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        raise _no_fields()
    ensure_current_revision(drawing)
    drawing.sqlmodel_update(updates)
    session.add(drawing)
    session.commit()
    session.refresh(drawing)
    return drawing_public(session, drawing)


@router.delete("/drawings/{drawing_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_drawing(
    drawing_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    revision_only: bool = Query(
        False,
        description=(
            "Remove only this (current) revision; the previous revision "
            "becomes current again (increment 14.5)."
        ),
    ),
) -> None:
    drawing = get_authorized_drawing(
        session, drawing_id, current_user, roles=WRITE_ROLES
    )
    # Old revisions are kept as the record of what the sheet showed; they go
    # only with the whole drawing.
    ensure_current_revision(drawing)
    series = session.exec(
        select(Drawing)
        .where(Drawing.series_id == _series(drawing))
        .where(Drawing.project_id == drawing.project_id)
        .order_by(col(Drawing.created_at).desc(), col(Drawing.id).desc())
    ).all()
    doomed = [drawing] if revision_only else list(series) or [drawing]
    # Pins go with the drawing (FK ON DELETE CASCADE, as in the legacy schema).
    # The S3 object is removed best-effort, matching the increment 04 decision
    # for single photos; the legacy router left it to the bucket lifecycle.
    for row in doomed:
        storage.delete_object(row.s3_key)
        session.delete(row)
    session.flush()
    if revision_only:
        previous = [d for d in series if d.id != drawing.id]
        if previous:
            previous[0].superseded_at = None
            session.add(previous[0])
    session.commit()


@router.patch(
    "/drawings/{drawing_id}/dimensions", response_model=DrawingDimensionsPublic
)
def update_drawing_dimensions(
    drawing_id: int,
    payload: DrawingDimensionsUpdate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    """Store captured PDF MediaBox dimensions for future coordinate migration."""
    drawing = get_authorized_drawing(
        session, drawing_id, current_user, roles=WRITE_ROLES
    )
    drawing.sqlmodel_update(payload.model_dump())
    session.add(drawing)
    session.commit()
    session.refresh(drawing)
    return drawing


@router.get("/drawings/{drawing_id}/view-url", response_model=DrawingViewUrl)
def read_drawing_view_url(
    drawing_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    drawing = get_authorized_drawing(session, drawing_id, current_user)
    return DrawingViewUrl(view_url=storage.presign_get(drawing.s3_key))


# ── Pins ────────────────────────────────────────────────────────────────────


@router.get("/drawings/{drawing_id}/pins", response_model=list[PinPublic])
def list_pins(drawing_id: int, session: SessionDep, current_user: CurrentUser) -> Any:
    get_authorized_drawing(session, drawing_id, current_user)
    stmt = (
        select(InspectionPin)
        .where(InspectionPin.drawing_id == drawing_id)
        .order_by(col(InspectionPin.id))
    )
    return pins_public(session, session.exec(stmt).all())


@router.post(
    "/drawings/{drawing_id}/pins",
    response_model=PinPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_pin(
    drawing_id: int,
    payload: PinCreate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    drawing = get_authorized_drawing(
        session, drawing_id, current_user, roles=WRITE_ROLES
    )
    ensure_current_revision(drawing)
    if payload.finding_id is not None:
        ensure_finding_in_project(session, payload.finding_id, drawing.project_id)
    if payload.itp_item_id is not None:
        ensure_itp_item_in_project(session, payload.itp_item_id, drawing.project_id)
    pin = InspectionPin.model_validate(
        payload,
        update={"drawing_id": drawing_id, "created_by": current_email(current_user)},
    )
    session.add(pin)
    session.commit()
    session.refresh(pin)
    return pin_public(session, pin)


@router.get("/pins/{pin_id}", response_model=PinPublic)
def read_pin(pin_id: int, session: SessionDep, current_user: CurrentUser) -> Any:
    pin, _ = get_authorized_pin(session, pin_id, current_user)
    return pin_public(session, pin)


@router.put("/pins/{pin_id}", response_model=PinPublic)
def update_pin(
    pin_id: int, payload: PinUpdate, session: SessionDep, current_user: CurrentUser
) -> Any:
    pin, drawing = get_authorized_pin(session, pin_id, current_user, roles=WRITE_ROLES)
    # ``finding_id: null`` / ``itp_item_id: null`` unlink the pin; other
    # nulls are "not sent".
    nullable = {"finding_id", "itp_item_id"}
    updates = payload.model_dump(exclude_unset=True)
    updates = {k: v for k, v in updates.items() if v is not None or k in nullable}
    confirmed = bool(updates.pop("position_confirmed", False))
    if not updates and not confirmed:
        raise _no_fields()
    ensure_current_revision(drawing)
    moved = bool({"x_pct", "y_pct", "page_number"} & updates.keys())
    if (moved or confirmed) and pin.position_check:
        # Increment 14.5: a carried pin is settled once someone confirms it
        # where it is or puts it where it belongs.
        pin.position_check = False
        pin.position_confirmed_by = current_email(current_user)
        pin.position_confirmed_at = get_datetime_utc()
    if updates.get("finding_id") is not None:
        ensure_finding_in_project(session, updates["finding_id"], drawing.project_id)
    if updates.get("itp_item_id") is not None:
        ensure_itp_item_in_project(session, updates["itp_item_id"], drawing.project_id)
    pin.sqlmodel_update(updates)
    session.add(pin)
    session.commit()
    session.refresh(pin)
    return pin_public(session, pin)


@router.delete("/pins/{pin_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pin(pin_id: int, session: SessionDep, current_user: CurrentUser) -> None:
    pin, drawing = get_authorized_pin(session, pin_id, current_user, roles=WRITE_ROLES)
    ensure_current_revision(drawing)
    session.delete(pin)
    session.commit()
