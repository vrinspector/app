"""Email send log and invite resend (rebuild increment 13.5).

    GET  /projects/{id}/emails[?email_type=&related_id=]   → [EmailLogPublic]  (owner)
    POST /projects/{id}/members/{mid}/invite-email          → 202 EmailLogPublic (owner)

Owners see what the app emailed on their project's behalf (newest first, up to
200 rows) so the Members section can say "Invite emailed" / "Invite failed",
and can send a member's invite again. A resend inside
``INVITE_RESEND_COOLDOWN_SECONDS`` of the last one is refused (429) so a
double tap can't spam the invitee. Non-members get the usual 404; members who
are not owners get 403.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from sqlmodel import col, select

from app.api.authz import MANAGE_ROLES, get_authorized_project, not_found
from app.api.deps import CurrentUser, SessionDep
from app.api.routes.projects import send_member_invite
from app.core.config import settings
from app.models import EMAIL_TYPES, EmailLogPublic, EmailSendLog, ProjectMember

router = APIRouter(prefix="/projects", tags=["emails"])

MAX_LOG_ROWS = 200


def _public(log: EmailSendLog) -> EmailLogPublic:
    return EmailLogPublic.model_validate(log, from_attributes=True)


@router.get("/{project_id}/emails", response_model=list[EmailLogPublic])
def list_project_emails(
    project_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    email_type: str | None = Query(default=None, max_length=50),
    related_id: int | None = None,
) -> Any:
    get_authorized_project(session, project_id, current_user, roles=MANAGE_ROLES)
    if email_type is not None and email_type not in EMAIL_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"email_type must be one of: {', '.join(EMAIL_TYPES)}",
        )
    stmt = select(EmailSendLog).where(EmailSendLog.project_id == project_id)
    if email_type is not None:
        stmt = stmt.where(EmailSendLog.email_type == email_type)
    if related_id is not None:
        stmt = stmt.where(EmailSendLog.related_id == related_id)
    stmt = stmt.order_by(
        col(EmailSendLog.created_at).desc(), col(EmailSendLog.id).desc()
    ).limit(MAX_LOG_ROWS)
    return [_public(log) for log in session.exec(stmt).all()]


@router.post(
    "/{project_id}/members/{member_id}/invite-email",
    response_model=EmailLogPublic,
    status_code=status.HTTP_202_ACCEPTED,
)
def resend_member_invite(
    project_id: int,
    member_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> Any:
    project = get_authorized_project(
        session, project_id, current_user, roles=MANAGE_ROLES
    )
    member = session.get(ProjectMember, member_id)
    if member is None or member.project_id != project_id:
        raise not_found("Member not found")
    if member.role == "owner":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project owners are not sent invites",
        )
    last = session.exec(
        select(EmailSendLog)
        .where(EmailSendLog.project_id == project_id)
        .where(EmailSendLog.email_type == "member_invite")
        .where(EmailSendLog.related_id == member_id)
        .order_by(col(EmailSendLog.created_at).desc(), col(EmailSendLog.id).desc())
    ).first()
    cooldown = timedelta(seconds=settings.INVITE_RESEND_COOLDOWN_SECONDS)
    if (
        last is not None
        and last.status in ("queued", "sent")
        and last.created_at is not None
        and datetime.now(UTC) - last.created_at < cooldown
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="An invite was just sent to this member. Try again in a minute.",
        )
    log = send_member_invite(
        session, background_tasks, project=project, member=member, user=current_user
    )
    return _public(log)
