import warnings
from typing import Literal, Self

from pydantic import (
    EmailStr,
    HttpUrl,
    PostgresDsn,
    computed_field,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Use top level .env file (one level above ./backend/)
        env_file="../.env",
        env_ignore_empty=True,
        extra="ignore",
    )
    API_V1_STR: str = "/api/v1"
    FRONTEND_HOST: str = "http://localhost:5173"
    FASTAPI_ENV: Literal["development"] | None = None

    PROJECT_NAME: str
    SENTRY_DSN: HttpUrl | None = None
    DATABASE_URL: PostgresDsn

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def _use_psycopg_driver(cls, value: str | PostgresDsn) -> str:
        database_url = str(value)
        for scheme in ("postgres://", "postgresql://"):
            if database_url.startswith(scheme):
                return database_url.replace(scheme, "postgresql+psycopg://", 1)
        return database_url

    # --- Auth0 (identity provider; Hard Rule: Auth0 `sub` is the identity anchor) ---
    # Tenant domain, e.g. "example.us.auth0.com" (no scheme, no trailing slash).
    AUTH0_DOMAIN: str
    # API identifier registered in Auth0 ("audience" of access tokens).
    # The legacy backend used the env key AUTH0_API_AUDIENCE; keep the same name.
    AUTH0_API_AUDIENCE: str
    # Optional override, e.g. for a custom domain. Defaults to https://{AUTH0_DOMAIN}/
    AUTH0_ISSUER: str | None = None
    AUTH0_ALGORITHMS: list[str] = ["RS256"]
    # Seconds to cache the tenant JWKS before refreshing.
    AUTH0_JWKS_CACHE_SECONDS: int = 3600
    # Namespaced custom claim an Auth0 Action may use to copy the email into the
    # access token (access tokens for an API do not carry `email` by default).
    AUTH0_EMAIL_CLAIM: str = "https://vrinspector.com/email"
    # If the access token carries no email claim, look it up at /userinfo
    # (result cached per token until the token expires).
    AUTH0_USERINFO_FALLBACK: bool = True

    @computed_field  # type: ignore[prop-decorator]
    @property
    def auth0_issuer(self) -> str:
        if self.AUTH0_ISSUER:
            return self.AUTH0_ISSUER
        return f"https://{self.AUTH0_DOMAIN}/"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def auth0_jwks_url(self) -> str:
        return f"https://{self.AUTH0_DOMAIN}/.well-known/jwks.json"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def auth0_userinfo_url(self) -> str:
        return f"https://{self.AUTH0_DOMAIN}/userinfo"

    # --- S3 (Hard Rule 8: file storage is S3 only) ---
    # Bucket and region are configuration, not secrets. AWS credentials come
    # from the runtime (instance role / env vars) and are never in the repo.
    S3_BUCKET: str = "vrinspector-files"
    AWS_REGION: str = "us-east-1"
    # Lifetimes of presigned URLs (seconds), as deployed on staging.
    S3_PRESIGN_PUT_SECONDS: int = 600
    S3_PRESIGN_GET_SECONDS: int = 3600

    # --- Weather (Block 5, increment 10.5): Open-Meteo, free, no API key ---
    WEATHER_GEOCODING_URL: str = "https://geocoding-api.open-meteo.com/v1/search"
    WEATHER_FORECAST_URL: str = "https://api.open-meteo.com/v1/forecast"
    WEATHER_TIMEOUT_SECONDS: float = 4.0
    # Readings are cached in process per location; Open-Meteo updates every
    # 15 minutes, so ten minutes keeps a crew's repeated opens to one call.
    WEATHER_CACHE_SECONDS: int = 600

    # --- Outbound email (increment 13.5; Block 7.1 pulled forward) ---
    # One SMTP service for every email the app sends. Production target is
    # AWS SES over SMTP (host email-smtp.<region>.amazonaws.com, port 587,
    # STARTTLS, SES SMTP credentials) — all supplied by the environment at
    # RG-3; nothing real is ever committed. Local dev and CI use Mailpit (the
    # maintained MailCatcher successor) on port 1025 without TLS. With no
    # SMTP_HOST / EMAILS_FROM_EMAIL the app still works: each email is logged
    # with status "skipped" instead of being sent.
    SMTP_TLS: bool = True
    SMTP_SSL: bool = False
    SMTP_PORT: int = 587
    SMTP_HOST: str | None = None
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_TIMEOUT_SECONDS: float = 10.0
    EMAILS_FROM_EMAIL: EmailStr | None = None
    EMAILS_FROM_NAME: str | None = None
    # Optional Reply-To (e.g. a monitored support inbox).
    EMAILS_REPLY_TO: EmailStr | None = None
    # Optional SES configuration set (bounce / complaint tracking); sent as the
    # X-SES-CONFIGURATION-SET header only when set.
    SES_CONFIGURATION_SET: str | None = None
    # Public address of the web app, used for links inside emails. Defaults to
    # FRONTEND_HOST.
    APP_PUBLIC_URL: str | None = None
    # A member's invite email can be re-sent at most once per this many seconds.
    INVITE_RESEND_COOLDOWN_SECONDS: int = 60

    @computed_field  # type: ignore[prop-decorator]
    @property
    def app_public_url(self) -> str:
        return (self.APP_PUBLIC_URL or self.FRONTEND_HOST).rstrip("/")

    @model_validator(mode="after")
    def _set_default_emails_from(self) -> Self:
        if not self.EMAILS_FROM_NAME:
            self.EMAILS_FROM_NAME = self.PROJECT_NAME
        return self

    @computed_field  # type: ignore[prop-decorator]
    @property
    def emails_enabled(self) -> bool:
        return bool(self.SMTP_HOST and self.EMAILS_FROM_EMAIL)

    def _check_default_secret(self, var_name: str, value: str | None) -> None:
        if value == "changethis":
            message = (
                f'The value of {var_name} is "changethis", '
                "for security, please change it, at least for deployments."
            )
            if self.FASTAPI_ENV == "development":
                warnings.warn(message, stacklevel=1)
            else:
                raise ValueError(message)

    def _check_placeholder(self, var_name: str, value: str) -> None:
        if "changethis" in value or "example" in value:
            message = (
                f"The value of {var_name} is a placeholder ({value!r}). "
                "Set it to the real Auth0 value for deployments."
            )
            if self.FASTAPI_ENV == "development":
                warnings.warn(message, stacklevel=1)
            else:
                raise ValueError(message)

    @model_validator(mode="after")
    def _enforce_non_default_secrets(self) -> Self:
        for host in self.DATABASE_URL.hosts():
            self._check_default_secret("DATABASE_URL password", host["password"])
        self._check_placeholder("AUTH0_DOMAIN", self.AUTH0_DOMAIN)
        self._check_placeholder("AUTH0_API_AUDIENCE", self.AUTH0_API_AUDIENCE)
        return self


settings = Settings()  # type: ignore # ty: ignore[unused-ignore-comment]
