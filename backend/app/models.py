"""VR Inspector data layer — SQLModel tables for the Phase 2 rebuild (increment 03).

Porting rules (REBUILD_PLAN session rule 7 / PRD v2.63 §3):

* INTEGER primary keys (SERIAL) on every table, plus an external ``public_id``
  (UUID) that the rebuild adds as the Phase 2 baseline. Internal joins and the
  legacy ``/api/v1/`` contract keep using the integer ``id``.
* Identity is Auth0; there is **no** users table. Legacy attribution columns
  (``created_by``, ``uploaded_by``, ``project_members.user_email``) store the
  Auth0 **email**, exactly as the live staging schema does, because the
  membership checks join on ``project_members.user_email``. The rebuild adds a
  nullable ``project_members.user_sub`` so the Auth0 ``sub`` can become the
  anchor without breaking the live data (filled in as members sign in).
* File storage is S3 only: tables hold S3 keys, never file bytes or server paths.

Column-by-column provenance (verified from the deployed Block 8D/8E router and
migration vs. inferred from the deployed SPA's API contract) is documented in
``docs/DATA_MODEL.md``. The legacy SQL remains the behavioural spec for the
route ports in increments 04 and 05.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import EmailStr
from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Field, Relationship, SQLModel


def get_datetime_utc() -> datetime:
    return datetime.now(UTC)


# --- Column factories -------------------------------------------------------
# Kept as small helpers so every table spells the shared baseline columns the
# same way (and so the Alembic baseline can compare against one definition).


def _pk_column() -> Column[int]:
    return Column(Integer, primary_key=True, autoincrement=True)


def _public_id_column() -> Column[uuid.UUID]:
    return Column(
        UUID(as_uuid=True),
        nullable=False,
        unique=True,
        server_default=text("gen_random_uuid()"),
    )


def _created_at_column() -> Column[datetime]:
    return Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


def _updated_at_column() -> Column[datetime]:
    return Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        onupdate=get_datetime_utc,
    )


# --- Value vocabularies (legacy SPA; enforced in the API layer, not as DB enums)

PROJECT_STATUSES = ("active", "on_hold", "complete")
INSPECTION_TYPES = (
    "civil",
    "structural",
    "mechanical",
    "electrical",
    "piping",
    "general",
)
INSPECTION_STATUSES = ("open", "closed")
FINDING_PRIORITIES = ("high", "medium", "low")
FINDING_STATUSES = ("open", "in-progress", "resolved")
MEMBER_ROLES = ("owner", "inspector", "viewer")
DRAWING_DISCIPLINES = (
    "general",
    "pid",
    "grading",
    "civil_structural",
    "equipment_layout",
    "steel_erection",
    "electrical",
    "other",
)
DRAWING_FILE_TYPES = ("pdf", "png", "jpg", "jpeg", "svg")
PIN_STATUSES = ("verified", "in_progress", "punch_item", "not_installed", "not_started")

# Byte-exact column comment from the Block 8E migration applied to RDS.
PAGE_NUMBER_COMMENT = (
    "PDF page number (1-indexed). Always 1 for raster images. Added in Block 8E."
)


# --- Tables -----------------------------------------------------------------


class Project(SQLModel, table=True):
    __tablename__ = "projects"

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    name: str = Field(sa_column=Column(String(255), nullable=False))
    client: str | None = Field(default=None, sa_column=Column(String(255)))
    location: str | None = Field(default=None, sa_column=Column(String(255)))
    status: str = Field(
        default="active",
        sa_column=Column(String(20), nullable=False, server_default=text("'active'")),
    )
    created_by: str | None = Field(default=None, sa_column=Column(String(255)))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())
    updated_at: datetime | None = Field(default=None, sa_column=_updated_at_column())

    inspections: list[Inspection] = Relationship(
        back_populates="project", cascade_delete=True
    )
    members: list[ProjectMember] = Relationship(
        back_populates="project", cascade_delete=True
    )
    drawings: list[Drawing] = Relationship(
        back_populates="project", cascade_delete=True
    )


class ProjectMember(SQLModel, table=True):
    __tablename__ = "project_members"
    __table_args__ = (
        UniqueConstraint("project_id", "user_email", name="uq_project_members_email"),
    )

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    project_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    # Auth0 email: the legacy membership checks join on this column.
    user_email: str = Field(sa_column=Column(String(255), nullable=False, index=True))
    # Auth0 `sub` (identity anchor). Nullable: filled in as members sign in.
    user_sub: str | None = Field(
        default=None, sa_column=Column(String(255), index=True)
    )
    role: str = Field(
        default="inspector",
        sa_column=Column(
            String(20), nullable=False, server_default=text("'inspector'")
        ),
    )
    invited_by: str | None = Field(default=None, sa_column=Column(String(255)))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())

    project: Project | None = Relationship(back_populates="members")


class Inspection(SQLModel, table=True):
    __tablename__ = "inspections"

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    project_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    title: str = Field(sa_column=Column(String(255), nullable=False))
    inspection_type: str | None = Field(default=None, sa_column=Column(String(30)))
    inspector: str | None = Field(default=None, sa_column=Column(String(255)))
    notes: str | None = Field(default=None, sa_column=Column(Text))
    # Workflow status as sent by the SPA on create ("open").
    status: str = Field(
        default="open",
        sa_column=Column(String(20), nullable=False, server_default=text("'open'")),
    )
    # Block 8B sign-off state: "open" | "closed" (findings lock when closed).
    inspection_status: str = Field(
        default="open",
        sa_column=Column(String(20), nullable=False, server_default=text("'open'")),
    )
    signed_off_by: str | None = Field(default=None, sa_column=Column(String(255)))
    signed_off_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())
    updated_at: datetime | None = Field(default=None, sa_column=_updated_at_column())

    project: Project | None = Relationship(back_populates="inspections")
    findings: list[Finding] = Relationship(
        back_populates="inspection", cascade_delete=True
    )
    photos: list[Photo] = Relationship(back_populates="inspection", cascade_delete=True)
    reports: list[InspectionReport] = Relationship(
        back_populates="inspection", cascade_delete=True
    )


class Finding(SQLModel, table=True):
    __tablename__ = "findings"

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    inspection_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("inspections.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    title: str = Field(sa_column=Column(String(255), nullable=False))
    description: str | None = Field(default=None, sa_column=Column(Text))
    priority: str = Field(
        default="medium",
        sa_column=Column(String(10), nullable=False, server_default=text("'medium'")),
    )
    location_ref: str | None = Field(default=None, sa_column=Column(String(255)))
    # "open" | "in-progress" | "resolved" (Block 8A defect repair workflow).
    status: str = Field(
        default="open",
        sa_column=Column(String(20), nullable=False, server_default=text("'open'")),
    )
    resolved_by: str | None = Field(default=None, sa_column=Column(String(255)))
    resolved_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    resolution_notes: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())
    updated_at: datetime | None = Field(default=None, sa_column=_updated_at_column())

    inspection: Inspection | None = Relationship(back_populates="findings")
    pins: list[InspectionPin] = Relationship(back_populates="finding")
    photos: list[Photo] = Relationship(back_populates="finding")


class Photo(SQLModel, table=True):
    __tablename__ = "photos"

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    inspection_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("inspections.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    # Increment 11a (capture loop): the finding this photo documents, when it
    # was taken for one. NULL for site photos; detached when the finding goes.
    finding_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("findings.id", ondelete="SET NULL"), index=True
        ),
    )
    # S3 object key (bucket `vrinspector-files`, prefix `photos/`); never a path.
    s3_key: str = Field(sa_column=Column(String(512), nullable=False))
    filename: str | None = Field(default=None, sa_column=Column(String(255)))
    content_type: str | None = Field(default=None, sa_column=Column(String(100)))
    uploaded_by: str | None = Field(default=None, sa_column=Column(String(255)))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())

    inspection: Inspection | None = Relationship(back_populates="photos")
    finding: Finding | None = Relationship(back_populates="photos")


class Drawing(SQLModel, table=True):
    """Block 8D/8E `drawings` table (PRD v2.59 schema + Block 8E R6 columns)."""

    __tablename__ = "drawings"

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    project_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    title: str = Field(sa_column=Column(String(255), nullable=False))
    drawing_number: str | None = Field(default=None, sa_column=Column(String(100)))
    discipline: str = Field(
        default="general",
        sa_column=Column(String(30), nullable=False, server_default=text("'general'")),
    )
    filename: str = Field(sa_column=Column(String(255), nullable=False))
    # S3 object key: drawings/projects/{project_id}/{uuid}{ext}
    s3_key: str = Field(sa_column=Column(String(512), nullable=False))
    file_type: str = Field(
        default="png",
        sa_column=Column(String(16), nullable=False, server_default=text("'png'")),
    )
    file_size: int | None = Field(default=None, sa_column=Column(BigInteger))
    view_url: str | None = Field(default=None, sa_column=Column(Text))
    thumbnail_url: str | None = Field(default=None, sa_column=Column(Text))
    # Block 8E (R6): PDF MediaBox dimensions in PDF points, for a future
    # coordinate-space migration. NULL for raster drawings.
    page_width_pts: Decimal | None = Field(default=None, sa_column=Column(Numeric))
    page_height_pts: Decimal | None = Field(default=None, sa_column=Column(Numeric))
    uploaded_by: str | None = Field(default=None, sa_column=Column(String(255)))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())
    updated_at: datetime | None = Field(default=None, sa_column=_updated_at_column())

    project: Project | None = Relationship(back_populates="drawings")
    pins: list[InspectionPin] = Relationship(
        back_populates="drawing", cascade_delete=True
    )


class InspectionPin(SQLModel, table=True):
    """Block 8D/8E `inspection_pins` table.

    Coordinates are zoom-independent percentages of the rendered page
    (0–100, NUMERIC(6,3)); `page_number` is 1-indexed and always 1 for raster
    drawings (Block 8E migration).
    """

    __tablename__ = "inspection_pins"

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    drawing_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("drawings.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    finding_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("findings.id", ondelete="SET NULL"), index=True
        ),
    )
    tag_number: str | None = Field(default=None, sa_column=Column(String(100)))
    label: str | None = Field(default=None, sa_column=Column(String(255)))
    x_pct: Decimal = Field(sa_column=Column(Numeric(6, 3), nullable=False))
    y_pct: Decimal = Field(sa_column=Column(Numeric(6, 3), nullable=False))
    status: str = Field(
        default="not_started",
        sa_column=Column(
            String(20), nullable=False, server_default=text("'not_started'")
        ),
    )
    notes: str | None = Field(default=None, sa_column=Column(Text))
    # Phase 2 discipline-specific data (grading, rebar, steel, electrical …).
    discipline_data: dict[str, Any] | None = Field(
        default=None, sa_column=Column(JSONB)
    )
    page_number: int = Field(
        default=1,
        sa_column=Column(
            Integer,
            nullable=False,
            server_default=text("1"),
            comment=PAGE_NUMBER_COMMENT,
        ),
    )
    created_by: str | None = Field(default=None, sa_column=Column(String(255)))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())

    drawing: Drawing | None = Relationship(back_populates="pins")
    finding: Finding | None = Relationship(back_populates="pins")


class InspectionReport(SQLModel, table=True):
    """Block 4 inspection report versions (rebuild increment 10).

    The legacy ``POST /reports/generate`` rendered a PDF to S3 and returned a
    presigned ``download_url`` without recording anything. The rebuild keeps
    every generated PDF as a numbered **version** of the inspection's report
    (ADR-009: "versions kept in S3"), so the screen can list and re-download
    earlier reports and the audit trail survives. The table holds S3 keys
    only — never file bytes (Hard Rule 8).
    """

    __tablename__ = "inspection_reports"
    __table_args__ = (
        UniqueConstraint(
            "inspection_id", "version", name="uq_inspection_reports_version"
        ),
    )

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    inspection_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("inspections.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    # 1, 2, 3 … per inspection; the newest version is the current report.
    version: int = Field(sa_column=Column(Integer, nullable=False))
    # S3 object key: reports/inspections/{inspection_id}/v{version}-{uuid}.pdf
    s3_key: str = Field(sa_column=Column(String(512), nullable=False))
    filename: str = Field(sa_column=Column(String(255), nullable=False))
    file_size: int | None = Field(default=None, sa_column=Column(BigInteger))
    # Snapshot of what the PDF covers, so the list can say "4 findings, 12
    # photos" without opening it.
    finding_count: int = Field(
        default=0, sa_column=Column(Integer, nullable=False, server_default=text("0"))
    )
    photo_count: int = Field(
        default=0, sa_column=Column(Integer, nullable=False, server_default=text("0"))
    )
    generated_by: str | None = Field(default=None, sa_column=Column(String(255)))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())

    inspection: Inspection | None = Relationship(back_populates="reports")


# The seven tables that exist on the live (pre-rebuild) staging database.
LEGACY_TABLES: tuple[str, ...] = (
    "projects",
    "project_members",
    "inspections",
    "findings",
    "photos",
    "drawings",
    "inspection_pins",
)

# Every domain table the rebuild owns (legacy tables + rebuild additions).
DOMAIN_TABLES: tuple[str, ...] = (*LEGACY_TABLES, "inspection_reports")


# --- API-only schemas -------------------------------------------------------


# Generic message
class Message(SQLModel):
    message: str


# The authenticated caller, as returned by GET /api/v1/users/me
class UserPublic(SQLModel):
    sub: str
    email: str | None = None
    name: str | None = None
    picture: str | None = None
    permissions: list[str] = []


# --- Increment 04: request/response shapes of the ported Block 1–8C routes ---
#
# Request bodies mirror exactly what the deployed SPA sends (field names and
# defaults). Responses return every table column (the legacy routers returned
# ``dict(row)``), so the new ``public_id`` / ``user_sub`` columns ride along.

ProjectStatus = Literal["active", "on_hold", "complete"]
InspectionType = Literal[
    "civil", "structural", "mechanical", "electrical", "piping", "general"
]
FindingPriority = Literal["high", "medium", "low"]
FindingStatus = Literal["open", "in-progress", "resolved"]
MemberRole = Literal["owner", "inspector", "viewer"]


class ProjectCreate(SQLModel):
    name: str = Field(min_length=1, max_length=255)
    client: str | None = Field(default=None, max_length=255)
    location: str | None = Field(default=None, max_length=255)
    status: ProjectStatus = "active"
    # Sent by the SPA (literal "Inspector"); the API records the verified
    # Auth0 identity instead, as the drawings router does for ``uploaded_by``.
    created_by: str | None = Field(default=None, max_length=255)


class ProjectUpdate(SQLModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    client: str | None = Field(default=None, max_length=255)
    location: str | None = Field(default=None, max_length=255)
    status: ProjectStatus | None = None


class ProjectPublic(SQLModel):
    id: int
    public_id: uuid.UUID
    name: str
    client: str | None
    location: str | None
    status: str
    created_by: str | None
    created_at: datetime
    updated_at: datetime


class MemberInvite(SQLModel):
    email: EmailStr
    role: MemberRole = "inspector"


class MemberPublic(SQLModel):
    id: int
    public_id: uuid.UUID
    project_id: int
    # The SPA reads ``m.email``; ``user_email`` is the column name.
    email: str
    user_email: str
    user_sub: str | None
    role: str
    invited_by: str | None
    created_at: datetime

    @classmethod
    def from_member(cls, member: ProjectMember) -> MemberPublic:
        return cls(
            id=member.id or 0,
            public_id=member.public_id or uuid.UUID(int=0),
            project_id=member.project_id,
            email=member.user_email,
            user_email=member.user_email,
            user_sub=member.user_sub,
            role=member.role,
            invited_by=member.invited_by,
            created_at=member.created_at or get_datetime_utc(),
        )


class InspectionCreate(SQLModel):
    project_id: int
    title: str = Field(min_length=1, max_length=255)
    inspection_type: InspectionType | None = None
    inspector: str | None = Field(default=None, max_length=255)
    notes: str | None = None
    status: Literal["open", "closed"] = "open"


class InspectionUpdate(SQLModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    inspection_type: InspectionType | None = None
    inspector: str | None = Field(default=None, max_length=255)
    notes: str | None = None


class InspectionPublic(SQLModel):
    id: int
    public_id: uuid.UUID
    project_id: int
    title: str
    inspection_type: str | None
    # The SPA's list card reads ``type``; create sends ``inspection_type``.
    type: str | None
    inspector: str | None
    notes: str | None
    status: str
    inspection_status: str
    signed_off_by: str | None
    signed_off_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_inspection(cls, inspection: Inspection) -> InspectionPublic:
        data = inspection.model_dump()
        data["type"] = inspection.inspection_type
        return cls.model_validate(data)


class FindingCreate(SQLModel):
    inspection_id: int
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    priority: FindingPriority = "medium"
    location_ref: str | None = Field(default=None, max_length=255)
    status: FindingStatus = "open"


class FindingUpdate(SQLModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    priority: FindingPriority | None = None
    location_ref: str | None = Field(default=None, max_length=255)


class FindingStatusUpdate(SQLModel):
    status: FindingStatus


class FindingResolve(SQLModel):
    resolution_notes: str | None = None


class FindingPublic(SQLModel):
    id: int
    public_id: uuid.UUID
    inspection_id: int
    title: str
    description: str | None
    priority: str
    location_ref: str | None
    status: str
    resolved_by: str | None
    resolved_at: datetime | None
    resolution_notes: str | None
    created_at: datetime
    updated_at: datetime


class PhotoPresignRequest(SQLModel):
    inspection_id: int
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(default="image/jpeg", max_length=100)


class PhotoPresignResponse(SQLModel):
    upload_url: str
    s3_key: str


class PhotoCreate(SQLModel):
    inspection_id: int
    # Increment 11a: a finding of the same inspection this photo documents.
    finding_id: int | None = None
    s3_key: str = Field(min_length=1, max_length=512)
    filename: str | None = Field(default=None, max_length=255)
    content_type: str | None = Field(default=None, max_length=100)
    # Sent by the SPA (display name); the API records the verified identity.
    uploaded_by: str | None = Field(default=None, max_length=255)


class PhotoPublic(SQLModel):
    id: int
    public_id: uuid.UUID
    inspection_id: int
    finding_id: int | None = None
    s3_key: str
    filename: str | None
    content_type: str | None
    uploaded_by: str | None
    created_at: datetime
    # Presigned S3 GET URL, generated per response (never stored).
    view_url: str | None = None


# --- Increment 05: drawings + pins (Block 8D/8E router, hardening carried over) ---
#
# Request bodies mirror the deployed ``staging_drawings_block8e.py`` schemas
# field for field; responses return every column as ``dict(row)`` did. Numeric
# columns (pin percentages, PDF page dimensions) are returned as JSON numbers,
# which is what the SPA's pin overlay and PDF.js scaling arithmetic consume.

DrawingDiscipline = Literal[
    "general",
    "pid",
    "grading",
    "civil_structural",
    "equipment_layout",
    "steel_erection",
    "electrical",
    "other",
]
DrawingFileType = Literal["pdf", "png", "jpg", "jpeg", "svg"]
PinStatus = Literal[
    "verified", "in_progress", "punch_item", "not_installed", "not_started"
]


class DrawingPresignRequest(SQLModel):
    project_id: int
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(default="application/octet-stream", max_length=100)


class DrawingPresignResponse(SQLModel):
    upload_url: str
    s3_key: str


class DrawingCreate(SQLModel):
    project_id: int
    title: str = Field(min_length=1, max_length=255)
    drawing_number: str | None = Field(default=None, max_length=100)
    discipline: DrawingDiscipline = "general"
    filename: str = Field(min_length=1, max_length=255)
    s3_key: str = Field(min_length=1, max_length=512)
    file_type: DrawingFileType = "png"
    file_size: int | None = Field(default=None, ge=0)
    view_url: str | None = None
    thumbnail_url: str | None = None
    page_width_pts: float | None = Field(default=None, gt=0)
    page_height_pts: float | None = Field(default=None, gt=0)
    # Sent by the SPA (display name); the API records the verified identity.
    uploaded_by: str | None = Field(default=None, max_length=255)


class DrawingUpdate(SQLModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    drawing_number: str | None = Field(default=None, max_length=100)
    discipline: DrawingDiscipline | None = None
    view_url: str | None = None
    thumbnail_url: str | None = None


class DrawingDimensionsUpdate(SQLModel):
    """Block 8E (R6): PDF MediaBox size in points, captured by the viewer."""

    page_width_pts: float = Field(gt=0)
    page_height_pts: float = Field(gt=0)


class DrawingDimensionsPublic(SQLModel):
    id: int
    page_width_pts: float | None
    page_height_pts: float | None


class DrawingPublic(SQLModel):
    id: int
    public_id: uuid.UUID
    project_id: int
    title: str
    drawing_number: str | None
    discipline: str
    filename: str
    s3_key: str
    file_type: str
    file_size: int | None
    view_url: str | None
    thumbnail_url: str | None
    page_width_pts: float | None
    page_height_pts: float | None
    uploaded_by: str | None
    created_at: datetime
    updated_at: datetime


class DrawingViewUrl(SQLModel):
    view_url: str


class PinCreate(SQLModel):
    finding_id: int | None = None
    tag_number: str | None = Field(default=None, max_length=100)
    label: str | None = Field(default=None, max_length=255)
    # Zoom-independent percentages of the rendered page (NUMERIC(6,3)).
    x_pct: float = Field(ge=0, le=100)
    y_pct: float = Field(ge=0, le=100)
    status: PinStatus = "not_started"
    notes: str | None = None
    page_number: int = Field(default=1, ge=1)


class PinUpdate(SQLModel):
    finding_id: int | None = None
    tag_number: str | None = Field(default=None, max_length=100)
    label: str | None = Field(default=None, max_length=255)
    status: PinStatus | None = None
    notes: str | None = None


class PinPublic(SQLModel):
    id: int
    public_id: uuid.UUID
    drawing_id: int
    finding_id: int | None
    tag_number: str | None
    label: str | None
    x_pct: float
    y_pct: float
    status: str
    notes: str | None
    discipline_data: dict[str, Any] | None
    page_number: int
    created_by: str | None
    created_at: datetime


class DashboardSummary(SQLModel):
    total_projects: int
    total_inspections: int
    open_findings: int
    high_priority_findings: int
    total_photos: int


class DashboardProject(SQLModel):
    id: int
    name: str
    client: str | None
    status: str
    inspection_count: int
    open_finding_count: int
    high_finding_count: int
    photo_count: int
    # Display string as the SPA renders it (date of the latest inspection).
    last_inspected: str


class DashboardInspection(SQLModel):
    id: int
    project_id: int
    project_name: str
    title: str
    inspector: str | None
    created_at: datetime
    finding_count: int


class DashboardPublic(SQLModel):
    summary: DashboardSummary
    projects: list[DashboardProject]
    recent_inspections: list[DashboardInspection]


# --- Increment 10: Block 4 inspection reports ---------------------------------


class ReportGenerateRequest(SQLModel):
    # The SPA's ``generateReport`` body: ``{inspection_id}``.
    inspection_id: int


class ReportPublic(SQLModel):
    id: int
    public_id: uuid.UUID
    inspection_id: int
    version: int
    s3_key: str
    filename: str
    file_size: int | None
    finding_count: int
    photo_count: int
    generated_by: str | None
    created_at: datetime
    # Presigned S3 GET URL, generated per response (never stored). The SPA
    # read ``download_url`` from the generate response; every report row
    # carries one so earlier versions can be re-downloaded.
    download_url: str | None = None
