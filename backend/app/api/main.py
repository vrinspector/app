from fastapi import APIRouter

from app.api.routes import users, utils

api_router = APIRouter()
api_router.include_router(users.router)
api_router.include_router(utils.router)
