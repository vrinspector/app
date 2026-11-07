from typing import Any
from unittest.mock import patch

import pytest

from app import utils
from app.core.config import settings


def test_generate_test_email_renders_template() -> None:
    data = utils.generate_test_email(email_to="someone@example.com")
    assert data.subject == f"{settings.PROJECT_NAME} - Test email"
    assert settings.PROJECT_NAME in data.html_content
    assert "someone@example.com" in data.html_content


def test_send_email_requires_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SMTP_HOST", None)
    with pytest.raises(AssertionError):
        utils.send_email(email_to="someone@example.com")


@pytest.mark.parametrize(
    ("tls", "ssl", "expected_key"),
    [(True, False, "tls"), (False, True, "ssl"), (False, False, None)],
)
def test_send_email_builds_smtp_options(
    monkeypatch: pytest.MonkeyPatch, tls: bool, ssl: bool, expected_key: str | None
) -> None:
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "EMAILS_FROM_EMAIL", "noreply@example.com")
    monkeypatch.setattr(settings, "SMTP_TLS", tls)
    monkeypatch.setattr(settings, "SMTP_SSL", ssl)
    monkeypatch.setattr(settings, "SMTP_USER", "mailer")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "mailer-password")

    sent: dict[str, Any] = {}

    class FakeMessage:
        def __init__(self, **kwargs: Any) -> None:
            sent["message"] = kwargs

        def send(self, *, to: str, smtp: dict[str, Any]) -> str:
            sent["to"] = to
            sent["smtp"] = smtp
            return "ok"

    with patch.object(utils.emails.message, "Message", FakeMessage):
        utils.send_email(
            email_to="someone@example.com", subject="Hi", html_content="<p>x</p>"
        )

    assert sent["to"] == "someone@example.com"
    assert sent["message"]["subject"] == "Hi"
    assert sent["smtp"]["host"] == "smtp.example.com"
    assert sent["smtp"]["user"] == "mailer"
    assert sent["smtp"]["password"] == "mailer-password"
    for key in ("tls", "ssl"):
        assert (key in sent["smtp"]) == (key == expected_key)
