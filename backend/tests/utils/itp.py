"""Shared ITP fixtures: a realistic master template and helpers to apply it."""

from typing import Any

from fastapi.testclient import TestClient

from tests.utils.domain import V1

CONCRETE_POUR: dict[str, Any] = {
    "title": "Concrete pour",
    "signoffRoles": [
        {"name": "Site engineer", "party": "contractor"},
        {"name": "Client engineer", "party": "client"},
    ],
    "pages": [
        {
            "name": "pre-pour",
            "title": "Pre-pour",
            "elements": [
                {
                    "type": "radiogroup",
                    "name": "formwork",
                    "title": "Formwork checked against drawings",
                    "choices": ["pass", "fail", "na"],
                    "classification": "surveillance",
                },
                {
                    "type": "radiogroup",
                    "name": "rebar",
                    "title": "Reinforcement inspected before pour",
                    "choices": ["pass", "fail", "na"],
                    "classification": "hold",
                    "signoffRoles": ["Client engineer", "Site engineer"],
                },
                {
                    "type": "panel",
                    "name": "reo",
                    "title": "Reinforcement",
                    "elements": [
                        {
                            "type": "text",
                            "name": "cover",
                            "title": "Cover to reinforcement (mm)",
                            "classification": "record",
                        }
                    ],
                },
            ],
        },
        {
            "name": "pour",
            "title": "Pour",
            "elements": [
                {"type": "html", "name": "note", "html": "<p>Slump at truck</p>"},
                {
                    "type": "radiogroup",
                    "name": "pour",
                    "title": "Pour witnessed",
                    "classification": "witness",
                    "signoffRoles": ["Client engineer"],
                },
                {
                    "type": "text",
                    "name": "cylinders",
                    "title": "Test cylinders taken",
                    "classification": "record",
                },
            ],
        },
    ],
}


def create_template(
    client: TestClient, h: dict[str, str], **overrides: Any
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": "Concrete pour",
        "description": "Slab pour, AS 3600",
        "status": "published",
        "body": CONCRETE_POUR,
    }
    body.update(overrides)
    r = client.post(f"{V1}/itp-templates", json=body, headers=h)
    assert r.status_code == 201, r.text
    data: dict[str, Any] = r.json()
    return data


def apply_template(
    client: TestClient,
    h: dict[str, str],
    project_id: int,
    template_id: int,
    **overrides: Any,
) -> dict[str, Any]:
    r = client.post(
        f"{V1}/projects/{project_id}/itps",
        json={"template_id": template_id, **overrides},
        headers=h,
    )
    assert r.status_code == 201, r.text
    data: dict[str, Any] = r.json()
    return data


def create_area(
    client: TestClient, h: dict[str, str], project_id: int, name: str, **extra: Any
) -> dict[str, Any]:
    r = client.post(
        f"{V1}/projects/{project_id}/areas",
        json={"name": name, **extra},
        headers=h,
    )
    assert r.status_code == 201, r.text
    data: dict[str, Any] = r.json()
    return data
