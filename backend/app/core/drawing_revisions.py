"""Drawing revision labels (increment 14.5).

Sheets are revised as A → B → C, 0 → 1 → 2, or P1 → P2 (preliminary). The
app suggests the next label and accepts whatever the user types instead.
"""

import re

MAX_LABEL_LENGTH = 20

# "Rev B", "Rev.B", "rev3", "Revision 2" — but not a label like "REVIEW".
_REV_PREFIX = re.compile(r"^\s*rev(?:ision)?(?:\.\s*|\s+|(?=\d))", re.IGNORECASE)
_TRAILING_NUMBER = re.compile(r"^(.*?)(\d+)$")
_LETTERS = re.compile(r"^[A-Z]{1,2}$")


def normalize_revision_label(value: str | None) -> str | None:
    """Trim, drop a typed "Rev" / "Revision" prefix and upper-case.

    Blank → ``None`` (an unlabelled drawing).
    """
    if value is None:
        return None
    label = _REV_PREFIX.sub("", value).strip().upper()
    label = re.sub(r"\s+", " ", label)
    return label[:MAX_LABEL_LENGTH] or None


def _next_letters(letters: str) -> str:
    """A → B, Z → AA, AY → AZ (spreadsheet-column style)."""
    chars = list(letters)
    i = len(chars) - 1
    while i >= 0:
        if chars[i] != "Z":
            chars[i] = chr(ord(chars[i]) + 1)
            return "".join(chars)
        chars[i] = "A"
        i -= 1
    return "A" + "".join(chars)


def next_revision_label(current: str | None) -> str:
    """The label suggested for the revision after ``current``.

    An unlabelled drawing counts as Rev A, so its first revision is B.
    """
    label = normalize_revision_label(current)
    if label is None:
        return "B"
    number = _TRAILING_NUMBER.match(label)
    if number:
        prefix, digits = number.groups()
        bumped = str(int(digits) + 1).zfill(len(digits))
        return f"{prefix}{bumped}"[:MAX_LABEL_LENGTH]
    if _LETTERS.match(label):
        return _next_letters(label)[:MAX_LABEL_LENGTH]
    return f"{label}-2"[:MAX_LABEL_LENGTH]
