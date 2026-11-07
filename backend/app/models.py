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
from typing import Any

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
    # S3 object key (bucket `vrinspector-files`, prefix `photos/`); never a path.
    s3_key: str = Field(sa_column=Column(String(512), nullable=False))
    filename: str | None = Field(default=None, sa_column=Column(String(255)))
    content_type: str | None = Field(default=None, sa_column=Column(String(100)))
    uploaded_by: str | None = Field(default=None, sa_column=Column(String(255)))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())

    inspection: Inspection | None = Relationship(back_populates="photos")


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


DOMAIN_TABLES: tuple[str, ...] = (
    "projects",
    "project_members",
    "inspections",
    "findings",
    "photos",
    "drawings",
    "inspection_pins",
)


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
