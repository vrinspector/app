"""Photos (Block 3): presigned S3 upload + registration, ported to SQLModel.

Legacy contract (deployed SPA, July 2026):

    POST   /photos/presign          body {inspection_id, filename, content_type}
                                    → {upload_url, s3_key}
    POST   /photos                  body {inspection_id, s3_key, filename, uploaded_by}
                                    → 201 photo
    GET    /photos?inspection_id=N  → list, each with a presigned ``view_url``

Increment 11a (capture loop) adds an optional ``finding_id`` to the register
body and the list filter: a photo taken for a finding is stored against it
(``photos.finding_id``, SET NULL when the finding goes). The finding must
belong to the same inspection; any other id is indistinguishable from a
missing one — 404 ``Finding not found``.
    GET    /photos/{id}             → photo with ``view_url``
    DELETE /photos/{id}             → 204 (S3 object deleted best-effort)

Increment 13.6 (ITP line evidence) lets the same three steps file a photo
against an ITP line instead: send ``itp_item_id`` in place of
``inspection_id`` to presign and register, and list with
``GET /photos?itp_item_id=N``. Exactly one of the two is given (422
otherwise). The key is bound to the line
(``photos/itp-items/{itp_item_id}/…``); evidence can be added or removed only
while the line can still be recorded — not on a complete or voided ITP, not
past an unreleased hold point, not once the line is signed — and the last
photo of a passed line that requires one cannot be deleted (set the line back
to pending first).

Increment 13.8 (three-shot set) adds two optional register fields:
``shot_slot`` (``context`` / ``intermediate`` / ``closeup``) — only for a
photo of an ITP line whose template asks for the three-shot set, 422
otherwise — and ``captured_at``, when the device says the picture was taken.
The uploaded file itself is never re-encoded, so its own EXIF metadata stays
in S3 as it was taken. The last photo that keeps a passed line evidenced
(its only photo, or the only one in a three-shot slot) cannot be deleted.

Hardening carried over from the drawings router: the presigned key is bound
to the inspection (``photos/inspections/{inspection_id}/{uuid}{ext}``) and a
registration whose ``s3_key`` is outside that prefix is refused with 404.
Files never touch the API server (Hard Rule 8).
"""

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import Session, col, select

from app.api.authz import (
    WRITE_ROLES,
    current_email,
    get_authorized_inspection,
    get_authorized_itp_item,
    get_authorized_photo,
    not_found,
)
from app.api.deps import CurrentUser, SessionDep
from app.api.itp_state import evidence_met, load_itp_state
from app.core.auth import AuthUser
from app.core.storage import PHOTO_EXTENSIONS, storage
from app.models import (
    Finding,
    ItpItem,
    Photo,
    PhotoCreate,
    PhotoPresignRequest,
    PhotoPresignResponse,
    PhotoPublic,
    ProjectItp,
)

router = APIRouter(prefix="/photos", tags=["photos"])


def _public(photo: Photo) -> PhotoPublic:
    data = photo.model_dump()
    data["view_url"] = storage.presign_get(photo.s3_key)
    return PhotoPublic.model_validate(data)


def _ensure_finding_in_inspection(
    session: Session, finding_id: int, inspection_id: int
) -> None:
    """A photo may only be filed under a finding of its own inspection."""
    finding = session.get(Finding, finding_id)
    if finding is None or finding.inspection_id != inspection_id:
        raise not_found("Finding not found")


def _one_parent(inspection_id: int | None, itp_item_id: int | None) -> None:
    if (inspection_id is None) == (itp_item_id is None):
        raise HTTPException(
            status_code=422,
            detail="Give exactly one of inspection_id or itp_item_id",
        )


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _ensure_evidence_editable(session: Session, item: ItpItem, itp: ProjectItp) -> None:
    """Line evidence changes only while the line itself could be recorded."""
    if itp.status == "complete":
        raise _conflict("This ITP is complete; reopen it to change its photos")
    if itp.status == "voided":
        raise _conflict("This ITP is voided")
    assert item.id is not None
    state = load_itp_state(session, itp).item(item.id)
    if state.blocked_by is not None:
        raise _conflict(
            f"Waiting for hold point “{state.blocked_by.requirement}” to be "
            "signed off before this line can be recorded"
        )
    if state.signatures:
        raise _conflict("This line is signed; its photos can no longer change")


def _authorized_line(
    session: Session, item_id: int, user: AuthUser, *, write: bool
) -> tuple[ItpItem, ProjectItp]:
    item, itp = get_authorized_itp_item(
        session, item_id, user, roles=WRITE_ROLES if write else None
    )
    if write:
        _ensure_evidence_editable(session, item, itp)
    return item, itp


@router.post("/presign", response_model=PhotoPresignResponse)
def presign_photo_upload(
    payload: PhotoPresignRequest, session: SessionDep, current_user: CurrentUser
) -> Any:
    _one_parent(payload.inspection_id, payload.itp_item_id)
    if payload.itp_item_id is not None:
        _authorized_line(session, payload.itp_item_id, current_user, write=True)
        prefix = storage.itp_photo_prefix(payload.itp_item_id)
    else:
        assert payload.inspection_id is not None
        get_authorized_inspection(
            session, payload.inspection_id, current_user, roles=WRITE_ROLES
        )
        prefix = storage.photo_prefix(payload.inspection_id)
    ext = storage.safe_extension(payload.filename, PHOTO_EXTENSIONS)
    key = f"{prefix}{uuid.uuid4().hex}{ext}"
    return PhotoPresignResponse(
        upload_url=storage.presign_put(key, payload.content_type), s3_key=key
    )


@router.post("", response_model=PhotoPublic, status_code=status.HTTP_201_CREATED)
def register_photo(
    payload: PhotoCreate, session: SessionDep, current_user: CurrentUser
) -> Any:
    _one_parent(payload.inspection_id, payload.itp_item_id)
    if payload.itp_item_id is not None:
        _authorized_line(session, payload.itp_item_id, current_user, write=True)
        if payload.finding_id is not None:
            raise HTTPException(
                status_code=422, detail="An ITP line photo cannot have a finding"
            )
        prefix = storage.itp_photo_prefix(payload.itp_item_id)
    else:
        assert payload.inspection_id is not None
        get_authorized_inspection(
            session, payload.inspection_id, current_user, roles=WRITE_ROLES
        )
        prefix = storage.photo_prefix(payload.inspection_id)
    if payload.shot_slot is not None:
        line = (
            session.get(ItpItem, payload.itp_item_id)
            if payload.itp_item_id is not None
            else None
        )
        if line is None or line.photo_set != "three_shot":
            raise HTTPException(
                status_code=422,
                detail="Only a line that asks for the three-shot set takes a shot slot",
            )
    if not payload.s3_key.startswith(prefix):
        # Project-bound upload keys: a key outside the inspection's (or line's)
        # prefix is treated like an object the caller cannot see.
        raise not_found("Photo not found")
    if payload.finding_id is not None and payload.inspection_id is not None:
        _ensure_finding_in_inspection(
            session, payload.finding_id, payload.inspection_id
        )
    photo = Photo(
        inspection_id=payload.inspection_id,
        itp_item_id=payload.itp_item_id,
        finding_id=payload.finding_id,
        s3_key=payload.s3_key,
        filename=payload.filename,
        content_type=payload.content_type,
        uploaded_by=current_email(current_user),
        shot_slot=payload.shot_slot,
        captured_at=payload.captured_at,
    )
    session.add(photo)
    session.commit()
    session.refresh(photo)
    return _public(photo)


@router.get("", response_model=list[PhotoPublic])
def list_photos(
    session: SessionDep,
    current_user: CurrentUser,
    inspection_id: int | None = Query(default=None),
    finding_id: int | None = Query(default=None),
    itp_item_id: int | None = Query(default=None),
) -> Any:
    _one_parent(inspection_id, itp_item_id)
    if itp_item_id is not None:
        _authorized_line(session, itp_item_id, current_user, write=False)
        stmt = select(Photo).where(Photo.itp_item_id == itp_item_id)
    else:
        assert inspection_id is not None
        get_authorized_inspection(session, inspection_id, current_user)
        stmt = select(Photo).where(Photo.inspection_id == inspection_id)
        if finding_id is not None:
            stmt = stmt.where(Photo.finding_id == finding_id)
    stmt = stmt.order_by(col(Photo.created_at).desc(), col(Photo.id).desc())
    return [_public(p) for p in session.exec(stmt).all()]


@router.get("/{photo_id}", response_model=PhotoPublic)
def read_photo(photo_id: int, session: SessionDep, current_user: CurrentUser) -> Any:
    return _public(get_authorized_photo(session, photo_id, current_user))


@router.delete("/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_photo(photo_id: int, session: SessionDep, current_user: CurrentUser) -> None:
    photo = get_authorized_photo(session, photo_id, current_user, roles=WRITE_ROLES)
    if photo.itp_item_id is not None:
        item, _ = _authorized_line(session, photo.itp_item_id, current_user, write=True)
        if item.status == "pass" and (item.photo_required or item.photo_set):
            others = session.exec(
                select(Photo.shot_slot)
                .where(Photo.itp_item_id == item.id)
                .where(Photo.id != photo.id)
            ).all()
            slots = {slot for slot in others if slot is not None}
            if not evidence_met(item, len(others), slots):
                raise _conflict(
                    "This line passed with its required photo; set it back to "
                    "pending before removing the last photo"
                )
    storage.delete_object(photo.s3_key)
    session.delete(photo)
    session.commit()
