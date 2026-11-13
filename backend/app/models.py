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

from pydantic import EmailStr, computed_field, field_validator
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Field, Relationship, SQLModel

from app.core.doc_numbers import (
    CODE_MAX_LENGTH,
    effective_project_code,
    normalise_project_code,
)
from app.core.itp_import import ItpImportDraft


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
# Increment 13.8: a line may require the three-shot photo set (owner's field
# guide Ch. 10) instead of a single photo. Slot order is the shooting order.
ITP_PHOTO_SETS = ("three_shot",)
THREE_SHOT_SLOTS = ("context", "intermediate", "closeup")
# Increment 13.9: a release line (the owner's field guide Checklist A-1 result
# "Approved to pour / Approved with conditions / Rejected") is recorded on a
# three-way scale instead of Pass / Fail / N/A. Stored as status ``pass`` (no
# conditions), ``pass`` + ``conditions`` text, or ``fail``; N/A is refused.
ITP_RESULT_SCALES = ("release",)
RELEASE_APPROVED_LABEL = "Approved"
RELEASE_CONDITIONAL_LABEL = "Approved with conditions"
RELEASE_REJECTED_LABEL = "Rejected"
ITP_ITEM_STATUSES = ("pending", "pass", "fail", "na")
SIGNOFF_PARTIES = ("contractor", "client", "engineer")
ITP_SIGNATURE_METHODS = ("in_app", "external_link")
# Increment 13.5 outbound email (Block 7.1 pulled forward).
EMAIL_TYPES = ("member_invite", "sign_request", "sign_reminder", "witness_notice")
# Increment 14: why a signing link stopped working before it was used.
SIGN_LINK_REVOKE_REASONS = ("withdrawn", "replaced")
# What a signing link looks like from the outside.
SIGN_LINK_STATES = ("active", "used", "expired", "revoked", "replaced")
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
    # Increment 13.8: short code used in ITP document numbers (ITP-<CODE>-<SEQ>).
    # NULL: a code derived from the name is used (app/core/doc_numbers.py).
    code: str | None = Field(default=None, sa_column=Column(String(CODE_MAX_LENGTH)))
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
    __table_args__ = (
        Index(
            "uq_findings_ai_suggestion",
            "ai_suggestion_id",
            unique=True,
            postgresql_where=text("ai_suggestion_id IS NOT NULL"),
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
    # Increment 15 (Block 10B): the discipline the finding belongs to (the
    # drawing discipline vocabulary); NULL for findings logged before it.
    discipline: str | None = Field(default=None, sa_column=Column(String(40)))
    # Increment 15 guardrail: the AI draft this finding was confirmed from, so
    # the prompt and model version stay traceable per finding. At most one
    # finding per draft; SET NULL keeps the finding if the log row goes.
    ai_suggestion_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("ai_suggestions.id", ondelete="SET NULL"), nullable=True
        ),
    )
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
        CheckConstraint(
            "shot_slot IS NULL OR (itp_item_id IS NOT NULL AND shot_slot IN "
            "('context', 'intermediate', 'closeup'))",
            name="ck_photos_shot_slot",
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
    # Increment 13.8 — three-shot set slot (context / intermediate / closeup)
    # for ITP line evidence; NULL for an ordinary photo.
    shot_slot: str | None = Field(default=None, sa_column=Column(String(20)))
    # When the picture was taken, as the device reported it (the original
    # file, EXIF included, is stored unchanged in S3). NULL when unknown.
    captured_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    # Increment 15 (Block 10A): how the inspector filed the photo — category,
    # defect tags and severity — set by hand or confirmed from an AI draft.
    # All NULL until someone files it.
    category: str | None = Field(default=None, sa_column=Column(String(30)))
    defect_tags: list[str] | None = Field(default=None, sa_column=Column(JSONB))
    severity: str | None = Field(default=None, sa_column=Column(String(10)))
    tags_confirmed_by: str | None = Field(default=None, sa_column=Column(String(255)))
    tags_confirmed_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    ai_suggestion_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("ai_suggestions.id", ondelete="SET NULL"), nullable=True
        ),
    )
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
    # Increment 14.5 — drawing revisions. Every revision of a sheet is its own
    # row; ``series_id`` groups them (the id of the first revision, no FK so
    # the group survives that row's deletion), ``revision`` is the label
    # ("A", "B", "0", "P1" …) and ``superseded_at`` is set when a newer
    # revision is uploaded. Exactly one row per series is current
    # (``superseded_at IS NULL``, partial unique index).
    series_id: int | None = Field(default=None, sa_column=Column(Integer, index=True))
    revision: str | None = Field(default=None, sa_column=Column(String(20)))
    superseded_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )

    __table_args__ = (
        Index(
            "uq_drawings_series_current",
            "series_id",
            unique=True,
            postgresql_where=text("superseded_at IS NULL"),
        ),
    )

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

    # Increment 14.5: a pin copied onto a new drawing revision remembers the
    # pin it came from and asks for its position to be checked until someone
    # confirms it or moves it.
    carried_from_pin_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("inspection_pins.id", ondelete="SET NULL"), index=True
        ),
    )
    position_check: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default=text("false")),
    )
    position_confirmed_by: str | None = Field(
        default=None, sa_column=Column(String(255))
    )
    position_confirmed_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
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
    # Increment 16 (Block 10C): the inspector's summary printed at the top of
    # this version, and the AI draft it started from, if any.
    summary: str | None = Field(default=None, sa_column=Column(Text))
    ai_suggestion_id: int | None = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("ai_suggestions.id", ondelete="SET NULL")),
    )
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
    __table_args__ = (
        UniqueConstraint("project_id", "seq", name="uq_project_itps_seq"),
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
    # Increment 13.8: 1, 2, 3 … per project — the SEQ of the document number
    # ITP-<PROJECT CODE>-<SEQ>. Given at creation; never reused or renumbered.
    seq: int | None = Field(default=None, sa_column=Column(Integer))
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
    # Increment 13.8: "three_shot" — the line is evidenced only when it has a
    # Context, an Intermediate and a Close-up-with-scale photo. NULL: none.
    photo_set: str | None = Field(default=None, sa_column=Column(String(20)))
    # Increment 13.9: "release" — Approved / Approved with conditions /
    # Rejected instead of Pass / Fail / N/A. NULL: the ordinary scale.
    result_scale: str | None = Field(default=None, sa_column=Column(String(20)))
    # The wording of "Approved" on this line, e.g. "Approved to pour".
    approved_label: str | None = Field(default=None, sa_column=Column(String(60)))
    # The written conditions of an "Approved with conditions" release.
    conditions: str | None = Field(default=None, sa_column=Column(Text))
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
    # Increment 14 (migration d8b3f5a2c614). ``withdrawn`` when someone on the
    # project revoked the link; ``replaced`` when a reminder or a new request
    # for the same role and document issued a fresh link in its place (the
    # raw token is never stored, so a reminder cannot resend the old one).
    revoked_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    revoked_reason: str | None = Field(default=None, sa_column=Column(String(20)))
    # How many reminders came before this link (0 for the first request).
    reminder_count: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, server_default=text("0")),
    )
    created_by: str | None = Field(default=None, sa_column=Column(String(255)))
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())


class ItpSignPack(SQLModel, table=True):
    """One generated version of a sign-off pack PDF (increment 14).

    A pack is either one ITP's or one area's combined pack (exactly one of
    ``project_itp_id`` / ``area_id``). Versions are numbered per document and
    never overwritten; the PDF lives in S3 (``s3_key``), never in the
    database. ``content_hash`` is the SHA-256 of everything the PDF shows, so
    asking for the pack again only renders a new version when something on
    it changed (regenerate-on-change).
    """

    __tablename__ = "itp_sign_packs"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(project_itp_id, area_id) = 1",
            name="ck_itp_sign_packs_one_document",
        ),
        Index(
            "uq_itp_sign_packs_itp_version",
            "project_itp_id",
            "version",
            unique=True,
            postgresql_where=text("project_itp_id IS NOT NULL"),
        ),
        Index(
            "uq_itp_sign_packs_area_version",
            "area_id",
            "version",
            unique=True,
            postgresql_where=text("area_id IS NOT NULL"),
        ),
    )

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
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
    version: int = Field(sa_column=Column(Integer, nullable=False))
    s3_key: str = Field(sa_column=Column(String(512), nullable=False))
    filename: str = Field(sa_column=Column(String(255), nullable=False))
    file_size: int = Field(sa_column=Column(Integer, nullable=False))
    content_hash: str = Field(sa_column=Column(String(64), nullable=False))
    signature_count: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, server_default=text("0")),
    )
    generated_by: str | None = Field(default=None, sa_column=Column(String(255)))
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


class AiSuggestion(SQLModel, table=True):
    """One AI draft (rebuild increment 15; PRD v2.62 Block 10 guardrails).

    Every call to the model writes a row — the draft it returned or the error
    — with the exact prompt text, prompt version and model version, so a
    finding confirmed from it stays defensible. Rows start as ``draft`` and
    move to ``confirmed`` (the inspector saved it, ``edited`` says whether they
    changed anything first) or ``dismissed``; a call that produced nothing is
    ``failed``. The photo itself is never stored here (only its id); the
    transcript is, because it is the input the draft was made from.
    """

    __tablename__ = "ai_suggestions"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('photo', 'voice', 'report', 'itp_import')",
            name="ck_ai_suggestions_kind",
        ),
        # An ITP import (10E) belongs to the account that asked for it; every
        # other kind is about one inspection.
        CheckConstraint(
            "kind = 'itp_import' OR "
            "(project_id IS NOT NULL AND inspection_id IS NOT NULL)",
            name="ck_ai_suggestions_scope",
        ),
        CheckConstraint(
            "status IN ('draft', 'confirmed', 'dismissed', 'failed')",
            name="ck_ai_suggestions_status",
        ),
    )

    id: int | None = Field(default=None, sa_column=_pk_column())
    public_id: uuid.UUID | None = Field(default=None, sa_column=_public_id_column())
    kind: str = Field(sa_column=Column(String(20), nullable=False))
    status: str = Field(
        default="draft",
        sa_column=Column(String(20), nullable=False, server_default=text("'draft'")),
    )
    project_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer,
            ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )
    inspection_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer,
            ForeignKey("inspections.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )
    # 10E: the master template a confirmed import was saved as.
    template_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("itp_templates.id", ondelete="SET NULL"), index=True
        ),
    )
    # 10E: the uploaded files — [{name, content_type, size, s3_key}]; the
    # originals are kept in S3 (Hard Rule 8), never in this table.
    source_files: list[dict[str, Any]] | None = Field(
        default=None, sa_column=Column(JSONB)
    )
    photo_id: int | None = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("photos.id", ondelete="SET NULL"), index=True
        ),
    )
    model: str = Field(sa_column=Column(String(100), nullable=False))
    prompt_version: str = Field(sa_column=Column(String(40), nullable=False))
    system_prompt: str = Field(sa_column=Column(Text, nullable=False))
    user_prompt: str = Field(sa_column=Column(Text, nullable=False))
    # 10B: the spoken observation as transcribed on the phone.
    input_text: str | None = Field(default=None, sa_column=Column(Text))
    draft: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    error: str | None = Field(default=None, sa_column=Column(Text))
    input_tokens: int | None = Field(default=None, sa_column=Column(Integer))
    output_tokens: int | None = Field(default=None, sa_column=Column(Integer))
    edited: bool | None = Field(default=None, sa_column=Column(Boolean))
    requested_by: str = Field(sa_column=Column(String(255), nullable=False))
    requested_by_sub: str = Field(sa_column=Column(String(255), nullable=False))
    decided_by: str | None = Field(default=None, sa_column=Column(String(255)))
    decided_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    created_at: datetime | None = Field(default=None, sa_column=_created_at_column())


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
    "itp_sign_packs",
    "ai_suggestions",
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
    # Increment 13.8: optional code for ITP numbers; blank → derived from name.
    code: str | None = Field(default=None, max_length=CODE_MAX_LENGTH + 10)

    @field_validator("code")
    @classmethod
    def _code(cls, value: str | None) -> str | None:
        return normalise_project_code(value)


class ProjectUpdate(SQLModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    client: str | None = Field(default=None, max_length=255)
    location: str | None = Field(default=None, max_length=255)
    status: ProjectStatus | None = None
    # Increment 13.8: "" or null clears it (the derived code is used again).
    code: str | None = Field(default=None, max_length=CODE_MAX_LENGTH + 10)

    @field_validator("code")
    @classmethod
    def _code(cls, value: str | None) -> str | None:
        return normalise_project_code(value)


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
    # Increment 13.8: the code an owner set (or null) …
    code: str | None = None

    # … and the one ITP numbers actually use.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def itp_code(self) -> str:
        return effective_project_code(self.code, self.name, self.id)


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
    # Increment 15: discipline (drawing vocabulary) and the AI draft this
    # finding is confirmed from — sending it is the inspector's confirmation.
    discipline: DrawingDiscipline | None = None
    ai_suggestion_id: int | None = None


class FindingUpdate(SQLModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    priority: FindingPriority | None = None
    location_ref: str | None = Field(default=None, max_length=255)
    discipline: DrawingDiscipline | None = None


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
    discipline: str | None = None
    ai_suggestion_id: int | None = None
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
    # Increment 13.8: the three-shot slot this ITP line photo fills, and when
    # the device says the picture was taken.
    shot_slot: Literal["context", "intermediate", "closeup"] | None = None
    captured_at: datetime | None = None


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
    shot_slot: str | None = None
    captured_at: datetime | None = None
    # Increment 15 (Block 10A): how the photo is filed.
    category: str | None = None
    defect_tags: list[str] | None = None
    severity: str | None = None
    tags_confirmed_by: str | None = None
    tags_confirmed_at: datetime | None = None
    ai_suggestion_id: int | None = None
    # Presigned S3 GET URL, generated per response (never stored).
    view_url: str | None = None


# --- Increment 15: AI capture assistance (Block 10A / 10B) --------------------

PhotoCategory = Literal[
    "progress", "defect", "safety", "materials", "equipment", "documentation", "other"
]
DefectType = Literal["crack", "corrosion", "water_ingress", "damage", "safety_hazard"]
Severity = Literal["low", "medium", "high"]


class PhotoTagsUpdate(SQLModel):
    """File a photo: by hand, or confirming an AI draft (``ai_suggestion_id``)."""

    category: PhotoCategory | None = None
    defect_tags: list[DefectType] = Field(default_factory=list, max_length=5)
    severity: Severity | None = None
    ai_suggestion_id: int | None = None


class AiStatus(SQLModel):
    enabled: bool
    model: str | None
    daily_limit: int
    used_today: int


class PhotoAnalysisRequest(SQLModel):
    photo_id: int


class VoiceFindingRequest(SQLModel):
    inspection_id: int
    transcript: str = Field(min_length=1, max_length=20000)
    location_ref: str | None = Field(default=None, max_length=255)


class ReportDraftRequest(SQLModel):
    inspection_id: int


class ItpImportSave(SQLModel):
    """10E: save a reviewed import draft as a new master template."""

    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    draft: ItpImportDraft


class AiSourceFile(SQLModel):
    name: str
    content_type: str
    size: int


class AiSuggestionPublic(SQLModel):
    id: int
    kind: str
    status: str
    project_id: int | None
    inspection_id: int | None
    photo_id: int | None
    template_id: int | None = None
    source_files: list[AiSourceFile] | None = None
    model: str
    prompt_version: str
    draft: dict[str, Any] | None
    edited: bool | None
    requested_by: str
    decided_by: str | None
    decided_at: datetime | None
    created_at: datetime


class AiSuggestionLog(AiSuggestionPublic):
    """The full audit row (prompts, transcript, tokens, error)."""

    system_prompt: str
    user_prompt: str
    input_text: str | None
    error: str | None
    input_tokens: int | None
    output_tokens: int | None
    finding_id: int | None = None


# --- Increment 05: drawings + pins (Block 8D/8E router, hardening carried over) ---
#
# Request bodies mirror the deployed ``staging_drawings_block8e.py`` schemas
# field for field; responses return every column as ``dict(row)`` did. Numeric
# columns (pin percentages, PDF page dimensions) are returned as JSON numbers,
# which is what the SPA's pin overlay and PDF.js scaling arithmetic consume.

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
    # Increment 14.5: optional revision label of the first upload ("A", "0" …).
    revision: str | None = Field(default=None, max_length=20)


class DrawingRevisionCreate(SQLModel):
    """Increment 14.5: register a new revision of an existing drawing.

    The file goes up exactly like a new drawing (``POST /drawings/presign`` →
    S3 PUT); this registers it against the drawing's series instead of as a
    separate drawing. Title, number and discipline carry over unless sent.
    """

    filename: str = Field(min_length=1, max_length=255)
    s3_key: str = Field(min_length=1, max_length=512)
    file_type: DrawingFileType = "png"
    file_size: int | None = Field(default=None, ge=0)
    page_width_pts: float | None = Field(default=None, gt=0)
    page_height_pts: float | None = Field(default=None, gt=0)
    # Blank → the next label after the current one (A → B, 0 → 1, P1 → P2).
    revision: str | None = Field(default=None, max_length=20)
    title: str | None = Field(default=None, min_length=1, max_length=255)
    drawing_number: str | None = Field(default=None, max_length=100)


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
    # Increment 14.5 — revisions. ``series_id`` groups a sheet's revisions;
    # only the current one (``is_current``) takes pin changes.
    series_id: int | None = None
    revision: str | None = None
    superseded_at: datetime | None = None
    revision_count: int = 1
    # Pins carried from the previous revision whose position nobody has
    # confirmed yet.
    pins_to_check: int = 0

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_current(self) -> bool:
        return self.superseded_at is None


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
    # Increment 14.5: move a pin (clears "check position"), or confirm a
    # carried pin where it is with ``position_confirmed: true``.
    x_pct: float | None = Field(default=None, ge=0, le=100)
    y_pct: float | None = Field(default=None, ge=0, le=100)
    page_number: int | None = Field(default=None, ge=1)
    position_confirmed: bool | None = None


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
    # Increment 14.5: pins carried onto a new drawing revision.
    carried_from_pin_id: int | None = None
    # The revision label of the drawing the pin was carried from.
    carried_from_revision: str | None = None
    position_check: bool = False
    position_confirmed_by: str | None = None
    position_confirmed_at: datetime | None = None


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
    # Increment 16 (Block 10C): an optional summary printed at the top of the
    # report, written by the inspector or edited from an AI draft
    # (``ai_suggestion_id``, a ``report`` draft of the same inspection).
    summary: str | None = Field(default=None, max_length=6000)
    ai_suggestion_id: int | None = None


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
    summary: str | None = None
    ai_suggestion_id: int | None = None
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
    # Increment 13.9: on a release line, the conditions of "Approved with
    # conditions" (sent with status "pass"; null or blank means plain Approved).
    conditions: str | None = Field(default=None, max_length=4000)


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
    # Increment 14: the weather at the project when it was signed (the same
    # fields as the weather badge) and a short-lived link to the drawn
    # signature, when one was captured.
    weather: dict[str, Any] | None = None
    signature_url: str | None = None


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
    # Increment 13.8: "three_shot" or null; the slots that have a photo; and
    # whether the line's photo rule (single or set) is met.
    photo_set: str | None = None
    shot_slots: list[str] = []
    evidenced: bool = True
    value_type: str | None = None
    value_unit: str | None = None
    value_min: float | None = None
    value_max: float | None = None
    measured_value: str | None = None
    # True / False for a number line with limits and a value; else null.
    out_of_tolerance: bool | None = None
    # Increment 13.9: "release" or null; the wording of Approved on this line;
    # the written conditions; and the result in words ("Approved to pour",
    # "Approved with conditions", "Rejected"; null while pending or on an
    # ordinary line).
    result_scale: str | None = None
    approved_label: str | None = None
    conditions: str | None = None
    result_label: str | None = None
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
    # Increment 13.8: ITP-<PROJECT CODE>-<SEQ>, e.g. ITP-LC4-007.
    seq: int | None = None
    doc_number: str | None = None
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
    doc_number: str | None = None
    area_name: str | None
    section: str | None
    requirement: str
    classification: str
    status: str
    released: bool


# --- Increment 14: external sign-off, packs, witness notices ----------------


class SignLinkCreate(SQLModel):
    """Ask for signatures by email.

    With ``signoff_role_id``: one link for that role (``signer_email``
    overrides the role's address). Without it: one link for every required
    role that has a signer email and still has lines to sign.
    """

    signoff_role_id: int | None = None
    signer_email: EmailStr | None = None


class SignLinkPublic(SQLModel):
    id: int
    public_id: uuid.UUID
    project_itp_id: int | None
    area_id: int | None
    signoff_role_id: int
    role_name: str
    signer_email: str
    # active | used | expired | revoked | replaced
    status: str
    expires_at: datetime
    used_at: datetime | None
    revoked_at: datetime | None
    reminder_count: int
    created_by: str | None
    created_at: datetime
    # Outcome of the email that carried this link (queued / sent / failed /
    # skipped), when there is one.
    email_status: str | None = None
    # The link itself — only in the response that created it. Only its
    # SHA-256 is stored, so it can never be read back later.
    link: str | None = None


class SignLinkBatch(SQLModel):
    links: list[SignLinkPublic]
    # Roles that were not sent a link, with the reason, in plain language.
    skipped: list[str]


class SignPackPublic(SQLModel):
    id: int
    project_itp_id: int | None
    area_id: int | None
    version: int
    filename: str
    file_size: int
    signature_count: int
    generated_by: str | None
    created_at: datetime
    download_url: str
    # On POST: whether this request rendered a new version (false when the
    # latest version already shows everything).
    regenerated: bool = False


class WitnessNoticeCreate(SQLModel):
    # When the work is expected to be ready to witness (free text keeps it
    # simple across time zones: "Thu 14 Nov, 7:30 am").
    planned_for: str | None = Field(default=None, max_length=120)
    message: str | None = Field(default=None, max_length=2000)


class WitnessNoticeResult(SQLModel):
    sent_to: list[str]
    skipped: list[str]


class SignLine(SQLModel):
    """One line as the external signer sees it."""

    id: int
    number: int
    section: str | None
    requirement: str
    classification: str
    status: str
    result_label: str | None
    measured_value: str | None
    value_unit: str | None
    out_of_tolerance: bool | None
    notes: str | None
    conditions: str | None
    acceptance_criteria: str | None
    reference_doc: str | None
    photo_count: int
    # Does this line need the link's role at all?
    needs_you: bool
    # ready: can be signed now; signed: this role already signed it;
    # waiting: needs this role but not yet ready (``waiting_reason`` says why).
    sign_state: str | None
    waiting_reason: str | None


class SignDocument(SQLModel):
    itp_id: int
    doc_number: str | None
    title: str
    status: str
    area_name: str | None
    lines: list[SignLine]


class SignSessionPublic(SQLModel):
    project_name: str
    project_client: str | None
    project_location: str | None
    # "itp" for one ITP's link, "area" for an area's combined pack.
    kind: str
    area_name: str | None
    role_name: str
    party: str
    signer_email: str
    expires_at: datetime
    documents: list[SignDocument]
    ready_count: int
    waiting_count: int
    signed_count: int
    # The current pack PDF (rendered on demand), if it could be produced.
    pack_url: str | None = None


class SignSubmit(SQLModel):
    signer_name: str = Field(min_length=1, max_length=255)
    # The drawn signature as a PNG data URL (signature_pad's toDataURL()).
    signature_png: str = Field(min_length=30, max_length=400_000)
    # The signer ticks "I have reviewed the lines above"; must be true.
    confirm: bool
    gps_lat: float | None = Field(default=None, ge=-90, le=90)
    gps_lng: float | None = Field(default=None, ge=-180, le=180)


class SignResult(SQLModel):
    signed_lines: int
    documents: int
    signed_at: datetime
    weather: dict[str, Any] | None
    # Lines that still need this role but were not ready (a new link is sent
    # for them later).
    still_waiting: int
