"""Send the signing-link reminders that are due (increment 14).

Run on a schedule (for example hourly) once the app is deployed:

    python -m app.sign_reminders

A live link that has waited ``SIGN_REMINDER_AFTER_DAYS`` without being used
is re-issued as a reminder email, at most ``SIGN_REMINDER_MAX`` times per role
and document. Scheduling it is part of the RG-3 deployment set-up (owner
action); nothing runs it automatically from this repository.
"""

import logging

from sqlmodel import Session

from app.api.routes.signoff import send_due_reminders
from app.core.db import engine

logger = logging.getLogger(__name__)


def main() -> int:
    with Session(engine) as session:
        sent = send_due_reminders(session)
    logger.info("Signing reminders sent: %s", sent)
    return sent


if __name__ == "__main__":  # pragma: no cover
    logging.basicConfig(level=logging.INFO)
    main()
