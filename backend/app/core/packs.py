"""Sign-off packs: one ITP, or one area's ITPs, as a PDF (increment 14).

PRD v2.63 §5: "pack PDF regenerate-on-change (WeasyPrint), versions in S3".
A pack is what an external signer reviews and what the project keeps: the
document number and title, every line with its acceptance criterion,
reference, record, result (in words for release lines), measured value,
notes, conditions and photo evidence, and every signature with its stamp
(signed time, method, GPS, weather, the drawn signature).

**Regenerate on change.** :func:`pack_content` gathers everything the PDF
shows into plain data; its SHA-256 is the pack's ``content_hash``.
:func:`ensure_pack` renders and stores a new version only when that hash
differs from the latest version's, so asking for the pack is cheap when
nothing changed and never hands out a stale one when something did. After a
signature the routes also call it in the background
(:func:`regenerate_in_background`), so the signed version is in S3 at once.

**Versions in S3.** Each version is a new object under
``packs/itps/{id}/`` or ``packs/areas/{id}/`` and a new ``itp_sign_packs``
row; nothing is overwritten. An ITP's latest key and version are also kept on
``project_itps.pack_s3_key`` / ``pack_version`` (increment 12 columns).
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import func
from sqlmodel import Session, col, select

from app.api.itp_state import (
    ItemState,
    ItpState,
    load_itp_states,
    out_of_tolerance,
    result_label,
)
from app.core.config import settings
from app.core.reports import html_to_pdf, thumbnail_data_uri
from app.core.storage import storage
from app.models import (
    ItpSignature,
    ItpSignPack,
    Photo,
    Project,
    ProjectArea,
    ProjectItp,
)

logger = logging.getLogger(__name__)

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "report-templates"
TEMPLATE_NAME = "itp_pack.html"

# Line photos in the pack: thumbnails this size, at most this many per line.
PACK_PHOTO_EDGE = 640
PACK_PHOTOS_PER_LINE = 6

CLASSIFICATION_CODES = {
    "hold": "H",
    "witness": "W",
    "review": "R",
    "information": "I",
    "surveillance": "I",
    "record": "R",
}
CLASSIFICATION_LABELS = {
    "H": "Hold point",
    "W": "Witness point",
    "R": "Review",
    "I": "Information",
}
LINE_STATUS_LABELS = {
    "pending": "Not recorded",
    "pass": "Pass",
    "fail": "Fail",
    "na": "N/A",
}
ITP_STATUS_LABELS = {
    "not_started": "Not started",
    "in_progress": "In progress",
    "complete": "Complete",
    "voided": "Voided",
}
PARTY_LABELS = {
    "contractor": "Contractor",
    "client": "Owner's representative",
    "engineer": "Third-party inspector",
}
METHOD_LABELS = {"in_app": "Signed in the app", "external_link": "Signed by email link"}
SHOT_LABELS = {
    "context": "Context",
    "intermediate": "Intermediate",
    "closeup": "Close-up with scale",
}

_env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(["html"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(UTC).isoformat() if value is not None else None


def _fmt_dt(value: str | datetime | None) -> str:
    if value is None:
        return "—"
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value.astimezone(UTC).strftime("%b %d, %Y %H:%M UTC")


_env.filters["dt"] = _fmt_dt


def weather_summary(weather: dict[str, Any] | None) -> str | None:
    """ "Clear sky, 72.5 °F, 40 % humidity, wind 5 mph — Greenwood, SC"."""
    if not weather:
        return None
    try:
        text = (
            f"{weather['description']}, {weather['temp_f']} °F, "
            f"{weather['humidity']} % humidity, wind {weather['wind_mph']} mph"
        )
    except KeyError:
        return None
    place = weather.get("location")
    return f"{text} — {place}" if place else text


def _signature_data(sig: ItpSignature) -> dict[str, Any]:
    return {
        "id": sig.id,
        "role_name": sig.role_name,
        "party": PARTY_LABELS.get(sig.party, sig.party),
        "signer_name": sig.signer_name,
        "signer_email": sig.signer_email,
        "method": METHOD_LABELS.get(sig.method, sig.method),
        "signed_at": _iso(sig.signed_at),
        "gps": (
            f"{float(sig.gps_lat):.6f}, {float(sig.gps_lng):.6f}"
            if sig.gps_lat is not None and sig.gps_lng is not None
            else None
        ),
        "weather": weather_summary(sig.weather),
        "signature_key": sig.signature_s3_key,
    }


def _line_data(number: int, line: ItemState, photos: list[Photo]) -> dict[str, Any]:
    item = line.item
    code = CLASSIFICATION_CODES.get(item.classification, "I")
    return {
        "number": number,
        "section": item.section,
        "requirement": item.requirement,
        "code": code,
        "classification": CLASSIFICATION_LABELS[code],
        "acceptance_criteria": item.acceptance_criteria,
        "reference_doc": item.reference_doc,
        "record_required": item.record_required,
        "status": item.status,
        "result": result_label(item)
        or LINE_STATUS_LABELS.get(item.status, item.status),
        "measured_value": item.measured_value,
        "value_unit": item.value_unit,
        "out_of_tolerance": out_of_tolerance(item),
        "notes": item.notes,
        "conditions": item.conditions,
        "roles": [r.role_name for r in line.roles],
        "missing_roles": [r.role_name for r in line.missing_roles]
        if line.item.classification in ("hold", "witness")
        else [],
        "photos": [
            {
                "key": p.s3_key,
                "label": SHOT_LABELS.get(p.shot_slot or "", None),
                "filename": p.filename,
            }
            for p in photos[:PACK_PHOTOS_PER_LINE]
        ],
        "more_photos": max(0, len(photos) - PACK_PHOTOS_PER_LINE),
        "signatures": [_signature_data(s) for s in line.signatures],
    }


def _document_data(
    state: ItpState,
    photos_by_item: dict[int, list[Photo]],
    pack_signatures: list[ItpSignature],
) -> dict[str, Any]:
    itp = state.itp
    sections: list[dict[str, Any]] = []
    for number, line in enumerate(state.items, start=1):
        name = line.item.section or "Checklist"
        if not sections or sections[-1]["name"] != name:
            sections.append({"name": name, "lines": []})
        sections[-1]["lines"].append(
            _line_data(number, line, photos_by_item.get(line.item.id or 0, []))
        )
    return {
        "itp_id": itp.id,
        "doc_number": state.doc_number,
        "title": itp.title,
        "status": ITP_STATUS_LABELS.get(itp.status, itp.status),
        "area_name": state.area.name if state.area else None,
        "template_version": itp.template_version,
        "item_count": len(state.items),
        "done_count": state.done_count,
        "fail_count": state.fail_count,
        "hold_count": len(state.holds),
        "open_holds": [
            {
                "requirement": h.item.requirement,
                "waiting": [r.role_name for r in h.missing_roles],
            }
            for h in state.open_holds
        ],
        "blockers": state.completion_blockers(),
        "sections": sections,
        "pack_signatures": [_signature_data(s) for s in pack_signatures],
    }


def pack_content(
    db: Session, project: Project, itps: list[ProjectItp], area: ProjectArea | None
) -> dict[str, Any]:
    """Everything the pack shows, as plain data (hashed for regenerate-on-change)."""
    states = load_itp_states(db, itps)
    item_ids = [line.item.id for s in states for line in s.items if line.item.id]
    photos_by_item: dict[int, list[Photo]] = defaultdict(list)
    if item_ids:
        for photo in db.exec(
            select(Photo)
            .where(col(Photo.itp_item_id).in_(item_ids))
            .order_by(col(Photo.created_at), col(Photo.id))
        ).all():
            assert photo.itp_item_id is not None
            photos_by_item[photo.itp_item_id].append(photo)
    pack_sigs: dict[int, list[ItpSignature]] = defaultdict(list)
    itp_ids = [i.id for i in itps]
    if itp_ids:
        for sig in db.exec(
            select(ItpSignature)
            .where(col(ItpSignature.project_itp_id).in_(itp_ids))
            .where(col(ItpSignature.itp_item_id).is_(None))
            .order_by(col(ItpSignature.signed_at), col(ItpSignature.id))
        ).all():
            pack_sigs[sig.project_itp_id].append(sig)
    return {
        "kind": "area" if area is not None else "itp",
        "project": {
            "id": project.id,
            "name": project.name,
            "client": project.client,
            "location": project.location,
        },
        "area": {"id": area.id, "name": area.name, "type": area.area_type}
        if area is not None
        else None,
        "documents": [
            _document_data(s, photos_by_item, pack_sigs.get(s.itp.id or 0, []))
            for s in states
        ],
    }


def content_hash(content: dict[str, Any]) -> str:
    raw = json.dumps(content, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def _image_data_uri(key: str | None, edge: int) -> str | None:
    if not key:
        return None
    data = storage.get_object(key)
    return thumbnail_data_uri(data, edge=edge) if data else None


def _png_data_uri(key: str | None) -> str | None:
    """A drawn signature as-is (PNG with transparency; tiny)."""
    if not key:
        return None
    data = storage.get_object(key)
    if not data:
        return None
    return "data:image/png;base64," + base64.b64encode(data).decode()


def render_html(
    content: dict[str, Any], *, version: int, generated_by: str, generated_at: datetime
) -> str:
    """The pack as HTML, with photos and signatures resolved to data URIs."""
    images: dict[str, str | None] = {}

    def image(key: str | None) -> str | None:
        if key is None:
            return None
        if key not in images:
            images[key] = _png_data_uri(key)
        return images[key]

    def enter(
        register: dict[tuple[Any, ...], dict[str, Any]],
        sig: dict[str, Any],
        *,
        pack: bool,
    ) -> None:
        """One register entry per signing (same signer, role, time, method)."""
        key = (sig["role_name"], sig["signer_email"], sig["signed_at"], sig["method"])
        entry = register.setdefault(key, {**sig, "lines": 0, "pack": False})
        if pack:
            entry["pack"] = True
        else:
            entry["lines"] += 1

    docs = []
    for doc in content["documents"]:
        doc = json.loads(json.dumps(doc))  # private copy to decorate
        # The lines show a compact mark; the register carries full stamps.
        register: dict[tuple[Any, ...], dict[str, Any]] = {}
        for section in doc["sections"]:
            for line in section["lines"]:
                for photo in line["photos"]:
                    photo["src"] = _image_data_uri(photo["key"], PACK_PHOTO_EDGE)
                for sig in line["signatures"]:
                    sig["image"] = image(sig["signature_key"])
                    enter(register, sig, pack=False)
        for sig in doc["pack_signatures"]:
            enter(register, sig, pack=True)
        doc["register"] = sorted(
            ({**e, "image": image(e["signature_key"])} for e in register.values()),
            key=lambda e: (e["signed_at"] or "", e["role_name"]),
        )
        docs.append(doc)
    template = _env.get_template(TEMPLATE_NAME)
    return template.render(
        content=content,
        project=content["project"],
        area=content["area"],
        documents=docs,
        version=version,
        generated_by=generated_by,
        generated_at=generated_at,
        title=_pack_title(content),
    )


def _pack_title(content: dict[str, Any]) -> str:
    if content["area"] is not None:
        return f"{content['area']['name']} — sign-off pack"
    doc = content["documents"][0] if content["documents"] else None
    if doc is None:  # pragma: no cover - an ITP pack always has its document
        return "Sign-off pack"
    return f"{doc['doc_number'] or doc['title']} — sign-off pack"


def _filename(content: dict[str, Any], version: int) -> str:
    if content["area"] is not None:
        stem = f"{content['area']['name']} sign-off pack"
    else:
        doc = content["documents"][0]
        stem = f"{doc['doc_number'] or doc['title']} sign-off pack"
    safe = "".join(ch if ch.isalnum() or ch in "-_ " else "" for ch in stem).strip()
    return f"{'-'.join(safe.split())[:80] or 'sign-off-pack'}-v{version}.pdf"


@dataclass
class PackTarget:
    """What a pack covers: one ITP, or the live ITPs of one area."""

    project: Project
    itps: list[ProjectItp]
    itp: ProjectItp | None = None
    area: ProjectArea | None = None


def itp_target(db: Session, itp: ProjectItp) -> PackTarget:
    project = db.get(Project, itp.project_id)
    assert project is not None
    return PackTarget(project=project, itps=[itp], itp=itp)


def area_itps(db: Session, area: ProjectArea) -> list[ProjectItp]:
    """An area's pack covers its ITPs that are not voided, in document order."""
    return list(
        db.exec(
            select(ProjectItp)
            .where(ProjectItp.area_id == area.id)
            .where(ProjectItp.status != "voided")
            .order_by(col(ProjectItp.seq), col(ProjectItp.id))
        ).all()
    )


def area_target(db: Session, area: ProjectArea) -> PackTarget:
    project = db.get(Project, area.project_id)
    assert project is not None
    return PackTarget(project=project, itps=area_itps(db, area), area=area)


def _filter(target: PackTarget) -> Any:
    if target.area is not None:
        return col(ItpSignPack.area_id) == target.area.id
    assert target.itp is not None
    return col(ItpSignPack.project_itp_id) == target.itp.id


def list_packs(db: Session, target: PackTarget) -> list[ItpSignPack]:
    return list(
        db.exec(
            select(ItpSignPack)
            .where(_filter(target))
            .order_by(col(ItpSignPack.version).desc())
        ).all()
    )


def ensure_pack(
    db: Session, target: PackTarget, *, generated_by: str
) -> tuple[ItpSignPack, bool]:
    """The current pack: the latest version, or a new one if anything changed.

    Returns ``(pack, regenerated)``. Commits when it creates a version.
    """
    content = pack_content(db, target.project, target.itps, target.area)
    digest = content_hash(content)
    latest = db.exec(
        select(ItpSignPack)
        .where(_filter(target))
        .order_by(col(ItpSignPack.version).desc())
        .limit(1)
    ).first()
    if latest is not None and latest.content_hash == digest:
        return latest, False

    last_version = db.exec(
        select(func.max(ItpSignPack.version)).where(_filter(target))
    ).one()
    version = int(last_version or 0) + 1
    generated_at = datetime.now(UTC)
    pdf = html_to_pdf(
        render_html(
            content,
            version=version,
            generated_by=generated_by,
            generated_at=generated_at,
        )
    )
    if target.area is not None:
        prefix = storage.sign_pack_prefix("areas", target.area.id or 0)
    else:
        assert target.itp is not None
        prefix = storage.sign_pack_prefix("itps", target.itp.id or 0)
    key = f"{prefix}v{version}-{uuid.uuid4().hex}.pdf"
    storage.put_object(key, pdf, "application/pdf")
    pack = ItpSignPack(
        project_itp_id=target.itp.id if target.itp is not None else None,
        area_id=target.area.id if target.area is not None else None,
        version=version,
        s3_key=key,
        filename=_filename(content, version),
        file_size=len(pdf),
        content_hash=digest,
        signature_count=sum(
            len(d["pack_signatures"])
            + sum(len(ln["signatures"]) for s in d["sections"] for ln in s["lines"])
            for d in content["documents"]
        ),
        generated_by=generated_by,
    )
    db.add(pack)
    if target.itp is not None:
        target.itp.pack_s3_key = key
        target.itp.pack_version = version
        db.add(target.itp)
    db.commit()
    db.refresh(pack)
    return pack, True


def regenerate_in_background(
    itp_ids: list[int], area_ids: list[int], generated_by: str
) -> None:
    """Bring the packs of these ITPs and areas up to date (a background task).

    Runs after the response with its own session; a failure is logged and
    never surfaces — the next request for the pack renders it instead.
    """
    if not settings.ITP_PACK_AUTOREGENERATE:
        return
    from app.core.db import engine

    with Session(engine) as db:
        for itp_id in dict.fromkeys(itp_ids):
            itp = db.get(ProjectItp, itp_id)
            if itp is None:
                continue
            try:
                ensure_pack(db, itp_target(db, itp), generated_by=generated_by)
            except Exception:  # noqa: BLE001 - background work must not raise
                db.rollback()
                logger.warning(
                    "Pack regeneration failed for ITP %s", itp_id, exc_info=True
                )
        for area_id in dict.fromkeys(area_ids):
            area = db.get(ProjectArea, area_id)
            if area is None:
                continue
            try:
                ensure_pack(db, area_target(db, area), generated_by=generated_by)
            except Exception:  # noqa: BLE001 - background work must not raise
                db.rollback()
                logger.warning(
                    "Pack regeneration failed for area %s", area_id, exc_info=True
                )
