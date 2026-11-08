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

Hardening carried over from the drawings router: the presigned key is bound
to the inspection (``photos/inspections/{inspection_id}/{uuid}{ext}``) and a
registration whose ``s3_key`` is outside that prefix is refused with 404.
Files never touch the API server (Hard Rule 8).
"""

import uuid
from typing import Any

from fastapi import APIRouter, Query, status
from sqlmodel import Session, col, select

from app.api.authz import (
    WRITE_ROLES,
    current_email,
    get_authorized_inspection,
    get_authorized_photo,
    not_found,
)
from app.api.deps import CurrentUser, SessionDep
from app.core.storage import PHOTO_EXTENSIONS, storage
from app.models import (
    Finding,
    Photo,
    PhotoCreate,
    PhotoPresignRequest,
    PhotoPresignResponse,
    PhotoPublic,
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


@router.post("/presign", response_model=PhotoPresignResponse)
def presign_photo_upload(
    payload: PhotoPresignRequest, session: SessionDep, current_user: CurrentUser
) -> Any:
    get_authorized_inspection(
        session, payload.inspection_id, current_user, roles=WRITE_ROLES
    )
    ext = storage.safe_extension(payload.filename, PHOTO_EXTENSIONS)
    key = f"{storage.photo_prefix(payload.inspection_id)}{uuid.uuid4().hex}{ext}"
    return PhotoPresignResponse(
        upload_url=storage.presign_put(key, payload.content_type), s3_key=key
    )


@router.post("", response_model=PhotoPublic, status_code=status.HTTP_201_CREATED)
def register_photo(
    payload: PhotoCreate, session: SessionDep, current_user: CurrentUser
) -> Any:
    get_authorized_inspection(
        session, payload.inspection_id, current_user, roles=WRITE_ROLES
    )
    if not payload.s3_key.startswith(storage.photo_prefix(payload.inspection_id)):
        # Project-bound upload keys: a key outside the inspection's prefix is
        # treated like an object the caller cannot see.
        raise not_found("Photo not found")
    if payload.finding_id is not None:
        _ensure_finding_in_inspection(
            session, payload.finding_id, payload.inspection_id
        )
    photo = Photo(
        inspection_id=payload.inspection_id,
        finding_id=payload.finding_id,
        s3_key=payload.s3_key,
        filename=payload.filename,
        content_type=payload.content_type,
        uploaded_by=current_email(current_user),
    )
    session.add(photo)
    session.commit()
    session.refresh(photo)
    return _public(photo)


@router.get("", response_model=list[PhotoPublic])
def list_photos(
    session: SessionDep,
    current_user: CurrentUser,
    inspection_id: int = Query(...),
    finding_id: int | None = Query(default=None),
) -> Any:
    get_authorized_inspection(session, inspection_id, current_user)
    stmt = (
        select(Photo)
        .where(Photo.inspection_id == inspection_id)
        .order_by(col(Photo.created_at).desc(), col(Photo.id).desc())
    )
    if finding_id is not None:
        stmt = stmt.where(Photo.finding_id == finding_id)
    return [_public(p) for p in session.exec(stmt).all()]


@router.get("/{photo_id}", response_model=PhotoPublic)
def read_photo(photo_id: int, session: SessionDep, current_user: CurrentUser) -> Any:
    return _public(get_authorized_photo(session, photo_id, current_user))


@router.delete("/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_photo(photo_id: int, session: SessionDep, current_user: CurrentUser) -> None:
    photo = get_authorized_photo(session, photo_id, current_user, roles=WRITE_ROLES)
    storage.delete_object(photo.s3_key)
    session.delete(photo)
    session.commit()
