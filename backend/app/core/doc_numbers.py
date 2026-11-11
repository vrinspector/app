"""ITP document numbers (rebuild increment 13.8).

Every project ITP gets a number ``ITP-<PROJECT CODE>-<SEQ>``, e.g.
``ITP-LC4-007``:

* ``SEQ`` is ``project_itps.seq`` — 1, 2, 3 … per project, given when the ITP
  is created and never reused or changed (a deleted ITP leaves a gap, as a
  document register would);
* ``PROJECT CODE`` is the project's own ``code`` when an owner has set one,
  otherwise a code derived from the project name (initials of its words, or
  the first four letters of a one-word name), falling back to ``P<id>``.

The number is worked out when it is read, so editing the project code
re-labels the project's ITPs; the sequence part never moves.

This module imports nothing from ``app.models`` so the models can use it.
"""

import re

CODE_MAX_LENGTH = 20
_CODE_RE = re.compile(r"^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$")
_WORD_RE = re.compile(r"[A-Za-z0-9]+")


class ProjectCodeError(ValueError):
    """A project code that cannot be used (message is user-facing)."""


def normalise_project_code(raw: str | None) -> str | None:
    """Trim, upper-case, spaces → hyphens; blank means "no code" (``None``)."""
    if raw is None:
        return None
    code = re.sub(r"[\s_]+", "-", raw.strip()).upper()
    if not code:
        return None
    if len(code) > CODE_MAX_LENGTH:
        raise ProjectCodeError(
            f"A project code can be at most {CODE_MAX_LENGTH} characters"
        )
    if not _CODE_RE.match(code):
        raise ProjectCodeError(
            "A project code uses letters, digits and hyphens only, and starts "
            "and ends with a letter or digit"
        )
    return code


def derived_project_code(name: str | None, project_id: int | None) -> str:
    """The code a project without its own uses: ``Landfill Cell 4`` → ``LC4``."""
    words = _WORD_RE.findall(name or "")
    if len(words) >= 2:
        code = "".join(w[0] for w in words)[:6]
    elif words:
        code = words[0][:4]
    else:
        code = ""
    code = code.upper()
    if len(code) < 2:
        code = f"P{project_id or 0}"
    return code


def effective_project_code(
    code: str | None, name: str | None, project_id: int | None
) -> str:
    return code or derived_project_code(name, project_id)


def itp_doc_number(project_code: str, seq: int | None) -> str | None:
    if seq is None:
        return None
    return f"ITP-{project_code}-{seq:03d}"
