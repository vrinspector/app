"""AI capture assistance (Block 10A photo analysis, 10B voice-to-finding).

PRD v2.62 §5 (Block 10), carried into v2.63 §6 unchanged:

* **10A** — on a photo, a vision-model call categorises the picture, lists
  candidate defects (crack, corrosion, water ingress, damage, safety hazard)
  and proposes a severity. The inspector confirms or edits.
* **10B** — a spoken observation (already transcribed on the phone by the
  Block 5 browser speech path) is structured into label, status, discipline
  and notes for one-tap confirm.
* **Guardrails** — AI text is a *draft until confirmed*; the prompt and the
  model version are logged per finding (``ai_suggestions`` table) for
  defensibility; no photo or transcript leaves S3 / RDS except to the
  contracted model API.

This module is the only place that talks to the model. It is a plain HTTPS
call to the Anthropic Messages API (``ANTHROPIC_API_URL``) with ``httpx`` —
no SDK, no ML infrastructure. The answer is forced through one tool whose
JSON schema is the draft's shape, then validated again here, so whatever the
model says the API only ever hands the screens a draft in the app's own
vocabulary.

With no ``ANTHROPIC_API_KEY`` the feature is simply off: ``ai.enabled`` is
false, the screens hide their AI buttons and the routes answer 503. The key
is supplied by the environment at RG-3 (never committed).

The HTTP transport is injectable (``ai.use_transport``) so the test suite
never reaches the network — the same seam as the weather service.
"""

from __future__ import annotations

import base64
import io
import json
import logging
from dataclasses import dataclass
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field, ValidationError, field_validator

from app.core.config import settings

logger = logging.getLogger(__name__)

# Bump whenever a prompt or a tool schema below changes; it is logged with
# every suggestion so an old draft can be traced to the words that made it.
PHOTO_PROMPT_VERSION = "10A-2026-11-12"
VOICE_PROMPT_VERSION = "10B-2026-11-12"

ANTHROPIC_VERSION = "2023-06-01"

# --- the app's vocabularies (mirrors app.models; repeated here so this module
# has no database imports) ----------------------------------------------------

PHOTO_CATEGORIES: tuple[str, ...] = (
    "progress",
    "defect",
    "safety",
    "materials",
    "equipment",
    "documentation",
    "other",
)
DEFECT_TYPES: tuple[str, ...] = (
    "crack",
    "corrosion",
    "water_ingress",
    "damage",
    "safety_hazard",
)
SEVERITIES: tuple[str, ...] = ("low", "medium", "high")
FINDING_STATUSES: tuple[str, ...] = ("open", "in-progress", "resolved")
DISCIPLINES: tuple[str, ...] = (
    "general",
    "pid",
    "grading",
    "civil_structural",
    "equipment_layout",
    "steel_erection",
    "electrical",
    "other",
)

PhotoCategory = Literal[
    "progress", "defect", "safety", "materials", "equipment", "documentation", "other"
]
DefectType = Literal["crack", "corrosion", "water_ingress", "damage", "safety_hazard"]
Severity = Literal["low", "medium", "high"]
Discipline = Literal[
    "general",
    "pid",
    "grading",
    "civil_structural",
    "equipment_layout",
    "steel_erection",
    "electrical",
    "other",
]

# Image types the model accepts. HEIC from an iPhone is converted when Pillow
# can read it; otherwise the photo is refused with a readable reason.
_MODEL_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


# --- drafts ------------------------------------------------------------------


def _clip(value: Any, limit: int) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit]


class DefectDraft(BaseModel):
    type: DefectType
    note: str = Field(default="", max_length=300)
    confidence: float | None = Field(default=None, ge=0, le=1)

    @field_validator("note", mode="before")
    @classmethod
    def _note(cls, value: Any) -> str:
        return _clip(value, 300)


class PhotoDraft(BaseModel):
    """10A: what the model proposes for one photo (all of it editable)."""

    category: PhotoCategory
    defects: list[DefectDraft] = Field(default_factory=list, max_length=5)
    severity: Severity | None = None
    # A finding the inspector can log from the photo in one tap.
    title: str = Field(default="", max_length=255)
    description: str = Field(default="", max_length=2000)

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, value: Any) -> str:
        return _clip(value, 255)

    @field_validator("description", mode="before")
    @classmethod
    def _description(cls, value: Any) -> str:
        return str(value or "").strip()[:2000]


class VoiceDraft(BaseModel):
    """10B: a structured finding from one spoken observation."""

    title: str = Field(min_length=1, max_length=255)
    status: Literal["open", "in-progress", "resolved"] = "open"
    priority: Severity = "medium"
    discipline: Discipline = "general"
    description: str = Field(default="", max_length=4000)
    location_ref: str | None = Field(default=None, max_length=255)

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, value: Any) -> str:
        return _clip(value, 255)

    @field_validator("description", mode="before")
    @classmethod
    def _description(cls, value: Any) -> str:
        return str(value or "").strip()[:4000]

    @field_validator("location_ref", mode="before")
    @classmethod
    def _location(cls, value: Any) -> str | None:
        text = _clip(value, 255)
        return text or None


# --- prompts (logged verbatim with every suggestion) -------------------------

PHOTO_SYSTEM_PROMPT = """\
You assist a construction field inspector. You look at one site photo and \
propose how to file it. You never decide anything: the inspector reviews \
every field before it is saved.

Rules:
- Describe only what is visible. Do not guess at causes, code compliance, \
structural adequacy or anything the photo cannot show.
- category: the single best fit (progress, defect, safety, materials, \
equipment, documentation, other).
- defects: list only candidate defects you can see, each one of crack, \
corrosion, water_ingress, damage, safety_hazard, with a short plain note of \
where it is in the frame and a confidence from 0 to 1. Empty list if none.
- severity: low, medium or high for the worst candidate defect, or null when \
there is none. Use high only for an apparent immediate safety risk or \
significant damage.
- title: a short finding title (under 80 characters) if a defect is visible, \
else an empty string. description: one or two factual sentences an \
inspector could sign, else an empty string.
- US English, US customary units. No markdown.
Answer only by calling the record_photo_analysis tool."""

VOICE_SYSTEM_PROMPT = """\
You assist a construction field inspector. You turn one spoken observation, \
transcribed by a phone, into a draft inspection finding. You never decide \
anything: the inspector reviews every field before it is saved.

Rules:
- Keep the inspector's facts, numbers, units and locations exactly as \
spoken; fix only obvious speech-recognition slips and punctuation. Never add \
facts, causes, code references or recommendations that were not said.
- title: a short label (under 80 characters) naming the item and the issue.
- status: open unless the inspector says it is being fixed (in-progress) or \
already fixed / verified (resolved).
- priority: high for an immediate safety risk, damage or a failed hold \
point; low for cosmetic or housekeeping items; otherwise medium.
- discipline: one of general, pid (piping / P&ID), grading, \
civil_structural, equipment_layout, steel_erection, electrical, other.
- description: the observation as clean sentences.
- location_ref: the location if one was spoken (gridline, level, room, \
station), else null.
- US English. No markdown.
Answer only by calling the record_finding_draft tool."""

PHOTO_TOOL: dict[str, Any] = {
    "name": "record_photo_analysis",
    "description": "Record the proposed filing for the photo.",
    "input_schema": {
        "type": "object",
        "properties": {
            "category": {"type": "string", "enum": list(PHOTO_CATEGORIES)},
            "defects": {
                "type": "array",
                "maxItems": 5,
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": list(DEFECT_TYPES)},
                        "note": {"type": "string"},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    },
                    "required": ["type", "note"],
                },
            },
            "severity": {"type": ["string", "null"], "enum": [*SEVERITIES, None]},
            "title": {"type": "string"},
            "description": {"type": "string"},
        },
        "required": ["category", "defects", "severity", "title", "description"],
    },
}

VOICE_TOOL: dict[str, Any] = {
    "name": "record_finding_draft",
    "description": "Record the draft finding.",
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "status": {"type": "string", "enum": list(FINDING_STATUSES)},
            "priority": {"type": "string", "enum": list(SEVERITIES)},
            "discipline": {"type": "string", "enum": list(DISCIPLINES)},
            "description": {"type": "string"},
            "location_ref": {"type": ["string", "null"]},
        },
        "required": ["title", "status", "priority", "discipline", "description"],
    },
}


def photo_user_prompt(context: dict[str, str | None]) -> str:
    lines = ["Propose how to file this site photo."]
    for label, key in (
        ("Inspection type", "inspection_type"),
        ("Inspection", "inspection_title"),
        ("Location", "location_ref"),
    ):
        if context.get(key):
            lines.append(f"{label}: {context[key]}")
    return "\n".join(lines)


def voice_user_prompt(transcript: str, context: dict[str, str | None]) -> str:
    lines = []
    for label, key in (
        ("Inspection type", "inspection_type"),
        ("Inspection", "inspection_title"),
        ("Location already filled in", "location_ref"),
    ):
        if context.get(key):
            lines.append(f"{label}: {context[key]}")
    lines.append("Spoken observation (transcript):")
    lines.append(f"<transcript>\n{transcript}\n</transcript>")
    return "\n".join(lines)


# --- results -------------------------------------------------------------------


class AiError(Exception):
    """A draft could not be produced; ``detail`` is shown to the inspector."""

    def __init__(
        self,
        detail: str,
        *,
        status_code: int = 502,
        model: str | None = None,
        raw: Any = None,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
        self.model = model
        self.raw = raw


@dataclass
class AiResult:
    draft: dict[str, Any]
    # The exact model version that answered (from the response), e.g.
    # "claude-sonnet-4-5-20250929" — not just the alias that was asked for.
    model: str
    input_tokens: int | None
    output_tokens: int | None


# --- images ----------------------------------------------------------------------


def prepare_image(data: bytes, content_type: str | None) -> tuple[str, str]:
    """Downscale a photo for the model; returns ``(media_type, base64)``.

    Phone photos are 3–12 MB; the model needs no more than
    ``AI_IMAGE_MAX_EDGE`` pixels on the long edge, so a JPEG copy is sent
    (smaller, cheaper, faster). The stored original in S3 is never touched.
    """
    try:
        from PIL import Image, ImageOps

        with Image.open(io.BytesIO(data)) as source:
            image: Image.Image = ImageOps.exif_transpose(source) or source
            image.thumbnail((settings.AI_IMAGE_MAX_EDGE, settings.AI_IMAGE_MAX_EDGE))
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            out = io.BytesIO()
            image.save(out, format="JPEG", quality=85, optimize=True)
        return "image/jpeg", base64.b64encode(out.getvalue()).decode()
    except Exception as exc:  # noqa: BLE001 - any decode failure
        ctype = (content_type or "").lower()
        if ctype in _MODEL_IMAGE_TYPES and len(data) <= 3_750_000:
            # Pillow could not read it but the model can take it as it is.
            return ctype, base64.b64encode(data).decode()
        raise AiError(
            "This photo's format can't be analysed (use JPEG or PNG)",
            status_code=422,
        ) from exc


# --- the client ------------------------------------------------------------------


class AiService:
    def __init__(self) -> None:
        self._transport: httpx.BaseTransport | None = None

    # -- test seam -------------------------------------------------------
    def use_transport(self, transport: httpx.BaseTransport | None) -> None:
        """Route HTTP through ``transport`` (tests); ``None`` restores the default."""
        self._transport = transport

    @property
    def enabled(self) -> bool:
        return settings.ai_enabled

    @property
    def model(self) -> str:
        return settings.AI_MODEL

    # -- calls -------------------------------------------------------------
    def analyze_photo(
        self, image: tuple[str, str], context: dict[str, str | None]
    ) -> AiResult:
        media_type, b64 = image
        content: list[dict[str, Any]] = [
            {
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64},
            },
            {"type": "text", "text": photo_user_prompt(context)},
        ]
        raw, result = self._call(PHOTO_SYSTEM_PROMPT, content, PHOTO_TOOL, 700)
        try:
            draft = PhotoDraft.model_validate(raw)
        except ValidationError as exc:
            raise AiError(
                "The AI answer could not be read; file the photo yourself",
                model=result.model,
                raw=raw,
            ) from exc
        if not draft.defects:
            draft.severity = None
        result.draft = draft.model_dump()
        return result

    def structure_transcript(
        self, transcript: str, context: dict[str, str | None]
    ) -> AiResult:
        content = [{"type": "text", "text": voice_user_prompt(transcript, context)}]
        raw, result = self._call(VOICE_SYSTEM_PROMPT, content, VOICE_TOOL, 800)
        try:
            draft = VoiceDraft.model_validate(raw)
        except ValidationError as exc:
            raise AiError(
                "The AI answer could not be read; fill the finding in yourself",
                model=result.model,
                raw=raw,
            ) from exc
        result.draft = draft.model_dump()
        return result

    # -- transport -----------------------------------------------------------
    def _call(
        self,
        system: str,
        content: list[dict[str, Any]],
        tool: dict[str, Any],
        max_tokens: int,
    ) -> tuple[dict[str, Any], AiResult]:
        if not self.enabled:
            raise AiError("AI assistance is not set up", status_code=503)
        body = {
            "model": settings.AI_MODEL,
            "max_tokens": max_tokens,
            "temperature": 0,
            "system": system,
            "tools": [tool],
            "tool_choice": {"type": "tool", "name": tool["name"]},
            "messages": [{"role": "user", "content": content}],
        }
        headers = {
            "x-api-key": settings.ANTHROPIC_API_KEY or "",
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
        try:
            with httpx.Client(
                timeout=httpx.Timeout(settings.AI_TIMEOUT_SECONDS),
                transport=self._transport,
            ) as client:
                response = client.post(
                    settings.ANTHROPIC_API_URL, json=body, headers=headers
                )
        except httpx.HTTPError as exc:
            logger.warning("AI call failed: %s", exc)
            raise AiError("The AI service did not answer; try again") from exc
        if response.status_code == 429:
            raise AiError(
                "The AI service is busy; try again in a minute", status_code=503
            )
        if response.status_code >= 400:
            logger.warning(
                "AI call returned %s: %s", response.status_code, response.text[:500]
            )
            raise AiError("The AI service did not answer; try again")
        try:
            payload = response.json()
        except json.JSONDecodeError as exc:
            raise AiError("The AI service did not answer; try again") from exc
        model = str(payload.get("model") or settings.AI_MODEL)
        usage = payload.get("usage") or {}
        result = AiResult(
            draft={},
            model=model,
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
        )
        for block in payload.get("content") or []:
            if (
                isinstance(block, dict)
                and block.get("type") == "tool_use"
                and block.get("name") == tool["name"]
                and isinstance(block.get("input"), dict)
            ):
                return block["input"], result
        raise AiError(
            "The AI answer could not be read; try again", model=model, raw=payload
        )


ai = AiService()
