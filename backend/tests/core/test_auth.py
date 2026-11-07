import time

import httpx
import pytest
from jwt.exceptions import InvalidTokenError

from app.core import auth
from app.core.auth import AuthUser, JWKSCache, UserInfoCache, extract_user_info
from app.core.config import settings
from tests.utils.auth0 import DEFAULT_EMAIL, DEFAULT_SUB, FakeTenant


def test_display_name_prefers_name_then_email_then_sub() -> None:
    assert AuthUser(sub="s", email="e@x.com", name="N").display_name == "N"
    assert AuthUser(sub="s", email="e@x.com").display_name == "e@x.com"
    assert AuthUser(sub="s").display_name == "s"


def test_extract_user_info_matches_legacy_contract(tenant: FakeTenant) -> None:
    user = auth.user_from_token(tenant.token())
    info = extract_user_info(user)
    # Legacy routers do: info.get("email") or info.get("sub") or "inspector"
    assert info["email"] == DEFAULT_EMAIL
    assert info["sub"] == DEFAULT_SUB
    assert set(info) == {"sub", "email", "name", "picture", "permissions"}


def test_user_from_token_scopes_and_claims(tenant: FakeTenant) -> None:
    user = auth.user_from_token(tenant.token())
    assert user.scopes == ["openid", "profile", "email"]
    assert user.claims["iss"] == settings.auth0_issuer
    assert user.permissions == []


def test_user_from_token_ignores_malformed_permissions(tenant: FakeTenant) -> None:
    user = auth.user_from_token(
        tenant.token(extra_claims={"permissions": "read:all", "scope": 42})
    )
    assert user.permissions == []
    assert user.scopes == []


def test_userinfo_fallback_can_be_disabled(
    tenant: FakeTenant, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "AUTH0_USERINFO_FALLBACK", False)
    tenant.userinfo = {"email": "should-not-be-used@example.com"}
    user = auth.user_from_token(tenant.token(email=None))
    assert user.email is None
    assert tenant.userinfo_fetches == 0


def test_decode_rejects_token_without_kid(tenant: FakeTenant) -> None:
    import jwt

    token = jwt.encode(
        {
            "iss": settings.auth0_issuer,
            "sub": "x",
            "aud": settings.AUTH0_API_AUDIENCE,
            "iat": int(time.time()),
            "exp": int(time.time()) + 60,
        },
        tenant.private_pem(),
        algorithm="RS256",
    )
    with pytest.raises(InvalidTokenError, match="key id"):
        auth.decode_token(token)


def test_decode_wraps_jwks_fetch_errors(tenant: FakeTenant) -> None:
    def boom(_url: str) -> dict[str, object]:
        raise httpx.ConnectError("no route to tenant")

    auth.jwks_cache._fetch = boom  # type: ignore[assignment]
    with pytest.raises(InvalidTokenError, match="signing keys"):
        auth.decode_token(tenant.token())


def test_decode_rejects_malformed_jwks(tenant: FakeTenant) -> None:
    auth.jwks_cache._fetch = lambda _url: {"keys": []}  # type: ignore[assignment]
    with pytest.raises(InvalidTokenError):
        auth.decode_token(tenant.token())


def test_jwks_cache_refreshes_after_ttl(tenant: FakeTenant) -> None:
    cache = JWKSCache("https://unit.test/jwks", ttl_seconds=0, fetch=tenant.fetch_jwks)
    cache.get_signing_key(tenant.kid)
    cache.get_signing_key(tenant.kid)
    assert tenant.jwks_fetches == 2


def test_jwks_cache_serves_from_cache_within_ttl(tenant: FakeTenant) -> None:
    cache = JWKSCache(
        "https://unit.test/jwks", ttl_seconds=3600, fetch=tenant.fetch_jwks
    )
    key1 = cache.get_signing_key(tenant.kid)
    key2 = cache.get_signing_key(tenant.kid)
    assert key1.key_id == key2.key_id == tenant.kid
    assert tenant.jwks_fetches == 1


def test_jwks_cache_picks_up_rotated_key(tenant: FakeTenant) -> None:
    cache = JWKSCache(
        "https://unit.test/jwks", ttl_seconds=3600, fetch=tenant.fetch_jwks
    )
    old_kid = tenant.kid
    cache.get_signing_key(old_kid)
    tenant.rotate_key()
    assert cache.get_signing_key(tenant.kid).key_id == tenant.kid
    with pytest.raises(InvalidTokenError, match="Unknown signing key"):
        cache.get_signing_key(old_kid)


def test_jwks_cache_ignores_encryption_keys() -> None:
    tenant = FakeTenant()
    enc = tenant.jwk()
    enc["use"] = "enc"
    cache = JWKSCache("https://unit.test/jwks", 3600, fetch=lambda _u: {"keys": [enc]})
    with pytest.raises(InvalidTokenError):
        cache.get_signing_key(tenant.kid)


def test_userinfo_cache_evicts_expired_entries() -> None:
    calls: list[str] = []

    def fetch(_url: str, token: str) -> dict[str, object]:
        calls.append(token)
        return {"email": f"{token}@example.com"}

    cache = UserInfoCache("https://unit.test/userinfo", fetch=fetch)
    assert cache.lookup("t1", expires_at=time.time() - 1)["email"] == "t1@example.com"
    # Expired entry is evicted on the next lookup, so t1 is fetched again.
    assert cache.lookup("t1", expires_at=time.time() + 60)["email"] == "t1@example.com"
    assert cache.lookup("t1", expires_at=time.time() + 60)["email"] == "t1@example.com"
    assert calls == ["t1", "t1"]


def test_http_get_json_rejects_non_object(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get(url: str, headers: dict[str, str], timeout: float) -> httpx.Response:
        assert timeout == auth.HTTP_TIMEOUT_SECONDS
        assert headers == {"Authorization": "Bearer tok"}
        return httpx.Response(200, json=[1, 2], request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", fake_get)
    with pytest.raises(ValueError):
        auth._http_get_json("https://unit.test/x", "tok")


def test_http_get_json_returns_object(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get(url: str, headers: dict[str, str], timeout: float) -> httpx.Response:
        assert timeout == auth.HTTP_TIMEOUT_SECONDS
        assert headers == {}
        return httpx.Response(200, json={"keys": []}, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", fake_get)
    assert auth._http_get_json("https://unit.test/x") == {"keys": []}
