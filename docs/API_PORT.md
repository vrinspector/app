# VR Inspector — API port (increment 04)

Increment 04 ports the Block 1–8C routes the deployed single-file SPA calls —
projects, members, inspections, findings, photos, and the dashboard roll-up —
from the legacy raw-SQL routers to SQLModel, under the `/api/v1/` prefix
(Hard Rule 7). Request bodies and response fields are the ones the deployed
SPA (`staging_index_with_help_private.html`, July 16, 2026) sends and reads;
responses return every table column, as the legacy `dict(row)` did, so the
rebuild's `public_id` rides along.

Only the drawings router survived in source form (`vrinspector/backend`,
`staging_snapshot_20260716/`). For the five routers ported here the **SPA's
call sites are the contract** and the drawings router is the **behavioural
template** (membership checks, 404 object-hiding, server-side attribution,
project-bound S3 keys). Where behaviour had to be inferred it is marked
*inferred* below and listed under "Decisions for the owner".

## Routes

| Legacy call (SPA) | Rebuild | Notes |
|---|---|---|
| `GET /api/dashboard` | `GET /api/v1/dashboard` | `summary`, `projects[]`, `recent_inspections[]` as the SPA renders them |
| `GET /api/projects` | `GET /api/v1/projects` | caller's projects, newest first |
| `POST /api/projects` | `POST /api/v1/projects` → 201 | creator becomes the `owner` member |
| — | `GET/PUT/DELETE /api/v1/projects/{id}` | PUT/DELETE owner-only; DELETE cascades |
| `GET /api/projects/{id}/members` | same under `/api/v1` | rows carry `email` (SPA) and `user_email` (column) |
| `POST /api/projects/{id}/members` `{email, role}` | same → 201 | owner-only; email normalized; duplicate → 409 |
| `DELETE /api/projects/{id}/members/{mid}` | same → 204 | owner-only; owners cannot be removed (400) |
| `GET /api/inspections?project_id=N` | same under `/api/v1` | each row carries `type` *and* `inspection_type` |
| `POST /api/inspections` | same → 201 | |
| `GET /api/inspections/{id}` | same | |
| — | `PUT/DELETE /api/v1/inspections/{id}` | |
| `PATCH /api/inspections/{id}/signoff` | same | Block 8B: `inspection_status`=`closed`, `signed_off_by/at` stamped |
| `PATCH /api/inspections/{id}/reopen` | same | clears the stamp |
| `GET /api/findings?inspection_id=N` | same under `/api/v1` | |
| `POST /api/findings` | same → 201 | 409 while the inspection is signed off |
| — | `GET/PUT/DELETE /api/v1/findings/{id}` | |
| `PATCH /api/findings/{id}/status` `{status}` | same | Block 8A: open / in-progress / resolved |
| `PATCH /api/findings/{id}/resolve` `{resolution_notes}` | same | stamps `resolved_by/at` |
| `POST /api/photos/presign` | same under `/api/v1` | `{upload_url, s3_key}`; key bound to the inspection |
| `POST /api/photos` | same → 201 | key must be under the inspection's prefix (else 404) |
| `GET /api/photos?inspection_id=N` | same | each row carries a presigned `view_url` |
| — | `GET/DELETE /api/v1/photos/{id}` | DELETE removes the S3 object best-effort |

Not in this increment: `GET /api/weather` (Open-Meteo lookup) and
`POST /api/reports/generate` (PDF to S3). They have no increment in
`REBUILD_PLAN.md`; see the tracking issue opened with the increment 04 PR.
Drawings and pins are increment 05.

## Authorization (carried over from the July 2026 hardening)

* Every object is reached through its project; non-members get **404** with
  the legacy `detail` strings (`Project not found`, `Inspection not found`,
  `Finding not found`, `Photo not found`, `Member not found`).
* Membership matches on `project_members.user_sub` when set, otherwise on
  the Auth0 email exactly as the legacy SQL did (`user_email`, case-
  insensitive). The first time an email-matched member is seen with a
  verified `sub`, the `sub` is recorded — so the identity anchor (Hard Rule 4 /
  PowerSync precondition) fills in as people sign in, with no data migration.
* Attribution columns (`created_by`, `uploaded_by`, `signed_off_by`,
  `resolved_by`, `invited_by`) always store the **verified** Auth0 email
  (falling back to `sub`), never the value the client sends — same as the
  drawings router's `uploaded_by`.

## Role policy (*inferred* — the legacy app stored roles but did not enforce them)

| Role | Can |
|---|---|
| `viewer` | read everything in the project |
| `inspector` | read + create/edit/delete inspections, findings, photos; sign off / reopen |
| `owner` | everything, plus edit/delete the project and manage members |

A member whose role does not allow an action gets **403** (not 404 — they
can already see the project).

## Decisions for the owner (please confirm or change)

1. **Role enforcement** as in the table above. Legacy parity would be "any
   member can do anything"; the rebuild tightens this. Say the word and
   `WRITE_ROLES` / `MANAGE_ROLES` in `backend/app/api/authz.py` change.
2. **Sign-off also sets `status`** to `closed` / back to `open` (*inferred*
   from the SPA's inspection card, which renders a `closed` badge from
   `status`).
3. **Finding status transitions** clear `resolved_by` / `resolved_at` when a
   finding leaves `resolved`; `resolution_notes` are kept as history.
   `PATCH /resolve` with `resolution_notes: null` clears the notes.
4. **Photo S3 keys** for new uploads are
   `photos/inspections/{inspection_id}/{uuid}{ext}` (project-bound, like the
   drawings hardening). Existing rows keep whatever key they have; `view_url`
   is presigned from the stored key, so old photos keep working.
5. **Deleting a project / inspection** removes rows via FK cascades but
   leaves S3 objects to the bucket lifecycle policy (as the legacy app did).
   Deleting a single photo does delete its object.
6. **Weather and report generation** are not ported yet — see the tracking
   issue. The rebuilt SPA screens (increments 08/10) will need them.

## Configuration

`S3_BUCKET` (default `vrinspector-files`) and `AWS_REGION` (default
`us-east-1`) are plain settings. AWS credentials are **never** in the repo:
boto3 reads them from the runtime (instance role or `AWS_*` environment
variables on the server). The test suite substitutes an in-memory S3 client
and never reaches AWS.
