"""Increments 13.7 / 13.9: the starter ITP library file itself.

13.9 aligns the library with the owner's two books (sources in
``docs/reference/``): the concrete ITP carries all 25 items of the field
guide's Checklist A-1, and Checklists A-2 to A-5 plus the commissioning
guide's Appendix A checklists are starters of their own.
"""

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
DEFAULT_ROLES = ["Contractor", "Owner's representative", "Third-party inspector"]

# Book figures listed in docs/reference/KNOWN_ERRORS.md: none may appear as
# an acceptance value (each is replaced by PROJECT_SPECIFIC).
KNOWN_ERROR_FIGURES = [
    r"0\.015",  # DTI feeler gauge (A-2 item 7)
    r"1/1000",  # column plumb (A-2 item 18)
    r"plus or minus 3 inches",  # rebar tolerance on d (Ch. 5)
    r"1\.5 inches for interior",  # interior slab cover (Ch. 5)
    r"≤\s?5\s?Ω",  # grounding resistance "per NEC" (Cx A-2 item 22)
    r"<\s?2\s?% of gauge range",  # hydrotest pressure drop (Cx A-2 item 3)
    r"110\s?%",  # relief set point (A-3 item 5)
    r"500V for ≤600V",  # megger test voltage (A-4 item 14)
    r"72 hours",  # continuous run (Cx A-3 item 20)
]


def _questions(body: dict) -> list[dict]:  # type: ignore[type-arg]
    return [e for page in body["pages"] for e in page["elements"]]


def _by_key(key: str) -> dict:  # type: ignore[type-arg]
    return next(s.body for s in starter_templates() if s.key == key)


def test_library_lists_the_starters_and_each_parses() -> None:
    starters = starter_templates()
    assert [s.key for s in starters] == [
        "cast-in-place-concrete",
        "earthwork-compaction",
        "underground-conduit-duct-bank",
        "structural-steel-connections",
        "piping-pressure-test",
        "electrical-pre-energization",
        "instrument-calibration",
        "cx-pre-commissioning-readiness",
        "cx-cold-commissioning",
        "cx-hot-commissioning",
        "cx-rfsu",
    ]
    for starter in starters:
        parsed = parse_template_body(starter.body)
        names = [r.name for r in parsed.roles]
        if starter.key.startswith("cx-"):
            assert names[:3] == [
                "Discipline lead",
                "Commissioning manager",
                "Operations manager",
            ]
        else:
            assert names[:3] == DEFAULT_ROLES
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
        for figure in KNOWN_ERROR_FIGURES:
            assert not re.search(figure, criteria), f"{label}: {figure}"
        assert q.get("reference"), f"{label}: no reference"
        if q["classification"] != "information":
            assert q.get("recordRequired"), f"{label}: no record"
        assert q["classification"] in {"hold", "witness", "review", "information"}
        if q["classification"] == "hold":
            assert q.get("signoffRoles"), label
        if q.get("inputType") == "number":
            assert q.get("unit"), f"{label}: number line without unit"
        if q.get("resultScale") == "release":
            assert q["classification"] == "hold", label


@pytest.mark.parametrize(
    ("key", "checklist", "count"),
    [
        ("structural-steel-connections", "Field guide Checklist A-2", 24),
        ("piping-pressure-test", "Field guide Checklist A-3", 25),
        ("electrical-pre-energization", "Field guide Checklist A-4", 28),
        ("instrument-calibration", "Field guide Checklist A-5", 20),
        ("cx-pre-commissioning-readiness", "Commissioning guide Checklist A-1", 25),
        ("cx-cold-commissioning", "Commissioning guide Checklist A-2", 25),
        ("cx-hot-commissioning", "Commissioning guide Checklist A-3", 25),
        ("cx-rfsu", "Commissioning guide Checklist A-4", 25),
    ],
)
def test_book_checklists_carry_every_item_in_order(
    key: str, checklist: str, count: int
) -> None:
    refs = [q["reference"] for q in _questions(_by_key(key))]
    numbered = [
        int(m.group(1))
        for r in refs
        if (m := re.match(re.escape(checklist) + r" item (\d+)\b", r))
    ]
    assert numbered == list(range(1, count + 1))


def test_concrete_carries_all_25_pre_pour_items_in_the_five_groups() -> None:
    concrete = _by_key("cast-in-place-concrete")
    assert [p["title"] for p in concrete["pages"]] == [
        "1 Before work",
        "2 Formwork and shoring",
        "3 Reinforcement (hold points)",
        "4 Embedded items",
        "5 Concrete mix and delivery readiness",
        "6 Documentation and pre-pour release",
        "7 During pour — test set",
        "8 Post-pour — curing and protection",
    ]
    groups: dict[str, list[int]] = {}
    for page in concrete["pages"]:
        for q in page["elements"]:
            m = re.match(r"Field guide Checklist A-1 item (\d+)\b", q["reference"])
            if m:
                groups.setdefault(page["name"], []).append(int(m.group(1)))
    assert groups == {
        "formwork-shoring": [1, 2, 3, 4, 5, 6],
        "reinforcement": [7, 8, 9, 10, 11, 12],
        "embedded-items": [13, 14, 15, 16],
        "mix-delivery": [17, 18, 19, 20, 21, 22],
        "documentation-release": [23, 24, 25],
    }

    lines = {q["name"]: q for q in _questions(concrete)}
    rebar = concrete["pages"][2]["elements"]
    assert all(q["classification"] == "hold" and q["photoRequired"] for q in rebar)
    spacing = lines["rebar-size-spacing"]
    assert spacing["photoSet"] == "three_shot"
    assert "every row and column" in spacing["acceptanceCriteria"]
    assert "at least three locations" in spacing["acceptanceCriteria"]
    assert lines["concrete-cover"]["inputType"] == "number"

    release = lines["pre-pour-release"]
    assert release["resultScale"] == "release"
    assert release["approvedLabel"] == "Approved to pour"
    assert release["choices"] == [
        "Approved to pour",
        "Approved with conditions",
        "Rejected",
    ]
    assert release["signoffRoles"] == ["Contractor", "Owner's representative"]
    assert "in writing" in release["title"]

    for name, unit, ref in (
        ("slump", "in", "C143"),
        ("air-content", "%", "C231"),
        ("unit-weight", "lb/ft³", "C138"),
        ("concrete-temperature", "°F", "C1064"),
    ):
        assert lines[name]["inputType"] == "number"
        assert lines[name]["unit"] == unit
        assert ref in lines[name]["reference"]
        assert lines[name]["classification"] == "witness"
    cylinders = lines["cylinders"]
    assert "four" in cylinders["acceptanceCriteria"]
    assert "C31" in cylinders["reference"]
    assert "truck number" in cylinders["acceptanceCriteria"]
    curing = lines["cylinder-curing"]
    assert (curing["min"], curing["max"], curing["unit"]) == (60, 80, "°F")
    for name in ("curing-start", "curing-duration", "hot-weather", "cold-weather"):
        assert "Field guide Ch. 5" in lines[name]["reference"]
    assert lines["strength-results"]["classification"] == "review"


def test_frontend_copy_is_identical() -> None:
    if not FRONTEND_COPY.exists():  # pragma: no cover - backend-only checkout
        pytest.skip("frontend not checked out")
    assert json.loads(FRONTEND_COPY.read_text(encoding="utf-8")) == json.loads(
        LIBRARY_PATH.read_text(encoding="utf-8")
    )
