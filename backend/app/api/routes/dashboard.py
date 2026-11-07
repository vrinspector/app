"""Dashboard (Block 6): roll-up of the caller's projects, ported to SQLModel.

Legacy contract (deployed SPA, July 2026): ``GET /dashboard`` →

    {
      "summary": {total_projects, total_inspections, open_findings,
                  high_priority_findings, total_photos},
      "projects": [{id, name, client, inspection_count, open_finding_count,
                    high_finding_count, photo_count, last_inspected}, ...],
      "recent_inspections": [{id, title, project_name, inspector, created_at,
                              finding_count}, ...]
    }

Scoped to projects the caller is a member of. "Open" means any status other
than ``resolved``; "high" means open findings with priority ``high``.
"""

from datetime import datetime
from typing import Any

from fastapi import APIRouter
from sqlalchemy import case, func
from sqlmodel import col, select

from app.api.authz import member_project_ids
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    DashboardInspection,
    DashboardProject,
    DashboardPublic,
    DashboardSummary,
    Finding,
    Inspection,
    Photo,
    Project,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

RECENT_LIMIT = 10


def _empty() -> DashboardPublic:
    return DashboardPublic(
        summary=DashboardSummary(
            total_projects=0,
            total_inspections=0,
            open_findings=0,
            high_priority_findings=0,
            total_photos=0,
        ),
        projects=[],
        recent_inspections=[],
    )


@router.get("", response_model=DashboardPublic)
def read_dashboard(session: SessionDep, current_user: CurrentUser) -> Any:
    ids = member_project_ids(session, current_user)
    if not ids:
        return _empty()

    in_scope = col(Inspection.project_id).in_(ids)
    is_open = col(Finding.status) != "resolved"
    is_high = is_open & (col(Finding.priority) == "high")

    projects = session.exec(
        select(Project)
        .where(col(Project.id).in_(ids))
        .order_by(col(Project.created_at).desc(), col(Project.id).desc())
    ).all()

    # Per-project roll-ups, each a small grouped query keyed by project_id.
    inspection_stats: dict[int, tuple[int, datetime | None]] = {
        pid: (int(count), last)
        for pid, count, last in session.exec(
            select(
                col(Inspection.project_id),
                func.count(col(Inspection.id)),
                func.max(col(Inspection.created_at)),
            )
            .where(in_scope)
            .group_by(col(Inspection.project_id))
        ).all()
    }
    finding_stats: dict[int, tuple[int, int]] = {
        pid: (int(open_count), int(high_count))
        for pid, open_count, high_count in session.exec(
            select(
                col(Inspection.project_id),
                func.coalesce(func.sum(case((is_open, 1), else_=0)), 0),
                func.coalesce(func.sum(case((is_high, 1), else_=0)), 0),
            )
            .join(Inspection, col(Finding.inspection_id) == col(Inspection.id))
            .where(in_scope)
            .group_by(col(Inspection.project_id))
        ).all()
    }
    photo_stats: dict[int, int] = {
        pid: int(count)
        for pid, count in session.exec(
            select(col(Inspection.project_id), func.count(col(Photo.id)))
            .join(Inspection, col(Photo.inspection_id) == col(Inspection.id))
            .where(in_scope)
            .group_by(col(Inspection.project_id))
        ).all()
    }

    rows: list[DashboardProject] = []
    totals = {"inspections": 0, "open": 0, "high": 0, "photos": 0}
    for project in projects:
        assert project.id is not None
        inspections, last_inspected = inspection_stats.get(project.id, (0, None))
        open_count, high_count = finding_stats.get(project.id, (0, 0))
        photos = photo_stats.get(project.id, 0)
        totals["inspections"] += inspections
        totals["open"] += open_count
        totals["high"] += high_count
        totals["photos"] += photos
        rows.append(
            DashboardProject(
                id=project.id,
                name=project.name,
                client=project.client,
                status=project.status,
                inspection_count=inspections,
                open_finding_count=open_count,
                high_finding_count=high_count,
                photo_count=photos,
                last_inspected=(
                    last_inspected.date().isoformat() if last_inspected else "Never"
                ),
            )
        )

    finding_counts = (
        select(
            col(Finding.inspection_id).label("inspection_id"),
            func.count(col(Finding.id)).label("finding_count"),
        )
        .group_by(col(Finding.inspection_id))
        .subquery()
    )
    recent_rows = session.exec(
        select(
            Inspection,
            col(Project.name),
            func.coalesce(finding_counts.c.finding_count, 0),
        )
        .join(Project, col(Inspection.project_id) == col(Project.id))
        .outerjoin(finding_counts, finding_counts.c.inspection_id == col(Inspection.id))
        .where(in_scope)
        .order_by(col(Inspection.created_at).desc(), col(Inspection.id).desc())
        .limit(RECENT_LIMIT)
    ).all()
    recent: list[DashboardInspection] = []
    for inspection, project_name, count in recent_rows:
        assert inspection.id is not None and inspection.created_at is not None
        recent.append(
            DashboardInspection(
                id=inspection.id,
                project_id=inspection.project_id,
                project_name=project_name,
                title=inspection.title,
                inspector=inspection.inspector,
                created_at=inspection.created_at,
                finding_count=int(count),
            )
        )

    return DashboardPublic(
        summary=DashboardSummary(
            total_projects=len(rows),
            total_inspections=totals["inspections"],
            open_findings=totals["open"],
            high_priority_findings=totals["high"],
            total_photos=totals["photos"],
        ),
        projects=rows,
        recent_inspections=recent,
    )
