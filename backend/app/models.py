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
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
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
# Block 9.5 ITP vocabularies (PRD v2.63 §5; enforced in the API layer as above).
AREA_TYPES = ("level", "lot", "stage", "chainage", "other")
ITP_TEMPLATE_STATUSES = ("draft", "published", "archived")
PROJECT_ITP_STATUSES = ("not_started", "in_progress", "complete", "voided")
# Increment 13.6 (owner review 2026-11-10): Hold / Witness / Review /
# Information. Migration ``a9d4c2e7f318`` renamed the stored values
# ``surveillance`` → ``information`` and ``record`` → ``review``; template
# bodies keep the old words readable (``app/core/itp.py``).
ITP_ITEM_CLASSIFICATIONS = ("hold", "witness", "review", "information")
LEGACY_CLASSIFICATIONS = {"surveillance": "information", "record": "review"}
ITP_VALUE_TYPES = ("number", "text")
ITP_ITEM_STATUSES = ("pending", "pass", "fail", "na")
SIGNOFF_PARTIES = ("contractor", "client", "engineer")
ITP_SIGNATURE_METHODS = ("in_app", "external_link")
# Increment 13.5 outbound email (Block 7.1 pulled forward).
EMAIL_TYPES = ("member_invite",)
EMAIL_STATUSES = ("queued", "sent", "failed", "skipped")

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

    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(inspection_id, itp_item_id) = 1",
            name="ck_photos_one_parent",
        ),
    )

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    # NULL only for ITP line evidence (increment 13.6): a photo belongs to
    # exactly one of an inspection or an ITP line.
    inspection_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer,
            ForeignKey("inspections.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )
    # Increment 13.6: evidence photo for one ITP line (goes with the line).
    itp_item_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("itp_items.id", ondelete="CASCADE"), index=True
        ),
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
    # Block 9.5: the ITP item this pin marks on the drawing (the drawing-anchored
    # hold point). Detached, not deleted, when the item goes.
    itp_item_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("itp_items.id", ondelete="SET NULL"), index=True
        ),
    )

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


# --- Increment 12: Block 9.5 ITP / hold points + Areas (PRD v2.63 §5) -----------
#
# Deliberately no ``Relationship`` attributes on these tables: deletes must go
# through the database's own cascades so the signed-evidence guards in migration
# ``e7c2a9f4b613`` can tell "this row is being deleted on its own" (refused when
# signed) from "the whole project is going" (allowed). An ORM cascade would
# delete the children first, while the parent still exists, and trip the guard.
# ``docs/DATA_MODEL.md`` records the rules; same-project checks (an ITP's area, a
# pin's item, an area's parent) live in the API layer, like ``photos.finding_id``.


class ProjectArea(SQLModel, table=True):
    """A level / lot / stage / chainage of a project; ITPs are applied per area."""

    __tablename__ = "project_areas"

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
    # Optional nesting (Building A → Level 3). Children move to the top level
    # when their parent is deleted.
    parent_area_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("project_areas.id", ondelete="SET NULL"), index=True
        ),
    )
    name: str = Field(sa_column=Column(String(255), nullable=False))
    area_type: str = Field(
        default="other",
        sa_column=Column(String(20), nullable=False, server_default=text("'other'")),
    )
    sort_order: int = Field(
        default=0, sa_column=Column(Integer, nullable=False, server_default=text("0"))
    )
    created_by: str | None = Field(default=None, sa_column=Column(String(255)))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())
    updated_at: datetime | None = Field(default=None, sa_column=_updated_at_column())


class ItpTemplate(SQLModel, table=True):
    """A master ITP, one row per version.

    Every version of one template shares a ``template_key``; editing a master
    adds the next ``version`` rather than changing a row a project imported.
    There is no company table yet, so a master belongs to the account that
    created it (``created_by`` / ``created_by_sub``).
    """

    __tablename__ = "itp_templates"
    __table_args__ = (
        UniqueConstraint("template_key", "version", name="uq_itp_templates_version"),
    )

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    template_key: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            UUID(as_uuid=True),
            nullable=False,
            server_default=text("gen_random_uuid()"),
            index=True,
        ),
    )
    version: int = Field(
        default=1, sa_column=Column(Integer, nullable=False, server_default=text("1"))
    )
    name: str = Field(sa_column=Column(String(255), nullable=False))
    description: str | None = Field(default=None, sa_column=Column(Text))
    status: str = Field(
        default="draft",
        sa_column=Column(String(20), nullable=False, server_default=text("'draft'")),
    )
    # SurveyJS-compatible form JSON (sections, items, classifications, roles).
    body: dict[str, Any] = Field(sa_column=Column(JSONB, nullable=False))
    created_by: str | None = Field(default=None, sa_column=Column(String(255)))
    created_by_sub: str | None = Field(default=None, sa_column=Column(String(255)))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())
    updated_at: datetime | None = Field(default=None, sa_column=_updated_at_column())


class ProjectItp(SQLModel, table=True):
    """A project's frozen copy of a master template (optionally for one area).

    ``body`` is copied at import, so nothing done to the master reaches it.
    The single nullable ``area_id`` is what makes "at most one area" true.
    """

    __tablename__ = "project_itps"

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
    # NULL = applies to the whole project. An unsigned ITP becomes project-level
    # if its area is deleted; an area with a signed ITP cannot be deleted.
    area_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("project_areas.id", ondelete="SET NULL"), index=True
        ),
    )
    # Provenance only. The master may later be deleted; the copy stands alone.
    template_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("itp_templates.id", ondelete="SET NULL"), index=True
        ),
    )
    template_version: int | None = Field(default=None, sa_column=Column(Integer))
    title: str = Field(sa_column=Column(String(255), nullable=False))
    status: str = Field(
        default="not_started",
        sa_column=Column(
            String(20), nullable=False, server_default=text("'not_started'")
        ),
    )
    body: dict[str, Any] = Field(sa_column=Column(JSONB, nullable=False))
    # Latest generated sign-off pack (increment 14); S3 key only, never bytes.
    pack_s3_key: str | None = Field(default=None, sa_column=Column(String(512)))
    pack_version: int | None = Field(default=None, sa_column=Column(Integer))
    created_by: str | None = Field(default=None, sa_column=Column(String(255)))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())
    updated_at: datetime | None = Field(default=None, sa_column=_updated_at_column())


class ItpItem(SQLModel, table=True):
    """One checklist line of a project ITP."""

    __tablename__ = "itp_items"

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    project_itp_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("project_itps.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    section: str | None = Field(default=None, sa_column=Column(String(255)))
    # The SurveyJS element this row was materialised from, in ``body``.
    element_name: str | None = Field(default=None, sa_column=Column(String(255)))
    requirement: str = Field(sa_column=Column(Text, nullable=False))
    # hold | witness | surveillance | record. No default on purpose: a line that
    # lost its classification must fail, not quietly stop being a hold point.
    classification: str = Field(sa_column=Column(String(20), nullable=False))
    status: str = Field(
        default="pending",
        sa_column=Column(String(20), nullable=False, server_default=text("'pending'")),
    )
    notes: str | None = Field(default=None, sa_column=Column(Text))
    sort_order: int = Field(
        default=0, sa_column=Column(Integer, nullable=False, server_default=text("0"))
    )
    # Increment 13.6 — line evidence, copied from the template question.
    acceptance_criteria: str | None = Field(default=None, sa_column=Column(Text))
    reference_doc: str | None = Field(default=None, sa_column=Column(String(255)))
    record_required: str | None = Field(default=None, sa_column=Column(Text))
    photo_required: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default=text("false")),
    )
    # number | text — the line takes a measured value; NULL: result only.
    value_type: str | None = Field(default=None, sa_column=Column(String(10)))
    value_unit: str | None = Field(default=None, sa_column=Column(String(40)))
    value_min: float | None = Field(default=None, sa_column=Column(Float))
    value_max: float | None = Field(default=None, sa_column=Column(Float))
    # What was entered on site, as typed (numbers normalised on save).
    measured_value: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())
    updated_at: datetime | None = Field(default=None, sa_column=_updated_at_column())


class SignoffRole(SQLModel, table=True):
    """A sign-off role on a project, shared by all of that project's ITPs."""

    __tablename__ = "signoff_roles"
    __table_args__ = (
        UniqueConstraint("project_id", "role_name", name="uq_signoff_roles_name"),
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
    role_name: str = Field(sa_column=Column(String(255), nullable=False))
    # contractor | client | engineer
    party: str = Field(sa_column=Column(String(20), nullable=False))
    signer_email: str | None = Field(default=None, sa_column=Column(String(255)))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())


class ItpItemRequiredRole(SQLModel, table=True):
    """Which sign-off roles an ITP item needs (many-to-many)."""

    __tablename__ = "itp_item_required_roles"
    __table_args__ = (
        UniqueConstraint(
            "itp_item_id", "signoff_role_id", name="uq_itp_item_required_role"
        ),
    )

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    itp_item_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("itp_items.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    signoff_role_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("signoff_roles.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )


class ExternalSignToken(SQLModel, table=True):
    """A no-account signing link; only the SHA-256 of the token is stored.

    A link opens one ITP's pack, or one area's combined pack: exactly one of
    ``project_itp_id`` / ``area_id`` is set.
    """

    __tablename__ = "external_sign_tokens"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(project_itp_id, area_id) = 1",
            name="ck_external_sign_tokens_one_document",
        ),
        CheckConstraint(
            "char_length(token_hash) = 64",
            name="ck_external_sign_tokens_hash_length",
        ),
    )

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    token_hash: str = Field(sa_column=Column(String(64), nullable=False, unique=True))
    project_itp_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("project_itps.id", ondelete="CASCADE"), index=True
        ),
    )
    area_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("project_areas.id", ondelete="CASCADE"), index=True
        ),
    )
    signoff_role_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("signoff_roles.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    signer_email: str = Field(sa_column=Column(String(255), nullable=False))
    expires_at: datetime | None = Field(
        default=None,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now() + interval '14 days'"),
        ),
    )
    used_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    revoked: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default=text("false")),
    )
    created_by: str | None = Field(default=None, sa_column=Column(String(255)))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())


class ItpSignature(SQLModel, table=True):
    """One signature, with its time / GPS / weather stamp.

    ``itp_item_id`` NULL means the signature is on the whole pack. An area pack
    signature writes one row per ITP it covers, so every signature names an ITP.
    Role name and party are copied in so the record survives the role's deletion.
    """

    __tablename__ = "itp_signatures"

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    project_itp_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("project_itps.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    itp_item_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("itp_items.id", ondelete="CASCADE"), index=True
        ),
    )
    signoff_role_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("signoff_roles.id", ondelete="SET NULL"), index=True
        ),
    )
    external_token_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer,
            ForeignKey("external_sign_tokens.id", ondelete="SET NULL"),
            index=True,
        ),
    )
    role_name: str = Field(sa_column=Column(String(255), nullable=False))
    party: str = Field(sa_column=Column(String(20), nullable=False))
    signer_name: str | None = Field(default=None, sa_column=Column(String(255)))
    signer_email: str = Field(sa_column=Column(String(255), nullable=False))
    # Auth0 `sub` for in-app signatures; NULL for external links.
    signer_sub: str | None = Field(default=None, sa_column=Column(String(255)))
    # in_app | external_link
    method: str = Field(sa_column=Column(String(20), nullable=False))
    signed_at: datetime | None = Field(default=None, sa_column=_created_at_column())
    gps_lat: Decimal | None = Field(default=None, sa_column=Column(Numeric(9, 6)))
    gps_lng: Decimal | None = Field(default=None, sa_column=Column(Numeric(9, 6)))
    weather: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    # S3 object key of the drawn signature image; never file bytes.
    signature_s3_key: str | None = Field(default=None, sa_column=Column(String(512)))


# --- Increment 13.5: outbound email send log (Block 7.1 pulled forward) --------


class EmailSendLog(SQLModel, table=True):
    """One row per email the app tries to send (rebuild increment 13.5).

    Written as ``queued`` (or ``skipped`` when SMTP is not configured) before
    delivery is attempted, then moved to ``sent`` / ``failed`` by the delivery
    task, so an owner can see whether an invite went out and the audit trail
    survives. Holds addresses, subject and outcome only — never the body,
    never credentials. ``project_id`` is SET NULL on project delete so the log
    outlives the project; ``related_id`` names the subject row of the email
    (the member for ``member_invite``) without a foreign key, so removing the
    member keeps the history.
    """

    __tablename__ = "email_send_log"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'sent', 'failed', 'skipped')",
            name="ck_email_send_log_status",
        ),
    )

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    project_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer,
            ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    email_type: str = Field(sa_column=Column(String(50), nullable=False))
    related_id: int | None = Field(default=None, sa_column=Column(Integer))
    recipient: str = Field(sa_column=Column(String(320), nullable=False))
    subject: str = Field(sa_column=Column(String(255), nullable=False))
    status: str = Field(
        default="queued",
        sa_column=Column(String(20), nullable=False, server_default=text("'queued'")),
    )
    # SMTP Message-ID we generated (SES keeps it), for tracing a bounce back.
    message_id: str | None = Field(default=None, sa_column=Column(String(255)))
    error: str | None = Field(default=None, sa_column=Column(Text))
    triggered_by: str | None = Field(default=None, sa_column=Column(String(255)))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())
    updated_at: datetime | None = Field(default=None, sa_column=_updated_at_column())
    sent_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )


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
DOMAIN_TABLES: tuple[str, ...] = (
    *LEGACY_TABLES,
    "inspection_reports",
    "project_areas",
    "itp_templates",
    "project_itps",
    "itp_items",
    "signoff_roles",
    "itp_item_required_roles",
    "external_sign_tokens",
    "itp_signatures",
    "email_send_log",
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


class EmailLogPublic(SQLModel):
    """A row of the email send log as the owner-only API returns it."""

    id: int
    public_id: uuid.UUID
    project_id: int | None
    email_type: str
    related_id: int | None
    recipient: str
    subject: str
    status: str
    error: str | None
    triggered_by: str | None
    created_at: datetime
    sent_at: datetime | None


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
    # Exactly one of the two (increment 13.6 adds ITP line evidence).
    inspection_id: int | None = None
    itp_item_id: int | None = None
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(default="image/jpeg", max_length=100)


class PhotoPresignResponse(SQLModel):
    upload_url: str
    s3_key: str


class PhotoCreate(SQLModel):
    # Exactly one of ``inspection_id`` / ``itp_item_id`` (increment 13.6).
    inspection_id: int | None = None
    itp_item_id: int | None = None
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
    inspection_id: int | None
    itp_item_id: int | None = None
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
    # Increment 13: the ITP item this pin marks (same project only).
    itp_item_id: int | None = None
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
    # ``null`` unlinks the ITP item, like ``finding_id``.
    itp_item_id: int | None = None
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
    itp_item_id: int | None = None


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


# --- Increment 13: Block 9.5 ITP screens + Areas -------------------------------
#
# New routes (no legacy counterpart). Shapes are the rebuild's own; the same
# 404 object-hiding applies: an area, ITP, item or role is reached through its
# project, and a master template only by the account that created it.

AreaType = Literal["level", "lot", "stage", "chainage", "other"]
ItpTemplateStatus = Literal["draft", "published", "archived"]
ProjectItpStatus = Literal["not_started", "in_progress", "complete", "voided"]
ItpItemClassification = Literal["hold", "witness", "review", "information"]
ItpItemStatus = Literal["pending", "pass", "fail", "na"]
SignoffParty = Literal["contractor", "client", "engineer"]


class AreaCreate(SQLModel):
    name: str = Field(min_length=1, max_length=255)
    area_type: AreaType = "other"
    parent_area_id: int | None = None


class AreaBulkCreate(SQLModel):
    """A numbered series: ``Level 1`` … ``Level 12``."""

    prefix: str = Field(min_length=1, max_length=200)
    start: int = Field(ge=0, le=100000)
    end: int = Field(ge=0, le=100000)
    area_type: AreaType = "other"
    parent_area_id: int | None = None


class AreaUpdate(SQLModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    area_type: AreaType | None = None
    # ``null`` moves the area to the top level.
    parent_area_id: int | None = None


class AreaOrder(SQLModel):
    area_ids: list[int]


class AreaPublic(SQLModel):
    id: int
    public_id: uuid.UUID
    project_id: int
    parent_area_id: int | None
    name: str
    area_type: str
    sort_order: int
    created_by: str | None
    created_at: datetime
    updated_at: datetime
    # Roll-up of the area's ITPs.
    itp_count: int = 0
    complete_count: int = 0
    item_count: int = 0
    done_count: int = 0
    open_hold_count: int = 0
    signed: bool = False


class ItpTemplateCreate(SQLModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    status: ItpTemplateStatus = "draft"
    body: dict[str, Any]


class ItpTemplateUpdate(SQLModel):
    """Content changes add the next version; the edited row is left as it was."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    body: dict[str, Any] | None = None


class ItpTemplateStatusUpdate(SQLModel):
    status: ItpTemplateStatus


class ItpTemplateVersion(SQLModel):
    id: int
    version: int
    status: str
    created_at: datetime


class ItpTemplateSummary(SQLModel):
    id: int
    public_id: uuid.UUID
    template_key: uuid.UUID
    version: int
    name: str
    description: str | None
    status: str
    item_count: int
    hold_count: int
    role_names: list[str]
    created_by: str | None
    created_at: datetime
    updated_at: datetime


class ItpTemplatePublic(ItpTemplateSummary):
    body: dict[str, Any]
    versions: list[ItpTemplateVersion]


class SignoffRoleCreate(SQLModel):
    role_name: str = Field(min_length=1, max_length=255)
    party: SignoffParty = "contractor"
    signer_email: EmailStr | None = None


class SignoffRoleUpdate(SQLModel):
    role_name: str | None = Field(default=None, min_length=1, max_length=255)
    party: SignoffParty | None = None
    # ``null`` clears the email.
    signer_email: EmailStr | None = None


class SignoffRolePublic(SQLModel):
    id: int
    public_id: uuid.UUID
    project_id: int
    role_name: str
    party: str
    signer_email: str | None
    created_at: datetime
    item_count: int = 0


class ProjectItpCreate(SQLModel):
    template_id: int
    area_id: int | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)


class ProjectItpBulkCreate(SQLModel):
    """Bulk apply: one frozen copy per selected area."""

    template_id: int
    area_ids: list[int] = Field(min_length=1, max_length=200)


class ProjectItpUpdate(SQLModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    # ``null`` makes the ITP whole-project.
    area_id: int | None = None
    status: ProjectItpStatus | None = None


class ItpItemUpdate(SQLModel):
    status: ItpItemStatus | None = None
    notes: str | None = None
    # Increment 13.6: the measured value for a number / text line (null clears).
    measured_value: str | None = Field(default=None, max_length=500)


class ItpSignatureCreate(SQLModel):
    signoff_role_id: int
    signer_name: str | None = Field(default=None, max_length=255)
    gps_lat: float | None = Field(default=None, ge=-90, le=90)
    gps_lng: float | None = Field(default=None, ge=-180, le=180)


class ItpRoleRef(SQLModel):
    id: int
    role_name: str
    party: str
    signer_email: str | None


class ItpSignaturePublic(SQLModel):
    id: int
    itp_item_id: int | None
    signoff_role_id: int | None
    role_name: str
    party: str
    signer_name: str | None
    signer_email: str
    method: str
    signed_at: datetime
    gps_lat: float | None
    gps_lng: float | None


class ItpPinRef(SQLModel):
    id: int
    drawing_id: int
    drawing_title: str | None
    page_number: int
    label: str | None
    tag_number: str | None
    status: str


class ItpItemPublic(SQLModel):
    id: int
    public_id: uuid.UUID
    project_itp_id: int
    section: str | None
    element_name: str | None
    requirement: str
    classification: str
    status: str
    notes: str | None
    sort_order: int
    updated_at: datetime
    # Increment 13.6 — line evidence.
    acceptance_criteria: str | None = None
    reference_doc: str | None = None
    record_required: str | None = None
    photo_required: bool = False
    photo_count: int = 0
    value_type: str | None = None
    value_unit: str | None = None
    value_min: float | None = None
    value_max: float | None = None
    measured_value: str | None = None
    # True / False for a number line with limits and a value; else null.
    out_of_tolerance: bool | None = None
    required_roles: list[ItpRoleRef]
    signatures: list[ItpSignaturePublic]
    # Hold point: every required role has signed. Always true for other lines.
    released: bool
    # The unreleased hold point earlier in the ITP that stops this line being
    # recorded, if any.
    blocked_by_item_id: int | None
    pins: list[ItpPinRef]


class ProjectItpSummary(SQLModel):
    id: int
    public_id: uuid.UUID
    project_id: int
    area_id: int | None
    area_name: str | None
    template_id: int | None
    template_version: int | None
    title: str
    status: str
    item_count: int
    done_count: int
    fail_count: int
    hold_count: int
    open_hold_count: int
    signature_count: int
    created_by: str | None
    created_at: datetime
    updated_at: datetime


class ProjectItpPublic(ProjectItpSummary):
    body: dict[str, Any]
    items: list[ItpItemPublic]
    # Plain-language reasons the ITP cannot be marked complete yet.
    completion_blockers: list[str]


class ItpItemRef(SQLModel):
    """One line of any of a project's ITPs, for the pin dialog's picker."""

    id: int
    project_itp_id: int
    itp_title: str
    area_name: str | None
    section: str | None
    requirement: str
    classification: str
    status: str
    released: bool
