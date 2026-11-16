# Offline sync (PowerSync) — rebuild increment 18

PRD v2.63 Block 11 / ADR-009: phones and tablets keep a local SQLite copy of
the projects their user belongs to, so an inspector can keep working with no
signal. [PowerSync](https://docs.powersync.com) (self-hosted open edition)
streams the database's changes down to each device; the app's own upload
queue sends the device's changes back through the existing `/api/v1/`
endpoints, so the API stays the only thing that writes to the database.

```
PostgreSQL ──logical replication──▶ PowerSync service ──sync streams──▶ phone (SQLite)
    ▲                                                                       │
    └──────────── FastAPI /api/v1/ (all authorization) ◀── upload queue ────┘
```

| File | What |
|---|---|
| `sync-config.yaml` | Which rows sync to whom (Sync Streams, edition 3). One rule: every synced row of every project the person is a member of (`project_members.user_sub` = the token's `sub`). |
| `service.yaml` | The service's settings. Every per-environment or secret value comes from the environment (`!env`); nothing secret is committed. |
| `validate.ts` | `bun run validate:sync` (from `frontend/`): compiles the sync config with the exact sync-rules engine the pinned image ships and checks `service.yaml` against the service's JSON schema. Runs in CI. |
| `../backend/app/alembic/versions/a1f6c3d9e715_powersync_publication.py` | Creates the `powersync` publication for exactly the synced tables. |
| `../frontend/src/lib/sync/` | Client: local schema, Auth0 credentials, upload queue → API. |

## What syncs

Projects, members (email and role), inspections, findings, photo records
(the file stays in S3; the offline photo queue is increment 19), drawings
(records; the sheet itself is fetched as today), pins, areas, project ITPs,
ITP lines and sign-off roles.

Never synced: Auth0 subs, presigned URLs, signing-link tokens, signatures and
sign packs, AI prompt logs, email logs, master templates.

## What can be changed offline

Inspections (create, edit, delete), findings (create, edit, status, resolve,
delete), pins (create, move, edit, delete) and ITP line results (result,
notes, measured value, conditions). Each change is replayed against the same
endpoint the screen uses online, in the order it was made; a change the API
refuses (for example the inspection was signed off in the meantime) is kept
in the device's `upload_rejections` list with the API's reason instead of
blocking everything behind it. Sign-offs and signatures always need a
connection.

**On screen (increment 19).** With no connection, *Log / Edit finding* and
*place / move pin* write to the local copy (`src/lib/sync/localWrites.ts`);
those rows show "Not uploaded yet" until the queue empties. The header chip
shows Offline / N waiting / Syncing… / Synced and opens the sync panel with
**Sync now** and the **sync history** (`sync_audit`, local-only): every
uploaded change, refused ones with the API's reason, and edits that replaced
a newer server change (last write wins — the queue checks the server's
`updated_at` for findings and inspections first and keeps the replaced
values). Photos taken offline are not queued yet (follow-up issue).

## Running it locally

```bash
# 1. Postgres with logical replication (compose.yml already sets wal_level).
docker compose up -d db
# 2. The publication (part of the normal migrations).
cd backend && uv run alembic upgrade head && cd ..
# 3. The sync service (profile "offline"; its bucket storage is a separate
#    database, created on first start).
docker compose --profile offline up -d powersync
# 4. Point the frontend at it.
echo 'VITE_POWERSYNC_URL=http://localhost:8095' >> frontend/.env
```

Sign in as usual: the app hands PowerSync the same Auth0 access token the API
accepts. Without `VITE_POWERSYNC_URL` nothing PowerSync-related is built or
loaded and the app works exactly as before.

## Owner actions at RG-3 (never done by the automated sessions)

1. **Database (RDS):** set `rds.logical_replication = 1` in the parameter
   group (needs a reboot) and create a replication role for PowerSync:
   `CREATE ROLE powersync_repl WITH LOGIN PASSWORD '…'; GRANT rds_replication TO powersync_repl; GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_repl;`
2. **Publication:** created by the migration. If the migration log says
   "Publication powersync not created", run as the tables' owner:
   `CREATE PUBLICATION powersync FOR TABLE projects, project_members, inspections, findings, photos, drawings, inspection_pins, project_areas, project_itps, itp_items, signoff_roles;`
3. **Bucket storage:** an empty PostgreSQL database (same RDS instance is
   fine, separate database), e.g. `powersync_storage`.
4. **Service:** run `journeyapps/powersync-service:1.27.2` beside the API
   with `powersync/` mounted at `/config` and these variables:
   `PS_DATA_SOURCE_URI`, `PS_DATA_SOURCE_SSLMODE` (`verify-full` on RDS),
   `PS_STORAGE_URI`, `PS_STORAGE_SSLMODE`, `PS_PORT`,
   `PS_AUTH0_JWKS_URI` (`https://<tenant>/.well-known/jwks.json`),
   `PS_AUTH0_AUDIENCE` (the API identifier). Publish it behind Nginx on its
   own hostname (e.g. `sync.vrinspector.com`) with WebSocket upgrade allowed.
5. **Frontend build:** `VITE_POWERSYNC_URL=https://sync.vrinspector.com`.
