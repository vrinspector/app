"""Increment 13: reading a SurveyJS template body into ITP lines."""

from typing import Any

import pytest

from app.core.itp import TemplateError, parse_template_body
from tests.utils.itp import CONCRETE_POUR


def test_concrete_pour_parses_into_lines() -> None:
    parsed = parse_template_body(CONCRETE_POUR)
    assert parsed.title == "Concrete pour"
    assert [i.element_name for i in parsed.items] == [
        "formwork",
        "rebar",
        "cover",
        "pour",
        "cylinders",
    ]
    assert [i.section for i in parsed.items] == [
        "Pre-pour",
        "Pre-pour",
        "Reinforcement",
        "Pour",
        "Pour",
    ]
    assert parsed.hold_count == 1
    assert parsed.items[1].roles == ("Client engineer", "Site engineer")
    assert [(r.name, r.party) for r in parsed.roles] == [
        ("Site engineer", "contractor"),
        ("Client engineer", "client"),
    ]
    assert parsed.party_for("client ENGINEER") == "client"
    assert parsed.party_for("Nobody") == "contractor"


def test_flat_elements_localised_titles_and_undeclared_roles() -> None:
    parsed = parse_template_body(
        {
            "title": {"default": "Flat"},
            "elements": [
                {"type": "html", "name": "intro", "html": "<p>Read me</p>"},
                {
                    "type": "boolean",
                    "name": "q1",
                    "title": {"default": "Check A"},
                    "classification": "hold",
                    "signoffRoles": "Surveyor",
                },
            ],
        }
    )
    assert parsed.title == "Flat"
    assert parsed.items[0].requirement == "Check A"
    assert parsed.items[0].section is None
    assert [(r.name, r.party) for r in parsed.roles] == [("Surveyor", "contractor")]


def _q(**extra: Any) -> dict[str, Any]:
    return {
        "pages": [{"name": "p", "elements": [{"type": "text", "name": "a", **extra}]}]
    }


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ([], "JSON object"),
        ({"pages": []}, "at least one page"),
        ({"pages": ["x"]}, "page must be an object"),
        ({"pages": [{"elements": "x"}]}, "elements must be a list"),
        ({"pages": [{"elements": ["x"]}]}, "element must be an object"),
        ({"pages": [{"elements": [{"type": "text"}]}]}, "needs a name"),
        (_q(), "needs a classification"),
        (_q(classification="maybe"), "needs a classification"),
        (_q(classification="hold"), "at least one sign-off role"),
        (_q(classification="record", signoffRoles=[1]), "list of role names"),
        (
            {
                "signoffRoles": [{"name": "A"}],
                **_q(classification="hold", signoffRoles=["B"]),
            },
            "not in the template's signoffRoles",
        ),
        ({"signoffRoles": "A", **_q(classification="record")}, "signoffRoles must be"),
        ({"signoffRoles": [5], **_q(classification="record")}, "signoffRoles must be"),
        (
            {"signoffRoles": [{"name": ""}], **_q(classification="record")},
            "needs a name",
        ),
        (
            {"signoffRoles": [{"name": "x" * 300}], **_q(classification="record")},
            "too long",
        ),
        (
            {
                "signoffRoles": [{"name": "A", "party": "x"}],
                **_q(classification="record"),
            },
            "party",
        ),
        ({"signoffRoles": ["A", "a"], **_q(classification="record")}, "listed twice"),
        ({"pages": [{"elements": [{"type": "html", "name": "x"}]}]}, "no questions"),
        (
            {
                "pages": [
                    {
                        "elements": [
                            {"type": "text", "name": "a", "classification": "record"},
                            {"type": "text", "name": "a", "classification": "record"},
                        ]
                    }
                ]
            },
            "used twice",
        ),
    ],
)
def test_bad_bodies_are_refused_with_a_reason(body: Any, message: str) -> None:
    with pytest.raises(TemplateError, match=message):
        parse_template_body(body)


def test_missing_classifications_are_listed() -> None:
    body = {
        "pages": [{"elements": [{"type": "text", "name": f"q{i}"} for i in range(7)]}]
    }
    with pytest.raises(TemplateError, match="and 2 more"):
        parse_template_body(body)


def test_item_limit() -> None:
    body = {
        "pages": [
            {
                "elements": [
                    {"type": "text", "name": f"q{i}", "classification": "record"}
                    for i in range(501)
                ]
            }
        ]
    }
    with pytest.raises(TemplateError, match="at most 500"):
        parse_template_body(body)


# ── Increment 13.6: vocabulary and line evidence ────────────────────────────


def test_old_words_letters_and_new_words_all_read() -> None:
    body = {
        "pages": [
            {
                "elements": [
                    {"type": "boolean", "name": "a", "classification": "surveillance"},
                    {"type": "boolean", "name": "b", "classification": "record"},
                    {"type": "boolean", "name": "c", "classification": "W"},
                    {"type": "boolean", "name": "d", "classification": " Review "},
                    {"type": "boolean", "name": "e", "classification": "i"},
                ]
            }
        ]
    }
    parsed = parse_template_body(body)
    assert [i.classification for i in parsed.items] == [
        "information",
        "review",
        "witness",
        "review",
        "information",
    ]
    # The concrete fixture still uses the pre-13.6 words.
    assert [i.classification for i in parse_template_body(CONCRETE_POUR).items] == [
        "information",
        "hold",
        "review",
        "witness",
        "review",
    ]


def test_evidence_properties_and_value_types() -> None:
    body = {
        "signoffRoles": ["Contractor", "Owner's representative", {"name": "QA"}],
        "pages": [
            {
                "elements": [
                    {
                        "type": "boolean",
                        "name": "a",
                        "classification": "hold",
                        "signoffRoles": ["Third-party inspector"],
                        "acceptanceCriteria": "  No loose ties ",
                        "reference": "ACI 301 §3.3",
                        "recordRequired": "Photo",
                        "photoRequired": True,
                    },
                    {
                        "type": "text",
                        "name": "b",
                        "inputType": "number",
                        "classification": "R",
                        "unit": "in",
                        "min": "1.5",
                        "max": 3,
                    },
                    {"type": "text", "name": "c", "classification": "R", "min": 1},
                    {"type": "comment", "name": "d", "classification": "R"},
                    {
                        "type": "boolean",
                        "name": "e",
                        "classification": "R",
                        "valueType": "Number",
                        "unit": "°F",
                    },
                    {
                        "type": "text",
                        "name": "f",
                        "classification": "R",
                        "valueType": "none",
                        "unit": "in",
                    },
                ]
            }
        ],
    }
    # A hold role outside a declared list is refused, so drop the list here.
    with pytest.raises(TemplateError, match="not in the template"):
        parse_template_body(body)
    body["signoffRoles"] = None
    parsed = parse_template_body(body)
    a, b, c, d, e, f = parsed.items
    assert a.acceptance_criteria == "No loose ties"
    assert (a.reference, a.record_required, a.photo_required) == (
        "ACI 301 §3.3",
        "Photo",
        True,
    )
    assert a.value_type is None and a.unit is None
    assert (b.value_type, b.unit, b.min_value, b.max_value) == ("number", "in", 1.5, 3)
    assert (c.value_type, c.min_value) == ("text", None)
    assert d.value_type == "text"
    assert (e.value_type, e.unit) == ("number", "°F")
    assert (f.value_type, f.unit) == (None, None)
    assert [(r.name, r.party) for r in parsed.roles] == [
        ("Third-party inspector", "engineer")
    ]


@pytest.mark.parametrize(
    ("extra", "message"),
    [
        ({"photoRequired": "yes"}, "photoRequired must be true or false"),
        ({"valueType": "date"}, "valueType must be"),
        ({"valueType": 3}, "valueType must be"),
        ({"min": "low"}, "min must be a number"),
        ({"max": True}, "max must be a number"),
        ({"min": 5, "max": 1}, "min is greater than max"),
        ({"unit": "x" * 41}, "unit is longer than 40"),
        ({"reference": "x" * 256}, "reference is longer than 255"),
    ],
)
def test_bad_evidence_is_refused(extra: dict[str, Any], message: str) -> None:
    with pytest.raises(TemplateError, match=message):
        parse_template_body(_q(classification="review", **extra))
