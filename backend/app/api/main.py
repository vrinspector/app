from fastapi import APIRouter

from app.api.routes import (
    dashboard,
    drawings,
    findings,
    inspections,
    photos,
    projects,
    users,
    utils,
)

api_router = APIRouter()
api_router.include_router(users.router)
api_router.include_router(utils.router)
# Increment 04 — Block 1–8C route port (legacy shapes under /api/v1/)
api_router.include_router(projects.router)
api_router.include_router(inspections.router)
api_router.include_router(findings.router)
api_router.include_router(photos.router)
api_router.include_router(dashboard.router)
# Increment 05 — Block 8D/8E drawings + pins (authorization hardening carried over)
api_router.include_router(drawings.router)
