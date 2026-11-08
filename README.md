# VR Inspector — Application (Rebuild)

Field inspection SaaS for construction QA/QC: projects, inspections, findings, photos, drawings with page-aware inspection pins, and reports. Owned by Field Inspect LLC.

This repository is the **Phase 2 rebuild** of the VR Inspector application, per **PRD v2.63 / ADR-009** (reuse-first open-source stack). It replaces the legacy single-file SPA in `vrinspector/frontend` and the legacy deploy flow. The legacy repos remain as history.

## Stack

- **Backend:** FastAPI (Python), SQLModel/SQLAlchemy, Alembic, PostgreSQL
- **Frontend:** Vite + React + TypeScript, shadcn/ui + Tailwind
- **Infra:** Docker Compose (dev), GitHub Actions (CI), AWS (RDS, S3, Lightsail), Auth0
- **Base:** scaffolded from the official [full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) (template docs preserved at `docs/TEMPLATE_README.md`; see `development.md` for local dev)

## How work proceeds

- `REBUILD_PLAN.md` is the single source of truth for increment order and status.
- `docs/PARITY_CHECKLIST.md` is the side-by-side checklist (legacy staging SPA vs this app) that gates the legacy retirement (increment 11); the result columns are filled in by the owner.
- One increment per branch (`rebuild/NN-slug`), one PR per increment, reviewed and merged by the owner.
- **No deployment to staging or production until release gate RG-1 evidence is recorded** (PRD v2.63 §8).
- API compatibility rule: external prefix stays `/api/v1/`; INTEGER PKs; S3-only file storage (Hard Rules 4–8).
- Identity: Auth0 only (OIDC code flow + PKCE on the frontend, RS256 JWT validation against the tenant JWKS on the backend). No local users table; `sub` is the identity anchor. See `development.md` for local sign-in setup.

## Authoritative documents

PRD v2.63, the Rebuild Stack Decision Brief (2026-11-05), and the July 16, 2026 transfer package (Dropbox, `Projects_and_Engineering/VR_Inspector/`). Where records conflict, later deployment evidence controls.
