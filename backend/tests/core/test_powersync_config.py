"""Increment 18: the PowerSync sync config agrees with the database.

``powersync/sync-config.yaml`` is checked for SQL validity by the frontend's
``bun run validate:sync`` (the sync-rules engine itself). These tests check
what that engine cannot know: that every table and column it names exists in
the models, that every synced table is in the publication migration, that
nothing secret is selected, and that membership — the same rule the API
enforces — decides what syncs.
"""

import re
from importlib import import_module
from pathlib import Path
from typing import Any

import yaml

from app.models import SQLModel

ROOT = Path(__file__).resolve().parents[3]
SYNC_CONFIG = ROOT / "powersync" / "sync-config.yaml"
SERVICE_CONFIG = ROOT / "powersync" / "service.yaml"

# Never synced to a phone, whichever table they are on.
FORBIDDEN_COLUMNS = {
    "user_sub",
    "created_by_sub",
    "view_url",
    "thumbnail_url",
    "token_hash",
    "system_prompt",
    "user_prompt",
    "visitor_key",
}

_CAST = re.compile(r"^CAST\((\w+) AS TEXT\) AS (\w+)$", re.IGNORECASE)
_PLAIN = re.compile(r"^(\w+)$")


class _EnvLoader(yaml.SafeLoader):
    pass


_EnvLoader.add_constructor("!env", lambda loader, node: f"${{{node.value}}}")


def _load(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf8") as handle:
        return yaml.load(handle, Loader=_EnvLoader)  # noqa: S506 - safe loader subclass


def _queries() -> list[str]:
    config = _load(SYNC_CONFIG)
    out: list[str] = []
    for stream in config["streams"].values():
        out.extend(stream.get("queries") or [stream["query"]])
    return [" ".join(q.split()) for q in out]


def _parse(query: str) -> tuple[str, list[tuple[str, str, bool]], str]:
    """(table, [(source column, output column, cast to text)], where clause)."""
    match = re.match(r"^SELECT (.+?) FROM (\w+) WHERE (.+)$", query)
    assert match, query
    select, table, where = match.groups()
    columns: list[tuple[str, str, bool]] = []
    for part in (p.strip() for p in select.split(",")):
        cast = _CAST.match(part)
        plain = _PLAIN.match(part)
        assert cast or plain, f"unexpected select item {part!r} in {table}"
        if cast:
            columns.append((cast.group(1), cast.group(2), True))
        else:
            columns.append((part, part, False))
    return table, columns, where


def _publication_tables() -> tuple[str, ...]:
    module = import_module("app.alembic.versions.a1f6c3d9e715_powersync_publication")
    return module.TABLES  # type: ignore[no-any-return]


def test_every_synced_column_exists_in_the_models() -> None:
    tables = SQLModel.metadata.tables
    for query in _queries():
        table, columns, _ = _parse(query)
        assert table in tables, table
        known = set(tables[table].columns.keys())
        for source, output, _ in columns:
            assert source in known, f"{table}.{source} is not a column"
            assert output not in FORBIDDEN_COLUMNS, f"{table}.{output} must not sync"
        outputs = [output for _, output, _ in columns]
        assert outputs[0] == "id", f"{table}: id first"
        assert len(outputs) == len(set(outputs)), f"{table}: duplicate column"


def test_ids_and_foreign_keys_sync_as_text() -> None:
    """The client keys rows by text ids (and `local-…` ids offline)."""
    tables = SQLModel.metadata.tables
    for query in _queries():
        table, columns, _ = _parse(query)
        for source, output, cast in columns:
            column = tables[table].columns[source]
            is_key = source in {"id", "public_id", "series_id"} or bool(
                column.foreign_keys
            )
            assert cast == is_key, f"{table}.{source}: cast to text iff a key"
            if cast:
                assert output == source, f"{table}.{source} keeps its name"


def test_synced_tables_match_the_publication() -> None:
    synced = {_parse(q)[0] for q in _queries()}
    assert synced == set(_publication_tables())


def test_every_query_is_scoped_by_project_membership() -> None:
    config = _load(SYNC_CONFIG)
    assert config["config"]["edition"] == 3
    assert config["with"]["my_projects"] == (
        "SELECT project_id FROM project_members WHERE user_sub = auth.user_id()"
    )
    for query in _queries():
        _, _, where = _parse(query)
        assert "IN my_projects" in where, query


def test_service_config_takes_every_secret_from_the_environment() -> None:
    service = _load(SERVICE_CONFIG)
    connection = service["replication"]["connections"][0]
    assert connection["type"] == "postgresql"
    assert connection["uri"] == "${PS_DATA_SOURCE_URI}"
    assert service["storage"]["uri"] == "${PS_STORAGE_URI}"
    assert service["client_auth"]["jwks_uri"] == "${PS_AUTH0_JWKS_URI}"
    assert service["client_auth"]["audience"] == ["${PS_AUTH0_AUDIENCE}"]
    assert service["sync_config"]["path"] == "sync-config.yaml"
    text = SERVICE_CONFIG.read_text(encoding="utf8")
    assert "password" not in text.lower().replace("placeholder", "")
