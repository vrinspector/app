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
| finding_id | INTEGER NULL FK → findings SET NULL, indexed (migration `d5a1b7c3e902`) | rebuild (increment 11a: a photo taken in the capture loop is filed under its finding; site photos stay NULL) |
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
| itp_item_id | INTEGER FK → itp_items SET NULL, indexed | rebuild — increment 12, the drawing-anchored hold point |

### inspection_reports (rebuild, increment 10 — migration `c4e8f2a7b911`)

Not a legacy table: the deployed `POST /reports/generate` wrote a PDF to S3
and returned a presigned URL without recording it. The rebuild keeps every
generated report as a numbered version (ADR-009 "versions kept in S3").
Purely additive; the migration skips the table if it already exists and the
downgrade refuses to drop it while it holds rows.

| Column | Type | Source |
|---|---|---|
| id | SERIAL PK | rebuild |
| public_id | UUID | rebuild |
| inspection_id | INTEGER FK → inspections CASCADE, indexed | rebuild |
| version | INTEGER NOT NULL; unique (inspection_id, version) | rebuild — 1, 2, 3 … per inspection |
| s3_key | VARCHAR(512) NOT NULL (`reports/inspections/{inspection_id}/v{n}-{uuid}.pdf`) | rebuild |
| filename | VARCHAR(255) NOT NULL (download name) | rebuild |
| file_size | BIGINT | rebuild |
| finding_count, photo_count | INTEGER NOT NULL default 0 (what the PDF covers) | rebuild |
| generated_by | VARCHAR(255) (verified Auth0 email) | rebuild |
| created_at | TIMESTAMPTZ | rebuild |

`LEGACY_TABLES` in `app/models.py` names the seven tables above that exist
on the live database; `DOMAIN_TABLES` adds this one and the ITP tables below.

## Block 9.5 — ITP / hold points and Areas (increment 12, migration `e7c2a9f4b613`)

Eight new tables (PRD v2.63 §5, owner decision 2026-11-08 for Areas) and one
new nullable column on `inspection_pins`. Purely additive on the live database.
Routes and screens: increment 13 (`docs/API_PORT.md`, `docs/SCREENS.md`). `id` (SERIAL PK) and
`public_id` (UUID) are on every table and omitted below.

| Table | Purpose | Columns |
|---|---|---|
| `project_areas` | Level / lot / stage / chainage of a project | `project_id` (CASCADE), `parent_area_id` (self, SET NULL), `name`, `area_type` (level, lot, stage, chainage, other), `sort_order`, `created_by`, timestamps |
| `itp_templates` | Master ITP, one row per version | `template_key` (groups the versions), `version` (unique per key), `name`, `description`, `status` (draft, published, archived), `body` (SurveyJS JSON), `created_by`, `created_by_sub`, timestamps |
| `project_itps` | Frozen copy for a project, optionally one area | `project_id` (CASCADE), `area_id` (SET NULL), `template_id` (SET NULL), `template_version`, `title`, `status` (not_started, in_progress, complete, voided), `body` (copied at import), `pack_s3_key`, `pack_version`, `created_by`, timestamps |
| `itp_items` | One checklist line | `project_itp_id` (CASCADE), `section`, `element_name` (SurveyJS element in `body`), `requirement`, `classification` (hold, witness, surveillance, record; required, no default), `status` (pending, pass, fail, na), `notes`, `sort_order`, timestamps |
| `signoff_roles` | Role on a project | `project_id` (CASCADE), `role_name` (unique per project), `party` (contractor, client, engineer), `signer_email`, `created_at` |
| `itp_item_required_roles` | Which roles an item needs | `itp_item_id` (CASCADE), `signoff_role_id` (CASCADE), unique together |
| `external_sign_tokens` | No-account signing link | `token_hash` (SHA-256 hex, unique, must be 64 characters), `project_itp_id` / `area_id` (CASCADE; exactly one set), `signoff_role_id` (CASCADE), `signer_email`, `expires_at` (default 14 days), `used_at`, `revoked`, `created_by`, `created_at` |
| `itp_signatures` | One stamped signature | `project_itp_id` (CASCADE), `itp_item_id` (CASCADE; NULL = whole pack), `signoff_role_id` and `external_token_id` (SET NULL), `role_name` and `party` (copied), `signer_name`, `signer_email`, `signer_sub`, `method` (in_app, external_link), `signed_at`, `gps_lat`, `gps_lng`, `weather` (JSONB), `signature_s3_key` |

`itp_item_required_roles` is not named in the plan's list: PRD §5 gives an item
"required sign-off roles", and a link table lets "every required role has
signed" be an ordinary query with real foreign keys.

Rules the database enforces:

* **Frozen copies.** `project_itps.body` is its own JSON, so editing or deleting
  a master cannot reach it. Editing a master adds the next `version`.
* **At most one area.** `project_itps.area_id` is a single nullable column.
* **Signed evidence cannot be deleted piecemeal.** `BEFORE DELETE` triggers
  (`vri_guard_area_delete`, `vri_guard_project_itp_delete`,
  `vri_guard_itp_item_delete`) refuse with `restrict_violation` (IntegrityError)
  to delete an area with a signed ITP, an ITP with any signature, or an item with
  a signature. Deleting the whole **project** still cascades: each guard first
  checks that the parent still exists, and in a cascade it no longer does.
  This is why the ITP tables have no ORM `Relationship`s: an ORM cascade deletes
  children while the parent still exists and would trip the guard.
* **Tokens are stored only as a hash**, and every token opens exactly one ITP or
  one area.

Enforced in the API layer (increment 13; external tokens in 14), like `photos.finding_id` and the
value vocabularies: an ITP's area, an area's parent, a role and a pin's item
must belong to the same project; no parent-area cycles; a role that items still
require cannot be deleted (it would quietly clear the hold point); a hold point
blocks completion until every required role has signed.

Decisions for the owner (non-blocking; say if any should change):

35. **Masters belong to the account that created them.** PRD §5 says
    "company-level", but the app has no company record, so the template list in
    increment 13 is per account until one exists.
36. **Sign-off roles are per project**, not per ITP, so "Client engineer" and
    their email are entered once and reused across all 40 lots.
37. **Deleting an area with only unsigned ITPs keeps them** as whole-project
    ITPs rather than deleting them. Child areas move to the top level.
38. **Deleting a whole project still deletes its signed ITPs**, as it deletes
    everything else today. If signed records should stop a project being
    deleted, that is a small change to the guards.

## Outbound email send log (increment 13.5, migration `f3b8d1c6a425`)

`email_send_log` — one row per email the app tries to send. Additive and
idempotent; downgrade refuses while rows exist.

| Column | Notes |
|---|---|
| `id`, `public_id` | INTEGER PK + UUID, as everywhere |
| `project_id` | FK `projects.id` **ON DELETE SET NULL** — the log outlives the project |
| `email_type` | `member_invite`; increment 14 adds `sign_request`, `sign_reminder` and `witness_notice` (`related_id` = the link, or the ITP line for a notice) |
| `related_id` | the row the email is about (the member for an invite); no FK, so removing the member keeps the history |
| `recipient`, `subject` | what was sent and to whom — the body is never stored |
| `status` | `queued` → `sent` / `failed`; `skipped` when SMTP is not configured (check constraint) |
| `message_id` | the SMTP `Message-ID` we generated, to trace an SES bounce back to the row |
| `error` | failure reason (≤ 500 chars), never credentials |
| `triggered_by` | the signed-in email that caused the send |
| `created_at`, `updated_at`, `sent_at` | timestamps |

## ITP line evidence (increment 13.6, migration `a9d4c2e7f318`)

| Table | Column | Type | Notes |
|---|---|---|---|
| itp_items | acceptance_criteria | text NULL | From the template question's `acceptanceCriteria` |
| itp_items | reference_doc | varchar(255) NULL | `reference` |
| itp_items | record_required | text NULL | `recordRequired` |
| itp_items | photo_required | boolean NOT NULL DEFAULT false | `photoRequired`; Pass and sign-off need a photo on file |
| itp_items | value_type | varchar(10) NULL | `number` / `text`; NULL = result only |
| itp_items | value_unit | varchar(40) NULL | e.g. in, psi, °F |
| itp_items | value_min / value_max | double precision NULL | Number lines only; outside → `out_of_tolerance` |
| itp_items | measured_value | text NULL | As entered (numbers normalised, `1,250.0` → `1250`) |
| photos | itp_item_id | integer NULL FK → itp_items ON DELETE CASCADE, indexed | Evidence photo of one line |
| photos | inspection_id | now NULL-able | Check `ck_photos_one_parent`: `num_nonnulls(inspection_id, itp_item_id) = 1` |

`itp_items.classification` values renamed: `surveillance` → `information`,
`record` → `review` (now hold / witness / review / information). Template
bodies are not rewritten; the parser still reads the old words.

Upgrade is idempotent and every existing row stays valid. Downgrade refuses
while any photo is ITP evidence or any line holds a measured value, otherwise
maps the classification words back and drops the added columns.

## ITP document numbers + three-shot photos (increment 13.8, migration `b2e6f9c4d817`)

Additive and guarded (idempotent upgrade; the downgrade refuses while any
project has a code, any line asks for the three-shot set or any photo fills a
slot).

| Table | Column | Type | Notes |
| --- | --- | --- | --- |
| `projects` | `code` | VARCHAR(20) NULL | Owner-set PROJECT CODE for ITP numbers; NULL → derived from the name (`app/core/doc_numbers.py`). Returned with the effective `itp_code`. |
| `project_itps` | `seq` | INTEGER NULL, UNIQUE (`project_id`, `seq`) | 1, 2, 3 … per project; given at creation with the project row locked; existing ITPs backfilled in creation order. `doc_number` = `ITP-<itp_code>-<seq, 3 digits>` is computed, not stored. |
| `itp_items` | `photo_set` | VARCHAR(20) NULL | `three_shot` when the template question sets `photoSet`; the line is evidenced only with a Context, Intermediate and Close-up photo. |
| `photos` | `shot_slot` | VARCHAR(20) NULL, CHECK `ck_photos_shot_slot` | `context` / `intermediate` / `closeup`, only on ITP line photos. |
| `photos` | `captured_at` | TIMESTAMPTZ NULL | When the device says the picture was taken (the file in S3 keeps its own EXIF). |

## ITP release lines (increment 13.9, migration `c6f1a8d3e529`)

Additive and guarded (idempotent upgrade; the downgrade refuses while any line
is a release line or carries conditions). The result itself stays in
`itp_items.status` (`pass` / `fail`), so hold points, completion and sign-off
rules are unchanged.

| Table | Column | Type | Notes |
| --- | --- | --- | --- |
| `itp_items` | `result_scale` | VARCHAR(20) NULL | `release` when the template question sets `resultScale: "release"`: recorded as Approved / Approved with conditions / Rejected instead of Pass / Fail / N/A. |
| `itp_items` | `approved_label` | VARCHAR(60) NULL | The approval's wording on that line (`approvedLabel`, e.g. "Approved to pour"). |
| `itp_items` | `conditions` | TEXT NULL | The written conditions of "Approved with conditions"; only while `status = 'pass'`. |

## Not ported (by design)

* `voice_notes` (Block 1) — the deployed SPA uses browser speech recognition
  only; no route reads or writes the table. Revisit with Block 10B.
* Weather — the SPA calls `GET /weather?location&inspection_id`; no stored
  schema is evidenced. The route is ported in increment 10.5 as a lookup
  with an in-process cache (`app/core/weather.py`), still with no table; a
  stored reading per inspection can follow if the real dump shows one.


## External sign-off (increment 14, migration `d8b3f5a2c614`)

Additive and guarded (downgrade refuses while pack versions or link history
exist):

| Table | Change |
|---|---|
| `external_sign_tokens` | + `revoked_at` (timestamptz), `revoked_reason` (`withdrawn` / `replaced`), `reminder_count` (int, default 0). A reminder issues a new row and marks the old one `replaced`: the raw token is never stored, so it cannot be re-sent |
| `itp_sign_packs` (new) | one row per generated pack PDF: `project_itp_id` / `area_id` (CASCADE; exactly one set — `ck_itp_sign_packs_one_document`), `version` (unique per document, two partial unique indexes), `s3_key`, `filename`, `file_size`, `content_hash` (SHA-256 of what the PDF shows), `signature_count`, `generated_by`, `created_at` |

Existing increment-12 columns now in use: `itp_signatures.weather` (the stamp),
`signature_s3_key` (the drawn PNG in S3), `external_token_id`, `method =
external_link`; a row with `itp_item_id` NULL is the signer's signature on the
pack. `project_itps.pack_s3_key` / `pack_version` follow the latest ITP pack.
Deleting an unsigned ITP or an area removes its pack rows; the PDFs stay in S3.

## Drawing revisions (increment 14.5, migration `e4a7c9b2d816`)

Additive and guarded (downgrade refuses while a drawing is superseded or a
pin was carried from another revision):

| Table | Change |
|---|---|
| `drawings` | + `series_id` (int, indexed, no FK so the group survives deleting its first row; backfilled to `id`), `revision` (varchar 20, upper-case label, NULL = never labelled), `superseded_at` (timestamptz, NULL = current); partial unique index `uq_drawings_series_current` — one current revision per sheet |
| `inspection_pins` | + `carried_from_pin_id` (FK `inspection_pins.id` ON DELETE SET NULL, indexed), `position_check` (bool, default false), `position_confirmed_by` (varchar 255), `position_confirmed_at` (timestamptz) |

A new revision is a new `drawings` row in the same series; the previous row
gets `superseded_at` and keeps its pins untouched. Pins on the new row are
copies (`created_by` and links kept, `created_at` new).
