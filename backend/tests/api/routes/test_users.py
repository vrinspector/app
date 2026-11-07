import time

from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.auth0 import DEFAULT_EMAIL, DEFAULT_NAME, DEFAULT_SUB, FakeTenant

ME = f"{settings.API_V1_STR}/users/me"


def test_me_with_valid_token(client: TestClient, tenant: FakeTenant) -> None:
    r = client.get(ME, headers=tenant.auth_headers())
    assert r.status_code == 200
    body = r.json()
    assert body == {
        "sub": DEFAULT_SUB,
        "email": DEFAULT_EMAIL,
        "name": DEFAULT_NAME,
        "picture": None,
        "permissions": [],
    }


def test_me_carries_permissions_and_picture(
    client: TestClient, tenant: FakeTenant
) -> None:
    headers = tenant.auth_headers(
        extra_claims={
            "permissions": ["read:projects", "write:findings"],
            "picture": "https://cdn.example.com/avatar.png",
        }
    )
    r = client.get(ME, headers=headers)
    assert r.status_code == 200
    assert r.json()["permissions"] == ["read:projects", "write:findings"]
    assert r.json()["picture"] == "https://cdn.example.com/avatar.png"


def test_me_without_token_is_401(client: TestClient) -> None:
    r = client.get(ME)
    assert r.status_code == 401
    assert r.headers["WWW-Authenticate"] == "Bearer"
    assert r.json() == {"detail": "Not authenticated"}


def test_me_with_non_bearer_scheme_is_401(client: TestClient) -> None:
    r = client.get(ME, headers={"Authorization": "Basic dXNlcjpwYXNz"})
    assert r.status_code == 401
    assert r.headers["WWW-Authenticate"] == "Bearer"


def test_me_with_garbage_token_is_401(client: TestClient) -> None:
    r = client.get(ME, headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401
    assert r.json() == {"detail": "Could not validate credentials"}


def test_me_with_expired_token_is_401(client: TestClient, tenant: FakeTenant) -> None:
    headers = tenant.auth_headers(issued_at=time.time() - 3600, expires_in=600)
    r = client.get(ME, headers=headers)
    assert r.status_code == 401


def test_me_with_wrong_audience_is_401(client: TestClient, tenant: FakeTenant) -> None:
    r = client.get(ME, headers=tenant.auth_headers(audience="https://other.api"))
    assert r.status_code == 401


def test_me_with_wrong_issuer_is_401(client: TestClient, tenant: FakeTenant) -> None:
    r = client.get(ME, headers=tenant.auth_headers(issuer="https://evil.example.net/"))
    assert r.status_code == 401


def test_me_with_token_from_unknown_key_is_401(
    client: TestClient, tenant: FakeTenant
) -> None:
    other = FakeTenant()
    r = client.get(ME, headers=other.auth_headers())
    assert r.status_code == 401
    # The backend refetched the JWKS once looking for the unknown kid.
    assert tenant.jwks_fetches == 2


def test_me_with_hs256_token_is_401(client: TestClient, tenant: FakeTenant) -> None:
    # A symmetric token signed with the public key material must be rejected
    # (classic algorithm-confusion attack).
    forged = tenant.token(algorithm="HS256", key="not-the-private-key")
    r = client.get(ME, headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401


def test_me_without_sub_claim_is_401(client: TestClient, tenant: FakeTenant) -> None:
    r = client.get(ME, headers=tenant.auth_headers(omit=("sub",)))
    assert r.status_code == 401


def test_me_accepts_audience_list(client: TestClient, tenant: FakeTenant) -> None:
    headers = tenant.auth_headers(
        audience=[settings.AUTH0_API_AUDIENCE, settings.auth0_issuer + "userinfo"]
    )
    r = client.get(ME, headers=headers)
    assert r.status_code == 200


def test_me_email_from_namespaced_claim(client: TestClient, tenant: FakeTenant) -> None:
    headers = tenant.auth_headers(
        email=None,
        name=None,
        extra_claims={
            settings.AUTH0_EMAIL_CLAIM: "claim@example.com",
            "https://vrinspector.com/name": "Claim Name",
        },
    )
    r = client.get(ME, headers=headers)
    assert r.status_code == 200
    assert r.json()["email"] == "claim@example.com"
    assert r.json()["name"] == "Claim Name"
    assert tenant.userinfo_fetches == 0


def test_me_email_from_userinfo_fallback_is_cached(
    client: TestClient, tenant: FakeTenant
) -> None:
    tenant.userinfo = {
        "sub": DEFAULT_SUB,
        "email": "userinfo@example.com",
        "name": "From Userinfo",
        "picture": "https://cdn.example.com/u.png",
    }
    token = tenant.token(email=None, name=None)
    headers = {"Authorization": f"Bearer {token}"}
    for _ in range(2):
        r = client.get(ME, headers=headers)
        assert r.status_code == 200
        assert r.json()["email"] == "userinfo@example.com"
        assert r.json()["name"] == "From Userinfo"
        assert r.json()["picture"] == "https://cdn.example.com/u.png"
    assert tenant.userinfo_fetches == 1


def test_me_userinfo_failure_still_authenticates(
    client: TestClient, tenant: FakeTenant
) -> None:
    tenant.userinfo_error = RuntimeError("auth0 down")
    r = client.get(ME, headers=tenant.auth_headers(email=None, name=None))
    assert r.status_code == 200
    assert r.json()["sub"] == DEFAULT_SUB
    assert r.json()["email"] is None


def test_health_check_is_public(client: TestClient) -> None:
    r = client.get(f"{settings.API_V1_STR}/utils/health-check/")
    assert r.status_code == 200
    assert r.json() is True
