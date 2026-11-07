from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app.core import auth
from app.main import app
from tests.utils.auth0 import FakeTenant


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


@pytest.fixture(scope="module")
def client() -> Generator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def user_token_headers(tenant: FakeTenant) -> dict[str, str]:
    return tenant.auth_headers()
