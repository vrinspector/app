"""Projects (Block 1/2) and project members (Block 7), ported to SQLModel.

Legacy contract (deployed SPA, July 2026):

    GET    /projects                      → list of the caller's projects
    POST   /projects                      → 201 project
    GET    /projects/{id}                 → project
    PUT    /projects/{id}                 → project   (owner)
    DELETE /projects/{id}                 → 204       (owner; cascades)
    GET    /projects/{id}/members         → [{id, email, role, ...}]
    POST   /projects/{id}/members         → 201 member  body {email, role}
    DELETE /projects/{id}/members/{mid}   → 204

Rebuild increment 13.5 (Block 7.1 pulled forward): adding a member also sends
them an invite email (see ``app.core.email``). The response shape is unchanged;
delivery runs after the response as a background task and is recorded in the
email send log (``GET /projects/{id}/emails``, ``app.api.routes.emails``).

Creating a project makes the caller its ``owner`` member; everything else is
visible only to members (404 object-hiding for non-members).
"""

from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from sqlmodel import col, select

from app.api.authz import (
    MANAGE_ROLES,
    current_email,
    get_authorized_project,
    member_project_ids,
    not_found,
    require_project_member,
)
from app.api.deps import CurrentUser, SessionDep
from app.core import email as email_service
from app.models import (
    EmailSendLog,
    MemberInvite,
    MemberPublic,
    Project,
    ProjectCreate,
    ProjectMember,
    ProjectPublic,
    ProjectUpdate,
)

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectPublic])
def list_projects(session: SessionDep, current_user: CurrentUser) -> Any:
    """Projects the caller is a member of, newest first."""
    ids = member_project_ids(session, current_user)
    if not ids:
        return []
    stmt = (
        select(Project)
        .where(col(Project.id).in_(ids))
        .order_by(col(Project.created_at).desc(), col(Project.id).desc())
    )
    return list(session.exec(stmt).all())


@router.post("", response_model=ProjectPublic, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate, session: SessionDep, current_user: CurrentUser
) -> Any:
    email = current_email(current_user)
    project = Project(
        name=payload.name,
        client=payload.client,
        location=payload.location,
        status=payload.status,
        created_by=email,
    )
    session.add(project)
    session.flush()
    assert project.id is not None
    session.add(
        ProjectMember(
            project_id=project.id,
            user_email=email,
            user_sub=current_user.sub,
            role="owner",
            invited_by=email,
        )
    )
    session.commit()
    session.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectPublic)
def read_project(
    project_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    return get_authorized_project(session, project_id, current_user)


@router.put("/{project_id}", response_model=ProjectPublic)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    project = get_authorized_project(
        session, project_id, current_user, roles=MANAGE_ROLES
    )
    updates = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update"
        )
    project.sqlmodel_update(updates)
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int, session: SessionDep, current_user: CurrentUser
) -> None:
    """Delete a project and, via FK cascades, its members, inspections,
    findings, photos, drawings and pins. S3 objects are left for the storage
    lifecycle policy (the legacy app did the same for photos)."""
    project = get_authorized_project(
        session, project_id, current_user, roles=MANAGE_ROLES
    )
    session.delete(project)
    session.commit()


# --- Members (Block 7) -------------------------------------------------------


@router.get("/{project_id}/members", response_model=list[MemberPublic])
def list_members(
    project_id: int, session: SessionDep, current_user: CurrentUser
) -> Any:
    get_authorized_project(session, project_id, current_user)
    stmt = (
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .order_by(col(ProjectMember.id))
    )
    return [MemberPublic.from_member(m) for m in session.exec(stmt).all()]


@router.post(
    "/{project_id}/members",
    response_model=MemberPublic,
    status_code=status.HTTP_201_CREATED,
)
def invite_member(
    project_id: int,
    payload: MemberInvite,
    session: SessionDep,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> Any:
    """Add a member by email and send them an invite email. The invitee's
    Auth0 ``sub`` is recorded the first time they open the project."""
    project = get_authorized_project(
        session, project_id, current_user, roles=MANAGE_ROLES
    )
    email = str(payload.email).strip().lower()
    existing = session.exec(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .where(col(ProjectMember.user_email) == email)
    ).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email is already a member of the project",
        )
    member = ProjectMember(
        project_id=project_id,
        user_email=email,
        role=payload.role,
        invited_by=current_email(current_user),
    )
    session.add(member)
    session.commit()
    session.refresh(member)
    result = MemberPublic.from_member(member)
    send_member_invite(
        session, background_tasks, project=project, member=member, user=current_user
    )
    return result


def send_member_invite(
    session: SessionDep,
    background_tasks: BackgroundTasks,
    *,
    project: Project,
    member: ProjectMember,
    user: CurrentUser,
) -> EmailSendLog:
    """Log the member's invite email and schedule its delivery."""
    inviter = current_email(user)
    rendered = email_service.member_invite_email(
        project=project, member=member, inviter=inviter
    )
    log = email_service.queue_email(
        session,
        email_type="member_invite",
        recipient=member.user_email,
        rendered=rendered,
        project_id=project.id,
        related_id=member.id,
        triggered_by=inviter,
    )
    if log.status == "queued" and log.id is not None:
        background_tasks.add_task(email_service.deliver, log.id, rendered)
    return log


@router.delete(
    "/{project_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT
)
def remove_member(
    project_id: int,
    member_id: int,
    session: SessionDep,
    current_user: CurrentUser,
) -> None:
    require_project_member(session, project_id, current_user, roles=MANAGE_ROLES)
    member = session.get(ProjectMember, member_id)
    if member is None or member.project_id != project_id:
        raise not_found("Member not found")
    if member.role == "owner":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project owners cannot be removed",
        )
    session.delete(member)
    session.commit()
