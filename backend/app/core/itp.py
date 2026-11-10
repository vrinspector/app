"""ITP template bodies (Block 9.5, rebuild increment 13).

A master template's ``body`` is SurveyJS form JSON with two VR Inspector
properties layered on top (SurveyJS keeps unknown properties when it loads a
form, and the frontend registers them so they survive a round trip):

* a top-level ``signoffRoles`` list — ``[{"name": "Client engineer",
  "party": "client"}]`` — naming the roles the template's items may require;
* on every question, ``classification`` (``hold`` / ``witness`` /
  ``surveillance`` / ``record``) and an optional ``signoffRoles`` list of role
  names that must sign that line.

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

from app.models import ITP_ITEM_CLASSIFICATIONS, SIGNOFF_PARTIES

LAYOUT_TYPES = frozenset({"html", "image", "expression"})
CONTAINER_TYPES = frozenset({"panel", "paneldynamic"})
MAX_ITEMS = 500
DEFAULT_PARTY = "contractor"


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
            name, party = entry.strip(), DEFAULT_PARTY
        elif isinstance(entry, dict):
            name = (_text(entry.get("name")) or "").strip()
            party = str(entry.get("party") or DEFAULT_PARTY)
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
            classification = element.get("classification")
            if classification not in ITP_ITEM_CLASSIFICATIONS:
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
                    classification=str(classification),
                    roles=roles,
                )
            )

    if problems:
        shown = ", ".join(f"“{p}”" for p in problems[:5])
        more = f" and {len(problems) - 5} more" if len(problems) > 5 else ""
        raise TemplateError(
            "Every question needs a classification (hold, witness, surveillance "
            f"or record). Missing on {shown}{more}"
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
                parsed.roles.append(ParsedRole(name=role, party=DEFAULT_PARTY))
    return parsed
