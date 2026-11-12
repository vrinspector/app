"""ITP templates, sign-off roles, project ITPs and their lines (increment 13).

Block 9.5 (PRD v2.63 §5) — new routes, no legacy counterpart:

    GET    /itp-templates[?include_archived]      → the caller's masters (latest version each);
                                                    a new account is first given the
                                                    starter library (13.7)
    POST   /itp-templates                         → 201 master, version 1
    GET    /itp-templates/{id}                    → one version, with body + version list
    PUT    /itp-templates/{id}                    → 201 the next version (content edits)
    PATCH  /itp-templates/{id}/status             → that version's status (draft / published / archived)

    GET    /projects/{id}/signoff-roles           → roles, with how many lines need each
    POST   /projects/{id}/signoff-roles           → 201 role          (owner)
    POST   /projects/{id}/signoff-roles/defaults  → roles after adding the missing
                                                    default three (owner, 13.6)
    PUT    /signoff-roles/{id}                    → role              (owner)
    DELETE /signoff-roles/{id}                    → 204; 409 while lines need it (owner)

    GET    /projects/{id}/itps[?area_id]          → ITP summaries
    POST   /projects/{id}/itps                    → 201 frozen copy of a master
    POST   /projects/{id}/itps/bulk               → 201 one frozen copy per area
    GET    /projects/{id}/itp-items               → every line, for the pin picker
    GET    /itps/{id}                             → ITP with lines, roles, signatures, pins
    PUT    /itps/{id}                             → title / area / status
    DELETE /itps/{id}                             → 204; 409 once anything is signed
    PUT    /itp-items/{id}                        → record a line's result / notes /
                                                    measured value
    POST   /itp-items/{id}/signatures             → 201 in-app sign-off of a line

Rules enforced here (the data model leaves them to the API layer):

* An ITP is a **frozen copy**: import copies the master's body and turns each
  question into an ``itp_items`` row; nothing done to the master later
  reaches it.
* **Hold points block.** A line after an unreleased hold point cannot be
  recorded, and the ITP cannot be completed while a line is pending or failed
  or a hold point is waiting (``app/api/itp_state.py``).
* Signed lines keep their result; a complete or voided ITP is read-only until
  reopened.
* **Line evidence (13.6).** A line whose template sets ``photoRequired``
  cannot be passed, nor signed, until at least one photo is on file
  (``photos.itp_item_id``; uploaded with ``/photos/presign`` → S3 →
  ``/photos``). Number / text lines take a measured value next to the result;
  a number outside the line's min / max is flagged, not refused.
* **Three-shot set (13.8).** A line whose template sets ``photoSet:
  "three_shot"`` needs a Context, an Intermediate and a Close-up-with-scale
  photo (``photos.shot_slot``) before it can pass or be signed.
* **Release lines (13.9).** A line whose template sets ``resultScale:
  "release"`` is recorded as Approved (``status: "pass"``), Approved with
  conditions (``"pass"`` plus written ``conditions``) or Rejected
  (``"fail"``); N/A is refused and conditions are cleared when the line is no
  longer approved. ``result_label`` gives the result in words.
* **Document numbers (13.8).** Each new ITP takes the project's next ``seq``
  (the project row is locked while it is given, so two imports at once
  cannot take the same number); ``doc_number`` reads
  ``ITP-<project code>-<seq>``.
* Same-project checks: an ITP's area, a role and a pin's line all belong to
  the ITP's project, else 404.
"""

import copy
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.api.authz import (
    MANAGE_ROLES,
    WRITE_ROLES,
    current_email,
    ensure_area_in_project,
    get_authorized_itp,
    get_authorized_itp_item,
    get_authorized_project,
    get_authorized_signoff_role,
    get_owned_template,
    require_project_member,
)
from app.api.deps import CurrentUser, SessionDep
from app.api.itp_state import (
    evidence_gap,
    item_public,
    itp_public,
    itp_summary,
    load_itp_state,
    load_itp_states,
    signature_public,
)
from app.core.auth import AuthUser
from app.core.config import settings
from app.core.itp import DEFAULT_ROLES, TemplateError, parse_template_body
from app.core.itp_library import seed_starter_library
from app.core.packs import regenerate_in_background
from app.core.signing import weather_stamp
from app.models import (
    ItpItem,
    ItpItemPublic,
    ItpItemRef,
    ItpItemRequiredRole,
    ItpItemUpdate,
    ItpSignature,
    ItpSignatureCreate,
    ItpSignaturePublic,
    ItpTemplate,
    ItpTemplateCreate,
    ItpTemplatePublic,
    ItpTemplateStatusUpdate,
    ItpTemplateSummary,
    ItpTemplateUpdate,
    ItpTemplateVersion,
    Project,
    ProjectItp,
    ProjectItpBulkCreate,
    ProjectItpCreate,
    ProjectItpPublic,
    ProjectItpSummary,
    ProjectItpUpdate,
    SignoffRole,
    SignoffRoleCreate,
    SignoffRolePublic,
    SignoffRoleUpdate,
)

router = APIRouter(tags=["itps"])


def conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def unprocessable(detail: str) -> HTTPException:
    return HTTPException(status_code=422, detail=detail)


def _parse_or_422(body: dict[str, Any]) -> Any:
    try:
        return parse_template_body(body)
    except TemplateError as exc:
        raise unprocessable(str(exc)) from exc


# ── Master templates ────────────────────────────────────────────────────────


def _template_summary(template: ItpTemplate) -> dict[str, Any]:
    try:
        parsed = parse_template_body(template.body)
        counts = (len(parsed.items), parsed.hold_count, [r.name for r in parsed.roles])
    except TemplateError:  # pragma: no cover - bodies are validated on save
        counts = (0, 0, [])
    return {
        "id": template.id,
        "public_id": template.public_id,
        "template_key": template.template_key,
        "version": template.version,
        "name": template.name,
        "description": template.description,
        "status": template.status,
        "item_count": counts[0],
        "hold_count": counts[1],
        "role_names": counts[2],
        "created_by": template.created_by,
        "created_at": template.created_at,
        "updated_at": template.updated_at,
    }


def _versions(db: Session, template: ItpTemplate) -> list[ItpTemplate]:
    return list(
        db.exec(
            select(ItpTemplate)
            .where(ItpTemplate.template_key == template.template_key)
            .where(ItpTemplate.created_by_sub == template.created_by_sub)
            .order_by(col(ItpTemplate.version).desc())
        ).all()
    )


def _template_public(db: Session, template: ItpTemplate) -> ItpTemplatePublic:
    return ItpTemplatePublic.model_validate(
        {
            **_template_summary(template),
            "body": template.body,
            "versions": [
                ItpTemplateVersion(
                    id=v.id or 0,
                    version=v.version,
                    status=v.status,
                    created_at=v.created_at or datetime.now(UTC),
                )
                for v in _versions(db, template)
            ],
        }
    )


@router.get("/itp-templates", response_model=list[ItpTemplateSummary])
def list_templates(
    session: SessionDep,
    current_user: CurrentUser,
    include_archived: bool = Query(default=False),
) -> Any:
    """The caller's masters, latest version of each, most recently changed first.

    An account that has never had a master is first given the starter library
    (increment 13.7, ``app/core/itp_library.py``).
    """
    if settings.ITP_STARTER_LIBRARY:
        seed_starter_library(session, current_user, current_email(current_user))
    rows = session.exec(
        select(ItpTemplate)
        .where(ItpTemplate.created_by_sub == current_user.sub)
        .order_by(col(ItpTemplate.version).desc())
    ).all()
    latest: dict[Any, ItpTemplate] = {}
    for row in rows:
        latest.setdefault(row.template_key, row)
    result = [t for t in latest.values() if include_archived or t.status != "archived"]
    # Newest first; ties (the starters are seeded together) in creation order.
    result.sort(
        key=lambda t: (
            t.updated_at or datetime.min.replace(tzinfo=UTC),
            -(t.id or 0),
        ),
        reverse=True,
    )
    return [ItpTemplateSummary.model_validate(_template_summary(t)) for t in result]


@router.post(
    "/itp-templates",
    response_model=ItpTemplatePublic,
    status_code=status.HTTP_201_CREATED,
)
def create_template(
    payload: ItpTemplateCreate, session: SessionDep, current_user: CurrentUser
) -> Any:
    _parse_or_422(payload.body)
    template = ItpTemplate(
        name=payload.name,
        description=payload.description,
        status=payload.status,
        body=payload.body,
        version=1,
        created_by=current_email(current_user),
        created_by_sub=current_user.sub,
    )
    session.add(template)
    session.commit()
    session.refresh(template)
    return _template_public(session, template)


@router.get("/itp-templates/{template_id}", response_model=ItpTemplatePublic)
def read_template(
    template_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    return _template_public(
        session, get_owned_template(session, template_id, current_user)
    )


@router.put(
    "/itp-templates/{template_id}",
    response_model=ItpTemplatePublic,
    status_code=status.HTTP_201_CREATED,
)
def update_template(
    template_id: int,
    payload: ItpTemplateUpdate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    """Editing a master adds the next version; project copies are untouched."""
    template = get_owned_template(session, template_id, current_user)
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    latest = _versions(session, template)[0]
    if latest.id != template.id:
        raise conflict(f"Edit the latest version (v{latest.version}) instead")
    body = updates.get("body") or template.body
    _parse_or_422(body)
    new = ItpTemplate(
        template_key=template.template_key,
        version=template.version + 1,
        name=updates.get("name") or template.name,
        description=(
            updates["description"] if "description" in updates else template.description
        ),
        status=template.status,
        body=body,
        created_by=current_email(current_user),
        created_by_sub=current_user.sub,
    )
    session.add(new)
    session.commit()
    session.refresh(new)
    return _template_public(session, new)


@router.patch("/itp-templates/{template_id}/status", response_model=ItpTemplatePublic)
def update_template_status(
    template_id: int,
    payload: ItpTemplateStatusUpdate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    template = get_owned_template(session, template_id, current_user)
    template.status = payload.status
    session.add(template)
    session.commit()
    session.refresh(template)
    return _template_public(session, template)


# ── Sign-off roles (per project, owner decision 36) ──────────────────────────


def _role_public(db: Session, role: SignoffRole) -> SignoffRolePublic:
    count = db.exec(
        select(func.count())
        .select_from(ItpItemRequiredRole)
        .where(ItpItemRequiredRole.signoff_role_id == role.id)
    ).one()
    return SignoffRolePublic.model_validate(role, update={"item_count": count})


def _role_name_taken(
    db: Session, project_id: int, name: str, exclude: int | None = None
) -> bool:
    stmt = (
        select(SignoffRole)
        .where(SignoffRole.project_id == project_id)
        .where(func.lower(col(SignoffRole.role_name)) == name.strip().lower())
    )
    return any(r.id != exclude for r in db.exec(stmt).all())


@router.get(
    "/projects/{project_id}/signoff-roles", response_model=list[SignoffRolePublic]
)
def list_signoff_roles(
    project_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    get_authorized_project(session, project_id, current_user)
    roles = session.exec(
        select(SignoffRole)
        .where(SignoffRole.project_id == project_id)
        .order_by(col(SignoffRole.id))
    ).all()
    return [_role_public(session, r) for r in roles]


@router.post(
    "/projects/{project_id}/signoff-roles",
    response_model=SignoffRolePublic,
    status_code=status.HTTP_201_CREATED,
)
def create_signoff_role(
    project_id: int,
    payload: SignoffRoleCreate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    get_authorized_project(session, project_id, current_user, roles=MANAGE_ROLES)
    name = payload.role_name.strip()
    if _role_name_taken(session, project_id, name):
        raise conflict(f"There is already a role called “{name}”")
    role = SignoffRole(
        project_id=project_id,
        role_name=name,
        party=payload.party,
        signer_email=str(payload.signer_email) if payload.signer_email else None,
    )
    session.add(role)
    session.commit()
    session.refresh(role)
    return _role_public(session, role)


@router.post(
    "/projects/{project_id}/signoff-roles/defaults",
    response_model=list[SignoffRolePublic],
)
def add_default_signoff_roles(
    project_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    """Add whichever of Contractor / Owner's representative / Third-party
    inspector the project does not have yet (owner review 2026-11-10)."""
    get_authorized_project(session, project_id, current_user, roles=MANAGE_ROLES)
    for name, party in DEFAULT_ROLES:
        if not _role_name_taken(session, project_id, name):
            session.add(SignoffRole(project_id=project_id, role_name=name, party=party))
    session.commit()
    return list_signoff_roles(project_id, session, current_user)


@router.put("/signoff-roles/{role_id}", response_model=SignoffRolePublic)
def update_signoff_role(
    role_id: int,
    payload: SignoffRoleUpdate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    role = get_authorized_signoff_role(
        session, role_id, current_user, roles=MANAGE_ROLES
    )
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if updates.get("role_name"):
        name = updates["role_name"].strip()
        if _role_name_taken(session, role.project_id, name, exclude=role.id):
            raise conflict(f"There is already a role called “{name}”")
        role.role_name = name
    if updates.get("party"):
        role.party = updates["party"]
    if "signer_email" in updates:
        role.signer_email = (
            str(updates["signer_email"]) if updates["signer_email"] else None
        )
    session.add(role)
    session.commit()
    session.refresh(role)
    return _role_public(session, role)


@router.delete("/signoff-roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_signoff_role(
    role_id: int, session: SessionDep, current_user: CurrentUser
) -> None:
    role = get_authorized_signoff_role(
        session, role_id, current_user, roles=MANAGE_ROLES
    )
    if _role_public(session, role).item_count:
        # Deleting it would quietly clear hold points that wait on it.
        raise conflict(
            "ITP lines still need this role; it can be renamed but not deleted"
        )
    session.delete(role)
    session.commit()


# ── Project ITPs (frozen copies) ────────────────────────────────────────────


def _import(
    db: Session,
    *,
    template: ItpTemplate,
    project_id: int,
    area_id: int | None,
    title: str,
    user: AuthUser,
) -> ProjectItp:
    """Copy the master into the project and materialise its lines.

    Roles are matched to the project's by name (case-insensitive) and created
    when missing, with the party the template gives them.
    """
    parsed = _parse_or_422(template.body)
    roles = {
        r.role_name.casefold(): r
        for r in db.exec(
            select(SignoffRole).where(SignoffRole.project_id == project_id)
        ).all()
    }
    for parsed_role in parsed.roles:
        if parsed_role.name.casefold() not in roles:
            role = SignoffRole(
                project_id=project_id,
                role_name=parsed_role.name,
                party=parsed_role.party,
            )
            db.add(role)
            db.flush()
            roles[parsed_role.name.casefold()] = role
    itp = ProjectItp(
        project_id=project_id,
        area_id=area_id,
        template_id=template.id,
        template_version=template.version,
        seq=_next_seq(db, project_id),
        title=title[:255],
        status="not_started",
        body=copy.deepcopy(template.body),
        created_by=current_email(user),
    )
    db.add(itp)
    db.flush()
    assert itp.id is not None
    for index, parsed_item in enumerate(parsed.items):
        item = ItpItem(
            project_itp_id=itp.id,
            section=parsed_item.section,
            element_name=parsed_item.element_name,
            requirement=parsed_item.requirement,
            classification=parsed_item.classification,
            sort_order=(index + 1) * 10,
            acceptance_criteria=parsed_item.acceptance_criteria,
            reference_doc=parsed_item.reference,
            record_required=parsed_item.record_required,
            photo_required=parsed_item.photo_required,
            photo_set=parsed_item.photo_set,
            result_scale=parsed_item.result_scale,
            approved_label=parsed_item.approved_label,
            value_type=parsed_item.value_type,
            value_unit=parsed_item.unit,
            value_min=parsed_item.min_value,
            value_max=parsed_item.max_value,
        )
        db.add(item)
        db.flush()
        assert item.id is not None
        for role_name in parsed_item.roles:
            role_id = roles[role_name.casefold()].id
            assert role_id is not None
            db.add(ItpItemRequiredRole(itp_item_id=item.id, signoff_role_id=role_id))
    return itp


def _next_seq(db: Session, project_id: int) -> int:
    """The project's next ITP number, with the project row locked until commit."""
    db.exec(select(Project.id).where(Project.id == project_id).with_for_update())
    current = db.exec(
        select(func.max(ProjectItp.seq)).where(ProjectItp.project_id == project_id)
    ).one()
    return int(current or 0) + 1


def _importable_template(db: Session, template_id: int, user: AuthUser) -> ItpTemplate:
    template = get_owned_template(db, template_id, user)
    if template.status == "archived":
        raise conflict("This template is archived; restore it before applying it")
    return template


@router.get("/projects/{project_id}/itps", response_model=list[ProjectItpSummary])
def list_project_itps(
    project_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    area_id: int | None = Query(default=None),
) -> Any:
    get_authorized_project(session, project_id, current_user)
    stmt = select(ProjectItp).where(ProjectItp.project_id == project_id)
    if area_id is not None:
        stmt = stmt.where(ProjectItp.area_id == area_id)
    stmt = stmt.order_by(col(ProjectItp.created_at), col(ProjectItp.id))
    return [itp_summary(s) for s in load_itp_states(session, session.exec(stmt).all())]


@router.post(
    "/projects/{project_id}/itps",
    response_model=ProjectItpPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_project_itp(
    project_id: int,
    payload: ProjectItpCreate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    get_authorized_project(session, project_id, current_user, roles=WRITE_ROLES)
    template = _importable_template(session, payload.template_id, current_user)
    area = (
        ensure_area_in_project(session, payload.area_id, project_id)
        if payload.area_id is not None
        else None
    )
    title = payload.title or (
        f"{template.name} — {area.name}" if area is not None else template.name
    )
    itp = _import(
        session,
        template=template,
        project_id=project_id,
        area_id=area.id if area else None,
        title=title,
        user=current_user,
    )
    session.commit()
    session.refresh(itp)
    return itp_public(load_itp_state(session, itp))


@router.post(
    "/projects/{project_id}/itps/bulk",
    response_model=list[ProjectItpSummary],
    status_code=status.HTTP_201_CREATED,
)
def bulk_create_project_itps(
    project_id: int,
    payload: ProjectItpBulkCreate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    """Bulk apply one master to many areas: one frozen copy per area, all or none."""
    get_authorized_project(session, project_id, current_user, roles=WRITE_ROLES)
    template = _importable_template(session, payload.template_id, current_user)
    area_ids = list(dict.fromkeys(payload.area_ids))
    areas = [ensure_area_in_project(session, a, project_id) for a in area_ids]
    created = [
        _import(
            session,
            template=template,
            project_id=project_id,
            area_id=area.id,
            title=f"{template.name} — {area.name}",
            user=current_user,
        )
        for area in areas
    ]
    session.commit()
    for itp in created:
        session.refresh(itp)
    return [itp_summary(s) for s in load_itp_states(session, created)]


@router.get("/projects/{project_id}/itp-items", response_model=list[ItpItemRef])
def list_project_itp_items(
    project_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    get_authorized_project(session, project_id, current_user)
    itps = session.exec(
        select(ProjectItp)
        .where(ProjectItp.project_id == project_id)
        .where(ProjectItp.status != "voided")
        .order_by(col(ProjectItp.created_at), col(ProjectItp.id))
    ).all()
    refs: list[ItpItemRef] = []
    for state in load_itp_states(session, itps):
        for item_state in state.items:
            item = item_state.item
            assert item.id is not None and state.itp.id is not None
            refs.append(
                ItpItemRef(
                    id=item.id,
                    project_itp_id=state.itp.id,
                    itp_title=state.itp.title,
                    doc_number=state.doc_number,
                    area_name=state.area.name if state.area else None,
                    section=item.section,
                    requirement=item.requirement,
                    classification=item.classification,
                    status=item.status,
                    released=item_state.released,
                )
            )
    return refs


@router.get("/itps/{itp_id}", response_model=ProjectItpPublic)
def read_project_itp(
    itp_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    itp = get_authorized_itp(session, itp_id, current_user)
    return itp_public(load_itp_state(session, itp))


@router.put("/itps/{itp_id}", response_model=ProjectItpPublic)
def update_project_itp(
    itp_id: int,
    payload: ProjectItpUpdate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    itp = get_authorized_itp(session, itp_id, current_user, roles=WRITE_ROLES)
    member = require_project_member(session, itp.project_id, current_user)
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if updates.get("title"):
        itp.title = updates["title"]
    if "area_id" in updates:
        area_id = updates["area_id"]
        if area_id is not None:
            ensure_area_in_project(session, area_id, itp.project_id)
        itp.area_id = area_id
    new_status = updates.get("status")
    if new_status and new_status != itp.status:
        if "voided" in (new_status, itp.status) and member.role not in MANAGE_ROLES:
            raise HTTPException(
                status_code=403,
                detail="Only a project owner can void or restore an ITP",
            )
        if new_status == "complete":
            blockers = load_itp_state(session, itp).completion_blockers()
            if blockers:
                raise conflict("Not ready to complete: " + "; ".join(blockers))
        itp.status = new_status
    itp.updated_at = datetime.now(UTC)
    session.add(itp)
    session.commit()
    session.refresh(itp)
    return itp_public(load_itp_state(session, itp))


@router.delete("/itps/{itp_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project_itp(
    itp_id: int, session: SessionDep, current_user: CurrentUser
) -> None:
    itp = get_authorized_itp(session, itp_id, current_user, roles=WRITE_ROLES)
    session.delete(itp)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise conflict(
            "This ITP has signatures and cannot be deleted; void it instead"
        ) from exc


# ── Lines: record results, sign off ─────────────────────────────────────────


def _ensure_recordable(state: Any) -> None:
    if state.blocked_by is not None:
        raise conflict(
            f"Waiting for hold point “{state.blocked_by.requirement}” to be "
            "signed off before this line can be recorded"
        )
    if state.signatures:
        raise conflict("This line is signed; its result can no longer change")


def normalise_measured_value(item: ItpItem, raw: str | None) -> str | None:
    """Trim; a number line takes a number (``1,250.5`` → ``1250.5``)."""
    value = (raw or "").strip()
    if not value:
        return None
    if item.value_type is None:
        raise unprocessable("This line does not take a measured value")
    if item.value_type == "number":
        try:
            number = float(value.replace(",", ""))
        except ValueError as exc:
            raise unprocessable(f"“{value}” is not a number") from exc
        if number != number or number in (float("inf"), float("-inf")):
            raise unprocessable(f"“{value}” is not a number")
        if number.is_integer() and abs(number) < 1e15:
            return str(int(number))
        return repr(number)
    return value


def _ensure_editable(itp: ProjectItp) -> None:
    if itp.status == "complete":
        raise conflict("This ITP is complete; reopen it to change results")
    if itp.status == "voided":
        raise conflict("This ITP is voided")


def _apply_release(item: ItpItem, state: Any, updates: dict[str, Any]) -> None:
    """Increment 13.9: Approved / Approved with conditions / Rejected.

    Approved with conditions is ``status: "pass"`` plus written conditions;
    the conditions are kept only while the line is approved. N/A is refused:
    a release is recorded in writing either way.
    """
    new_status = updates.get("status")
    if new_status == "na":
        raise unprocessable(
            "A release line is recorded as Approved, Approved with conditions "
            "or Rejected, not N/A"
        )
    status_after = new_status if new_status is not None else item.status
    if "conditions" in updates:
        text = (updates["conditions"] or "").strip() or None
        if text is not None and status_after != "pass":
            raise unprocessable("Conditions go with an approval; record it first")
        if text != item.conditions:
            _ensure_recordable(state)
            item.conditions = text
    if status_after != "pass" and item.conditions is not None:
        _ensure_recordable(state)
        item.conditions = None


@router.put("/itp-items/{item_id}", response_model=ItpItemPublic)
def update_itp_item(
    item_id: int,
    payload: ItpItemUpdate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    item, itp = get_authorized_itp_item(
        session, item_id, current_user, roles=WRITE_ROLES
    )
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    _ensure_editable(itp)
    state = load_itp_state(session, itp).item(item_id)
    new_status = updates.get("status")
    if "measured_value" in updates:
        value = normalise_measured_value(item, updates["measured_value"])
        if value != item.measured_value:
            _ensure_recordable(state)
            item.measured_value = value
    if item.result_scale == "release":
        _apply_release(item, state, updates)
    elif updates.get("conditions"):
        raise unprocessable("Only a release line takes conditions")
    if new_status is not None and new_status != item.status:
        _ensure_recordable(state)
        if new_status == "pass" and not state.evidenced:
            gap = evidence_gap(item, state.shot_slots)
            raise conflict(
                f"This line needs {gap} before it can pass — take or upload "
                "the photo first"
            )
        item.status = new_status
        if itp.status == "not_started":
            itp.status = "in_progress"
            itp.updated_at = datetime.now(UTC)
            session.add(itp)
    if "notes" in updates:
        item.notes = updates["notes"]
    item.updated_at = datetime.now(UTC)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item_public(load_itp_state(session, itp).item(item_id))


@router.post(
    "/itp-items/{item_id}/signatures",
    response_model=ItpSignaturePublic,
    status_code=status.HTTP_201_CREATED,
)
def sign_itp_item(
    item_id: int,
    payload: ItpSignatureCreate,
    session: SessionDep,
    current_user: CurrentUser,
    background: BackgroundTasks,
) -> Any:
    """In-app sign-off of one line for one of its required roles.

    A role with a signer email is signed only by the member signed in with
    that email (any project role, so a client engineer invited as a viewer
    can sign); a role without one is signed by a project owner. External
    no-account links are increment 14 (``signoff.py``). Increment 14 adds the
    weather stamp and refreshes the sign-off pack in the background.
    """
    item, itp = get_authorized_itp_item(session, item_id, current_user)
    member = require_project_member(session, itp.project_id, current_user)
    if itp.status == "voided":
        raise conflict("This ITP is voided")
    state = load_itp_state(session, itp).item(item_id)
    role = next((r for r in state.roles if r.id == payload.signoff_role_id), None)
    if role is None:
        raise unprocessable("This line does not need that sign-off role")
    if any(s.signoff_role_id == role.id for s in state.signatures):
        raise conflict(f"{role.role_name} has already signed this line")
    if state.blocked_by is not None:
        raise conflict(
            f"Waiting for hold point “{state.blocked_by.requirement}” to be "
            "signed off first"
        )
    if item.status not in ("pass", "na"):
        raise conflict("Record this line as Pass or N/A before it is signed")
    if item.status == "pass" and not state.evidenced:
        gap = evidence_gap(item, state.shot_slots)
        raise conflict(f"This line needs {gap} before it can be signed")
    if role.signer_email:
        if (current_user.email or "").casefold() != role.signer_email.casefold():
            raise HTTPException(
                status_code=403,
                detail=f"Only {role.signer_email} can sign as {role.role_name}",
            )
    elif member.role not in MANAGE_ROLES:
        raise HTTPException(
            status_code=403,
            detail=(
                f"{role.role_name} has no signer email; a project owner signs "
                "for it, or add the signer's email to the role"
            ),
        )
    signature = ItpSignature(
        project_itp_id=itp.id or 0,
        itp_item_id=item.id,
        signoff_role_id=role.id,
        role_name=role.role_name,
        party=role.party,
        signer_name=payload.signer_name or current_user.name,
        signer_email=current_email(current_user),
        signer_sub=current_user.sub,
        method="in_app",
        gps_lat=Decimal(str(round(payload.gps_lat, 6)))
        if payload.gps_lat is not None
        else None,
        gps_lng=Decimal(str(round(payload.gps_lng, 6)))
        if payload.gps_lng is not None
        else None,
        weather=weather_stamp(session.get(Project, itp.project_id)),
    )
    session.add(signature)
    if itp.status == "not_started":
        itp.status = "in_progress"
        session.add(itp)
    session.commit()
    session.refresh(signature)
    background.add_task(
        regenerate_in_background,
        [itp.id or 0],
        [itp.area_id] if itp.area_id else [],
        current_email(current_user),
    )
    return signature_public(signature)
