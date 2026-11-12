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

    # --- ITP starter library (increment 13.7) ---
    # Seed the starter master templates (app/itp-library.json) the first time
    # an account with no masters lists them. Off only in tests that need an
    # empty list.
    ITP_STARTER_LIBRARY: bool = True

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

    # --- External sign-off (increment 14) ---
    # How long a no-account signing link works (PRD v2.63 §5: 14 days).
    SIGN_LINK_DAYS: int = 14
    # A link can be reminded (re-issued) at most once per this many seconds,
    # and a witness notice for the same line re-sent at most this often.
    SIGN_REMINDER_COOLDOWN_SECONDS: int = 60
    # Automatic reminders (``python -m app.sign_reminders``, run on a schedule
    # set up at RG-3): remind after this many days without a signature, at
    # most this many times per role and document.
    SIGN_REMINDER_AFTER_DAYS: int = 3
    SIGN_REMINDER_MAX: int = 2
    # Render the sign-off pack in the background after every signature, so the
    # signed version is in S3 straight away. Off only in tests that do not
    # look at packs (rendering takes a second).
    ITP_PACK_AUTOREGENERATE: bool = True

    # --- AI capture assistance (increment 15; Block 10A / 10B) ---
    # Claude API key for the contracted model API. Supplied by the environment
    # at RG-3 — never committed. Without it every AI button is hidden and the
    # /ai routes answer 503; the rest of the app is unaffected.
    ANTHROPIC_API_KEY: str | None = None
    ANTHROPIC_API_URL: str = "https://api.anthropic.com/v1/messages"
    # Model alias asked for; the exact version that answered is logged per
    # suggestion. Change here (environment) when a newer model is adopted.
    AI_MODEL: str = "claude-sonnet-4-5"
    AI_TIMEOUT_SECONDS: float = 30.0
    # Long edge (pixels) of the copy of a photo sent for analysis.
    AI_IMAGE_MAX_EDGE: int = 1568
    # Cost guard for a low-budget project: drafts one person may ask for per
    # UTC day (photo + voice together). 0 switches the cap off.
    AI_DAILY_LIMIT_PER_USER: int = 200
    # Longest transcript accepted for voice-to-finding (characters).
    AI_MAX_TRANSCRIPT_CHARS: int = 4000

    @computed_field  # type: ignore[prop-decorator]
    @property
    def ai_enabled(self) -> bool:
        return bool(self.ANTHROPIC_API_KEY)

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
