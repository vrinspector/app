"""Offline stand-in for the Auth0 tenant used by the test-suite.

Generates an RSA key pair once per test session, publishes it as a JWKS
document (what the backend would fetch from
``https://{AUTH0_DOMAIN}/.well-known/jwks.json``) and mints access tokens that
look exactly like Auth0-issued ones. No network access is involved.
"""

import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from app.core.config import settings

DEFAULT_SUB = "auth0|test-inspector-0001"
DEFAULT_EMAIL = "inspector@example.com"
DEFAULT_NAME = "Test Inspector"


@dataclass
class FakeTenant:
    kid: str = field(default_factory=lambda: f"kid-{uuid.uuid4().hex[:12]}")
    private_key: Any = field(
        default_factory=lambda: rsa.generate_private_key(
            public_exponent=65537, key_size=2048
        )
    )
    jwks_fetches: int = 0
    userinfo_fetches: int = 0
    userinfo: dict[str, Any] = field(default_factory=dict)
    userinfo_error: Exception | None = None

    # --- JWKS -----------------------------------------------------------
    def jwk(self, kid: str | None = None) -> dict[str, Any]:
        public_jwk = RSAAlgorithm.to_jwk(self.private_key.public_key(), as_dict=True)
        public_jwk.update({"kid": kid or self.kid, "use": "sig", "alg": "RS256"})
        return public_jwk

    def jwks(self) -> dict[str, Any]:
        return {"keys": [self.jwk()]}

    def fetch_jwks(self, _url: str) -> dict[str, Any]:
        self.jwks_fetches += 1
        return self.jwks()

    def fetch_userinfo(self, _url: str, _token: str) -> dict[str, Any]:
        self.userinfo_fetches += 1
        if self.userinfo_error is not None:
            raise self.userinfo_error
        return dict(self.userinfo)

    def rotate_key(self) -> None:
        self.kid = f"kid-{uuid.uuid4().hex[:12]}"
        self.private_key = rsa.generate_private_key(
            public_exponent=65537, key_size=2048
        )

    # --- tokens ---------------------------------------------------------
    def private_pem(self) -> bytes:
        return self.private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

    def token(
        self,
        *,
        sub: str = DEFAULT_SUB,
        email: str | None = DEFAULT_EMAIL,
        name: str | None = DEFAULT_NAME,
        audience: str | list[str] | None = None,
        issuer: str | None = None,
        expires_in: int = 600,
        issued_at: float | None = None,
        kid: str | None = None,
        algorithm: str = "RS256",
        key: Any = None,
        extra_claims: dict[str, Any] | None = None,
        omit: tuple[str, ...] = (),
    ) -> str:
        now = issued_at if issued_at is not None else time.time()
        claims: dict[str, Any] = {
            "iss": issuer if issuer is not None else settings.auth0_issuer,
            "sub": sub,
            "aud": audience if audience is not None else settings.AUTH0_API_AUDIENCE,
            "iat": int(now),
            "exp": int(now) + expires_in,
            "scope": "openid profile email",
        }
        if email is not None:
            claims["email"] = email
        if name is not None:
            claims["name"] = name
        if extra_claims:
            claims.update(extra_claims)
        for claim in omit:
            claims.pop(claim, None)
        headers = {"kid": kid or self.kid}
        signing_key = key if key is not None else self.private_pem()
        return jwt.encode(claims, signing_key, algorithm=algorithm, headers=headers)

    def auth_headers(self, **kwargs: Any) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token(**kwargs)}"}
