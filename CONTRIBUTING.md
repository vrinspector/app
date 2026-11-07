# Contributing

VR Inspector is developed by Field Inspect LLC. This repository is the Phase 2 rebuild of the application (PRD v2.63 / ADR-009).

## How changes are made

- `REBUILD_PLAN.md` is the single source of truth for what gets built and in what order. Work on the first unchecked increment only.
- One increment per branch (`rebuild/NN-slug`) and one pull request per increment, titled `Increment NN: <name>`, with a summary and test evidence.
- Continuous integration must be green before a pull request is merged.
- No secrets in the repository — placeholders only.
- No deployment to staging or production from this repository until release gate RG-1 evidence is recorded. Deploys are owner actions.

## Local checks

See [development.md](./development.md) for local setup. Before opening a pull request:

```bash
# Formatting, linting, type checks and generated-client freshness
uv run prek run --all-files

# Backend tests (needs the local Postgres from Docker Compose)
cd backend && uv run bash scripts/tests-start.sh

# Frontend build
bun run --filter frontend build
```

## Questions

Open a GitHub issue on this repository describing the question in plain language.
