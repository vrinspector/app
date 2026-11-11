"""Outbound email service (rebuild increment 13.5; Block 7.1 pulled forward).

One service for every email the app sends:

* **Templates.** Branded HTML is written with React Email in
  ``packages/react-email/`` and exported to ``app/email-templates/*.html`` with
  Jinja placeholders; each email also has a plain-text twin in
  ``app/email-text/*.txt``. Both are rendered here with Jinja (HTML with
  autoescaping, so a project name can never inject markup).
* **Transport.** Plain SMTP via ``smtplib`` on the template's settings
  (``SMTP_HOST`` / ``SMTP_PORT`` / ``SMTP_TLS`` (STARTTLS) / ``SMTP_SSL`` /
  ``SMTP_USER`` / ``SMTP_PASSWORD``). That is exactly what AWS SES's SMTP
  interface takes, so production is configuration only (owner action at
  RG-3). Local dev and CI point it at Mailpit. Tests swap in
  :class:`MemoryTransport` with :meth:`Mailer.use_transport`, mirroring
  ``storage.use_client``.
* **Send log.** :func:`queue_email` writes an ``email_send_log`` row
  (``queued``, or ``skipped`` when SMTP is not configured) inside the request;
  :func:`deliver` runs afterwards as a FastAPI background task with its own
  database session, sends, and records ``sent`` (with ``sent_at``) or
  ``failed`` (with the reason). A request never waits on, or fails because
  of, the mail server.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from pathlib import Path
from typing import Any, Protocol

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models import EmailSendLog, Project, ProjectMember

logger = logging.getLogger(__name__)

APP_DIR = Path(__file__).resolve().parent.parent
HTML_DIR = APP_DIR / "email-templates"
TEXT_DIR = APP_DIR / "email-text"

_html_env = Environment(
    loader=FileSystemLoader(HTML_DIR),
    autoescape=select_autoescape(["html"]),
    undefined=StrictUndefined,
)
_text_env = Environment(
    loader=FileSystemLoader(TEXT_DIR),
    autoescape=False,
    undefined=StrictUndefined,
    keep_trailing_newline=True,
)

# Longest error text kept on a failed row (SMTP replies can be chatty).
MAX_ERROR_LENGTH = 500


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str


def render(template: str, *, subject: str, context: dict[str, Any]) -> RenderedEmail:
    """Render ``{template}.html`` and ``{template}.txt`` with ``context``."""
    html = _html_env.get_template(f"{template}.html").render(context)
    text = _text_env.get_template(f"{template}.txt").render(context)
    return RenderedEmail(subject=subject, html=html, text=text)


# --- Transport ----------------------------------------------------------------


class Transport(Protocol):
    def send(self, message: EmailMessage) -> None: ...


class SmtpTransport:
    """Sends through the configured SMTP server (SES SMTP in production)."""

    def send(self, message: EmailMessage) -> None:
        host = settings.SMTP_HOST
        assert host, "SMTP_HOST is not configured"
        timeout = settings.SMTP_TIMEOUT_SECONDS
        context = ssl.create_default_context()
        smtp: smtplib.SMTP
        if settings.SMTP_SSL:
            smtp = smtplib.SMTP_SSL(
                host, settings.SMTP_PORT, timeout=timeout, context=context
            )
        else:
            smtp = smtplib.SMTP(host, settings.SMTP_PORT, timeout=timeout)
        with smtp:
            if settings.SMTP_TLS and not settings.SMTP_SSL:
                smtp.starttls(context=context)
            if settings.SMTP_USER:
                smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD or "")
            smtp.send_message(message)


@dataclass
class MemoryTransport:
    """Collects messages instead of sending them (tests and the demo)."""

    outbox: list[EmailMessage] = field(default_factory=list)
    fail_with: Exception | None = None

    def send(self, message: EmailMessage) -> None:
        if self.fail_with is not None:
            raise self.fail_with
        self.outbox.append(message)


class Mailer:
    def __init__(self) -> None:
        self._override: Transport | None = None

    @property
    def transport(self) -> Transport:
        return self._override or SmtpTransport()

    def use_transport(self, transport: Transport | None) -> None:
        """Swap the transport (tests); ``None`` restores SMTP."""
        self._override = transport


mailer = Mailer()


def build_message(*, recipient: str, rendered: RenderedEmail) -> EmailMessage:
    sender = str(settings.EMAILS_FROM_EMAIL)
    domain = sender.rsplit("@", 1)[-1] if "@" in sender else None
    message = EmailMessage()
    message["Subject"] = rendered.subject
    message["From"] = formataddr((settings.EMAILS_FROM_NAME or "", sender))
    message["To"] = recipient
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = make_msgid(domain=domain)
    if settings.EMAILS_REPLY_TO:
        message["Reply-To"] = str(settings.EMAILS_REPLY_TO)
    if settings.SES_CONFIGURATION_SET:
        message["X-SES-CONFIGURATION-SET"] = settings.SES_CONFIGURATION_SET
    message.set_content(rendered.text)
    message.add_alternative(rendered.html, subtype="html")
    return message


# --- Send log + delivery ------------------------------------------------------


def queue_email(
    session: Session,
    *,
    email_type: str,
    recipient: str,
    rendered: RenderedEmail,
    project_id: int | None = None,
    related_id: int | None = None,
    triggered_by: str | None = None,
) -> EmailSendLog:
    """Record the email in the send log and commit.

    The row is ``queued`` when SMTP is configured (the caller then schedules
    :func:`deliver`) and ``skipped`` otherwise, so an unconfigured environment
    still shows what would have been sent.
    """
    enabled = settings.emails_enabled
    log = EmailSendLog(
        project_id=project_id,
        email_type=email_type,
        related_id=related_id,
        recipient=recipient,
        subject=rendered.subject[:255],
        status="queued" if enabled else "skipped",
        error=None if enabled else "Email is not configured on this server",
        triggered_by=triggered_by,
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return log


def deliver(log_id: int, rendered: RenderedEmail) -> None:
    """Send a queued email and record the outcome (runs as a background task)."""
    with Session(engine) as session:
        log = session.get(EmailSendLog, log_id)
        if log is None or log.status != "queued":
            return
        try:
            message = build_message(recipient=log.recipient, rendered=rendered)
            log.message_id = str(message["Message-ID"])
            mailer.transport.send(message)
        except Exception as exc:  # noqa: BLE001 — every failure is recorded
            logger.warning("Email %s to %s failed: %s", log.id, log.recipient, exc)
            log.status = "failed"
            log.error = (f"{type(exc).__name__}: {exc}")[:MAX_ERROR_LENGTH]
        else:
            log.status = "sent"
            log.error = None
            log.sent_at = datetime.now(UTC)
        session.add(log)
        session.commit()


# --- Emails -------------------------------------------------------------------

ROLE_LABELS = {
    "owner": "Owner",
    "inspector": "Inspector",
    "viewer": "Viewer",
}
ROLE_DESCRIPTIONS = {
    "owner": "Owners manage the project, its members and its records.",
    "inspector": "Inspectors log inspections, findings and photos.",
    "viewer": "Viewers can see the project and its records but not change them.",
}


def member_invite_email(
    *, project: Project, member: ProjectMember, inviter: str
) -> RenderedEmail:
    app_name = settings.PROJECT_NAME
    context = {
        "app_name": app_name,
        "inviter": inviter,
        "project_name": project.name,
        "project_client": project.client or "—",
        "role_label": ROLE_LABELS.get(member.role, member.role),
        "role_description": ROLE_DESCRIPTIONS.get(member.role, ""),
        "email": member.user_email,
        "link": f"{settings.app_public_url}/projects/{project.id}",
    }
    return render(
        "member_invite",
        subject=f"You've been added to {project.name} on {app_name}",
        context=context,
    )


# --- Increment 14: signing links, reminders, witness / hold point notices -----


def sign_request_email(
    *,
    project: Project,
    role_name: str,
    documents: list[str],
    ready_count: int,
    expires_at: datetime,
    signer_email: str,
    requester: str,
    link: str,
    reminder: bool = False,
) -> RenderedEmail:
    app_name = settings.PROJECT_NAME
    what = documents[0] if len(documents) == 1 else f"{len(documents)} ITPs"
    if reminder:
        heading = "Reminder: your signature is still needed"
        intro = (
            f"{requester} is reminding you that {what} on {project.name} is "
            f"waiting for your signature as {role_name}. This email has a new "
            "link; any earlier link no longer works."
        )
        subject = f"Reminder: please sign {what} — {project.name}"
    else:
        heading = "Your signature is requested"
        intro = (
            f"{requester} asks you to review and sign {what} on {project.name} "
            f"as {role_name}."
        )
        subject = f"Please sign {what} — {project.name}"
    context = {
        "app_name": app_name,
        "heading": heading,
        "intro": intro,
        "requester": requester,
        "project_name": project.name,
        "project_client": project.client or "—",
        "role_name": role_name,
        "documents": "; ".join(documents) or "—",
        "ready_count": str(ready_count),
        "expires": expires_at.astimezone(UTC).strftime("%d %b %Y"),
        "email": signer_email,
        "link": link,
    }
    return render("sign_request", subject=subject, context=context)


def witness_notice_email(
    *,
    project: Project,
    document: str,
    classification: str,
    requirement: str,
    role_name: str,
    planned_for: str | None,
    message: str | None,
    sender: str,
) -> RenderedEmail:
    app_name = settings.PROJECT_NAME
    point_type = "Hold point" if classification == "hold" else "Witness point"
    context = {
        "app_name": app_name,
        "heading": f"{point_type} notice",
        "sender": sender,
        "project_name": project.name,
        "project_client": project.client or "—",
        "document": document,
        "point_type": point_type,
        "requirement": requirement,
        "role_name": role_name,
        "planned_for": (planned_for or "").strip() or "To be confirmed",
        "message": (message or "").strip() or "—",
    }
    return render(
        "witness_notice",
        subject=f"{point_type} notice: {requirement} — {project.name}",
        context=context,
    )
