"""Fake Claude Messages API for the AI capture routes (increment 15)."""

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


class FakeClaude:
    """Answers ``POST /v1/messages`` with a forced tool call; records requests."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.photo_answer: dict[str, Any] | None = dict(PHOTO_ANSWER)
        self.voice_answer: dict[str, Any] | None = dict(VOICE_ANSWER)
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
        answer = (
            self.photo_answer if tool == "record_photo_analysis" else self.voice_answer
        )
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
