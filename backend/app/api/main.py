from fastapi import APIRouter

from app.api.routes import (
    ai,
    areas,
    dashboard,
    drawings,
    emails,
    findings,
    inspections,
    itps,
    photos,
    projects,
    reports,
    signoff,
    users,
    utils,
    weather,
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
# Increment 10 — Block 4 inspection reports (PDF versions in S3)
api_router.include_router(reports.router)
# Increment 10.5 — Block 5 weather badge (Open-Meteo lookup, no key)
api_router.include_router(weather.router)
# Increment 13 — Block 9.5 ITP templates, project ITPs, sign-off roles, Areas
api_router.include_router(itps.router)
api_router.include_router(areas.router)
# Increment 13.5 — outbound email: send log + invite resend (Block 7.1)
api_router.include_router(emails.router)
# Increment 14 — external sign-off links, sign-off packs, witness notices
api_router.include_router(signoff.router)
# Increment 15 — Block 10A photo analysis + 10B voice-to-finding (Claude API)
api_router.include_router(ai.router)
