"""Increment 12: the Block 9.5 ITP / Areas tables, against the migrated database.

The rules under test are the ones the data model itself has to guarantee:
frozen copies, at most one area per ITP, signed evidence that cannot be deleted
piecemeal, and tokens stored only as a hash. Every test runs in a transaction
that is rolled back.
"""

from collections.abc import Iterator
from datetime import timedelta
from decimal import Decimal
from hashlib import sha256
from typing import Any, cast

import pytest
from sqlalchemy import delete, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.core.db import engine
from app.models import (
    Drawing,
    ExternalSignToken,
    InspectionPin,
    ItpItem,
    ItpItemRequiredRole,
    ItpSignature,
    ItpTemplate,
    Project,
    ProjectArea,
    ProjectItp,
    SignoffRole,
)

BODY: dict[str, Any] = {
    "title": "Concrete pour",
    "pages": [{"name": "formwork", "elements": [{"name": "rebar", "type": "text"}]}],
}


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


def _add[T](db: Session, row: T) -> T:
    db.add(row)
    db.flush()
    db.refresh(row)
    return row


def _project(db: Session) -> Project:
    return _add(db, Project(name="Greenwood plant"))


def _itp(db: Session, project: Project, area: ProjectArea | None = None) -> ProjectItp:
    return _add(
        db,
        ProjectItp(
            project_id=cast(int, project.id),
            area_id=area.id if area else None,
            title="Concrete pour",
            body=BODY,
        ),
    )


def _area(db: Session, project: Project, name: str = "Level 1") -> ProjectArea:
    return _add(
        db, ProjectArea(project_id=cast(int, project.id), name=name, area_type="level")
    )


def _item(db: Session, itp: ProjectItp, classification: str = "hold") -> ItpItem:
    return _add(
        db,
        ItpItem(
            project_itp_id=cast(int, itp.id),
            requirement="Rebar inspected before pour",
            classification=classification,
        ),
    )


def _role(db: Session, project: Project) -> SignoffRole:
    return _add(
        db,
        SignoffRole(
            project_id=cast(int, project.id),
            role_name="Client engineer",
            party="engineer",
            signer_email="engineer@example.com",
        ),
    )


def _signature(
    db: Session, itp: ProjectItp, item: ItpItem | None, role: SignoffRole
) -> ItpSignature:
    return _add(
        db,
        ItpSignature(
            project_itp_id=cast(int, itp.id),
            itp_item_id=item.id if item else None,
            signoff_role_id=role.id,
            role_name=role.role_name,
            party=role.party,
            signer_email="engineer@example.com",
            method="external_link",
            gps_lat=Decimal("34.194400"),
            gps_lng=Decimal("-82.161800"),
            weather={"description": "Clear", "temp_f": 71},
            signature_s3_key="signatures/1/abc.png",
        ),
    )


def _token(db: Session, role: SignoffRole, **target: Any) -> ExternalSignToken:
    return _add(
        db,
        ExternalSignToken(
            token_hash=sha256(b"raw-link-token").hexdigest(),
            signoff_role_id=cast(int, role.id),
            signer_email="engineer@example.com",
            **target,
        ),
    )


def _delete_refused(db: Session, row: Any, table: type[Any], fragment: str) -> None:
    """Deleting ``row`` is refused by its guard, and the row is still there."""
    with pytest.raises(IntegrityError, match=fragment):
        with db.begin_nested():
            db.execute(delete(table).where(table.id == row.id))
    assert db.execute(select(table.id).where(table.id == row.id)).scalar() == row.id


def _gone(db: Session, table: type[Any], row_id: int | None) -> bool:
    db.expire_all()
    return db.execute(select(table.id).where(table.id == row_id)).first() is None


def test_template_versions_share_a_key_and_cannot_repeat(db: Session) -> None:
    first = _add(db, ItpTemplate(name="Concrete pour", body=BODY))
    assert first.version == 1 and first.status == "draft"
    assert first.template_key is not None

    second = _add(
        db,
        ItpTemplate(
            template_key=first.template_key, version=2, name="Concrete pour", body=BODY
        ),
    )
    assert second.id != first.id

    with pytest.raises(IntegrityError, match="uq_itp_templates_version"):
        with db.begin_nested():
            db.add(
                ItpTemplate(
                    template_key=first.template_key,
                    version=2,
                    name="Clash",
                    body=BODY,
                )
            )
            db.flush()


def test_frozen_copy_is_independent_of_the_master(db: Session) -> None:
    project = _project(db)
    template = _add(db, ItpTemplate(name="Concrete pour", body=BODY))
    copy = _add(
        db,
        ProjectItp(
            project_id=cast(int, project.id),
            template_id=template.id,
            template_version=template.version,
            title=template.name,
            body=dict(template.body),
        ),
    )
    assert copy.status == "not_started"

    template.body = {"title": "Edited master", "pages": []}
    db.add(template)
    db.flush()
    db.refresh(copy)
    assert copy.body == BODY

    # The master can go; the copy keeps its content and which version it was.
    db.execute(delete(ItpTemplate).where(ItpTemplate.id == template.id))  # type: ignore[arg-type]
    db.refresh(copy)
    assert copy.template_id is None
    assert copy.template_version == 1
    assert copy.body == BODY


def test_project_itp_has_a_single_optional_area(db: Session) -> None:
    columns = {
        c["name"]: c for c in inspect(db.connection()).get_columns("project_itps")
    }
    assert columns["area_id"]["nullable"] is True

    project = _project(db)
    assert _itp(db, project).area_id is None
    area = _area(db, project)
    assert area.sort_order == 0
    assert _itp(db, project, area).area_id == area.id


def test_deleting_an_area_without_signatures_keeps_its_itps(db: Session) -> None:
    project = _project(db)
    parent = _area(db, project, "Building A")
    child = _add(
        db,
        ProjectArea(
            project_id=cast(int, project.id), parent_area_id=parent.id, name="Level 1"
        ),
    )
    itp = _itp(db, project, parent)

    db.execute(delete(ProjectArea).where(ProjectArea.id == parent.id))  # type: ignore[arg-type]
    db.refresh(itp)
    db.refresh(child)
    assert itp.area_id is None  # now applies to the whole project
    assert child.parent_area_id is None  # moved to the top level


def test_deleting_an_area_with_a_signed_itp_is_refused(db: Session) -> None:
    project = _project(db)
    area = _area(db, project)
    itp = _itp(db, project, area)
    _signature(db, itp, _item(db, itp), _role(db, project))
    _delete_refused(db, area, ProjectArea, "has signed ITPs")


def test_a_signed_itp_or_item_cannot_be_deleted_on_its_own(db: Session) -> None:
    project = _project(db)
    itp = _itp(db, project)
    signed_item = _item(db, itp)
    other_item = _item(db, itp, "record")
    _signature(db, itp, signed_item, _role(db, project))

    _delete_refused(db, itp, ProjectItp, "has signatures")
    _delete_refused(db, signed_item, ItpItem, "has signatures")
    # An item nobody signed can still be removed from a job-specific copy.
    db.execute(delete(ItpItem).where(ItpItem.id == other_item.id))  # type: ignore[arg-type]
    assert _gone(db, ItpItem, other_item.id)


def test_a_pack_signature_also_protects_the_itp(db: Session) -> None:
    project = _project(db)
    itp = _itp(db, project)
    _signature(db, itp, None, _role(db, project))
    _delete_refused(db, itp, ProjectItp, "has signatures")


@pytest.mark.parametrize("through_orm", [True, False])
def test_deleting_the_whole_project_still_cascades(
    db: Session, through_orm: bool
) -> None:
    project = _project(db)
    area = _area(db, project)
    itp = _itp(db, project, area)
    item = _item(db, itp)
    role = _role(db, project)
    signature = _signature(db, itp, item, role)
    token = _token(db, role, project_itp_id=itp.id)

    if through_orm:  # what DELETE /projects/{id} does
        db.delete(project)
        db.flush()
    else:
        db.execute(delete(Project).where(Project.id == project.id))  # type: ignore[arg-type]

    for table, row_id in (
        (ProjectArea, area.id),
        (ProjectItp, itp.id),
        (ItpItem, item.id),
        (SignoffRole, role.id),
        (ItpSignature, signature.id),
        (ExternalSignToken, token.id),
    ):
        assert _gone(db, table, row_id), table


def test_pin_links_to_an_item_and_detaches_when_it_goes(db: Session) -> None:
    project = _project(db)
    drawing = _add(
        db,
        Drawing(
            project_id=cast(int, project.id),
            title="Site plan",
            filename="plan.pdf",
            s3_key="drawings/projects/1/plan.pdf",
            file_type="pdf",
        ),
    )
    item = _item(db, _itp(db, project))
    pin = _add(
        db,
        InspectionPin(
            drawing_id=cast(int, drawing.id),
            x_pct=Decimal("10"),
            y_pct=Decimal("20"),
            itp_item_id=item.id,
        ),
    )
    assert pin.itp_item_id == item.id

    db.execute(delete(ItpItem).where(ItpItem.id == item.id))  # type: ignore[arg-type]
    db.refresh(pin)
    assert pin.itp_item_id is None


def test_item_must_be_classified_and_role_required_once(db: Session) -> None:
    project = _project(db)
    itp = _itp(db, project)
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.add(
                ItpItem(
                    project_itp_id=cast(int, itp.id),
                    requirement="No classification",
                    classification=cast(str, None),
                )
            )
            db.flush()

    item = _item(db, itp)
    assert item.status == "pending"
    role = _role(db, project)
    link: dict[str, Any] = {"itp_item_id": item.id, "signoff_role_id": role.id}
    _add(db, ItpItemRequiredRole(**link))
    with pytest.raises(IntegrityError, match="uq_itp_item_required_role"):
        with db.begin_nested():
            db.add(ItpItemRequiredRole(**link))
            db.flush()


def test_signoff_role_name_is_unique_per_project(db: Session) -> None:
    project = _project(db)
    _role(db, project)
    with pytest.raises(IntegrityError, match="uq_signoff_roles_name"):
        with db.begin_nested():
            _role(db, project)
    assert _role(db, _project(db)).role_name == "Client engineer"


def test_token_defaults_and_constraints(db: Session) -> None:
    project = _project(db)
    itp = _itp(db, project)
    area = _area(db, project)
    role = _role(db, project)

    token = _token(db, role, project_itp_id=itp.id)
    assert token.revoked is False and token.used_at is None
    assert token.created_at is not None and token.expires_at is not None
    assert token.expires_at - token.created_at == timedelta(days=14)

    fields: dict[str, Any] = {
        "signoff_role_id": role.id,
        "signer_email": "engineer@example.com",
    }
    digest = "a" * 64
    targets: list[dict[str, Any]] = [{}, {"project_itp_id": itp.id, "area_id": area.id}]
    for target in targets:
        with pytest.raises(IntegrityError, match="one_document"):
            with db.begin_nested():
                db.add(ExternalSignToken(token_hash=digest, **target, **fields))
                db.flush()
    # A raw link token is not a 64-character digest, so it cannot be stored.
    with pytest.raises(IntegrityError, match="hash_length"):
        with db.begin_nested():
            db.add(ExternalSignToken(token_hash="raw", area_id=area.id, **fields))
            db.flush()
    with pytest.raises(IntegrityError, match="token_hash_key"):
        with db.begin_nested():
            db.add(
                ExternalSignToken(
                    token_hash=token.token_hash, area_id=area.id, **fields
                )
            )
            db.flush()

    assert _add(db, ExternalSignToken(token_hash=digest, area_id=area.id, **fields)).id


def test_signature_record_survives_its_role_and_token(db: Session) -> None:
    project = _project(db)
    itp = _itp(db, project)
    role = _role(db, project)
    token = _token(db, role, project_itp_id=itp.id)
    signature = _signature(db, itp, _item(db, itp), role)
    signature.external_token_id = token.id
    db.add(signature)
    db.flush()

    db.execute(delete(SignoffRole).where(SignoffRole.id == role.id))  # type: ignore[arg-type]
    db.refresh(signature)
    assert signature.signoff_role_id is None
    assert signature.external_token_id is None  # the token went with its role
    assert signature.role_name == "Client engineer"
    assert signature.party == "engineer"
    assert signature.gps_lat == Decimal("34.194400")
    assert signature.weather == {"description": "Clear", "temp_f": 71}
    assert signature.signed_at is not None
