from collections.abc import Generator
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError
from sqlmodel import Session

from app.core.auth import AuthUser, user_from_token
from app.core.db import engine

# auto_error=False so we control the 401 shape and the WWW-Authenticate header.
bearer_scheme = HTTPBearer(auto_error=False, description="Auth0 access token")

UNAUTHENTICATED_HEADERS = {"WWW-Authenticate": "Bearer"}


def get_db() -> Generator[Session]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]
CredentialsDep = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]


def get_current_user(request: Request, credentials: CredentialsDep) -> AuthUser:
    """Resolve the caller from the ``Authorization: Bearer`` header.

    401 for a missing, malformed or expired token, or one with the wrong
    issuer or audience.
    Authorization (project membership) is a separate concern handled per route
    with 404 object-hiding, as in the legacy routers.
    """
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers=UNAUTHENTICATED_HEADERS,
        )
    try:
        user = user_from_token(credentials.credentials)
    except InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers=UNAUTHENTICATED_HEADERS,
        )
    request.state.user = user
    return user


CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
