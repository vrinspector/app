"""Increment 03 acceptance: the Alembic baseline matches the models and applies
cleanly both to an empty database and to a copy of the legacy (pre-Alembic)
staging schema without touching existing rows.
"""

import os
import uuid
from collections.abc import Iterator

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

from app.core.config import settings
from app.models import DOMAIN_TABLES, LEGACY_TABLES, SQLModel
from tests.utils.db import (
    LEGACY_SCHEMA_SQL,
    load_sql_file,
    run_alembic,
    scratch_database,
)

BASELINE_REVISION = "b7d3e9a1c204"
# The revision before the baseline: downgrading to it removes every domain table.
PRE_BASELINE_REVISION = "3f1c2d9a8b70"
# Head of the chain (later increments add tables on top of the baseline).
HEAD_REVISION = "b2e6f9c4d817"
# The line-evidence revision (increment 13.6), just below head.
LINE_EVIDENCE_REVISION = "a9d4c2e7f318"
# The revision before the email log (increment 13.5).
PRE_EMAIL_REVISION = "e7c2a9f4b613"
# The revision before the ITP migration (increment 12).
PRE_ITP_REVISION = "d5a1b7c3e902"

LEGACY_SEED = """
INSERT INTO projects (name, client, location, status, created_by)
    VALUES ('Legacy Plant', 'PGE', 'Greenwood, SC', 'active', 'owner@example.com');
INSERT INTO project_members (project_id, user_email, role)
    VALUES (1, 'owner@example.com', 'owner'), (1, 'field@example.com', 'inspector');
INSERT INTO inspections (project_id, title, inspection_type, inspector)
    VALUES (1, 'Site walk 1', 'piping', 'owner@example.com');
INSERT INTO findings (inspection_id, title, priority, status)
    VALUES (1, 'Missing bolt', 'high', 'open');
INSERT INTO photos (inspection_id, s3_key, filename, uploaded_by)
    VALUES (1, 'photos/1/abc.jpg', 'abc.jpg', 'owner@example.com');
INSERT INTO drawings (project_id, title, drawing_number, discipline, filename,
                      s3_key, file_type, uploaded_by)
    VALUES (1, 'P&ID-001', 'P&ID-001', 'pid', 'pid.pdf',
            'drawings/projects/1/abc.pdf', 'pdf', 'owner@example.com');
INSERT INTO inspection_pins (drawing_id, finding_id, x_pct, y_pct, status, created_by)
    VALUES (1, 1, 42.5, 67.1, 'punch_item', 'owner@example.com'),
           (1, NULL, 10.0, 20.0, 'verified', 'owner@example.com');
"""


def _material_diffs(url: str) -> list[object]:
    """Autogenerate diff between the live DB and the models, minus cosmetics.

    Ignored: column comments (the legacy DB comment matches, other DBs may
    not carry one) and the *name* of an equivalent unique constraint (the
    legacy table has an unnamed `(project_id, user_email)` constraint).
    """
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            ctx = MigrationContext.configure(
                conn,
                opts={"compare_type": True, "compare_server_default": True},
            )
            diffs = compare_metadata(ctx, SQLModel.metadata)
    finally:
        engine.dispose()

    material: list[object] = []
    removed_unique: set[tuple[str, tuple[str, ...]]] = set()
    added_unique: set[tuple[str, tuple[str, ...]]] = set()
    for diff in diffs:
        if isinstance(diff, list):  # grouped column-level changes
            inner = [d for d in diff if d[0] != "modify_comment"]
            if inner:
                material.append(inner)
            continue
        kind = diff[0]
        if kind in {"remove_constraint", "add_constraint"}:
            constraint = diff[1]
            key = (
                constraint.table.name,
                tuple(c.name for c in constraint.columns),
            )
            (removed_unique if kind == "remove_constraint" else added_unique).add(key)
            continue
        material.append(diff)
    # A rename shows up as remove+add of the same column set: not material.
    for key in removed_unique ^ added_unique:
        material.append(("unique_constraint_mismatch", key))
    return material


def _columns(url: str, table: str) -> dict[str, dict[str, object]]:
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            return {c["name"]: c for c in inspect(conn).get_columns(table)}
    finally:
        engine.dispose()


def _scalar(url: str, sql: str) -> object:
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            return conn.execute(text(sql)).scalar()
    finally:
        engine.dispose()


@pytest.fixture
def fresh_db() -> Iterator[str]:
    with scratch_database(f"vri_test_fresh_{os.getpid()}") as url:
        yield url


@pytest.fixture
def legacy_db() -> Iterator[str]:
    """A database shaped like staging before the rebuild, with sample rows."""
    with scratch_database(f"vri_test_legacy_{os.getpid()}") as url:
        load_sql_file(url, LEGACY_SCHEMA_SQL)
        engine = create_engine(url, isolation_level="AUTOCOMMIT")
        try:
            with engine.connect() as conn:
                conn.exec_driver_sql(LEGACY_SEED)
        finally:
            engine.dispose()
        yield url


def test_migration_chain_has_one_head() -> None:
    # `alembic heads` needs no database; it reads the versions directory.
    result = run_alembic(str(settings.DATABASE_URL), "heads")
    assert result.returncode == 0, result.stderr
    assert HEAD_REVISION in result.stdout
    assert "(head)" in result.stdout and result.stdout.count("(head)") == 1


def test_fresh_database_upgrade_matches_models(fresh_db: str) -> None:
    result = run_alembic(fresh_db, "upgrade", "head")
    assert result.returncode == 0, result.stderr

    engine = create_engine(fresh_db)
    try:
        with engine.connect() as conn:
            tables = set(inspect(conn).get_table_names())
    finally:
        engine.dispose()
    assert set(DOMAIN_TABLES) <= tables
    assert "user" not in tables  # identity is Auth0, no local users table

    assert _material_diffs(fresh_db) == []

    # Round trip: downgrade the (empty) domain tables and come back.
    result = run_alembic(fresh_db, "downgrade", PRE_BASELINE_REVISION)
    assert result.returncode == 0, result.stderr
    engine = create_engine(fresh_db)
    try:
        with engine.connect() as conn:
            assert not set(DOMAIN_TABLES) & set(inspect(conn).get_table_names())
    finally:
        engine.dispose()
    result = run_alembic(fresh_db, "upgrade", "head")
    assert result.returncode == 0, result.stderr
    assert _material_diffs(fresh_db) == []


def test_legacy_database_upgrade_is_additive(legacy_db: str) -> None:
    # Only the legacy tables exist before the upgrade; the rebuild's own
    # tables (inspection_reports) are created by it.
    before = {
        table: _scalar(legacy_db, f"SELECT count(*) FROM {table}")
        for table in LEGACY_TABLES
    }
    assert before["inspection_pins"] == 2

    result = run_alembic(legacy_db, "upgrade", "head")
    assert result.returncode == 0, result.stderr

    # No rows lost, legacy integer ids untouched.
    after = {
        table: _scalar(legacy_db, f"SELECT count(*) FROM {table}")
        for table in LEGACY_TABLES
    }
    assert after == before
    assert _scalar(legacy_db, "SELECT id FROM projects") == 1

    # Rebuild additions back-filled on existing rows.
    for table in DOMAIN_TABLES:
        cols = _columns(legacy_db, table)
        assert "public_id" in cols, table
        assert cols["public_id"]["nullable"] is False
        nulls = _scalar(
            legacy_db, f"SELECT count(*) FROM {table} WHERE public_id IS NULL"
        )
        assert nulls == 0, table
        distinct = _scalar(legacy_db, f"SELECT count(DISTINCT public_id) FROM {table}")
        assert distinct == after.get(table, 0), table
    pin_public_id = _scalar(
        legacy_db, "SELECT public_id FROM inspection_pins WHERE id = 1"
    )
    assert isinstance(pin_public_id, uuid.UUID)
    assert _scalar(legacy_db, "SELECT min(page_number) FROM inspection_pins") == 1
    assert "user_sub" in _columns(legacy_db, "project_members")
    assert (
        _scalar(
            legacy_db, "SELECT count(*) FROM project_members WHERE user_sub IS NULL"
        )
        == 2
    )

    # Legacy FK semantics intact: deleting a finding detaches its pin,
    # deleting a project cascades through everything.
    engine = create_engine(legacy_db, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            conn.execute(text("DELETE FROM findings WHERE id = 1"))
            assert (
                conn.execute(
                    text("SELECT finding_id FROM inspection_pins WHERE id = 1")
                ).scalar()
                is None
            )
            conn.execute(text("DELETE FROM projects WHERE id = 1"))
            for table in DOMAIN_TABLES:
                assert conn.execute(text(f"SELECT count(*) FROM {table}")).scalar() == 0
    finally:
        engine.dispose()

    # The reconciled legacy database now matches the models.
    assert _material_diffs(legacy_db) == []

    # Running the baseline again is a no-op (idempotent on an upgraded DB).
    result = run_alembic(legacy_db, "upgrade", "head")
    assert result.returncode == 0, result.stderr


def test_itp_migration_is_additive_and_refuses_to_lose_itp_data(legacy_db: str) -> None:
    assert run_alembic(legacy_db, "upgrade", "head").returncode == 0

    # Existing pins are untouched and start unlinked.
    pins = _columns(legacy_db, "inspection_pins")
    assert pins["itp_item_id"]["nullable"] is True
    assert (
        _scalar(
            legacy_db, "SELECT count(*) FROM inspection_pins WHERE itp_item_id IS NULL"
        )
        == 2
    )

    engine = create_engine(legacy_db, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            conn.exec_driver_sql(
                """INSERT INTO project_itps (project_id, title, body)
                       VALUES (1, 'Concrete pour', '{}');
                   INSERT INTO itp_items (project_itp_id, requirement, classification)
                       VALUES (1, 'Rebar checked', 'hold');
                   UPDATE inspection_pins SET itp_item_id = 1 WHERE id = 1;"""
            )
            result = run_alembic(legacy_db, "downgrade", PRE_ITP_REVISION)
            assert result.returncode != 0
            assert "Refusing to downgrade" in (result.stderr + result.stdout)
            assert _scalar(legacy_db, "SELECT count(*) FROM project_itps") == 1

            # Once the link and the rows are cleared deliberately, the downgrade
            # goes through and removes the guards too.
            conn.execute(text("UPDATE inspection_pins SET itp_item_id = NULL"))
            conn.execute(text("DELETE FROM project_itps"))
    finally:
        engine.dispose()
    result = run_alembic(legacy_db, "downgrade", PRE_ITP_REVISION)
    assert result.returncode == 0, result.stderr
    assert "itp_item_id" not in _columns(legacy_db, "inspection_pins")
    assert (
        _scalar(
            legacy_db, "SELECT count(*) FROM pg_proc WHERE proname LIKE 'vri_guard_%'"
        )
        == 0
    )


def test_email_log_migration_is_additive_and_guarded(legacy_db: str) -> None:
    assert run_alembic(legacy_db, "upgrade", "head").returncode == 0
    cols = _columns(legacy_db, "email_send_log")
    assert cols["project_id"]["nullable"] is True
    assert cols["status"]["nullable"] is False

    engine = create_engine(legacy_db, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            conn.exec_driver_sql(
                """INSERT INTO email_send_log
                       (project_id, email_type, related_id, recipient, subject)
                       VALUES (1, 'member_invite', 2, 'field@example.com', 'Hi')"""
            )
            # Unknown statuses are refused by the check constraint.
            try:
                conn.exec_driver_sql(
                    "UPDATE email_send_log SET status = 'bounced'"
                )
            except Exception as exc:  # noqa: BLE001
                assert "ck_email_send_log_status" in str(exc)
            else:  # pragma: no cover
                raise AssertionError("status check constraint missing")
            result = run_alembic(legacy_db, "downgrade", PRE_EMAIL_REVISION)
            assert result.returncode != 0
            assert "Refusing to downgrade f3b8d1c6a425" in (
                result.stderr + result.stdout
            )
            conn.execute(text("DELETE FROM email_send_log"))
    finally:
        engine.dispose()
    result = run_alembic(legacy_db, "downgrade", PRE_EMAIL_REVISION)
    assert result.returncode == 0, result.stderr
    engine = create_engine(legacy_db)
    try:
        with engine.connect() as conn:
            assert "email_send_log" not in inspect(conn).get_table_names()
    finally:
        engine.dispose()
    # And back up again cleanly.
    assert run_alembic(legacy_db, "upgrade", "head").returncode == 0


def test_downgrade_refuses_to_drop_populated_tables(legacy_db: str) -> None:
    assert run_alembic(legacy_db, "upgrade", "head").returncode == 0

    result = run_alembic(legacy_db, "downgrade", PRE_BASELINE_REVISION)
    assert result.returncode != 0
    assert "Refusing to downgrade" in (result.stderr + result.stdout)
    # Nothing was dropped: the refusal rolls the whole downgrade back, so even
    # the (empty) reports table is still there and the version is unchanged.
    assert _scalar(legacy_db, "SELECT count(*) FROM inspection_pins") == 2
    assert (
        _scalar(legacy_db, "SELECT version_num FROM alembic_version") == HEAD_REVISION
    )
    assert _scalar(legacy_db, "SELECT count(*) FROM inspection_reports") == 0

    # After a deliberate truncate the downgrade proceeds.
    engine = create_engine(legacy_db, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            conn.execute(text("TRUNCATE " + ", ".join(DOMAIN_TABLES) + " CASCADE"))
    finally:
        engine.dispose()
    result = run_alembic(legacy_db, "downgrade", PRE_BASELINE_REVISION)
    assert result.returncode == 0, result.stderr
    engine = create_engine(legacy_db)
    try:
        with engine.connect() as conn:
            assert not set(DOMAIN_TABLES) & set(inspect(conn).get_table_names())
    finally:
        engine.dispose()


def test_line_evidence_migration_renames_and_guards(legacy_db: str) -> None:
    """Increment 13.6: vocabulary rename, evidence columns, ITP photos."""
    assert run_alembic(legacy_db, "upgrade", PRE_EMAIL_REVISION).returncode == 0
    engine = create_engine(legacy_db, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            conn.exec_driver_sql(
                """INSERT INTO project_itps (project_id, title, body)
                       VALUES (1, 'Concrete pour', '{}');
                   INSERT INTO itp_items (project_itp_id, requirement, classification)
                       VALUES (1, 'Formwork', 'surveillance'),
                              (1, 'Cover', 'record'),
                              (1, 'Rebar', 'hold');"""
            )
    finally:
        engine.dispose()
    assert run_alembic(legacy_db, "upgrade", LINE_EVIDENCE_REVISION).returncode == 0

    rows = _scalar(
        legacy_db,
        "SELECT string_agg(classification, ',' ORDER BY id) FROM itp_items",
    )
    assert rows == "information,review,hold"
    assert _columns(legacy_db, "photos")["inspection_id"]["nullable"] is True
    assert _columns(legacy_db, "itp_items")["photo_required"]["nullable"] is False
    assert (
        _scalar(legacy_db, "SELECT count(*) FROM itp_items WHERE photo_required")
        == 0
    )

    engine = create_engine(legacy_db, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            # A photo needs exactly one parent.
            for values in ("(NULL, NULL, 'x')", "(1, 1, 'x')"):
                try:
                    conn.exec_driver_sql(
                        "INSERT INTO photos (inspection_id, itp_item_id, s3_key) "
                        f"VALUES {values}"
                    )
                except Exception as exc:  # noqa: BLE001
                    assert "ck_photos_one_parent" in str(exc)
                else:  # pragma: no cover
                    raise AssertionError("photo parent check missing")
            conn.exec_driver_sql(
                "INSERT INTO photos (itp_item_id, s3_key) "
                "VALUES (3, 'photos/itp-items/3/a.jpg')"
            )
            result = run_alembic(legacy_db, "downgrade", "-1")
            assert result.returncode != 0
            assert "Refusing to downgrade a9d4c2e7f318" in (
                result.stderr + result.stdout
            )
            conn.execute(text("DELETE FROM photos WHERE itp_item_id IS NOT NULL"))
            conn.execute(text("UPDATE itp_items SET measured_value = '2' WHERE id = 2"))
            result = run_alembic(legacy_db, "downgrade", "-1")
            assert result.returncode != 0
            conn.execute(text("UPDATE itp_items SET measured_value = NULL"))
    finally:
        engine.dispose()
    result = run_alembic(legacy_db, "downgrade", "-1")
    assert result.returncode == 0, result.stderr
    rows = _scalar(
        legacy_db,
        "SELECT string_agg(classification, ',' ORDER BY id) FROM itp_items",
    )
    assert rows == "surveillance,record,hold"
    assert "itp_item_id" not in _columns(legacy_db, "photos")
    assert _columns(legacy_db, "photos")["inspection_id"]["nullable"] is False
    assert run_alembic(legacy_db, "upgrade", "head").returncode == 0


def test_doc_number_migration_numbers_and_guards(legacy_db: str) -> None:
    """Increment 13.8: ITP numbers backfilled per project; slot / code guards."""
    assert run_alembic(legacy_db, "upgrade", LINE_EVIDENCE_REVISION).returncode == 0
    engine = create_engine(legacy_db, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            conn.exec_driver_sql(
                """INSERT INTO projects (name) VALUES ('Second');
                   INSERT INTO project_itps (project_id, title, body, created_at)
                       VALUES (1, 'B', '{}', '2026-11-02'),
                              (1, 'A', '{}', '2026-11-01'),
                              (2, 'C', '{}', '2026-11-03');
                   INSERT INTO itp_items (project_itp_id, requirement, classification)
                       VALUES (1, 'Rebar', 'hold');"""
            )
    finally:
        engine.dispose()
    assert run_alembic(legacy_db, "upgrade", "head").returncode == 0
    assert (
        _scalar(
            legacy_db,
            "SELECT string_agg(title || seq, ',' ORDER BY project_id, seq) "
            "FROM project_itps",
        )
        == "A1,B2,C1"
    )
    assert _columns(legacy_db, "projects")["code"]["nullable"] is True
    assert _scalar(legacy_db, "SELECT count(*) FROM projects WHERE code IS NOT NULL") == 0
    # Re-running is a no-op (idempotent upgrade keeps the numbers).
    assert run_alembic(legacy_db, "downgrade", LINE_EVIDENCE_REVISION).returncode == 0
    assert run_alembic(legacy_db, "upgrade", "head").returncode == 0

    engine = create_engine(legacy_db, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            for sql, name in (
                (
                    "INSERT INTO project_itps (project_id, title, body, seq) "
                    "VALUES (1, 'Dup', '{}', 1)",
                    "uq_project_itps_seq",
                ),
                (
                    "INSERT INTO photos (inspection_id, s3_key, shot_slot) "
                    "VALUES (1, 'x', 'context')",
                    "ck_photos_shot_slot",
                ),
                (
                    "INSERT INTO photos (itp_item_id, s3_key, shot_slot) "
                    "VALUES (1, 'x', 'wide')",
                    "ck_photos_shot_slot",
                ),
            ):
                try:
                    conn.exec_driver_sql(sql)
                except Exception as exc:  # noqa: BLE001
                    assert name in str(exc)
                else:  # pragma: no cover
                    raise AssertionError(f"{name} missing")
            conn.exec_driver_sql("UPDATE projects SET code = 'LP' WHERE id = 1")
            result = run_alembic(legacy_db, "downgrade", "-1")
            assert result.returncode != 0
            assert "Refusing to downgrade b2e6f9c4d817" in (
                result.stderr + result.stdout
            )
            conn.exec_driver_sql("UPDATE projects SET code = NULL")
            conn.exec_driver_sql(
                "INSERT INTO photos (itp_item_id, s3_key, shot_slot, captured_at) "
                "VALUES (1, 'photos/itp-items/1/a.jpg', 'context', now())"
            )
            assert run_alembic(legacy_db, "downgrade", "-1").returncode != 0
            conn.exec_driver_sql("DELETE FROM photos WHERE shot_slot IS NOT NULL")
    finally:
        engine.dispose()
    result = run_alembic(legacy_db, "downgrade", "-1")
    assert result.returncode == 0, result.stderr
    assert "seq" not in _columns(legacy_db, "project_itps")
    assert "shot_slot" not in _columns(legacy_db, "photos")
    assert run_alembic(legacy_db, "upgrade", "head").returncode == 0
