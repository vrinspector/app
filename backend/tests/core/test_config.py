import pytest

from app.core.config import Settings

BASE = {
    # scripts/test.sh exports FASTAPI_ENV=development; be explicit per test.
    "FASTAPI_ENV": None,
    "PROJECT_NAME": "VR Inspector",
    "DATABASE_URL": "postgresql://postgres:strong-password@localhost:5432/app",
    "AUTH0_DOMAIN": "tenant.us.auth0.com",
    "AUTH0_API_AUDIENCE": "https://api.vrinspector.com",
}


def test_auth0_urls_are_derived_from_domain() -> None:
    s = Settings(_env_file=None, **BASE)  # type: ignore[call-arg]
    assert s.auth0_issuer == "https://tenant.us.auth0.com/"
    assert s.auth0_jwks_url == "https://tenant.us.auth0.com/.well-known/jwks.json"
    assert s.auth0_userinfo_url == "https://tenant.us.auth0.com/userinfo"
    assert str(s.DATABASE_URL).startswith("postgresql+psycopg://")


def test_auth0_issuer_override() -> None:
    s = Settings(_env_file=None, AUTH0_ISSUER="https://login.vrinspector.com/", **BASE)  # type: ignore[call-arg]
    assert s.auth0_issuer == "https://login.vrinspector.com/"


def test_placeholder_auth0_values_rejected_outside_development() -> None:
    with pytest.raises(ValueError, match="AUTH0_DOMAIN"):
        Settings(_env_file=None, **{**BASE, "AUTH0_DOMAIN": "example.us.auth0.com"})  # type: ignore[call-arg]
    with pytest.raises(ValueError, match="AUTH0_API_AUDIENCE"):
        Settings(_env_file=None, **{**BASE, "AUTH0_API_AUDIENCE": "https://changethis"})  # type: ignore[call-arg]


def test_placeholder_auth0_values_warn_in_development() -> None:
    with pytest.warns(UserWarning, match="AUTH0_DOMAIN"):
        Settings(  # type: ignore[call-arg]
            _env_file=None,
            **{
                **BASE,
                "FASTAPI_ENV": "development",
                "AUTH0_DOMAIN": "example.us.auth0.com",
            },
        )


def test_default_database_password_rejected_outside_development() -> None:
    with pytest.raises(ValueError, match="DATABASE_URL password"):
        Settings(  # type: ignore[call-arg]
            _env_file=None,
            **{
                **BASE,
                "DATABASE_URL": "postgresql://postgres:changethis@localhost:5432/app",
            },
        )


def test_emails_enabled_requires_host_and_sender() -> None:
    s = Settings(_env_file=None, **BASE)  # type: ignore[call-arg]
    assert s.emails_enabled is False
    assert s.EMAILS_FROM_NAME == "VR Inspector"
    s = Settings(
        _env_file=None,
        SMTP_HOST="smtp.example.com",
        EMAILS_FROM_EMAIL="noreply@example.com",
        **BASE,
    )  # type: ignore[call-arg]
    assert s.emails_enabled is True
