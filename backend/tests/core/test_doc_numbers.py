"""Increment 13.8: project codes, ITP document numbers, photoSet parsing."""

from typing import Any

import pytest

from app.core.doc_numbers import (
    ProjectCodeError,
    derived_project_code,
    effective_project_code,
    itp_doc_number,
    normalise_project_code,
)
from app.core.itp import TemplateError, parse_template_body


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Landfill Cell 4", "LC4"),
        ("Greenwood Plant", "GP"),
        ("Riverside", "RIVE"),
        ("North Basin Pump Station Upgrade Phase Two", "NBPSUP"),
        ("  ", "P7"),
        ("X", "P7"),
        (None, "P7"),
    ],
)
def test_derived_code(name: str | None, expected: str) -> None:
    assert derived_project_code(name, 7) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("lc-4", "LC-4"),
        ("  gw plant ", "GW-PLANT"),
        ("a_b", "A-B"),
        ("", None),
        ("   ", None),
        (None, None),
    ],
)
def test_normalise_code(raw: str | None, expected: str | None) -> None:
    assert normalise_project_code(raw) == expected


@pytest.mark.parametrize("raw", ["-AB", "AB-", "A/B", "Ünï", "X" * 21])
def test_bad_codes_are_refused(raw: str) -> None:
    with pytest.raises(ProjectCodeError):
        normalise_project_code(raw)


def test_doc_number() -> None:
    assert itp_doc_number("LC4", 7) == "ITP-LC4-007"
    assert itp_doc_number("LC4", 1234) == "ITP-LC4-1234"
    assert itp_doc_number("LC4", None) is None
    assert effective_project_code("OWN", "Landfill Cell 4", 1) == "OWN"
    assert effective_project_code(None, "Landfill Cell 4", 1) == "LC4"


def _body(**extra: Any) -> dict[str, Any]:
    return {
        "pages": [
            {
                "elements": [
                    {
                        "type": "radiogroup",
                        "name": "rebar",
                        "title": "Rebar",
                        "classification": "W",
                        **extra,
                    }
                ]
            }
        ]
    }


@pytest.mark.parametrize(
    "value", ["three_shot", "three-shot", "threeShot", "Three Shot"]
)
def test_photo_set_spellings(value: str) -> None:
    item = parse_template_body(_body(photoSet=value)).items[0]
    assert item.photo_set == "three_shot"


@pytest.mark.parametrize("value", [None, False, "none", ""])
def test_photo_set_absent(value: Any) -> None:
    assert parse_template_body(_body(photoSet=value)).items[0].photo_set is None


@pytest.mark.parametrize("value", ["two_shot", True, 3])
def test_photo_set_invalid(value: Any) -> None:
    with pytest.raises(TemplateError, match="photoSet"):
        parse_template_body(_body(photoSet=value))
