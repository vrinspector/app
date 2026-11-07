# VR Inspector — API port (increments 04 and 05)

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

Not ported yet: `GET /api/weather` (Open-Meteo lookup) and
`POST /api/reports/generate` (PDF to S3). They have no increment in
`REBUILD_PLAN.md`; see the tracking issue opened with the increment 04 PR (#9).

## Drawings and pins (increment 05)

Ported from `vrinspector/backend` → `staging_snapshot_20260716/
staging_drawings_block8e.py`, the one legacy router that survived in source
form, so here the **legacy code is the contract** rather than the SPA's call
sites. Its local authorization regression suite
(`test_drawings_authorization.py`) is ported to pytest as the first two tests
in `backend/tests/api/routes/test_drawings.py`: same fixture, same
allowed-member walk, same non-member assertions, same `detail` strings.

| Legacy route | Rebuild | Notes |
|---|---|---|
| `POST /v1/drawings/presign` `{project_id, filename, content_type}` | `POST /api/v1/drawings/presign` | `{upload_url, s3_key}`; key `drawings/projects/{project_id}/{uuid}{ext}`, 10-minute PUT |
| `POST /v1/drawings` | same → 201 | `s3_key` must be under the project prefix, else **404 Drawing not found**; `uploaded_by` recorded server-side |
| `GET /v1/drawings?project_id=N[&discipline=]` | same | newest first |
| `GET /v1/drawings/{id}` | same | |
| `PUT /v1/drawings/{id}` | same | nulls mean "not sent"; empty → 400 `No fields to update` |
| `DELETE /v1/drawings/{id}` | same → 204 | pins cascade; S3 object deleted best-effort (*inferred*, see below) |
| `PATCH /v1/drawings/{id}/dimensions` `{page_width_pts, page_height_pts}` | same | Block 8E R6; returns `{id, page_width_pts, page_height_pts}` |
| `GET /v1/drawings/{id}/view-url` | same | `{view_url}`, 1-hour presigned GET |
| `GET /v1/drawings/{id}/pins` | same | ordered by `id` |
| `POST /v1/drawings/{id}/pins` | same → 201 | the SPA's `placePin` body incl. `page_number` (1-indexed) |
| `DELETE /v1/pins/{id}` | same → 204 | |
| — | `GET /api/v1/pins/{id}`, `PUT /api/v1/pins/{id}` | rebuild additions; the legacy module declared `PinUpdate` but exposed no route. `PUT` with `finding_id: null` unlinks |

Numeric columns (`x_pct`, `y_pct`, `page_width_pts`, `page_height_pts`) are
returned as JSON **numbers**, as FastAPI's encoder did for the legacy
`dict(row)`; the SPA's overlay arithmetic depends on that.

Role policy applies as in increment 04: viewers read (list, get, view-url,
pins), inspectors and owners write. Non-members get 404 everywhere.

### Decisions for the owner (increment 05)

7. **Vocabularies are enforced** at the API layer: `discipline` ∈ the Block 8D
   list, `file_type` ∈ {pdf, png, jpg, jpeg, svg}, pin `status` ∈ the five
   Block 8D statuses, `x_pct`/`y_pct` in 0–100, `page_number ≥ 1`, page
   dimensions > 0. The legacy router stored any string / number (the column
   is `NUMERIC(6,3)`, so an out-of-range percentage would have been a 500).
   The deployed SPA only ever sends values inside these sets.
8. **Pins may only link to findings in the same project** (404 `Finding not
   found` otherwise). The legacy router relied on the FK alone, which allowed
   cross-project links.
9. **Deleting a drawing deletes its S3 object** best-effort, matching
   decision 4/5 for single photos. The legacy router left the object to the
   bucket lifecycle policy. Deleting a project still leaves objects behind.
10. **`GET /pins/{id}` and `PUT /pins/{id}`** are new. The rebuilt drawing
    viewer (increment 09) needs a way to change a pin's status / link a
    finding without delete-and-recreate; the legacy SPA had no such UI.

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
