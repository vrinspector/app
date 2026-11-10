"""Increment 13.7: the starter ITP library file itself."""

import json
import re
from pathlib import Path

import pytest

from app.core.itp import parse_template_body
from app.core.itp_library import LIBRARY_PATH, starter_templates

PROJECT_SPECIFIC = "Project-specific value required — verify before issue"
FRONTEND_COPY = (
    Path(__file__).resolve().parents[3] / "frontend" / "src" / "lib" / "itpLibrary.json"
)


def _questions(body: dict) -> list[dict]:  # type: ignore[type-arg]
    return [e for page in body["pages"] for e in page["elements"]]


def test_library_has_the_four_starters_and_each_parses() -> None:
    starters = starter_templates()
    assert [s.key for s in starters] == [
        "cast-in-place-concrete",
        "earthwork-compaction",
        "underground-conduit-duct-bank",
        "piping-pressure-test",
    ]
    for starter in starters:
        parsed = parse_template_body(starter.body)
        assert [r.name for r in parsed.roles] == [
            "Contractor",
            "Owner's representative",
            "Third-party inspector",
        ]
        assert parsed.hold_count >= 1
        assert starter.body["libraryKey"] == starter.key


@pytest.mark.parametrize("starter", starter_templates(), ids=lambda s: s.key)
def test_every_line_is_measurable_and_referenced(starter) -> None:  # type: ignore[no-untyped-def]
    for q in _questions(starter.body):
        label = f"{starter.key}/{q['name']}"
        criteria = q.get("acceptanceCriteria", "")
        assert len(criteria) >= 40, f"{label}: criterion too thin"
        # Never "per spec" alone: a criterion that leans on the spec must say
        # the number is project-specific.
        if re.search(r"\bper spec", criteria, re.IGNORECASE):
            assert PROJECT_SPECIFIC in criteria, label
        assert q.get("reference"), f"{label}: no reference"
        assert q["classification"] in {"hold", "witness", "review", "information"}
        if q["classification"] == "hold":
            assert q.get("signoffRoles"), label
            assert q.get("photoRequired") is True, f"{label}: hold without photo"
        if q.get("inputType") == "number":
            assert q.get("unit"), f"{label}: number line without unit"


def test_concrete_starter_follows_the_owner_outline() -> None:
    concrete = starter_templates()[0].body
    assert [p["title"] for p in concrete["pages"]] == [
        "1 Before work",
        "2 Formwork and embeds",
        "3 Rebar inspection",
        "4 Pre-pour release",
        "5 Placement and after",
    ]
    rebar = concrete["pages"][2]["elements"]
    assert [q["name"] for q in rebar] == [
        "bar-size-grade",
        "bar-spacing",
        "lap-lengths",
        "ties",
        "supports",
        "clear-cover",
        "cleanliness",
    ]
    assert all(q["classification"] == "hold" and q["photoRequired"] for q in rebar)
    cover = next(q for q in rebar if q["name"] == "clear-cover")
    assert cover["inputType"] == "number" and cover["unit"] == "in"

    release = concrete["pages"][3]["elements"][-1]
    assert release["classification"] == "hold"
    assert release["signoffRoles"] == ["Contractor", "Owner's representative"]

    lines = {q["name"]: q for q in _questions(concrete)}
    for name, unit in (
        ("slump", "in"),
        ("air-content", "%"),
        ("concrete-temperature", "°F"),
        ("unit-weight", "lb/ft³"),
    ):
        assert lines[name]["inputType"] == "number" and lines[name]["unit"] == unit
        assert lines[name]["classification"] == "witness"
    assert lines["concrete-temperature"]["max"] == 95
    assert "water added" in lines["batch-tickets"]["acceptanceCriteria"]
    assert lines["strength-results"]["classification"] == "review"
    for name in ("mix-design", "rebar-submittals"):
        assert lines[name]["classification"] == "review"
    assert lines["subgrade"]["classification"] == "witness"


def test_frontend_copy_is_identical() -> None:
    if not FRONTEND_COPY.exists():  # pragma: no cover - backend-only checkout
        pytest.skip("frontend not checked out")
    assert json.loads(FRONTEND_COPY.read_text(encoding="utf-8")) == json.loads(
        LIBRARY_PATH.read_text(encoding="utf-8")
    )
