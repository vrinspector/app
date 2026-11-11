from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core import auth
from app.core.config import settings
from app.core.db import engine
from app.core.email import MemoryTransport, mailer
from app.core.storage import storage
from app.main import app
from app.models import DOMAIN_TABLES
from tests.utils.auth0 import FakeTenant
from tests.utils.s3 import FakeS3


@pytest.fixture(scope="session")
def tenant() -> FakeTenant:
    """One fake Auth0 tenant (RSA key pair + JWKS) for the whole session."""
    return FakeTenant()


@pytest.fixture(autouse=True)
def offline_auth0(tenant: FakeTenant) -> Generator[FakeTenant]:
    """Route the backend's JWKS / userinfo lookups to the fake tenant.

    Tests never reach the network: the JWKS cache and userinfo cache are
    re-pointed at in-memory stubs and reset around every test.
    """
    auth.jwks_cache._fetch = tenant.fetch_jwks  # type: ignore[assignment]
    auth.userinfo_cache._fetch = tenant.fetch_userinfo  # type: ignore[assignment]
    auth.jwks_cache.clear()
    auth.userinfo_cache.clear()
    tenant.jwks_fetches = 0
    tenant.userinfo_fetches = 0
    tenant.userinfo = {}
    tenant.userinfo_error = None
    yield tenant
    auth.jwks_cache.clear()
    auth.userinfo_cache.clear()


@pytest.fixture(autouse=True)
def fake_s3() -> Generator[FakeS3]:
    """Presigned URLs and deletes go to an in-memory recorder, never to AWS."""
    fake = FakeS3()
    storage.use_client(fake)
    yield fake
    storage.use_client(None)


@pytest.fixture(autouse=True)
def outbox() -> Generator[MemoryTransport]:
    """Outbound email goes to an in-memory outbox, never to an SMTP server."""
    transport = MemoryTransport()
    mailer.use_transport(transport)
    yield transport
    mailer.use_transport(None)


@pytest.fixture(autouse=True)
def no_starter_library(monkeypatch: pytest.MonkeyPatch) -> None:
    """Accounts start empty in tests; the starter-library tests switch it on."""
    monkeypatch.setattr(settings, "ITP_STARTER_LIBRARY", False)


@pytest.fixture(autouse=True)
def no_background_packs(monkeypatch: pytest.MonkeyPatch) -> None:
    """Signatures do not render packs in the background unless a test asks."""
    monkeypatch.setattr(settings, "ITP_PACK_AUTOREGENERATE", False)


@pytest.fixture(autouse=True)
def offline_weather() -> Generator[None]:
    """The signature weather stamp never reaches Open-Meteo in tests.

    The weather service answers 503, so a stamp is simply omitted; tests that
    want a reading install their own transport (``tests/utils/weather.py``).
    """
    import httpx

    from app.core.weather import weather

    weather.use_transport(httpx.MockTransport(lambda request: httpx.Response(503)))
    yield
    weather.use_transport(None)


@pytest.fixture(autouse=True)
def clean_domain_tables() -> Generator[None]:
    """API tests commit real rows; wipe the domain tables after each test."""
    yield
    with engine.begin() as conn:
        conn.execute(
            text("TRUNCATE " + ", ".join(DOMAIN_TABLES) + " RESTART IDENTITY CASCADE")
        )


@pytest.fixture(scope="module")
def client() -> Generator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def user_token_headers(tenant: FakeTenant) -> dict[str, str]:
    return tenant.auth_headers()
