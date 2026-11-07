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

Creating a project makes the caller its ``owner`` member; everything else is
visible only to members (404 object-hiding for non-members).
"""

from typing import Any

from fastapi import APIRouter, HTTPException, status
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
from app.models import (
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
) -> Any:
    """Add a member by email. The invitee's Auth0 ``sub`` is recorded the first
    time they open the project. (Block 7.1 — SES invitation emails — remains
    deferred, as on staging.)"""
    get_authorized_project(session, project_id, current_user, roles=MANAGE_ROLES)
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
    return MemberPublic.from_member(member)


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
