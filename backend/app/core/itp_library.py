"""Starter ITP template library (rebuild increment 13.7).

``app/itp-library.json`` holds the master templates every new account starts
with: cast-in-place concrete (ACI 301 / 318 and the ASTM field-test methods),
earthwork and compaction, underground conduit / duct bank before backfill,
and piping pressure test. Every line carries a measurable acceptance
criterion, a reference, the record required and an H / W / R / I code; where
the number is set by the project rather than the code, the criterion says
"Project-specific value required — verify before issue".

The frontend keeps a copy (``frontend/src/lib/itpLibrary.json``)
for the "Start from" picker in the template editor and the demo build; a
backend test fails if the two drift apart.

Seeding: the first time an account lists its masters and has never had one
(no row of any status), each starter is added as a published version 1 owned
by that account. After that the copies are the account's own — edited,
versioned and archived like any other master — and are never re-added or
overwritten. ``settings.ITP_STARTER_LIBRARY`` switches seeding off.
"""

import hashlib
import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlmodel import Session, select

from app.core.auth import AuthUser
from app.core.itp import parse_template_body
from app.models import ItpTemplate

LIBRARY_PATH = Path(__file__).resolve().parent.parent / "itp-library.json"


@dataclass(frozen=True)
class StarterTemplate:
    key: str
    name: str
    description: str
    body: dict[str, Any]


@cache
def starter_templates() -> tuple[StarterTemplate, ...]:
    """The library, each body checked with the same parser as user templates."""
    raw = json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))
    starters = tuple(
        StarterTemplate(
            key=str(entry["key"]),
            name=str(entry["name"]),
            description=str(entry["description"]),
            body=entry["body"],
        )
        for entry in raw["templates"]
    )
    for starter in starters:
        parse_template_body(starter.body)
    return starters


def _lock_key(sub: str) -> int:
    """A signed 64-bit advisory-lock key for one account."""
    digest = hashlib.sha256(f"itp-starter-library:{sub}".encode()).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


def seed_starter_library(session: Session, user: AuthUser, email: str | None) -> int:
    """Add the starters for an account that has never had a master.

    Returns how many were added (0 when the account already has masters).
    A transaction-scoped advisory lock keeps two first requests from the same
    account (two tabs, a retry) from seeding twice.
    """
    session.connection().execute(
        text("SELECT pg_advisory_xact_lock(:key)"), {"key": _lock_key(user.sub)}
    )
    existing = session.exec(
        select(ItpTemplate.id).where(ItpTemplate.created_by_sub == user.sub).limit(1)
    ).first()
    if existing is not None:
        session.commit()  # release the lock
        return 0
    starters = starter_templates()
    for starter in starters:
        session.add(
            ItpTemplate(
                name=starter.name,
                description=starter.description,
                status="published",
                body=json.loads(json.dumps(starter.body)),
                version=1,
                created_by=email,
                created_by_sub=user.sub,
            )
        )
    session.commit()
    return len(starters)
