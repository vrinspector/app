"""Auth0 access-token verification.

VR Inspector has no local users table. Identity comes from Auth0:

* the frontend obtains an access token for the API audience through the
  OIDC authorization-code flow (PKCE) and sends it as ``Authorization: Bearer``;
* this module verifies the token offline against the tenant's JSON Web Key Set
  (JWKS), checking signature, expiry, issuer and audience;
* the token's ``sub`` claim is the identity anchor (Hard Rule); ``email`` is
  carried for display and for the legacy ``project_members.user_email`` checks.

Only the JWKS document (public keys) is fetched from Auth0, and it is cached.
"""

import hashlib
import logging
import threading
import time
from collections.abc import Callable
from typing import Any

import httpx
import jwt
from jwt import PyJWK, PyJWKSet
from jwt.exceptions import InvalidTokenError, PyJWKSetError
from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger(__name__)

HTTP_TIMEOUT_SECONDS = 5.0


class AuthUser(BaseModel):
    """The verified caller. ``sub`` is the only guaranteed identifier."""

    sub: str
    email: str | None = None
    name: str | None = None
    picture: str | None = None
    permissions: list[str] = Field(default_factory=list)
    scopes: list[str] = Field(default_factory=list)
    claims: dict[str, Any] = Field(default_factory=dict, repr=False)

    @property
    def display_name(self) -> str:
        return self.name or self.email or self.sub


def extract_user_info(user: AuthUser) -> dict[str, Any]:
    """Legacy-compatible view used by ported routers.

    The July 2026 staging routers call ``extract_user_info(current_user)`` and
    read ``.get("email") or .get("sub")``. Keep that contract so the port in
    increments 04–05 is mechanical.
    """
    return {
        "sub": user.sub,
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
        "permissions": list(user.permissions),
    }


class JWKSCache:
    """Fetches and caches the tenant JWKS; refreshes on expiry or unknown ``kid``."""

    def __init__(
        self,
        url: str,
        ttl_seconds: int,
        fetch: Callable[[str], dict[str, Any]] | None = None,
    ) -> None:
        self._url = url
        self._ttl = ttl_seconds
        self._fetch = fetch or _http_get_json
        self._lock = threading.Lock()
        self._jwks: PyJWKSet | None = None
        self._fetched_at = 0.0

    def clear(self) -> None:
        with self._lock:
            self._jwks = None
            self._fetched_at = 0.0

    def _refresh(self) -> PyJWKSet:
        data = self._fetch(self._url)
        jwks = PyJWKSet.from_dict(data)
        self._jwks = jwks
        self._fetched_at = time.monotonic()
        return jwks

    def _current(self) -> PyJWKSet:
        if self._jwks is None or time.monotonic() - self._fetched_at > self._ttl:
            return self._refresh()
        return self._jwks

    def get_signing_key(self, kid: str) -> PyJWK:
        with self._lock:
            jwks = self._current()
            key = _find_key(jwks, kid)
            if key is None:
                # Key rotation: refetch once before giving up.
                jwks = self._refresh()
                key = _find_key(jwks, kid)
            if key is None:
                raise InvalidTokenError("Unknown signing key")
            return key


def _find_key(jwks: PyJWKSet, kid: str) -> PyJWK | None:
    for key in jwks.keys:
        if key.key_id == kid and key.public_key_use in (None, "sig"):
            return key
    return None


def _http_get_json(url: str, token: str | None = None) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    response = httpx.get(url, headers=headers, timeout=HTTP_TIMEOUT_SECONDS)
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError("Unexpected JSON payload")
    return data


class UserInfoCache:
    """Per-token cache of ``/userinfo`` lookups (used only when the access token
    carries no email claim). Entries expire with the token."""

    def __init__(
        self,
        url: str,
        fetch: Callable[[str, str], dict[str, Any]] | None = None,
    ) -> None:
        self._url = url
        self._fetch = fetch or _http_get_json
        self._lock = threading.Lock()
        self._entries: dict[str, tuple[float, dict[str, Any]]] = {}

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def lookup(self, token: str, expires_at: float) -> dict[str, Any]:
        key = hashlib.sha256(token.encode()).hexdigest()
        now = time.time()
        with self._lock:
            self._evict(now)
            cached = self._entries.get(key)
            if cached is not None:
                return cached[1]
        try:
            info = self._fetch(self._url, token)
        except Exception:  # network/HTTP problems must not break auth
            logger.warning("Auth0 /userinfo lookup failed", exc_info=True)
            info = {}
        with self._lock:
            self._entries[key] = (expires_at, info)
        return info

    def _evict(self, now: float) -> None:
        expired = [k for k, (exp, _) in self._entries.items() if exp <= now]
        for k in expired:
            del self._entries[k]


jwks_cache = JWKSCache(settings.auth0_jwks_url, settings.AUTH0_JWKS_CACHE_SECONDS)
userinfo_cache = UserInfoCache(settings.auth0_userinfo_url)


def decode_token(token: str) -> dict[str, Any]:
    """Verify an Auth0 access token and return its claims.

    Raises ``jwt.exceptions.InvalidTokenError`` (or a subclass) on any failure.
    """
    header = jwt.get_unverified_header(token)
    alg = header.get("alg")
    if alg not in settings.AUTH0_ALGORITHMS:
        raise InvalidTokenError("Unsupported token algorithm")
    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        raise InvalidTokenError("Token has no key id")
    try:
        signing_key = jwks_cache.get_signing_key(kid)
    except (PyJWKSetError, ValueError, httpx.HTTPError) as exc:
        raise InvalidTokenError("Unable to load signing keys") from exc
    claims: dict[str, Any] = jwt.decode(
        token,
        signing_key.key,
        algorithms=settings.AUTH0_ALGORITHMS,
        audience=settings.AUTH0_API_AUDIENCE,
        issuer=settings.auth0_issuer,
        options={"require": ["exp", "iat", "sub"]},
    )
    return claims


def _first_str(claims: dict[str, Any], *names: str) -> str | None:
    for name in names:
        value = claims.get(name)
        if isinstance(value, str) and value:
            return value
    return None


def user_from_token(token: str) -> AuthUser:
    """Verify ``token`` and build the :class:`AuthUser` for the request."""
    claims = decode_token(token)
    namespace = settings.AUTH0_EMAIL_CLAIM.rsplit("/", 1)[0]
    email = _first_str(claims, "email", settings.AUTH0_EMAIL_CLAIM)
    name = _first_str(claims, "name", f"{namespace}/name")
    picture = _first_str(claims, "picture", f"{namespace}/picture")

    if email is None and settings.AUTH0_USERINFO_FALLBACK:
        info = userinfo_cache.lookup(token, float(claims["exp"]))
        email = _first_str(info, "email")
        name = name or _first_str(info, "name")
        picture = picture or _first_str(info, "picture")

    permissions = claims.get("permissions")
    scope = claims.get("scope")
    return AuthUser(
        sub=str(claims["sub"]),
        email=email,
        name=name,
        picture=picture,
        permissions=[str(p) for p in permissions]
        if isinstance(permissions, list)
        else [],
        scopes=scope.split() if isinstance(scope, str) else [],
        claims=claims,
    )
