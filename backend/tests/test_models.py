"""ORM-level checks for the increment 03 data layer against the app database
(migrated by `scripts/prestart.sh` before the suite runs). Every test runs in
a transaction that is rolled back, so nothing is left behind.
"""

import uuid
from collections.abc import Iterator
from decimal import Decimal

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.db import engine
from app.models import (
    DOMAIN_TABLES,
    PAGE_NUMBER_COMMENT,
    Drawing,
    Finding,
    Inspection,
    InspectionPin,
    Photo,
    Project,
    ProjectMember,
    SQLModel,
)


@pytest.fixture
def db() -> Iterator[Session]:
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


def _project(db: Session, **kwargs: object) -> Project:
    project = Project(name="Greenwood plant", client="PGE", **kwargs)  # type: ignore[arg-type]
    db.add(project)
    db.flush()
    return project


def test_domain_tables_are_registered_with_integer_pks() -> None:
    tables = SQLModel.metadata.tables
    for name in DOMAIN_TABLES:
        assert name in tables, name
        pk = list(tables[name].primary_key.columns)
        assert [c.name for c in pk] == ["id"]
        assert pk[0].type.python_type is int
        public_id = tables[name].c.public_id
        assert public_id.unique or any(
            {c.name for c in uc.columns} == {"public_id"}
            for uc in tables[name].constraints
        )
    assert "user" not in tables  # Auth0 is the identity provider


def test_live_schema_has_the_block_8e_columns() -> None:
    with engine.connect() as conn:
        inspector = inspect(conn)
        pins = {c["name"]: c for c in inspector.get_columns("inspection_pins")}
        drawings = {c["name"] for c in inspector.get_columns("drawings")}
    assert pins["page_number"]["nullable"] is False
    assert pins["page_number"]["comment"] == PAGE_NUMBER_COMMENT
    assert {"page_width_pts", "page_height_pts"} <= drawings


def test_server_defaults_and_public_ids(db: Session) -> None:
    project = _project(db)
    assert isinstance(project.id, int)
    db.refresh(project)
    assert isinstance(project.public_id, uuid.UUID)
    assert project.status == "active"
    assert project.created_at is not None and project.updated_at is not None

    inspection = Inspection(project_id=project.id, title="Walk 1")
    db.add(inspection)
    db.flush()
    db.refresh(inspection)
    assert inspection.status == "open"
    assert inspection.inspection_status == "open"
    assert inspection.signed_off_at is None

    finding = Finding(inspection_id=inspection.id, title="Crack in slab")
    db.add(finding)
    db.flush()
    db.refresh(finding)
    assert finding.priority == "medium"
    assert finding.status == "open"

    drawing = Drawing(
        project_id=project.id,
        title="P&ID-001",
        filename="pid.pdf",
        s3_key=f"drawings/projects/{project.id}/{uuid.uuid4().hex}.pdf",
        file_type="pdf",
        page_width_pts=Decimal("1224"),
        page_height_pts=Decimal("792"),
    )
    db.add(drawing)
    db.flush()
    pin = InspectionPin(
        drawing_id=drawing.id, x_pct=Decimal("42.500"), y_pct=Decimal("67.100")
    )
    db.add(pin)
    db.flush()
    db.refresh(pin)
    assert pin.page_number == 1  # raster / legacy default
    assert pin.status == "not_started"
    assert pin.x_pct == Decimal("42.500")

    photo = Photo(inspection_id=inspection.id, s3_key="photos/1/abc.jpg")
    db.add(photo)
    db.flush()
    db.refresh(photo)
    assert isinstance(photo.public_id, uuid.UUID)
    assert (
        len(
            {
                project.public_id,
                inspection.public_id,
                finding.public_id,
                drawing.public_id,
                pin.public_id,
                photo.public_id,
            }
        )
        == 6
    )


def test_page_aware_pins_and_discipline_data(db: Session) -> None:
    project = _project(db)
    drawing = Drawing(
        project_id=project.id,
        title="Sheet set",
        filename="set.pdf",
        s3_key=f"drawings/projects/{project.id}/set.pdf",
        file_type="pdf",
    )
    db.add(drawing)
    db.flush()
    db.add_all(
        [
            InspectionPin(
                drawing_id=drawing.id,
                x_pct=Decimal("1"),
                y_pct=Decimal("2"),
                page_number=1,
            ),
            InspectionPin(
                drawing_id=drawing.id,
                x_pct=Decimal("3"),
                y_pct=Decimal("4"),
                page_number=3,
                discipline_data={"elevation_ft": 101.5, "rebar": {"size": "#5"}},
            ),
        ]
    )
    db.flush()
    page3 = db.exec(
        select(InspectionPin).where(
            InspectionPin.drawing_id == drawing.id, InspectionPin.page_number == 3
        )
    ).all()
    assert len(page3) == 1
    assert page3[0].discipline_data == {"elevation_ft": 101.5, "rebar": {"size": "#5"}}


def test_membership_is_unique_per_project_and_email(db: Session) -> None:
    project = _project(db)
    db.add(
        ProjectMember(project_id=project.id, user_email="a@example.com", role="owner")
    )
    db.flush()
    # Same email on another project is fine.
    other = _project(db)
    db.add(ProjectMember(project_id=other.id, user_email="a@example.com"))
    db.flush()
    db.add(ProjectMember(project_id=project.id, user_email="a@example.com"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_member_sub_is_optional_until_first_sign_in(db: Session) -> None:
    project = _project(db)
    member = ProjectMember(project_id=project.id, user_email="b@example.com")
    db.add(member)
    db.flush()
    db.refresh(member)
    assert member.user_sub is None
    assert member.role == "inspector"
    member.user_sub = "auth0|abc123"
    db.flush()
    found = db.exec(
        select(ProjectMember).where(ProjectMember.user_sub == "auth0|abc123")
    ).one()
    assert found.id == member.id


def test_cascade_deletes_follow_the_legacy_fk_rules(db: Session) -> None:
    project = _project(db)
    inspection = Inspection(project_id=project.id, title="Walk")
    db.add(inspection)
    db.flush()
    finding = Finding(inspection_id=inspection.id, title="Open item")
    db.add(finding)
    db.flush()
    # Increment 11a: a photo filed under the finding (capture loop).
    photo = Photo(
        inspection_id=inspection.id, finding_id=finding.id, s3_key="photos/x.jpg"
    )
    drawing = Drawing(
        project_id=project.id,
        title="D",
        filename="d.png",
        s3_key=f"drawings/projects/{project.id}/d.png",
    )
    db.add_all([photo, drawing])
    db.flush()
    pin = InspectionPin(
        drawing_id=drawing.id,
        finding_id=finding.id,
        x_pct=Decimal("5"),
        y_pct=Decimal("5"),
    )
    db.add(pin)
    db.flush()
    pin_id, finding_id, project_id = pin.id, finding.id, project.id
    photo_id = photo.id

    # Deleting a finding detaches the pin and the photo (ON DELETE SET NULL)
    # but keeps both.
    db.delete(finding)
    db.flush()
    db.expire_all()
    pin_again = db.get(InspectionPin, pin_id)
    assert pin_again is not None and pin_again.finding_id is None
    photo_again = db.get(Photo, photo_id)
    assert photo_again is not None and photo_again.finding_id is None
    assert db.get(Finding, finding_id) is None

    # Deleting the project cascades through inspections, photos, drawings, pins.
    db.delete(db.get(Project, project_id))
    db.flush()
    db.expire_all()
    assert db.get(InspectionPin, pin_id) is None
    assert (
        db.exec(select(Inspection).where(Inspection.project_id == project_id)).all()
        == []
    )
    assert db.exec(select(Photo)).all() == [] or all(
        p.inspection_id != inspection.id for p in db.exec(select(Photo)).all()
    )
