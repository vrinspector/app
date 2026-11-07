from datetime import UTC, datetime

from sqlmodel import SQLModel

# Database tables arrive with increment 03 (data layer port). Identity is NOT a
# table: users are Auth0 subjects (see app/core/auth.py). Hard Rules: INTEGER
# primary keys (+ public_id), Auth0 `sub` as the identity anchor.


def get_datetime_utc() -> datetime:
    return datetime.now(UTC)


# Generic message
class Message(SQLModel):
    message: str


# The authenticated caller, as returned by GET /api/v1/users/me
class UserPublic(SQLModel):
    sub: str
    email: str | None = None
    name: str | None = None
    picture: str | None = None
    permissions: list[str] = []
