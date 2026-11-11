"""ITP template bodies (Block 9.5, rebuild increment 13).

A master template's ``body`` is SurveyJS form JSON with two VR Inspector
properties layered on top (SurveyJS keeps unknown properties when it loads a
form, and the frontend registers them so they survive a round trip):

* a top-level ``signoffRoles`` list — ``[{"name": "Client engineer",
  "party": "client"}]`` — naming the roles the template's items may require;
* on every question, ``classification`` (``hold`` / ``witness`` /
  ``review`` / ``information``, or the letters H / W / R / I) and an optional
  ``signoffRoles`` list of role names that must sign that line.

Increment 13.6 (line evidence) adds optional properties per question, all
copied onto the line at import:

* ``acceptanceCriteria``, ``reference`` and ``recordRequired`` — text shown
  under the line title (and later printed in the pack);
* ``photoRequired`` — Pass and hold-point sign-off need a photo on file;
* ``valueType`` (``number`` / ``text``), ``unit``, ``min`` and ``max`` — the
  line takes a measured value. A SurveyJS ``text`` question with
  ``inputType: number`` is a number line and a plain ``text`` / ``comment``
  question a text line, without saying so; ``valueType: "none"`` opts out.

Increment 13.8 adds ``photoSet: "three_shot"`` (also written ``three-shot``
or ``threeShot``): the line needs the three-shot photo set — Context,
Intermediate, Close-up with scale — before it can pass or be signed, instead
of a single photo.

The words used before 13.6 — ``surveillance`` and ``record`` — are still read
(as ``information`` and ``review``), so older template bodies stay valid.

Sections are the SurveyJS pages (or a panel's title inside a page). Every
question is one checklist line; layout elements (``html``, ``image``,
``expression``) are not. A question with no classification is refused rather
than given a default, for the same reason the column has none: a hold point
must never be lost quietly.

``parse_template_body`` is the single reader: it validates a body for the
template routes and yields the rows a project import materialises.
"""

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from app.models import (
    ITP_ITEM_CLASSIFICATIONS,
    ITP_PHOTO_SETS,
    ITP_VALUE_TYPES,
    LEGACY_CLASSIFICATIONS,
    SIGNOFF_PARTIES,
)

LAYOUT_TYPES = frozenset({"html", "image", "expression"})
CONTAINER_TYPES = frozenset({"panel", "paneldynamic"})
MAX_ITEMS = 500
DEFAULT_PARTY = "contractor"
CLASSIFICATION_LETTERS = {
    "h": "hold",
    "w": "witness",
    "r": "review",
    "i": "information",
}
# Default sign-off roles (owner review 2026-11-10) and the party each signs
# for; a template naming one of them without a party gets that party.
DEFAULT_ROLES = (
    ("Contractor", "contractor"),
    ("Owner's representative", "client"),
    ("Third-party inspector", "engineer"),
)
_DEFAULT_PARTIES = {name.casefold(): party for name, party in DEFAULT_ROLES}


class TemplateError(ValueError):
    """A body that cannot be used as an ITP template (message is user-facing)."""


@dataclass(frozen=True)
class ParsedRole:
    name: str
    party: str


@dataclass(frozen=True)
class ParsedItem:
    section: str | None
    element_name: str
    requirement: str
    classification: str
    roles: tuple[str, ...]
    acceptance_criteria: str | None = None
    reference: str | None = None
    record_required: str | None = None
    photo_required: bool = False
    photo_set: str | None = None
    value_type: str | None = None
    unit: str | None = None
    min_value: float | None = None
    max_value: float | None = None


@dataclass
class ParsedTemplate:
    title: str | None
    roles: list[ParsedRole] = field(default_factory=list)
    items: list[ParsedItem] = field(default_factory=list)

    @property
    def hold_count(self) -> int:
        return sum(1 for item in self.items if item.classification == "hold")

    def party_for(self, role_name: str) -> str:
        for role in self.roles:
            if role.name.casefold() == role_name.casefold():
                return role.party
        return DEFAULT_PARTY


def _text(value: Any) -> str | None:
    """SurveyJS titles may be a string or a ``{"default": …, "fr": …}`` map."""
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, dict):
        for key in ("default", "en"):
            if isinstance(value.get(key), str) and value[key].strip():
                return str(value[key]).strip()
    return None


def _roles(raw: Any) -> list[ParsedRole]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise TemplateError("signoffRoles must be a list of {name, party}")
    roles: list[ParsedRole] = []
    seen: set[str] = set()
    for entry in raw:
        if isinstance(entry, str):
            name = entry.strip()
            party = _DEFAULT_PARTIES.get(name.casefold(), DEFAULT_PARTY)
        elif isinstance(entry, dict):
            name = (_text(entry.get("name")) or "").strip()
            party = str(
                entry.get("party")
                or _DEFAULT_PARTIES.get(name.casefold(), DEFAULT_PARTY)
            )
        else:
            raise TemplateError("signoffRoles must be a list of {name, party}")
        if not name:
            raise TemplateError("Every sign-off role needs a name")
        if len(name) > 255:
            raise TemplateError(f"Role name is too long: {name[:40]}…")
        if party not in SIGNOFF_PARTIES:
            raise TemplateError(
                f"Role “{name}” has party “{party}”; use one of "
                + ", ".join(SIGNOFF_PARTIES)
            )
        if name.casefold() in seen:
            raise TemplateError(f"Role “{name}” is listed twice")
        seen.add(name.casefold())
        roles.append(ParsedRole(name=name, party=party))
    return roles


def _walk(
    elements: Any, section: str | None
) -> Iterator[tuple[str | None, dict[str, Any]]]:
    if elements is None:
        return
    if not isinstance(elements, list):
        raise TemplateError("elements must be a list")
    for element in elements:
        if not isinstance(element, dict):
            raise TemplateError("Every element must be an object")
        kind = str(element.get("type") or "")
        if kind in CONTAINER_TYPES:
            inner = element.get("elements") or element.get("templateElements")
            yield from _walk(inner, _text(element.get("title")) or section)
        elif kind not in LAYOUT_TYPES:
            yield section, element


def normalise_classification(value: Any) -> str | None:
    """``hold`` / ``witness`` / ``review`` / ``information``, the letters
    H / W / R / I, or the pre-13.6 words — else ``None``."""
    if not isinstance(value, str):
        return None
    key = value.strip().casefold()
    key = CLASSIFICATION_LETTERS.get(key, key)
    key = LEGACY_CLASSIFICATIONS.get(key, key)
    return key if key in ITP_ITEM_CLASSIFICATIONS else None


def _number(element: dict[str, Any], key: str, label: str) -> float | None:
    raw = element.get(key)
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        raise TemplateError(f"“{label}”: {key} must be a number")
    try:
        return float(raw)
    except (TypeError, ValueError) as exc:
        raise TemplateError(f"“{label}”: {key} must be a number") from exc


def _short(element: dict[str, Any], key: str, label: str, limit: int) -> str | None:
    value = _text(element.get(key))
    if value is not None and len(value) > limit:
        raise TemplateError(f"“{label}”: {key} is longer than {limit} characters")
    return value


def _value_type(element: dict[str, Any], label: str) -> str | None:
    raw = element.get("valueType")
    if raw is not None:
        if not isinstance(raw, str) or (
            raw.strip().casefold() not in (*ITP_VALUE_TYPES, "none")
        ):
            raise TemplateError(f"“{label}”: valueType must be number, text or none")
        kind = raw.strip().casefold()
        return None if kind == "none" else kind
    question = str(element.get("type") or "")
    if question == "text":
        return "number" if element.get("inputType") == "number" else "text"
    if question == "comment":
        return "text"
    return None


def _photo_set(element: dict[str, Any], label: str) -> str | None:
    raw = element.get("photoSet")
    if raw is None or raw is False:
        return None
    kind = (
        raw.strip().replace("-", "_").replace(" ", "_").casefold()
        if isinstance(raw, str)
        else None
    )
    if kind == "threeshot":
        kind = "three_shot"
    if kind in ("", "none"):
        return None
    if kind not in ITP_PHOTO_SETS:
        raise TemplateError(f"“{label}”: photoSet must be three_shot or none")
    return kind


def _evidence(element: dict[str, Any], label: str) -> dict[str, Any]:
    photo = element.get("photoRequired", False)
    if not isinstance(photo, bool):
        raise TemplateError(f"“{label}”: photoRequired must be true or false")
    photo_set = _photo_set(element, label)
    value_type = _value_type(element, label)
    low = _number(element, "min", label)
    high = _number(element, "max", label)
    if low is not None and high is not None and low > high:
        raise TemplateError(f"“{label}”: min is greater than max")
    return {
        "acceptance_criteria": _text(element.get("acceptanceCriteria")),
        "reference": _short(element, "reference", label, 255),
        "record_required": _text(element.get("recordRequired")),
        "photo_required": photo,
        "photo_set": photo_set,
        "value_type": value_type,
        "unit": _short(element, "unit", label, 40) if value_type else None,
        "min_value": low if value_type == "number" else None,
        "max_value": high if value_type == "number" else None,
    }


def parse_template_body(body: Any) -> ParsedTemplate:
    if not isinstance(body, dict):
        raise TemplateError("The template must be a JSON object")
    pages = body.get("pages")
    if pages is None and "elements" in body:
        pages = [{"elements": body["elements"]}]
    if not isinstance(pages, list) or not pages:
        raise TemplateError("The template needs at least one page of questions")

    parsed = ParsedTemplate(
        title=_text(body.get("title")), roles=_roles(body.get("signoffRoles"))
    )
    declared = {role.name.casefold() for role in parsed.roles}
    names: set[str] = set()
    problems: list[str] = []

    for page in pages:
        if not isinstance(page, dict):
            raise TemplateError("Every page must be an object")
        page_section = _text(page.get("title")) or _text(page.get("name"))
        for section, element in _walk(page.get("elements"), page_section):
            name = _text(element.get("name"))
            if not name:
                raise TemplateError("Every question needs a name")
            if name in names:
                raise TemplateError(f"Question name “{name}” is used twice")
            names.add(name)
            label = _text(element.get("title")) or name
            classification = normalise_classification(element.get("classification"))
            if classification is None:
                problems.append(label)
                continue
            raw_roles = element.get("signoffRoles") or []
            if isinstance(raw_roles, str):
                raw_roles = [raw_roles]
            if not isinstance(raw_roles, list) or not all(
                isinstance(r, str) and r.strip() for r in raw_roles
            ):
                raise TemplateError(
                    f"“{label}”: signoffRoles must be a list of role names"
                )
            roles = tuple(dict.fromkeys(r.strip() for r in raw_roles))
            for role in roles:
                if declared and role.casefold() not in declared:
                    raise TemplateError(
                        f"“{label}” needs role “{role}”, which is not in the "
                        "template's signoffRoles list"
                    )
            if classification == "hold" and not roles:
                raise TemplateError(
                    f"Hold point “{label}” needs at least one sign-off role"
                )
            parsed.items.append(
                ParsedItem(
                    section=section[:255] if section else None,
                    element_name=name[:255],
                    requirement=label,
                    classification=classification,
                    roles=roles,
                    **_evidence(element, label),
                )
            )

    if problems:
        shown = ", ".join(f"“{p}”" for p in problems[:5])
        more = f" and {len(problems) - 5} more" if len(problems) > 5 else ""
        raise TemplateError(
            "Every question needs a classification (hold, witness, review or "
            f"information). Missing on {shown}{more}"
        )
    if not parsed.items:
        raise TemplateError("The template has no questions")
    if len(parsed.items) > MAX_ITEMS:
        raise TemplateError(f"A template can have at most {MAX_ITEMS} questions")
    # Undeclared role names (allowed when no list is given) become roles too.
    known = {role.name.casefold() for role in parsed.roles}
    for item in parsed.items:
        for role in item.roles:
            if role.casefold() not in known:
                known.add(role.casefold())
                parsed.roles.append(
                    ParsedRole(
                        name=role,
                        party=_DEFAULT_PARTIES.get(role.casefold(), DEFAULT_PARTY),
                    )
                )
    return parsed
