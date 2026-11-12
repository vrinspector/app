"""Fake Claude Messages API for the AI capture routes (increments 15 and 16)."""

import json
from typing import Any

import httpx

MODEL_VERSION = "claude-sonnet-4-5-20250929"

PHOTO_ANSWER: dict[str, Any] = {
    "category": "defect",
    "defects": [
        {
            "type": "corrosion",
            "note": "Surface rust at the base plate, lower left",
            "confidence": 0.82,
        },
        {"type": "crack", "note": "Hairline crack in the grout pad", "confidence": 0.4},
    ],
    "severity": "medium",
    "title": "Corrosion at column base plate",
    "description": "Surface rust visible on the base plate and anchor nuts.",
}

VOICE_ANSWER: dict[str, Any] = {
    "title": "Missing flange bolts at valve V-101",
    "status": "open",
    "priority": "high",
    "discipline": "pid",
    "description": "Two of eight flange bolts are missing at valve V-101.",
    "location_ref": "Pipe rack, gridline C-4",
}

REPORT_ANSWER: dict[str, Any] = {
    "summary": (
        "A piping walkdown of Site walk 1 was carried out.\n\n"
        "Two findings were recorded, one of them high priority: missing "
        "flange bolts at valve V-101.\n\nOne finding remains open."
    )
}

ITP_ANSWER: dict[str, Any] = {
    "name": "Concrete pour ITP (imported)",
    "description": "Pre-pour and placement checks for slabs.",
    "roles": [
        {"name": "Contractor", "party": "contractor"},
        {"name": "Engineer of record", "party": "engineer"},
    ],
    "sections": [
        {
            "title": "Pre-pour",
            "lines": [
                {
                    "title": "Rebar placement checked",
                    "classification": "H",
                    "acceptance_criteria": "Per drawing S-201, cover 2 in.",
                    "reference": "ACI 318",
                    "record_required": "Pre-pour checklist",
                    "roles": ["Engineer of record"],
                    "photo_required": True,
                    "value_type": "none",
                    "unit": None,
                },
                {
                    "title": "Formwork dimensions",
                    "classification": "W",
                    "roles": ["Contractor", "Site engineer"],
                },
            ],
        },
        {
            "title": "Placement",
            "lines": [
                {
                    "title": "Slump",
                    "classification": "witness",
                    "value_type": "number",
                    "unit": "in",
                },
                {"title": "Batch tickets", "classification": "S"},
            ],
        },
        {"title": "Empty heading", "lines": []},
    ],
    "notes": ["Page 2 was blurred; line 7 may be incomplete."],
}

TOOL_ANSWERS = {
    "record_photo_analysis": "photo_answer",
    "record_finding_draft": "voice_answer",
    "record_report_summary": "report_answer",
    "record_itp_draft": "itp_answer",
}


class FakeClaude:
    """Answers ``POST /v1/messages`` with a forced tool call; records requests."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.photo_answer: dict[str, Any] | None = dict(PHOTO_ANSWER)
        self.voice_answer: dict[str, Any] | None = dict(VOICE_ANSWER)
        self.report_answer: dict[str, Any] | None = dict(REPORT_ANSWER)
        self.itp_answer: dict[str, Any] | None = json.loads(json.dumps(ITP_ANSWER))
        self.fail_with: int | None = None
        self.timeout = False
        self.no_tool = False

    def bodies(self) -> list[dict[str, Any]]:
        return [json.loads(r.content) for r in self.requests]

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.timeout:
            raise httpx.ReadTimeout("timed out", request=request)
        if self.fail_with is not None:
            return httpx.Response(self.fail_with, json={"error": {"type": "x"}})
        body = json.loads(request.content)
        tool = body["tools"][0]["name"]
        answer = getattr(self, TOOL_ANSWERS[tool])
        content: list[dict[str, Any]] = [{"type": "text", "text": "Here you go."}]
        if not self.no_tool:
            content.append(
                {"type": "tool_use", "id": "toolu_1", "name": tool, "input": answer}
            )
        return httpx.Response(
            200,
            json={
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "model": MODEL_VERSION,
                "content": content,
                "stop_reason": "tool_use",
                "usage": {"input_tokens": 1234, "output_tokens": 210},
            },
        )

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)
