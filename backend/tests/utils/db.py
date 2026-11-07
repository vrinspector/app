"""Helpers for tests that need their own scratch PostgreSQL database.

The CI database user is the Postgres superuser (Compose `db` service), so the
tests can create and drop databases on the same server the app points at.
"""

import os
import subprocess
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parents[2]
LEGACY_SCHEMA_SQL = (
    BACKEND_DIR / "app" / "alembic" / "legacy" / "staging_schema_reconstructed.sql"
)


def database_url(db_name: str) -> str:
    """The configured DATABASE_URL, pointed at another database name."""
    url = make_url(str(settings.DATABASE_URL)).set(database=db_name)
    return url.render_as_string(hide_password=False)


def _maintenance_engine() -> Engine:
    # Connect to the app database itself (always exists) with AUTOCOMMIT:
    # CREATE/DROP DATABASE cannot run inside a transaction.
    return create_engine(str(settings.DATABASE_URL), isolation_level="AUTOCOMMIT")


@contextmanager
def scratch_database(name: str) -> Iterator[str]:
    """Create an empty database, yield its URL, and drop it afterwards."""
    admin = _maintenance_engine()
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield database_url(name)
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def run_alembic(url: str, *args: str) -> subprocess.CompletedProcess[str]:
    """Run `alembic <args>` against `url` in a subprocess.

    `app/alembic/env.py` reads the URL from settings at import time, so the
    cleanest way to target another database is a fresh interpreter with
    DATABASE_URL overridden.
    """
    env = {**os.environ, "DATABASE_URL": url}
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def load_sql_file(url: str, path: Path) -> None:
    engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            conn.exec_driver_sql(path.read_text())
    finally:
        engine.dispose()
