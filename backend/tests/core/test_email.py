"""Outbound email service internals (increment 13.5).

The SMTP transport is exercised against a tiny in-process SMTP server (no
third-party package), and — when the Mailpit container from compose / CI is
reachable — end to end through Mailpit's API.
"""

import json
import os
import smtplib
import socket
import socketserver
import threading
import urllib.request
import uuid
from collections.abc import Generator
from email import message_from_bytes
from email.message import EmailMessage
from email.policy import default as default_policy
from typing import Any

import pytest

from app.core import email as email_service
from app.core.config import settings
from app.core.email import (
    MemoryTransport,
    RenderedEmail,
    SmtpTransport,
    build_message,
    mailer,
    render,
)

RENDERED = RenderedEmail(subject="Hello", html="<p>Hi</p>", text="Hi")


def test_render_uses_both_templates_and_escapes_html() -> None:
    context = {
        "app_name": "VR Inspector",
        "inviter": "o@example.com",
        "project_name": "A & B <Plant>",
        "project_client": "—",
        "role_label": "Inspector",
        "role_description": "Does things.",
        "email": "x@example.com",
        "link": "https://app.example.com/projects/1",
    }
    out = render("member_invite", subject="S", context=context)
    assert out.subject == "S"
    assert "A &amp; B &lt;Plant&gt;" in out.html
    assert "A & B <Plant>" in out.text  # text part is not HTML-escaped
    assert "{{" not in out.html and "{{" not in out.text


def test_render_refuses_missing_placeholders() -> None:
    with pytest.raises(Exception, match="undefined"):
        render("member_invite", subject="S", context={})


def test_build_message_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "EMAILS_FROM_EMAIL", "noreply@vri.example.com")
    monkeypatch.setattr(settings, "EMAILS_FROM_NAME", "VR Inspector")
    monkeypatch.setattr(settings, "EMAILS_REPLY_TO", "support@vri.example.com")
    monkeypatch.setattr(settings, "SES_CONFIGURATION_SET", "vri-transactional")
    message = build_message(recipient="to@example.com", rendered=RENDERED)
    assert message["From"] == "VR Inspector <noreply@vri.example.com>"
    assert message["Reply-To"] == "support@vri.example.com"
    assert message["X-SES-CONFIGURATION-SET"] == "vri-transactional"
    assert message["Message-ID"].endswith("@vri.example.com>")
    assert message.is_multipart()
    assert message.get_content_type() == "multipart/alternative"

    monkeypatch.setattr(settings, "EMAILS_REPLY_TO", None)
    monkeypatch.setattr(settings, "SES_CONFIGURATION_SET", None)
    plain = build_message(recipient="to@example.com", rendered=RENDERED)
    assert plain["Reply-To"] is None
    assert plain["X-SES-CONFIGURATION-SET"] is None


def test_mailer_defaults_to_smtp_and_can_be_swapped() -> None:
    mailer.use_transport(None)
    assert isinstance(mailer.transport, SmtpTransport)
    memory = MemoryTransport()
    mailer.use_transport(memory)
    assert mailer.transport is memory


def test_deliver_ignores_missing_or_finished_rows() -> None:
    email_service.deliver(987654, RENDERED)  # no such row: no error


# --- SMTP transport -----------------------------------------------------------


class _SmtpHandler(socketserver.StreamRequestHandler):
    """Just enough SMTP (RFC 5321) to accept one message per connection."""

    def _reply(self, line: str) -> None:
        self.wfile.write(f"{line}\r\n".encode())

    def handle(self) -> None:
        server: Any = self.server
        self._reply("220 test ESMTP")
        envelope: dict[str, Any] = {"rcpt": []}
        while True:
            raw = self.rfile.readline()
            if not raw:
                return
            command = raw.decode().strip()
            verb = command.split(" ", 1)[0].upper()
            server.commands.append(verb)
            if verb in ("EHLO", "HELO"):
                self._reply("250-test")
                self._reply("250 AUTH PLAIN LOGIN")
            elif verb == "AUTH":
                self._reply("235 2.7.0 Authentication successful")
            elif verb == "MAIL":
                envelope["from"] = command
                self._reply("250 OK")
            elif verb == "RCPT":
                envelope["rcpt"].append(command)
                self._reply("250 OK")
            elif verb == "DATA":
                self._reply("354 End data with <CR><LF>.<CR><LF>")
                lines: list[bytes] = []
                while True:
                    data_line = self.rfile.readline()
                    if data_line in (b".\r\n", b".\n", b""):
                        break
                    if data_line.startswith(b".."):
                        data_line = data_line[1:]
                    lines.append(data_line)
                envelope["data"] = b"".join(lines)
                server.messages.append(envelope)
                envelope = {"rcpt": []}
                self._reply("250 OK queued")
            elif verb == "QUIT":
                self._reply("221 Bye")
                return
            else:
                self._reply("250 OK")


@pytest.fixture
def smtp_server() -> Generator[Any]:
    server: Any = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _SmtpHandler)
    server.daemon_threads = True
    server.messages = []
    server.commands = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()


def test_smtp_transport_sends_through_a_real_socket(
    smtp_server: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    host, port = smtp_server.server_address
    monkeypatch.setattr(settings, "SMTP_HOST", host)
    monkeypatch.setattr(settings, "SMTP_PORT", port)
    monkeypatch.setattr(settings, "SMTP_TLS", False)
    monkeypatch.setattr(settings, "SMTP_SSL", False)
    monkeypatch.setattr(settings, "SMTP_USER", "ses-smtp-user")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "placeholder")
    message = build_message(recipient="to@example.com", rendered=RENDERED)
    SmtpTransport().send(message)

    assert "AUTH" in smtp_server.commands
    assert "STARTTLS" not in smtp_server.commands
    (received,) = smtp_server.messages
    assert [r.lower() for r in received["rcpt"]] == ["rcpt to:<to@example.com>"]
    parsed = message_from_bytes(received["data"], policy=default_policy)
    assert parsed["Subject"] == "Hello"
    assert parsed["Message-ID"] == message["Message-ID"]


def test_smtp_transport_uses_starttls_or_ssl(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    class FakeSMTP:
        def __init__(self, host: str, port: int, **kwargs: Any) -> None:
            calls.append(f"connect {type(self).__name__} {host}:{port}")
            assert kwargs["timeout"] == settings.SMTP_TIMEOUT_SECONDS

        def __enter__(self) -> FakeSMTP:
            return self

        def __exit__(self, *exc: object) -> None:
            calls.append("quit")

        def starttls(self, **_kwargs: Any) -> None:
            calls.append("starttls")

        def login(self, user: str, password: str) -> None:
            calls.append(f"login {user}")

        def send_message(self, _message: EmailMessage) -> None:
            calls.append("send")

    class FakeSMTPSSL(FakeSMTP):
        pass

    monkeypatch.setattr(email_service.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(email_service.smtplib, "SMTP_SSL", FakeSMTPSSL)
    monkeypatch.setattr(settings, "SMTP_HOST", "email-smtp.us-east-1.amazonaws.com")
    monkeypatch.setattr(settings, "SMTP_PORT", 587)
    monkeypatch.setattr(settings, "SMTP_USER", "AKIAPLACEHOLDER")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "placeholder")
    message = build_message(recipient="to@example.com", rendered=RENDERED)

    # SES default: port 587 + STARTTLS + SMTP credentials.
    monkeypatch.setattr(settings, "SMTP_TLS", True)
    monkeypatch.setattr(settings, "SMTP_SSL", False)
    SmtpTransport().send(message)
    assert calls == [
        "connect FakeSMTP email-smtp.us-east-1.amazonaws.com:587",
        "starttls",
        "login AKIAPLACEHOLDER",
        "send",
        "quit",
    ]

    # Implicit TLS (SES port 465), no STARTTLS on top.
    calls.clear()
    monkeypatch.setattr(settings, "SMTP_SSL", True)
    monkeypatch.setattr(settings, "SMTP_PORT", 465)
    SmtpTransport().send(message)
    assert calls[0] == "connect FakeSMTPSSL email-smtp.us-east-1.amazonaws.com:465"
    assert "starttls" not in calls

    # No credentials (Mailpit): no login.
    calls.clear()
    monkeypatch.setattr(settings, "SMTP_SSL", False)
    monkeypatch.setattr(settings, "SMTP_TLS", False)
    monkeypatch.setattr(settings, "SMTP_USER", None)
    SmtpTransport().send(message)
    assert calls == [
        "connect FakeSMTP email-smtp.us-east-1.amazonaws.com:465",
        "send",
        "quit",
    ]


def test_smtp_errors_surface_to_deliver(monkeypatch: pytest.MonkeyPatch) -> None:
    # Closed port → the transport raises; deliver() turns that into "failed".
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        free_port = s.getsockname()[1]
    monkeypatch.setattr(settings, "SMTP_HOST", "127.0.0.1")
    monkeypatch.setattr(settings, "SMTP_PORT", free_port)
    monkeypatch.setattr(settings, "SMTP_TLS", False)
    monkeypatch.setattr(settings, "SMTP_TIMEOUT_SECONDS", 2.0)
    with pytest.raises((OSError, smtplib.SMTPException)):
        SmtpTransport().send(
            build_message(recipient="x@example.com", rendered=RENDERED)
        )


# --- Mailpit (compose / CI) ---------------------------------------------------

MAILPIT_API = os.environ.get("MAILPIT_API", "http://localhost:8025")


def _mailpit_up() -> bool:
    try:
        with urllib.request.urlopen(f"{MAILPIT_API}/api/v1/info", timeout=1):
            return True
    except OSError:
        return False


@pytest.mark.skipif(not _mailpit_up(), reason="Mailpit is not running")
def test_mailpit_receives_the_invite(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SMTP_HOST", "localhost")
    monkeypatch.setattr(settings, "SMTP_PORT", 1025)
    monkeypatch.setattr(settings, "SMTP_TLS", False)
    monkeypatch.setattr(settings, "SMTP_SSL", False)
    monkeypatch.setattr(settings, "SMTP_USER", None)
    marker = uuid.uuid4().hex[:12]
    rendered = RenderedEmail(
        subject=f"VR Inspector mailpit check {marker}",
        html=f"<p>{marker}</p>",
        text=marker,
    )
    SmtpTransport().send(build_message(recipient="mp@example.com", rendered=rendered))
    url = f"{MAILPIT_API}/api/v1/search?query=subject:{marker}"
    with urllib.request.urlopen(url, timeout=5) as response:
        found = json.load(response)
    assert found["messages_count"] >= 1


def test_app_public_url_defaults_to_frontend_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "APP_PUBLIC_URL", None)
    monkeypatch.setattr(settings, "FRONTEND_HOST", "http://localhost:5173/")
    assert settings.app_public_url == "http://localhost:5173"
    monkeypatch.setattr(settings, "APP_PUBLIC_URL", "https://app.vri.example.com/")
    assert settings.app_public_url == "https://app.vri.example.com"
