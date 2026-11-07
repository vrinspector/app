from typing import Any

from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.models import UserPublic

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserPublic)
def read_user_me(current_user: CurrentUser) -> Any:
    """
    Return the caller's identity as verified from the Auth0 access token.

    There is no local users table; `sub` is the identity anchor and `email`
    is for display (and the legacy membership checks).
    """
    return UserPublic(
        sub=current_user.sub,
        email=current_user.email,
        name=current_user.name,
        picture=current_user.picture,
        permissions=current_user.permissions,
    )
