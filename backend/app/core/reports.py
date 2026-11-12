"""Block 4 inspection report: HTML → PDF with WeasyPrint (ADR-009).

The legacy ``POST /api/reports/generate`` rendered a PDF for one inspection
and returned a presigned download URL. Its source did not survive in the
transfer package, so the document is rebuilt from what the inspection screen
shows (``docs/SCREENS.md``): the inspection's details and sign-off state, a
findings summary, the findings with their Block 8A resolution, and the site
photos. The stack decision keeps PDF generation server-side in Python with
WeasyPrint; this module is the only place that knows about it.

Photos are read from S3 by the server (the one read path the API has, see
``Storage.get_object``), downscaled with Pillow so a 12-megapixel phone
photo becomes a ~100 kB thumbnail, and embedded as data URIs so the PDF is
self-contained. A photo that cannot be read renders as a placeholder rather
than failing the report.
"""

from __future__ import annotations

import base64
import io
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.storage import storage
from app.models import Finding, Inspection, Photo, Project

logger = logging.getLogger(__name__)

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "report-templates"
TEMPLATE_NAME = "inspection_report.html"

# Embedded photo thumbnails: longest edge in pixels and JPEG quality.
THUMBNAIL_EDGE = 1000
THUMBNAIL_QUALITY = 78

PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}
STATUS_LABELS = {"open": "Open", "in-progress": "In progress", "resolved": "Resolved"}
PRIORITY_LABELS = {"high": "High", "medium": "Medium", "low": "Low"}
INSPECTION_TYPE_LABELS = {
    "civil": "Civil",
    "structural": "Structural",
    "mechanical": "Mechanical",
    "electrical": "Electrical",
    "piping": "Piping",
    "general": "General",
}

_env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(["html"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


def _fmt_dt(value: datetime | None) -> str:
    if value is None:
        return "—"
    return value.astimezone(UTC).strftime("%b %d, %Y %H:%M UTC")


def _fmt_date(value: datetime | None) -> str:
    if value is None:
        return "—"
    return value.astimezone(UTC).strftime("%b %d, %Y")


_env.filters["dt"] = _fmt_dt
_env.filters["date"] = _fmt_date


@dataclass
class ReportContext:
    project: Project
    inspection: Inspection
    findings: list[Finding]
    photos: list[Photo]
    version: int
    generated_by: str
    generated_at: datetime
    # Increment 16 (Block 10C): the inspector's summary, and whether it
    # started as an AI draft (printed with a provenance line).
    narrative: str | None = None
    narrative_ai: bool = False


def thumbnail_data_uri(data: bytes, *, edge: int = THUMBNAIL_EDGE) -> str | None:
    """Downscale ``data`` to a JPEG thumbnail and return it as a data URI.

    Shared with the ITP sign-off pack (increment 14), which uses a smaller edge.
    """
    try:
        from PIL import Image, ImageOps

        with Image.open(io.BytesIO(data)) as source:
            image: Image.Image = ImageOps.exif_transpose(source) or source
            image.thumbnail((edge, edge))
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            out = io.BytesIO()
            image.save(out, format="JPEG", quality=THUMBNAIL_QUALITY, optimize=True)
    except Exception:  # noqa: BLE001 - any decode failure → placeholder
        logger.warning("Could not decode a photo for the report", exc_info=True)
        return None
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode()


def _photo_rows(photos: list[Photo]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for photo in photos:
        data = storage.get_object(photo.s3_key)
        src = thumbnail_data_uri(data) if data else None
        rows.append(
            {
                "filename": photo.filename or photo.s3_key.rsplit("/", 1)[-1],
                "uploaded_by": photo.uploaded_by,
                "created_at": photo.created_at,
                "src": src,
            }
        )
    return rows


def _summary(findings: list[Finding], photos: list[Photo]) -> dict[str, int]:
    return {
        "findings": len(findings),
        "open": sum(1 for f in findings if f.status == "open"),
        "in_progress": sum(1 for f in findings if f.status == "in-progress"),
        "resolved": sum(1 for f in findings if f.status == "resolved"),
        "high": sum(
            1 for f in findings if f.priority == "high" and f.status != "resolved"
        ),
        "photos": len(photos),
    }


def render_html(ctx: ReportContext) -> str:
    """The report as HTML — what WeasyPrint lays out; also handy to test."""
    findings = sorted(
        ctx.findings,
        key=lambda f: (
            PRIORITY_ORDER.get(f.priority, 9),
            f.created_at or datetime.min.replace(tzinfo=UTC),
        ),
    )
    inspection_type = ctx.inspection.inspection_type
    template = _env.get_template(TEMPLATE_NAME)
    return template.render(
        project=ctx.project,
        inspection=ctx.inspection,
        inspection_type_label=(
            INSPECTION_TYPE_LABELS.get(inspection_type, inspection_type)
            if inspection_type
            else None
        ),
        signed_off=ctx.inspection.inspection_status == "closed",
        findings=findings,
        summary=_summary(ctx.findings, ctx.photos),
        photos=_photo_rows(ctx.photos),
        status_labels=STATUS_LABELS,
        priority_labels=PRIORITY_LABELS,
        version=ctx.version,
        generated_by=ctx.generated_by,
        generated_at=ctx.generated_at,
        narrative=[p.strip() for p in (ctx.narrative or "").split("\n") if p.strip()],
        narrative_ai=ctx.narrative_ai,
    )


def html_to_pdf(html: str) -> bytes:
    """Lay out ``html`` with WeasyPrint. Imported lazily: it is only needed here."""
    from weasyprint import HTML  # type: ignore[import-untyped]

    pdf: bytes = HTML(string=html, base_url=str(TEMPLATE_DIR)).write_pdf()
    return pdf


def render_pdf(ctx: ReportContext) -> bytes:
    return html_to_pdf(render_html(ctx))
