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

Authorization hardening carried over unchanged: every object is reached
through project membership; missing and unauthorized objects both return
**404** with the legacy ``detail`` strings; the presigned upload key is bound
to the project prefix ``drawings/projects/{project_id}/`` and a registration
whose key lies outside it is refused as "Drawing not found"; attribution
(``uploaded_by`` / ``created_by``) is the verified Auth0 identity, never the
value the client sends. Files never touch the API server (Hard Rule 8).
"""

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import col, select

from app.api.authz import (
    WRITE_ROLES,
    current_email,
    ensure_finding_in_project,
    get_authorized_drawing,
    get_authorized_pin,
    get_authorized_project,
    not_found,
)
from app.api.deps import CurrentUser, SessionDep
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
    DrawingUpdate,
    DrawingViewUrl,
    InspectionPin,
    PinCreate,
    PinPublic,
    PinUpdate,
)

router = APIRouter(tags=["drawings"])


def _no_fields() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update"
    )


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
        update={"uploaded_by": current_email(current_user)},
    )
    session.add(drawing)
    session.commit()
    session.refresh(drawing)
    return drawing


@router.get("/drawings", response_model=list[DrawingPublic])
def list_drawings(
    session: SessionDep,
    current_user: CurrentUser,
    project_id: int = Query(...),
    discipline: DrawingDiscipline | None = Query(None),
) -> Any:
    get_authorized_project(session, project_id, current_user)
    stmt = select(Drawing).where(Drawing.project_id == project_id)
    if discipline:
        stmt = stmt.where(Drawing.discipline == discipline)
    stmt = stmt.order_by(col(Drawing.created_at).desc(), col(Drawing.id).desc())
    return list(session.exec(stmt).all())


@router.get("/drawings/{drawing_id}", response_model=DrawingPublic)
def read_drawing(
    drawing_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    return get_authorized_drawing(session, drawing_id, current_user)


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
    drawing.sqlmodel_update(updates)
    session.add(drawing)
    session.commit()
    session.refresh(drawing)
    return drawing


@router.delete("/drawings/{drawing_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_drawing(
    drawing_id: int, session: SessionDep, current_user: CurrentUser
) -> None:
    drawing = get_authorized_drawing(
        session, drawing_id, current_user, roles=WRITE_ROLES
    )
    # Pins go with the drawing (FK ON DELETE CASCADE, as in the legacy schema).
    # The S3 object is removed best-effort, matching the increment 04 decision
    # for single photos; the legacy router left it to the bucket lifecycle.
    storage.delete_object(drawing.s3_key)
    session.delete(drawing)
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
    return list(session.exec(stmt).all())


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
    if payload.finding_id is not None:
        ensure_finding_in_project(session, payload.finding_id, drawing.project_id)
    pin = InspectionPin.model_validate(
        payload,
        update={"drawing_id": drawing_id, "created_by": current_email(current_user)},
    )
    session.add(pin)
    session.commit()
    session.refresh(pin)
    return pin


@router.get("/pins/{pin_id}", response_model=PinPublic)
def read_pin(pin_id: int, session: SessionDep, current_user: CurrentUser) -> Any:
    pin, _ = get_authorized_pin(session, pin_id, current_user)
    return pin


@router.put("/pins/{pin_id}", response_model=PinPublic)
def update_pin(
    pin_id: int, payload: PinUpdate, session: SessionDep, current_user: CurrentUser
) -> Any:
    pin, drawing = get_authorized_pin(session, pin_id, current_user, roles=WRITE_ROLES)
    # ``finding_id: null`` unlinks the pin; other nulls are "not sent".
    updates = payload.model_dump(exclude_unset=True)
    updates = {k: v for k, v in updates.items() if v is not None or k == "finding_id"}
    if not updates:
        raise _no_fields()
    if updates.get("finding_id") is not None:
        ensure_finding_in_project(session, updates["finding_id"], drawing.project_id)
    pin.sqlmodel_update(updates)
    session.add(pin)
    session.commit()
    session.refresh(pin)
    return pin


@router.delete("/pins/{pin_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pin(pin_id: int, session: SessionDep, current_user: CurrentUser) -> None:
    pin, _ = get_authorized_pin(session, pin_id, current_user, roles=WRITE_ROLES)
    session.delete(pin)
    session.commit()
