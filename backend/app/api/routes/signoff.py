"""External sign-off, sign-off packs and witness notices (increment 14).

Block 9.5 (PRD v2.63 §5) — new routes, no legacy counterpart.

Signed-in (members of the ITP's / area's project; 404 object hiding):

    GET    /itps/{id}/sign-links            → the ITP's signing links, newest first
    POST   /itps/{id}/sign-links            → 201 {links, skipped}: email a link to one
                                              role, or to every role with lines ready
    GET    /areas/{id}/sign-links           → the area's combined-pack links
    POST   /areas/{id}/sign-links           → 201 as above, one link per role for the
                                              whole area (one email, one visit)
    POST   /sign-links/{id}/remind          → 201 a fresh link emailed as a reminder;
                                              the old one is marked replaced
    POST   /sign-links/{id}/revoke          → the link, withdrawn
    GET    /itps/{id}/packs                 → pack versions, newest first
    POST   /itps/{id}/packs                 → the current pack (renders a new version
                                              only if something on it changed)
    GET    /areas/{id}/packs, POST /areas/{id}/packs  → the area's combined pack
    POST   /itp-items/{id}/witness-notice   → email the line's notified parties

No account (the link is the credential):

    GET    /sign/{token}                    → what the link signs, line by line
    POST   /sign/{token}                    → sign every ready line, once

Who may do what: any member reads links and packs (viewers too — a pack is
a read-out, like a report); owners and inspectors send, remind and withdraw
links and send notices (the people running the work).
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from sqlmodel import Session, col, select

from app.api.authz import (
    WRITE_ROLES,
    current_email,
    get_authorized_area,
    get_authorized_itp,
    get_authorized_itp_item,
    not_found,
    require_project_member,
)
from app.api.deps import CurrentUser, SessionDep
from app.api.itp_state import ItpState, load_itp_states, out_of_tolerance, result_label
from app.core import packs
from app.core.config import settings
from app.core.email import (
    deliver,
    queue_email,
    sign_request_email,
    witness_notice_email,
)
from app.core.signing import (
    GONE_MESSAGES,
    INVALID_LINK,
    RoleLine,
    SignatureImageError,
    decode_signature_png,
    hash_token,
    link_expiry,
    link_status,
    link_url,
    new_token,
    role_lines,
    weather_stamp,
)
from app.core.storage import storage
from app.models import (
    EmailSendLog,
    ExternalSignToken,
    ItpSignature,
    ItpSignPack,
    Project,
    ProjectArea,
    ProjectItp,
    SignDocument,
    SignLine,
    SignLinkBatch,
    SignLinkCreate,
    SignLinkPublic,
    SignoffRole,
    SignPackPublic,
    SignResult,
    SignSessionPublic,
    SignSubmit,
    WitnessNoticeCreate,
    WitnessNoticeResult,
)

router = APIRouter(tags=["signoff"])

SIGN_EMAIL_TYPES = ("sign_request", "sign_reminder")


def conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


# ── Documents a link covers ─────────────────────────────────────────────────


class Scope:
    """One ITP, or one area's live ITPs, with their project."""

    def __init__(
        self,
        db: Session,
        *,
        itp: ProjectItp | None = None,
        area: ProjectArea | None = None,
    ) -> None:
        self.itp = itp
        self.area = area
        if itp is not None:
            assert area is None
            project_id = itp.project_id
            self.itps = [itp]
        else:
            assert area is not None
            project_id = area.project_id
            self.itps = packs.area_itps(db, area)
        project = db.get(Project, project_id)
        assert project is not None
        self.project = project

    @classmethod
    def of_token(cls, db: Session, token: ExternalSignToken) -> Scope:
        if token.project_itp_id is not None:
            itp = db.get(ProjectItp, token.project_itp_id)
            assert itp is not None  # CASCADE removes the token with the ITP
            return cls(db, itp=itp)
        area = db.get(ProjectArea, token.area_id)
        assert area is not None
        return cls(db, area=area)

    def states(self, db: Session) -> list[ItpState]:
        return load_itp_states(db, self.itps)

    def token_filter(self) -> Any:
        if self.itp is not None:
            return col(ExternalSignToken.project_itp_id) == self.itp.id
        assert self.area is not None
        return col(ExternalSignToken.area_id) == self.area.id

    def pack_target(self) -> packs.PackTarget:
        return packs.PackTarget(
            project=self.project, itps=self.itps, itp=self.itp, area=self.area
        )

    def document_names(self, states: list[ItpState]) -> list[str]:
        names = []
        for state in states:
            if state.itp.status == "voided":
                continue
            label = (
                f"{state.doc_number} {state.itp.title}"
                if state.doc_number
                else state.itp.title
            )
            names.append(label)
        if self.area is not None:
            return (
                [f"{self.area.name}: " + "; ".join(names)]
                if names
                else [self.area.name]
            )
        return names


def _roles_needed(states: list[ItpState]) -> list[SignoffRole]:
    seen: dict[int, SignoffRole] = {}
    for state in states:
        if state.itp.status == "voided":
            continue
        for line in state.items:
            for role in line.roles:
                if role.id is not None:
                    seen.setdefault(role.id, role)
    return sorted(seen.values(), key=lambda r: r.id or 0)


# ── Links: read model ───────────────────────────────────────────────────────


def _email_statuses(db: Session, token_ids: list[int]) -> dict[int, str]:
    if not token_ids:
        return {}
    rows = db.exec(
        select(EmailSendLog)
        .where(col(EmailSendLog.email_type).in_(SIGN_EMAIL_TYPES))
        .where(col(EmailSendLog.related_id).in_(token_ids))
        .order_by(col(EmailSendLog.created_at), col(EmailSendLog.id))
    ).all()
    out: dict[int, str] = {}
    for row in rows:
        if row.related_id is not None:
            out[row.related_id] = row.status
    return out


def _link_public(
    token: ExternalSignToken,
    role_name: str,
    email_status: str | None = None,
    raw: str | None = None,
) -> SignLinkPublic:
    assert token.id is not None and token.public_id is not None
    assert token.expires_at is not None and token.created_at is not None
    return SignLinkPublic(
        id=token.id,
        public_id=token.public_id,
        project_itp_id=token.project_itp_id,
        area_id=token.area_id,
        signoff_role_id=token.signoff_role_id,
        role_name=role_name,
        signer_email=token.signer_email,
        status=link_status(token),
        expires_at=token.expires_at,
        used_at=token.used_at,
        revoked_at=token.revoked_at,
        reminder_count=token.reminder_count,
        created_by=token.created_by,
        created_at=token.created_at,
        email_status=email_status,
        link=link_url(raw) if raw is not None else None,
    )


def _list_links(db: Session, scope: Scope) -> list[SignLinkPublic]:
    rows = db.exec(
        select(ExternalSignToken, SignoffRole)
        .join(
            SignoffRole, col(SignoffRole.id) == col(ExternalSignToken.signoff_role_id)
        )
        .where(scope.token_filter())
        .order_by(
            col(ExternalSignToken.created_at).desc(), col(ExternalSignToken.id).desc()
        )
    ).all()
    statuses = _email_statuses(db, [t.id for t, _ in rows if t.id is not None])
    return [_link_public(t, r.role_name, statuses.get(t.id or 0)) for t, r in rows]


# ── Links: issue, remind, withdraw ──────────────────────────────────────────


def _issue(
    db: Session,
    background: BackgroundTasks | None,
    *,
    scope: Scope,
    states: list[ItpState],
    role: SignoffRole,
    signer_email: str,
    requester: str,
    reminder_count: int = 0,
) -> SignLinkPublic:
    """Replace any live link for this role + document, create one, email it."""
    now = datetime.now(UTC)
    for old in db.exec(
        select(ExternalSignToken)
        .where(scope.token_filter())
        .where(ExternalSignToken.signoff_role_id == role.id)
        .where(col(ExternalSignToken.used_at).is_(None))
        .where(col(ExternalSignToken.revoked).is_(False))
    ).all():
        old.revoked = True
        old.revoked_at = now
        old.revoked_reason = "replaced"
        db.add(old)
    raw, digest = new_token()
    token = ExternalSignToken(
        token_hash=digest,
        project_itp_id=scope.itp.id if scope.itp is not None else None,
        area_id=scope.area.id if scope.area is not None else None,
        signoff_role_id=role.id or 0,
        signer_email=signer_email,
        expires_at=link_expiry(now),
        reminder_count=reminder_count,
        created_by=requester,
    )
    db.add(token)
    db.commit()
    db.refresh(token)
    assert token.id is not None and token.expires_at is not None
    ready = [rl for rl in role_lines(states, role.id or 0) if rl.sign_state == "ready"]
    rendered = sign_request_email(
        project=scope.project,
        role_name=role.role_name,
        documents=scope.document_names(states),
        ready_count=len(ready),
        expires_at=token.expires_at,
        signer_email=signer_email,
        requester=requester,
        link=link_url(raw),
        reminder=reminder_count > 0,
    )
    log = queue_email(
        db,
        email_type="sign_reminder" if reminder_count else "sign_request",
        recipient=signer_email,
        rendered=rendered,
        project_id=scope.project.id,
        related_id=token.id,
        triggered_by=requester,
    )
    if log.status == "queued":
        assert log.id is not None
        if background is not None:
            background.add_task(deliver, log.id, rendered)
        else:  # the reminders job: no request to hang the task on
            deliver(log.id, rendered)
            db.refresh(log)
    return _link_public(token, role.role_name, log.status, raw)


def _request_links(
    db: Session,
    background: BackgroundTasks,
    scope: Scope,
    payload: SignLinkCreate,
    requester: str,
) -> SignLinkBatch:
    states = scope.states(db)
    needed = _roles_needed(states)
    if payload.signoff_role_id is not None:
        role = next((r for r in needed if r.id == payload.signoff_role_id), None)
        if role is None:
            raise HTTPException(
                status_code=422, detail="No line here needs that sign-off role"
            )
        lines = role_lines(states, role.id or 0)
        if all(rl.sign_state == "signed" for rl in lines):
            raise conflict(_nothing_ready(role, lines))
        email = payload.signer_email or role.signer_email
        if not email:
            raise HTTPException(
                status_code=422,
                detail=f"{role.role_name} has no signer email — enter one, or add "
                "it under Sign-off roles",
            )
        if not any(rl.sign_state == "ready" for rl in lines):
            raise conflict(_nothing_ready(role, lines))
        link = _issue(
            db,
            background,
            scope=scope,
            states=states,
            role=role,
            signer_email=str(email),
            requester=requester,
        )
        return SignLinkBatch(links=[link], skipped=[])

    if payload.signer_email is not None:
        raise HTTPException(
            status_code=422, detail="Choose a role to send to a different email"
        )
    links: list[SignLinkPublic] = []
    skipped: list[str] = []
    for role in needed:
        lines = role_lines(states, role.id or 0)
        if all(rl.sign_state == "signed" for rl in lines):
            continue
        if not role.signer_email:
            skipped.append(
                f"{role.role_name}: no signer email — add one under Sign-off roles"
            )
            continue
        if not any(rl.sign_state == "ready" for rl in lines):
            skipped.append(f"{role.role_name}: nothing ready to sign yet")
            continue
        links.append(
            _issue(
                db,
                background,
                scope=scope,
                states=states,
                role=role,
                signer_email=role.signer_email,
                requester=requester,
            )
        )
    if not links and not skipped:
        raise conflict("Every required signature is already on file")
    return SignLinkBatch(links=links, skipped=skipped)


def _nothing_ready(role: SignoffRole, lines: list[RoleLine]) -> str:
    if lines and all(rl.sign_state == "signed" for rl in lines):
        return f"{role.role_name} has already signed every line"
    reason = next((rl.reason for rl in lines if rl.reason), None)
    return f"Nothing is ready for {role.role_name} to sign yet" + (
        f" ({reason.lower()})" if reason else ""
    )


@router.get("/itps/{itp_id}/sign-links", response_model=list[SignLinkPublic])
def list_itp_sign_links(
    itp_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    itp = get_authorized_itp(session, itp_id, current_user)
    return _list_links(session, Scope(session, itp=itp))


@router.post(
    "/itps/{itp_id}/sign-links",
    response_model=SignLinkBatch,
    status_code=status.HTTP_201_CREATED,
)
def create_itp_sign_links(
    itp_id: int,
    payload: SignLinkCreate,
    session: SessionDep,
    current_user: CurrentUser,
    background: BackgroundTasks,
) -> Any:
    itp = get_authorized_itp(session, itp_id, current_user, roles=WRITE_ROLES)
    if itp.status == "voided":
        raise conflict("This ITP is voided")
    return _request_links(
        session,
        background,
        Scope(session, itp=itp),
        payload,
        current_email(current_user),
    )


@router.get("/areas/{area_id}/sign-links", response_model=list[SignLinkPublic])
def list_area_sign_links(
    area_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    area = get_authorized_area(session, area_id, current_user)
    return _list_links(session, Scope(session, area=area))


@router.post(
    "/areas/{area_id}/sign-links",
    response_model=SignLinkBatch,
    status_code=status.HTTP_201_CREATED,
)
def create_area_sign_links(
    area_id: int,
    payload: SignLinkCreate,
    session: SessionDep,
    current_user: CurrentUser,
    background: BackgroundTasks,
) -> Any:
    area = get_authorized_area(session, area_id, current_user, roles=WRITE_ROLES)
    scope = Scope(session, area=area)
    if not scope.itps:
        raise conflict("This area has no ITPs to sign")
    return _request_links(
        session, background, scope, payload, current_email(current_user)
    )


def _authorized_link(
    db: Session, link_id: int, user: Any, *, write: bool
) -> tuple[ExternalSignToken, Scope]:
    token = db.get(ExternalSignToken, link_id)
    if token is None:
        raise not_found("Signing link not found")
    scope = Scope.of_token(db, token)
    require_project_member(
        db,
        scope.project.id or 0,
        user,
        roles=WRITE_ROLES if write else None,
        detail="Signing link not found",
    )
    return token, scope


@router.post(
    "/sign-links/{link_id}/remind",
    response_model=SignLinkPublic,
    status_code=status.HTTP_201_CREATED,
)
def remind_sign_link(
    link_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    background: BackgroundTasks,
) -> Any:
    token, scope = _authorized_link(session, link_id, current_user, write=True)
    state = link_status(token)
    if state in ("used", "replaced"):
        raise conflict(
            "This link has been used; send a new request for anything left"
            if state == "used"
            else "This link was already replaced by a newer one"
        )
    assert token.created_at is not None
    wait = settings.SIGN_REMINDER_COOLDOWN_SECONDS
    if datetime.now(UTC) - token.created_at < timedelta(seconds=wait):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="This link was sent moments ago — wait a minute before reminding",
        )
    role = session.get(SignoffRole, token.signoff_role_id)
    assert role is not None  # CASCADE removes the token with its role
    states = scope.states(session)
    lines = role_lines(states, role.id or 0)
    if not any(rl.sign_state == "ready" for rl in lines):
        raise conflict(_nothing_ready(role, lines))
    return _issue(
        session,
        background,
        scope=scope,
        states=states,
        role=role,
        signer_email=token.signer_email,
        requester=current_email(current_user),
        reminder_count=token.reminder_count + 1,
    )


@router.post("/sign-links/{link_id}/revoke", response_model=SignLinkPublic)
def revoke_sign_link(
    link_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    token, _ = _authorized_link(session, link_id, current_user, write=True)
    if link_status(token) == "used":
        raise conflict("This link has already been used; its signatures stand")
    if not token.revoked:
        token.revoked = True
        token.revoked_at = datetime.now(UTC)
        token.revoked_reason = "withdrawn"
        session.add(token)
        session.commit()
        session.refresh(token)
    role = session.get(SignoffRole, token.signoff_role_id)
    statuses = _email_statuses(session, [token.id or 0])
    return _link_public(
        token, role.role_name if role else "", statuses.get(token.id or 0)
    )


# ── Packs ───────────────────────────────────────────────────────────────────


def _pack_public(pack: ItpSignPack, regenerated: bool = False) -> SignPackPublic:
    assert pack.id is not None and pack.created_at is not None
    return SignPackPublic(
        id=pack.id,
        project_itp_id=pack.project_itp_id,
        area_id=pack.area_id,
        version=pack.version,
        filename=pack.filename,
        file_size=pack.file_size,
        signature_count=pack.signature_count,
        generated_by=pack.generated_by,
        created_at=pack.created_at,
        download_url=storage.presign_get(pack.s3_key),
        regenerated=regenerated,
    )


@router.get("/itps/{itp_id}/packs", response_model=list[SignPackPublic])
def list_itp_packs(itp_id: int, session: SessionDep, current_user: CurrentUser) -> Any:
    itp = get_authorized_itp(session, itp_id, current_user)
    return [
        _pack_public(p)
        for p in packs.list_packs(session, packs.itp_target(session, itp))
    ]


@router.post("/itps/{itp_id}/packs", response_model=SignPackPublic)
def current_itp_pack(
    itp_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    itp = get_authorized_itp(session, itp_id, current_user)
    pack, fresh = packs.ensure_pack(
        session,
        packs.itp_target(session, itp),
        generated_by=current_email(current_user),
    )
    return _pack_public(pack, fresh)


@router.get("/areas/{area_id}/packs", response_model=list[SignPackPublic])
def list_area_packs(
    area_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    area = get_authorized_area(session, area_id, current_user)
    return [
        _pack_public(p)
        for p in packs.list_packs(session, packs.area_target(session, area))
    ]


@router.post("/areas/{area_id}/packs", response_model=SignPackPublic)
def current_area_pack(
    area_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    area = get_authorized_area(session, area_id, current_user)
    pack, fresh = packs.ensure_pack(
        session,
        packs.area_target(session, area),
        generated_by=current_email(current_user),
    )
    return _pack_public(pack, fresh)


# ── Witness / hold point notice ─────────────────────────────────────────────


@router.post("/itp-items/{item_id}/witness-notice", response_model=WitnessNoticeResult)
def send_witness_notice(
    item_id: int,
    payload: WitnessNoticeCreate,
    session: SessionDep,
    current_user: CurrentUser,
    background: BackgroundTasks,
) -> Any:
    item, itp = get_authorized_itp_item(
        session, item_id, current_user, roles=WRITE_ROLES
    )
    if item.classification not in ("witness", "hold"):
        raise HTTPException(
            status_code=422,
            detail="Notices are for witness and hold points only",
        )
    if itp.status in ("voided", "complete"):
        raise conflict(f"This ITP is {itp.status}")
    since = datetime.now(UTC) - timedelta(
        seconds=settings.SIGN_REMINDER_COOLDOWN_SECONDS
    )
    recent = session.exec(
        select(EmailSendLog.id)
        .where(EmailSendLog.email_type == "witness_notice")
        .where(EmailSendLog.related_id == item.id)
        .where(col(EmailSendLog.created_at) > since)
    ).first()
    if recent is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="A notice for this line was sent moments ago — wait a minute",
        )
    state = load_itp_states(session, [itp])[0]
    line = state.item(item_id)
    project = session.get(Project, itp.project_id)
    assert project is not None
    sender = current_user.name or current_email(current_user)
    document = f"{state.doc_number} {itp.title}" if state.doc_number else itp.title
    sent_to: list[str] = []
    skipped: list[str] = []
    for role in line.roles:
        if not role.signer_email:
            skipped.append(
                f"{role.role_name}: no signer email — add one under Sign-off roles"
            )
            continue
        rendered = witness_notice_email(
            project=project,
            document=document,
            classification=item.classification,
            requirement=item.requirement,
            role_name=role.role_name,
            planned_for=payload.planned_for,
            message=payload.message,
            sender=sender,
        )
        log = queue_email(
            session,
            email_type="witness_notice",
            recipient=role.signer_email,
            rendered=rendered,
            project_id=project.id,
            related_id=item.id,
            triggered_by=current_email(current_user),
        )
        if log.status == "queued":
            assert log.id is not None
            background.add_task(deliver, log.id, rendered)
        sent_to.append(role.signer_email)
    if not sent_to:
        raise HTTPException(
            status_code=422,
            detail="No one to notify: "
            + ("; ".join(skipped) if skipped else "this line names no sign-off role"),
        )
    return WitnessNoticeResult(sent_to=sent_to, skipped=skipped)


# ── Public: the signing page ────────────────────────────────────────────────


def _open_token(db: Session, raw: str, *, lock: bool = False) -> ExternalSignToken:
    if not raw or len(raw) > 200:
        raise not_found(INVALID_LINK)
    stmt = select(ExternalSignToken).where(
        ExternalSignToken.token_hash == hash_token(raw)
    )
    if lock:
        stmt = stmt.with_for_update()
    token = db.exec(stmt).first()
    if token is None:
        raise not_found(INVALID_LINK)
    state = link_status(token)
    if state != "active":
        raise HTTPException(
            status_code=status.HTTP_410_GONE, detail=GONE_MESSAGES[state]
        )
    return token


def _sign_documents(states: list[ItpState], role_id: int) -> list[SignDocument]:
    by_item = {id(rl.line): rl for rl in role_lines(states, role_id)}
    docs: list[SignDocument] = []
    for state in states:
        if state.itp.status == "voided":
            continue
        lines: list[SignLine] = []
        for number, line in enumerate(state.items, start=1):
            item = line.item
            rl = by_item.get(id(line))
            lines.append(
                SignLine(
                    id=item.id or 0,
                    number=number,
                    section=item.section,
                    requirement=item.requirement,
                    classification=item.classification,
                    status=item.status,
                    result_label=result_label(item),
                    measured_value=item.measured_value,
                    value_unit=item.value_unit,
                    out_of_tolerance=out_of_tolerance(item),
                    notes=item.notes,
                    conditions=item.conditions,
                    acceptance_criteria=item.acceptance_criteria,
                    reference_doc=item.reference_doc,
                    photo_count=line.photo_count,
                    needs_you=rl is not None,
                    sign_state=rl.sign_state if rl else None,
                    waiting_reason=rl.reason if rl else None,
                )
            )
        docs.append(
            SignDocument(
                itp_id=state.itp.id or 0,
                doc_number=state.doc_number,
                title=state.itp.title,
                status=state.itp.status,
                area_name=state.area.name if state.area else None,
                lines=lines,
            )
        )
    return docs


@router.get("/sign/{token}", response_model=SignSessionPublic)
def open_signing_link(token: str, session: SessionDep) -> Any:
    link = _open_token(session, token)
    scope = Scope.of_token(session, link)
    role = session.get(SignoffRole, link.signoff_role_id)
    assert role is not None and link.expires_at is not None
    states = scope.states(session)
    lines = role_lines(states, role.id or 0)
    pack_url: str | None = None
    try:
        pack, _ = packs.ensure_pack(
            session,
            scope.pack_target(),
            generated_by=f"signing link ({link.signer_email})",
        )
        pack_url = storage.presign_get(pack.s3_key)
    except Exception:  # noqa: BLE001 - the page works without the PDF
        session.rollback()
    return SignSessionPublic(
        project_name=scope.project.name,
        project_client=scope.project.client,
        project_location=scope.project.location,
        kind="area" if scope.area is not None else "itp",
        area_name=scope.area.name if scope.area is not None else None,
        role_name=role.role_name,
        party=role.party,
        signer_email=link.signer_email,
        expires_at=link.expires_at,
        documents=_sign_documents(states, role.id or 0),
        ready_count=sum(1 for rl in lines if rl.sign_state == "ready"),
        waiting_count=sum(1 for rl in lines if rl.sign_state == "waiting"),
        signed_count=sum(1 for rl in lines if rl.sign_state == "signed"),
        pack_url=pack_url,
    )


@router.post("/sign/{token}", response_model=SignResult)
def submit_signature(
    token: str,
    payload: SignSubmit,
    session: SessionDep,
    background: BackgroundTasks,
) -> Any:
    if not payload.confirm:
        raise HTTPException(
            status_code=422, detail="Tick the box to confirm you reviewed the lines"
        )
    try:
        png = decode_signature_png(payload.signature_png)
    except SignatureImageError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    link = _open_token(session, token, lock=True)
    scope = Scope.of_token(session, link)
    role = session.get(SignoffRole, link.signoff_role_id)
    assert role is not None and role.id is not None and link.id is not None
    if not any(
        rl.sign_state == "ready" for rl in role_lines(scope.states(session), role.id)
    ):
        raise conflict(
            "Nothing is ready for your signature yet. This link still works — "
            "come back when the project team tells you the work is ready."
        )

    stamp = weather_stamp(scope.project)
    key = f"{storage.signature_prefix(scope.project.id or 0)}{link.public_id}.png"
    storage.put_object(key, png, "image/png")
    signed_at = datetime.now(UTC)
    gps_lat = (
        Decimal(str(round(payload.gps_lat, 6))) if payload.gps_lat is not None else None
    )
    gps_lng = (
        Decimal(str(round(payload.gps_lng, 6))) if payload.gps_lng is not None else None
    )

    def signature(itp_id: int, item_id: int | None) -> ItpSignature:
        return ItpSignature(
            project_itp_id=itp_id,
            itp_item_id=item_id,
            signoff_role_id=role.id,
            external_token_id=link.id,
            role_name=role.role_name,
            party=role.party,
            signer_name=payload.signer_name.strip(),
            signer_email=link.signer_email,
            signer_sub=None,
            method="external_link",
            signed_at=signed_at,
            gps_lat=gps_lat,
            gps_lng=gps_lng,
            weather=stamp,
            signature_s3_key=key,
        )

    signed_lines = 0
    touched: set[int] = set()
    # Signing a hold point can release the lines behind it; take every line
    # that becomes ready in the same visit (bounded by the number of lines).
    for _ in range(sum(len(s.items) for s in scope.states(session)) + 1):
        ready = [
            rl
            for rl in role_lines(scope.states(session), role.id)
            if rl.sign_state == "ready"
        ]
        if not ready:
            break
        for rl in ready:
            itp_id = rl.state.itp.id or 0
            session.add(signature(itp_id, rl.line.item.id))
            touched.add(itp_id)
            signed_lines += 1
        session.flush()
    for itp_id in sorted(touched):
        session.add(signature(itp_id, None))
    link.used_at = signed_at
    session.add(link)
    session.commit()

    remaining = sum(
        1
        for rl in role_lines(scope.states(session), role.id)
        if rl.sign_state == "waiting"
    )
    area_ids = {i.area_id for i in scope.itps if i.id in touched and i.area_id}
    if scope.area is not None and scope.area.id:
        area_ids.add(scope.area.id)
    background.add_task(
        packs.regenerate_in_background,
        sorted(touched),
        sorted(a for a in area_ids if a is not None),
        f"signing link ({link.signer_email})",
    )
    return SignResult(
        signed_lines=signed_lines,
        documents=len(touched),
        signed_at=signed_at,
        weather=stamp,
        still_waiting=remaining,
    )


# ── Automatic reminders (run on a schedule; see app/sign_reminders.py) ──────


def send_due_reminders(db: Session, now: datetime | None = None) -> int:
    """Remind every live link that has waited ``SIGN_REMINDER_AFTER_DAYS``.

    At most ``SIGN_REMINDER_MAX`` reminders per role and document; a link
    whose lines are not ready (or are all signed) is left alone. Returns how
    many reminders were sent.
    """
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=settings.SIGN_REMINDER_AFTER_DAYS)
    due = db.exec(
        select(ExternalSignToken)
        .where(col(ExternalSignToken.used_at).is_(None))
        .where(col(ExternalSignToken.revoked).is_(False))
        .where(col(ExternalSignToken.expires_at) > now)
        .where(col(ExternalSignToken.created_at) <= cutoff)
        .where(col(ExternalSignToken.reminder_count) < settings.SIGN_REMINDER_MAX)
        .order_by(col(ExternalSignToken.id))
    ).all()
    sent = 0
    for token in due:
        scope = Scope.of_token(db, token)
        role = db.get(SignoffRole, token.signoff_role_id)
        if role is None or role.id is None:  # pragma: no cover - CASCADE
            continue
        states = scope.states(db)
        if not any(rl.sign_state == "ready" for rl in role_lines(states, role.id)):
            continue
        _issue(
            db,
            None,
            scope=scope,
            states=states,
            role=role,
            signer_email=token.signer_email,
            requester=token.created_by or settings.PROJECT_NAME,
            reminder_count=token.reminder_count + 1,
        )
        sent += 1
    return sent
