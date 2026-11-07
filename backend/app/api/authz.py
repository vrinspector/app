"""Project-membership authorization, ported from the deployed staging routers.

Rules (July 2026 authorization hardening, carried over unchanged):

* Every domain object is reached through its project, and a caller only sees
  a project they are a member of (``project_members``).
* Missing and unauthorized objects are indistinguishable: both are **404**
  (object hiding), with the same ``detail`` strings the legacy router used.
* Membership is matched on the Auth0 ``sub`` when the row already carries
  one, otherwise on the Auth0 **email** exactly as the legacy SQL did
  (``pm.user_email = :email``). The first time an email-matched member is
  seen with a ``sub`` we record it, so ``sub`` becomes the anchor over time
  without touching live data up front.

Role policy (rebuild; the legacy app stored roles but did not enforce them —
flagged for owner confirmation in the increment 04 PR):

* ``viewer`` — read-only.
* ``inspector`` — read + create/edit inspections, findings, photos, sign-off.
* ``owner`` — everything, plus project edit/delete and member management.
"""

from collections.abc import Iterable

from fastapi import HTTPException, status
from sqlalchemy import func, or_, update
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, col, select

from app.core.auth import AuthUser
from app.core.db import engine
from app.models import (
    MEMBER_ROLES,
    Drawing,
    Finding,
    Inspection,
    InspectionPin,
    Photo,
    Project,
    ProjectMember,
)

WRITE_ROLES: frozenset[str] = frozenset({"owner", "inspector"})
MANAGE_ROLES: frozenset[str] = frozenset({"owner"})

assert WRITE_ROLES | MANAGE_ROLES <= set(MEMBER_ROLES)


def current_email(user: AuthUser) -> str:
    """Attribution value stored in ``created_by`` / ``uploaded_by`` columns.

    Legacy: ``user_info.get("email") or user_info.get("sub") or "inspector"``.
    """
    return user.email or user.sub


def not_found(detail: str) -> HTTPException:
    # Object-hiding response: 404 for both missing and unauthorized objects.
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _identity_clause(user: AuthUser) -> ColumnElement[bool]:
    clauses = [col(ProjectMember.user_sub) == user.sub]
    if user.email:
        clauses.append(func.lower(col(ProjectMember.user_email)) == user.email.lower())
    return or_(*clauses)


def find_membership(
    db: Session, project_id: int, user: AuthUser
) -> ProjectMember | None:
    """The caller's membership row for ``project_id`` (``None`` if not a member)."""
    stmt = (
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .where(_identity_clause(user))
        .order_by(col(ProjectMember.id))
    )
    member = db.exec(stmt).first()
    if member is not None and member.user_sub is None:
        # First sighting of this member with a verified Auth0 sub: anchor it.
        # Written in its own short transaction so it persists on read-only
        # requests without committing (and expiring) the request session.
        assert member.id is not None
        with engine.begin() as conn:
            conn.execute(
                update(ProjectMember)
                .where(col(ProjectMember.id) == member.id)
                .where(col(ProjectMember.user_sub).is_(None))
                .values(user_sub=user.sub)
            )
        member.user_sub = user.sub
    return member


def member_project_ids(db: Session, user: AuthUser) -> list[int]:
    stmt = select(ProjectMember.project_id).where(_identity_clause(user)).distinct()
    return list(db.exec(stmt).all())


def require_project_member(
    db: Session,
    project_id: int,
    user: AuthUser,
    *,
    roles: Iterable[str] | None = None,
    detail: str = "Project not found",
) -> ProjectMember:
    """404 unless the caller is a member of ``project_id``.

    With ``roles``, a member whose role is not in the set gets 403 (they can
    see the project, so hiding it would be wrong).
    """
    member = find_membership(db, project_id, user)
    if member is None:
        raise not_found(detail)
    if roles is not None and member.role not in set(roles):
        raise forbidden("Your project role does not allow this action")
    return member


def get_authorized_project(
    db: Session, project_id: int, user: AuthUser, *, roles: Iterable[str] | None = None
) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise not_found("Project not found")
    require_project_member(db, project_id, user, roles=roles)
    return project


def get_authorized_inspection(
    db: Session,
    inspection_id: int,
    user: AuthUser,
    *,
    roles: Iterable[str] | None = None,
) -> Inspection:
    inspection = db.get(Inspection, inspection_id)
    if inspection is None:
        raise not_found("Inspection not found")
    require_project_member(
        db, inspection.project_id, user, roles=roles, detail="Inspection not found"
    )
    return inspection


def get_authorized_finding(
    db: Session, finding_id: int, user: AuthUser, *, roles: Iterable[str] | None = None
) -> tuple[Finding, Inspection]:
    finding = db.get(Finding, finding_id)
    if finding is None:
        raise not_found("Finding not found")
    inspection = db.get(Inspection, finding.inspection_id)
    if inspection is None:  # pragma: no cover - FK guarantees the parent
        raise not_found("Finding not found")
    require_project_member(
        db, inspection.project_id, user, roles=roles, detail="Finding not found"
    )
    return finding, inspection


def get_authorized_photo(
    db: Session, photo_id: int, user: AuthUser, *, roles: Iterable[str] | None = None
) -> Photo:
    photo = db.get(Photo, photo_id)
    if photo is None:
        raise not_found("Photo not found")
    inspection = db.get(Inspection, photo.inspection_id)
    if inspection is None:  # pragma: no cover - FK guarantees the parent
        raise not_found("Photo not found")
    require_project_member(
        db, inspection.project_id, user, roles=roles, detail="Photo not found"
    )
    return photo


def get_authorized_drawing(
    db: Session, drawing_id: int, user: AuthUser, *, roles: Iterable[str] | None = None
) -> Drawing:
    """Legacy ``_get_authorized_drawing``: drawings ⋈ project_members, else 404."""
    drawing = db.get(Drawing, drawing_id)
    if drawing is None:
        raise not_found("Drawing not found")
    require_project_member(
        db, drawing.project_id, user, roles=roles, detail="Drawing not found"
    )
    return drawing


def get_authorized_pin(
    db: Session, pin_id: int, user: AuthUser, *, roles: Iterable[str] | None = None
) -> tuple[InspectionPin, Drawing]:
    """Legacy ``_get_authorized_pin``: pins ⋈ drawings ⋈ project_members, else 404."""
    pin = db.get(InspectionPin, pin_id)
    if pin is None:
        raise not_found("Pin not found")
    drawing = db.get(Drawing, pin.drawing_id)
    if drawing is None:  # pragma: no cover - FK guarantees the parent
        raise not_found("Pin not found")
    require_project_member(
        db, drawing.project_id, user, roles=roles, detail="Pin not found"
    )
    return pin, drawing


def ensure_finding_in_project(db: Session, finding_id: int, project_id: int) -> None:
    """A pin may only link to a finding of an inspection in the same project.

    Rebuild addition (the legacy router relied on the FK alone): a finding from
    another project is indistinguishable from a missing one — 404.
    """
    finding = db.get(Finding, finding_id)
    inspection = (
        db.get(Inspection, finding.inspection_id) if finding is not None else None
    )
    if inspection is None or inspection.project_id != project_id:
        raise not_found("Finding not found")


def ensure_inspection_open(inspection: Inspection) -> None:
    """Block 8B: findings are locked once an inspection is signed off."""
    if inspection.inspection_status == "closed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Inspection is signed off; reopen it to change findings",
        )
