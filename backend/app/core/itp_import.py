"""ITP import (Block 10E, rebuild increment 16).

An inspector uploads an existing ITP — a PDF, a spreadsheet (.xlsx / .csv) or
photos of a paper form — and the model reads it into a **draft** in the
simple shape below (sections → lines). The inspector reviews and edits that
draft in a plain form, then saves it; only then is it turned into a master
template body (``draft_to_body``) and validated by the one template reader,
``app.core.itp.parse_template_body``. The model never writes a template.

Owner decision 2026-11-10: import is *the* way to make a custom template —
no paid form builder. So the draft shape is deliberately the handful of
things a line needs (title, H / W / R / I, criteria, reference, record, who
signs, photo, measured value) and nothing SurveyJS-specific.

Reading the files happens here too, with the standard library only:

* PDF — passed to the model as a document block (the model reads text and
  scanned pages alike);
* images — downscaled JPEG copies (``app.core.ai.prepare_image``);
* CSV — decoded as text;
* XLSX — the cell text of every sheet, read from the workbook's XML (an .xlsx
  is a zip of XML parts), so no spreadsheet library is needed.

The original files are kept in S3 by the route (Hard Rule 8), never on disk.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from dataclasses import dataclass
from typing import Any, Literal, cast
from xml.etree import ElementTree

from pydantic import BaseModel, Field, field_validator

Classification = Literal["H", "W", "R", "I"]
Party = Literal["contractor", "client", "engineer"]
ValueType = Literal["none", "number", "text"]
SourceKind = Literal["pdf", "image", "csv", "xlsx"]

CLASSIFICATION_WORDS = {
    "H": "hold",
    "W": "witness",
    "R": "review",
    "I": "information",
}
PASS_FAIL_CHOICES = ["Pass", "Fail", "N/A"]

# The default sign-off roles (``app.core.itp.DEFAULT_ROLES``), repeated here
# because ``app.models`` imports this module; a test keeps the two in step.
DEFAULT_ROLES: tuple[tuple[str, Party], ...] = (
    ("Contractor", "contractor"),
    ("Owner's representative", "client"),
    ("Third-party inspector", "engineer"),
)

MAX_SECTIONS = 40
MAX_LINES = 300
# Characters of spreadsheet text sent to the model (about 30k tokens).
MAX_SHEET_CHARS = 120_000


def _clean(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _clean_or_none(value: Any, limit: int) -> str | None:
    text = _clean(value, limit)
    return text or None


# --- the draft (what the model fills in and the review form edits) ------------


class ImportRole(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    party: Party = "contractor"

    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, value: Any) -> str:
        return _clean(value, 255)


class ImportLine(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    classification: Classification = "I"
    acceptance_criteria: str | None = Field(default=None, max_length=2000)
    reference: str | None = Field(default=None, max_length=500)
    record_required: str | None = Field(default=None, max_length=500)
    # Names of roles (from the draft's ``roles``) that sign this line.
    roles: list[str] = Field(default_factory=list, max_length=6)
    photo_required: bool = False
    value_type: ValueType = "none"
    unit: str | None = Field(default=None, max_length=40)

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, value: Any) -> str:
        return _clean(value, 500)

    @field_validator("classification", mode="before")
    @classmethod
    def _classification(cls, value: Any) -> str:
        text = str(value or "").strip().upper()
        words = {w.upper(): letter for letter, w in CLASSIFICATION_WORDS.items()}
        words.update({"SURVEILLANCE": "I", "RECORD": "R"})
        return words.get(text, text[:1] if text[:1] in CLASSIFICATION_WORDS else "I")

    @field_validator("acceptance_criteria", mode="before")
    @classmethod
    def _criteria(cls, value: Any) -> str | None:
        return _clean_or_none(value, 2000)

    @field_validator("reference", "record_required", mode="before")
    @classmethod
    def _short(cls, value: Any) -> str | None:
        return _clean_or_none(value, 500)

    @field_validator("unit", mode="before")
    @classmethod
    def _unit(cls, value: Any) -> str | None:
        return _clean_or_none(value, 40)

    @field_validator("roles", mode="before")
    @classmethod
    def _roles(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        names: list[str] = []
        for entry in value:
            name = _clean(entry, 255)
            if name and name.casefold() not in {n.casefold() for n in names}:
                names.append(name)
        return names[:6]


class ImportSection(BaseModel):
    title: str = Field(default="", max_length=255)
    lines: list[ImportLine] = Field(default_factory=list, max_length=MAX_LINES)

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, value: Any) -> str:
        return _clean(value, 255)


class ItpImportDraft(BaseModel):
    """The editable draft of an imported ITP."""

    name: str = Field(default="", max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    roles: list[ImportRole] = Field(default_factory=list, max_length=12)
    sections: list[ImportSection] = Field(default_factory=list, max_length=MAX_SECTIONS)
    # What the model could not read or had to assume — shown above the form.
    notes: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, value: Any) -> str:
        return _clean(value, 255)

    @field_validator("description", mode="before")
    @classmethod
    def _description(cls, value: Any) -> str | None:
        return _clean_or_none(value, 2000)

    @field_validator("notes", mode="before")
    @classmethod
    def _notes(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [n for n in (_clean(v, 300) for v in value) if n][:12]

    @field_validator("roles", mode="before")
    @classmethod
    def _dedupe_roles(cls, value: Any) -> Any:
        if not isinstance(value, list):
            return []
        seen: set[str] = set()
        kept: list[Any] = []
        for entry in value:
            name = _clean(entry.get("name") if isinstance(entry, dict) else entry, 255)
            if name and name.casefold() not in seen:
                seen.add(name.casefold())
                kept.append(entry if isinstance(entry, dict) else {"name": name})
        return kept

    @property
    def line_count(self) -> int:
        return sum(len(section.lines) for section in self.sections)

    def tidy(self) -> ItpImportDraft:
        """Drop empty sections, give every role a line uses an entry, and fall
        back to the default roles when the document named none."""
        self.sections = [s for s in self.sections if s.lines]
        known = {role.name.casefold() for role in self.roles}
        used: list[str] = []
        for section in self.sections:
            for line in section.lines:
                for name in line.roles:
                    if name.casefold() not in known:
                        known.add(name.casefold())
                        used.append(name)
        defaults: dict[str, Party] = {
            name.casefold(): party for name, party in DEFAULT_ROLES
        }
        for name in used:
            party = defaults.get(name.casefold(), "contractor")
            self.roles.append(ImportRole(name=name, party=party))
        if not self.roles:
            self.roles = [
                ImportRole(name=name, party=party) for name, party in DEFAULT_ROLES
            ]
        # A hold point must name who releases it (``parse_template_body``
        # refuses one without). When the document did not say, the owner's
        # side signs — and the inspector is told to check.
        signer = next(
            (r for r in self.roles if r.party == "client"),
            next((r for r in self.roles if r.party == "engineer"), self.roles[0]),
        )
        unsigned = 0
        for section in self.sections:
            for line in section.lines:
                if line.classification == "H" and not line.roles:
                    line.roles = [signer.name]
                    unsigned += 1
        note = (
            f"{unsigned} hold point{'s' if unsigned != 1 else ''} named no "
            f"signer; set to {signer.name} — check."
        )
        if unsigned and note not in self.notes:
            self.notes = [*self.notes, note][-12:]
        return self


# --- draft → template body --------------------------------------------------------


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.casefold()).strip("-")
    return slug[:48] or "line"


def draft_to_body(draft: ItpImportDraft, *, name: str) -> dict[str, Any]:
    """The master template body for a reviewed draft (SurveyJS form JSON with
    the VR Inspector line properties; see ``app.core.itp``)."""
    used: set[str] = set()

    def unique(base: str) -> str:
        candidate, n = base, 2
        while candidate in used:
            candidate = f"{base}-{n}"
            n += 1
        used.add(candidate)
        return candidate

    pages: list[dict[str, Any]] = []
    for index, section in enumerate(draft.sections, start=1):
        elements: list[dict[str, Any]] = []
        for line in section.lines:
            element: dict[str, Any]
            if line.value_type == "number":
                element = {"type": "text", "inputType": "number"}
            elif line.value_type == "text":
                element = {"type": "text"}
            else:
                element = {"type": "radiogroup", "choices": list(PASS_FAIL_CHOICES)}
            element["name"] = unique(_slug(line.title))
            element["title"] = line.title
            element["classification"] = CLASSIFICATION_WORDS[line.classification]
            if line.roles:
                element["signoffRoles"] = list(line.roles)
            if line.acceptance_criteria:
                element["acceptanceCriteria"] = line.acceptance_criteria
            if line.reference:
                element["reference"] = line.reference
            if line.record_required:
                element["recordRequired"] = line.record_required
            if line.photo_required:
                element["photoRequired"] = True
            if line.value_type != "none" and line.unit:
                element["unit"] = line.unit
            elements.append(element)
        pages.append(
            {
                "name": unique(f"section-{index}"),
                "title": section.title or f"Section {index}",
                "elements": elements,
            }
        )
    return {
        "title": name,
        "importedWithAi": True,
        "signoffRoles": [{"name": r.name, "party": r.party} for r in draft.roles],
        "pages": pages,
    }


# --- reading the uploaded files ---------------------------------------------------

PDF_TYPES = frozenset({"application/pdf"})
IMAGE_TYPES = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"}
)
CSV_TYPES = frozenset({"text/csv", "application/csv", "text/plain"})
XLSX_TYPES = frozenset(
    {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
)
EXTENSIONS = {
    "pdf": "pdf",
    "jpg": "image",
    "jpeg": "image",
    "png": "image",
    "webp": "image",
    "gif": "image",
    "heic": "image",
    "heif": "image",
    "csv": "csv",
    "txt": "csv",
    "xlsx": "xlsx",
}
ACCEPTED_LABEL = "PDF, photos (JPEG / PNG / HEIC), Excel (.xlsx) or CSV"


class ImportFileError(ValueError):
    """An uploaded file that cannot be read (message is user-facing)."""


@dataclass
class SourceFile:
    name: str
    kind: SourceKind
    content_type: str
    data: bytes


def classify_file(name: str, content_type: str | None, data: bytes) -> SourceFile:
    """Work out what an uploaded file is, by its extension then its type."""
    clean_name = (name or "upload").rsplit("/", 1)[-1].rsplit("\\", 1)[-1][:200]
    extension = clean_name.rsplit(".", 1)[-1].casefold() if "." in clean_name else ""
    ctype = (content_type or "").split(";")[0].strip().casefold()
    kind = EXTENSIONS.get(extension)
    if kind is None:
        if ctype in PDF_TYPES:
            kind = "pdf"
        elif ctype in IMAGE_TYPES:
            kind = "image"
        elif ctype in XLSX_TYPES:
            kind = "xlsx"
        elif ctype in CSV_TYPES:
            kind = "csv"
    if kind is None:
        raise ImportFileError(
            f"“{clean_name}” isn't a file we can read ({ACCEPTED_LABEL})"
        )
    if not data:
        raise ImportFileError(f"“{clean_name}” is empty")
    if kind == "pdf" and not data.startswith(b"%PDF"):
        raise ImportFileError(f"“{clean_name}” isn't a readable PDF")
    if kind == "xlsx" and not zipfile.is_zipfile(io.BytesIO(data)):
        raise ImportFileError(
            f"“{clean_name}” isn't a readable .xlsx workbook (an old .xls? "
            "Save it as .xlsx or CSV)"
        )
    stored_type = {
        "pdf": "application/pdf",
        "csv": "text/csv",
        "xlsx": next(iter(XLSX_TYPES)),
    }.get(kind, ctype or "image/jpeg")
    return SourceFile(
        name=clean_name,
        kind=cast(SourceKind, kind),
        content_type=stored_type,
        data=data,
    )


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode(
        "utf-8", errors="replace"
    )  # pragma: no cover - latin-1 decodes all


def csv_text(data: bytes) -> str:
    """CSV rows as `` | ``-separated lines (blank rows dropped)."""
    text = _decode(data)
    try:
        dialect: Any = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = []
    for row in csv.reader(io.StringIO(text), dialect):
        cells = [" ".join(cell.split()) for cell in row]
        if any(cells):
            rows.append(" | ".join(cells).rstrip(" |"))
    return "\n".join(rows)[:MAX_SHEET_CHARS]


_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _column_index(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    index = 0
    for ch in letters.upper():
        index = index * 26 + (ord(ch) - 64)
    return max(index - 1, 0)


def xlsx_text(data: bytes) -> str:
    """Cell text of every sheet of an .xlsx workbook, row by row.

    Reads ``xl/sharedStrings.xml``, ``xl/workbook.xml`` (sheet names) and each
    ``xl/worksheets/sheetN.xml``. Formulas give their cached value; styling,
    merged cells and pictures are ignored. Parsed with ElementTree from the
    standard library (no entity expansion of external resources).
    """
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ImportFileError("That workbook could not be opened") from exc
    with archive:
        names = set(archive.namelist())
        total = sum(info.file_size for info in archive.infolist())
        if total > 60 * 1024 * 1024:
            raise ImportFileError("That workbook is too large to read")
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", _NS):
                shared.append(
                    "".join(t.text or "" for t in si.iter(f"{{{_NS['m']}}}t"))
                )
        sheets: list[tuple[str, str]] = []
        if "xl/workbook.xml" in names:
            workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
            rels: dict[str, str] = {}
            if "xl/_rels/workbook.xml.rels" in names:
                rel_root = ElementTree.fromstring(
                    archive.read("xl/_rels/workbook.xml.rels")
                )
                for rel in rel_root:
                    target = rel.get("Target") or ""
                    target = target.lstrip("/")
                    if not target.startswith("xl/"):
                        target = "xl/" + target
                    rels[rel.get("Id") or ""] = target
            for sheet in workbook.iter(f"{{{_NS['m']}}}sheet"):
                rid = sheet.get(f"{{{_REL_NS}}}id") or ""
                path = rels.get(rid)
                if path and path in names:
                    sheets.append((sheet.get("name") or "Sheet", path))
        if not sheets:
            sheets = [
                (n.rsplit("/", 1)[-1].removesuffix(".xml"), n)
                for n in sorted(names)
                if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")
            ]
        out: list[str] = []
        for sheet_name, path in sheets:
            root = ElementTree.fromstring(archive.read(path))
            rows: list[str] = []
            for row in root.iter(f"{{{_NS['m']}}}row"):
                cells: dict[int, str] = {}
                for cell in row.findall("m:c", _NS):
                    kind = cell.get("t")
                    value = ""
                    if kind == "s":
                        v = cell.find("m:v", _NS)
                        if v is not None and (v.text or "").strip().isdigit():
                            i = int((v.text or "0").strip())
                            value = shared[i] if i < len(shared) else ""
                    elif kind == "inlineStr":
                        value = "".join(
                            t.text or "" for t in cell.iter(f"{{{_NS['m']}}}t")
                        )
                    else:
                        v = cell.find("m:v", _NS)
                        value = (v.text or "") if v is not None else ""
                    value = " ".join(value.split())
                    if value:
                        cells[_column_index(cell.get("r") or "A")] = value
                if cells:
                    width = max(cells) + 1
                    rows.append(
                        " | ".join(cells.get(i, "") for i in range(width)).rstrip(" |")
                    )
            if rows:
                out.append(f"## Sheet: {sheet_name}")
                out.extend(rows)
        text = "\n".join(out)
    if not text.strip():
        raise ImportFileError("That workbook has no text in it")
    return text[:MAX_SHEET_CHARS]
