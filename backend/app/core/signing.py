"""External sign-off: magic-link tokens, readiness, and the signature stamp.

Increment 14 (PRD v2.63 §5). The rules, in one place:

* **Tokens.** ``secrets.token_urlsafe(32)`` — 256 random bits, above the
  PRD's 128-bit floor. Only the SHA-256 hex digest is stored
  (``external_sign_tokens.token_hash``); the link itself exists only in the
  email (and once in the API response that created it, for "Copy link").
* **Single use, 14 days, revocable.** A link signs once (``used_at``),
  expires ``SIGN_LINK_DAYS`` after it was issued, and can be withdrawn. A
  reminder, or a new request for the same role and document, issues a fresh
  link and marks the old one *replaced*: the old link cannot be re-sent
  because it is not stored.
* **What a link signs.** Every line of its ITP (or of every live ITP of its
  area) that needs the link's role and is *ready*: not yet signed by that
  role, not behind an unreleased hold point, recorded Pass or N/A, and — for
  a Pass — with its photo evidence on file. The same rules as in-app
  signing (increment 13 / 13.6 / 13.8). Lines that are not ready are shown
  with the reason and left for a later link.
* **Stamp.** Server time, the signer's GPS if their browser shares it, and
  the weather at the project's location from the same Open-Meteo lookup as
  the weather badge (``weather`` JSONB; omitted if the lookup fails — a
  signature never fails because of the weather service).
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from app.api.itp_state import ItemState, ItpState
from app.core.config import settings
from app.core.weather import weather
from app.models import ExternalSignToken, Project

# 32 bytes → 43 URL-safe characters, 256 bits of entropy.
TOKEN_BYTES = 32
# A drawn signature is a small PNG; anything bigger is not one.
MAX_SIGNATURE_BYTES = 250_000
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PNG_DATA_URL_PREFIX = "data:image/png;base64,"


def new_token() -> tuple[str, str]:
    """A fresh link token and the hash that is stored for it."""
    raw = secrets.token_urlsafe(TOKEN_BYTES)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def link_url(raw: str) -> str:
    return f"{settings.app_public_url}/sign/{raw}"


def link_expiry(now: datetime | None = None) -> datetime:
    return (now or datetime.now(UTC)) + timedelta(days=settings.SIGN_LINK_DAYS)


def link_status(token: ExternalSignToken, now: datetime | None = None) -> str:
    """active | used | expired | revoked | replaced"""
    now = now or datetime.now(UTC)
    if token.used_at is not None:
        return "used"
    if token.revoked:
        return "replaced" if token.revoked_reason == "replaced" else "revoked"
    if token.expires_at is not None and token.expires_at <= now:
        return "expired"
    return "active"


GONE_MESSAGES = {
    "used": "This signing link has already been used. If there is more to sign, "
    "the project team will send a new link.",
    "expired": "This signing link has expired. Ask the project team to send a new one.",
    "revoked": "This signing link was withdrawn by the project team.",
    "replaced": "This signing link was replaced by a newer one — use the most "
    "recent email you received.",
}
INVALID_LINK = "This signing link is not valid. Check that the whole link was copied."


# ── Readiness ──────────────────────────────────────────────────────────────


@dataclass
class RoleLine:
    state: ItpState
    line: ItemState
    # ready | signed | waiting
    sign_state: str
    reason: str | None


def role_lines(states: list[ItpState], role_id: int) -> list[RoleLine]:
    """Every line of these ITPs that needs ``role_id``, with where it stands."""
    out: list[RoleLine] = []
    for state in states:
        if state.itp.status == "voided":
            continue
        for line in state.items:
            if role_id not in {r.id for r in line.roles}:
                continue
            out.append(RoleLine(state, line, *_where(line, role_id)))
    return out


def _where(line: ItemState, role_id: int) -> tuple[str, str | None]:
    item = line.item
    if any(s.signoff_role_id == role_id for s in line.signatures):
        return "signed", None
    if line.blocked_by is not None:
        return (
            "waiting",
            f"Waiting for hold point “{line.blocked_by.requirement}” to be released",
        )
    if item.status == "pending":
        return "waiting", "Not recorded on site yet"
    if item.status == "fail":
        return "waiting", "Recorded as failed — waiting for the work to be fixed"
    if item.status == "pass" and not line.evidenced:
        return "waiting", "Photo evidence still to be added"
    return "ready", None


# ── Stamp ──────────────────────────────────────────────────────────────────


def weather_stamp(project: Project | None) -> dict[str, Any] | None:
    """The weather at the project's location now, or None."""
    place = ((project.location if project else None) or "").strip()
    if not place:
        return None
    try:
        reading = weather.lookup(place)
    except Exception:  # noqa: BLE001 - WeatherError or anything else: best effort
        return None
    data: dict[str, Any] = reading.model_dump()
    data["source"] = "open-meteo"
    return data


class SignatureImageError(ValueError):
    """The drawn signature is not a usable PNG (message is user-facing)."""


def decode_signature_png(data_url: str) -> bytes:
    """``data:image/png;base64,...`` → PNG bytes, or SignatureImageError."""
    if not data_url.startswith(PNG_DATA_URL_PREFIX):
        raise SignatureImageError("The signature must be a PNG image")
    try:
        data = base64.b64decode(data_url[len(PNG_DATA_URL_PREFIX) :], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise SignatureImageError("The signature image could not be read") from exc
    if not data.startswith(PNG_MAGIC):
        raise SignatureImageError("The signature must be a PNG image")
    if len(data) > MAX_SIGNATURE_BYTES:
        raise SignatureImageError("The signature image is too large")
    return data
