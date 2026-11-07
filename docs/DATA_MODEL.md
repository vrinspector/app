# VR Inspector — Data model (increment 03)

The rebuild's SQLModel tables live in `backend/app/models.py`; the Alembic
baseline that creates or reconciles them is
`backend/app/alembic/versions/b7d3e9a1c204_data_layer_baseline.py`.

Hard Rules applied (PRD v2.63 §3): INTEGER primary keys with an added external
`public_id` (UUID); Auth0 identity with **no users table** (attribution
columns hold the Auth0 email, exactly as the live schema does); S3-only file
storage (tables hold S3 keys only); API prefix unchanged.

## How the baseline behaves on the live database

The legacy Block 1–8E tables on staging were created without Alembic. The
baseline is therefore *reconciling*, not destructive:

| Database | What `alembic upgrade head` does |
|---|---|
| Fresh (CI, local Compose, new environment) | Creates all seven tables from the frozen definitions. |
| Live staging/production (tables already exist) | Adds only what is missing — `public_id` (back-filled per row with `gen_random_uuid()`), `project_members.user_sub`, `photos.content_type`, indexes, and the `public_id` unique constraints. Existing columns, types and rows are left exactly as they are. |

`alembic downgrade` refuses to drop a domain table that holds rows, so an
accidental downgrade on a live database stops instead of destroying records.

Tested in `backend/tests/alembic/test_data_layer_baseline.py` against an empty
database and against `backend/app/alembic/legacy/staging_schema_reconstructed.sql`
with sample rows. Both end states have **no autogenerate diff** against the
models (ignoring the column comment and the legacy constraint's name).

## Owner action: replace the reconstructed schema with the real one

`staging_schema_reconstructed.sql` is a *reconstruction*, not a dump. To close
the increment 03 acceptance criterion ("applies cleanly to a copy of the real
schema") against the real DDL, replace that file with the output of

```bash
pg_dump --schema-only --no-owner --no-privileges "$DATABASE_URL_SYNC" \
  > backend/app/alembic/legacy/staging_schema_reconstructed.sql
```

run from the staging server (it contains table definitions only — no data, no
secrets), then run the backend test suite. If the dump shows different column
names or types for the five inferred tables, adjust `models.py` and the
baseline's `_columns()` to match the live DDL (the legacy SQL is the spec).

## Column provenance

Legend — **verified**: byte-exact from the deployed router / migration or the
PRD v2.59 "deployed" schema tables; **contract**: name taken from the deployed
SPA's request/response fields (type and length are the rebuild's assumption);
**rebuild**: added by increment 03 for the Phase 2 baseline.

### projects

| Column | Type | Source |
|---|---|---|
| id | SERIAL PK | contract (`p.id`) |
| public_id | UUID, unique, default `gen_random_uuid()` | rebuild |
| name | VARCHAR(255) NOT NULL | contract |
| client | VARCHAR(255) | contract |
| location | VARCHAR(255) | contract |
| status | VARCHAR(20) NOT NULL default `active` (`active`/`on_hold`/`complete`) | contract |
| created_by | VARCHAR(255) (Auth0 email / display name) | contract (POST body) |
| created_at, updated_at | TIMESTAMPTZ NOT NULL default `now()` | contract / legacy pattern |

### project_members

| Column | Type | Source |
|---|---|---|
| id | SERIAL PK | contract (`m.id`) |
| public_id | UUID | rebuild |
| project_id | INTEGER FK → projects ON DELETE CASCADE | verified (router join) |
| user_email | VARCHAR(255) NOT NULL | **verified** — the deployed drawings router joins `project_members.user_email` |
| user_sub | VARCHAR(255) NULL, indexed | rebuild — Auth0 `sub` anchor, filled as members sign in |
| role | VARCHAR(20) NOT NULL default `inspector` (`owner`/`inspector`/`viewer`) | contract |
| invited_by | VARCHAR(255) | contract (assumed) |
| created_at | TIMESTAMPTZ | legacy pattern |
| unique (project_id, user_email) | | contract (one membership per email) |

### inspections

| Column | Type | Source |
|---|---|---|
| id | SERIAL PK | contract |
| public_id | UUID | rebuild |
| project_id | INTEGER FK → projects CASCADE | contract (`?project_id=`) |
| title | VARCHAR(255) NOT NULL | contract |
| inspection_type | VARCHAR(30) (`civil`/`structural`/`mechanical`/`electrical`/`piping`/`general`) | contract (POST sends `inspection_type`; the list card reads `type` — the port in increment 04 returns both) |
| inspector | VARCHAR(255) | contract |
| notes | TEXT | contract |
| status | VARCHAR(20) NOT NULL default `open` | contract (POST) |
| inspection_status | VARCHAR(20) NOT NULL default `open` (`open`/`closed`, Block 8B sign-off) | contract (`inspection_status === 'closed'`) |
| signed_off_by | VARCHAR(255) | contract |
| signed_off_at | TIMESTAMPTZ | contract |
| created_at, updated_at | TIMESTAMPTZ | contract / legacy pattern |

### findings

| Column | Type | Source |
|---|---|---|
| id | SERIAL PK | contract |
| public_id | UUID | rebuild |
| inspection_id | INTEGER FK → inspections CASCADE | contract |
| title | VARCHAR(255) NOT NULL | contract |
| description | TEXT | contract |
| priority | VARCHAR(10) NOT NULL default `medium` (`high`/`medium`/`low`) | contract |
| location_ref | VARCHAR(255) | contract |
| status | VARCHAR(20) NOT NULL default `open` (`open`/`in-progress`/`resolved`) | contract |
| resolved_by | VARCHAR(255) | contract |
| resolved_at | TIMESTAMPTZ | contract |
| resolution_notes | TEXT | contract |
| created_at, updated_at | TIMESTAMPTZ | legacy pattern |

### photos

| Column | Type | Source |
|---|---|---|
| id | SERIAL PK | contract |
| public_id | UUID | rebuild |
| inspection_id | INTEGER FK → inspections CASCADE | contract |
| s3_key | VARCHAR(512) NOT NULL (`photos/…`, S3 only) | contract |
| filename | VARCHAR(255) | contract |
| content_type | VARCHAR(100) | rebuild (presign request carries it) |
| uploaded_by | VARCHAR(255) | contract |
| created_at | TIMESTAMPTZ | legacy pattern |

`view_url` on photo responses is a presigned S3 GET URL generated by the API,
not a stored column.

### drawings — verified (PRD v2.59 deployed schema + Block 8E)

| Column | Type | Source |
|---|---|---|
| id | SERIAL PK | verified |
| public_id | UUID | rebuild |
| project_id | INTEGER FK → projects CASCADE | verified |
| title | VARCHAR(255) NOT NULL | verified |
| drawing_number | VARCHAR(100) | verified |
| discipline | VARCHAR(30) NOT NULL default `general` | verified (router default) |
| filename | VARCHAR(255) NOT NULL | verified |
| s3_key | VARCHAR(512) NOT NULL (`drawings/projects/{project_id}/{uuid}{ext}`) | verified |
| file_type | VARCHAR(16) NOT NULL default `png` | verified |
| file_size | BIGINT | verified (router INSERT column; type assumed) |
| view_url, thumbnail_url | TEXT | verified |
| page_width_pts, page_height_pts | NUMERIC | **verified** — Block 8E migration |
| uploaded_by | VARCHAR(255) | verified |
| created_at, updated_at | TIMESTAMPTZ default `now()` | verified |

### inspection_pins — verified (PRD v2.59 deployed schema + Block 8E)

| Column | Type | Source |
|---|---|---|
| id | SERIAL PK | verified |
| public_id | UUID | rebuild |
| drawing_id | INTEGER FK → drawings CASCADE | verified |
| finding_id | INTEGER FK → findings SET NULL | verified |
| tag_number | VARCHAR(100) | verified |
| label | VARCHAR(255) | verified |
| x_pct, y_pct | NUMERIC(6,3) NOT NULL (0–100, zoom-independent) | verified |
| status | VARCHAR(20) NOT NULL default `not_started` | verified (router default) |
| notes | TEXT | verified |
| discipline_data | JSONB | verified |
| page_number | INTEGER NOT NULL default 1 (+ byte-exact column comment) | **verified** — Block 8E migration |
| created_by | VARCHAR(255) | verified |
| created_at | TIMESTAMPTZ | verified |

## Not ported (by design)

* `voice_notes` (Block 1) — the deployed SPA uses browser speech recognition
  only; no route reads or writes the table. Revisit with Block 10B.
* Weather — the SPA calls `GET /weather?location&inspection_id`; no stored
  schema is evidenced. Increment 04 ports the route; a cache table can follow
  if the real dump shows one.
* Block 9.5 ITP tables, `inspection_pins.itp_item_id` — increment 12.
