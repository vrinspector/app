# VR Inspector — API port (increments 04, 05 and 10)

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
| `POST /api/photos` | same → 201 | key must be under the inspection's prefix (else 404); optional `finding_id` (increment 11a) must name a finding of the same inspection, else 404 `Finding not found` |
| `GET /api/photos?inspection_id=N` | same, plus optional `&finding_id=M` | each row carries a presigned `view_url` and `finding_id` (null for site photos) |
| — | `GET/DELETE /api/v1/photos/{id}` | DELETE removes the S3 object best-effort |

`GET /api/weather` is ported in increment 10.5 and `POST /api/reports/generate`
in increment 10 (both below).

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

## Reports (increment 10)

The Block 4 report route, folded into the reports/dashboard/members/Help
increment (issue #9, option 2). The SPA's `generateReport` is the contract
for the request and the one field it read; the rest is rebuild.

| Legacy call (SPA) | Rebuild | Notes |
|---|---|---|
| `POST /api/reports/generate` `{inspection_id}` → `{download_url}` | `POST /api/v1/reports/generate` → 201 report | renders the PDF, writes it to S3 as the next **version**, returns the row with a presigned `download_url` (1 hour) |
| — | `GET /api/v1/reports?inspection_id=N` | every version, newest first, each with `download_url` |
| — | `GET /api/v1/reports/{id}` | one version |

**Document.** `app/core/reports.py` renders `app/report-templates/
inspection_report.html` (Jinja2, brand palette, Letter) and lays it out with
WeasyPrint (ADR-009: server-side Python PDF generation). Contents: header
band (project, inspection, version, generated by/at), details and sign-off
state, summary tiles (findings / open / in progress / resolved / high
priority / photos), the findings table sorted high → medium → low with
location, status and the Block 8A resolution (by, date, notes), and the
site photos as embedded thumbnails (read from S3 by the server, downscaled
to 1000 px JPEG with Pillow; an unreadable object renders "Photo
unavailable" rather than failing the report).

**Storage.** `reports/inspections/{inspection_id}/v{n}-{uuid}.pdf`, written
by the API with `put_object` — the one place the server writes an object
(uploads still go browser → S3 by presigned PUT). Nothing is overwritten;
the `inspection_reports` table (`docs/DATA_MODEL.md`) records each version.
Deleting the inspection cascades the rows; the objects are left to the
bucket lifecycle policy, like decision 5.

**Authorization.** Any project member may generate and read (a report is a
read-out of the record — decision 27); non-members get 404 `Inspection not
found` / `Report not found`.

**Runtime.** WeasyPrint needs Pango: the backend image installs
`libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 fonts-dejavu-core`
(Dockerfile) and `test-backend.yml` installs the same on the runner. No
network access is needed to render.

## Weather (increment 10.5)

The Block 5 weather badge, the last route the deployed SPA called that had
no increment (issue #9; owner decision 2026-11-08: keep the shipped feature
for parity). The SPA's `loadFindingsScreen` is the contract: it asked for
the project's location text and read five fields, and treated any failure
as "no badge". The legacy route's source did not survive; the provider the
plan names is Open-Meteo (free, no API key).

| Legacy call (SPA) | Rebuild | Notes |
|---|---|---|
| `GET /api/weather?location=<text>&inspection_id=N` → `{description, temp_f, humidity, wind_mph, weather_code}` | `GET /api/v1/weather?inspection_id=N[&location=<text>]` → the same five fields plus `location` (the place the geocoder resolved) and `observed_at` | `inspection_id` is required and authorized like every object (non-member → 404 `Inspection not found`); `location` defaults to the project's stored location |

**Lookup.** `app/core/weather.py`: Open-Meteo geocoding
(`geocoding-api.open-meteo.com/v1/search`, first match) → forecast
(`api.open-meteo.com/v1/forecast`, `current=temperature_2m,
relative_humidity_2m,wind_speed_10m,weather_code`, °F and mph). The WMO
`weather_code` is translated to text server-side (`WMO_DESCRIPTIONS`) so
every client shows the same words. Readings are cached in process per
normalised location for `WEATHER_CACHE_SECONDS` (600; Open-Meteo refreshes
every 15 minutes), so a crew opening the same inspection repeatedly costs
one upstream call per worker. Timeouts are `WEATHER_TIMEOUT_SECONDS` (4 s).
Nothing is stored (`docs/DATA_MODEL.md`).

**Errors.** No location on the project and none passed → 404 `Project has
no location`; the geocoder finds nothing → 404 `Location not found: …`; the
provider down, slow or erroring → 503 `Weather service unavailable`. A
failure is never cached. The screen hides the badge on any error, as the
SPA did (`WeatherBadge`, `retry: false`, no toast).

**Configuration.** `WEATHER_GEOCODING_URL`, `WEATHER_FORECAST_URL`,
`WEATHER_TIMEOUT_SECONDS`, `WEATHER_CACHE_SECONDS` — plain settings with
working defaults; there is no key to configure. The test suite injects an
`httpx.MockTransport` (`weather.use_transport`) and never reaches the
network, the same seam as `Storage.use_client`.

## ITPs, sign-off roles and Areas (increment 13)

Block 9.5 (PRD v2.63 §5) — new routes with no legacy counterpart, in
`app/api/routes/itps.py` and `app/api/routes/areas.py`; the read model
(hold points, completion blockers) is `app/api/itp_state.py`, the template
reader `app/core/itp.py` (mirrored in `frontend/src/lib/itp.ts` for the
editor and the demo).

    GET    /itp-templates[?include_archived]   caller's masters, latest version each
    POST   /itp-templates                      201, version 1 (body validated → 422 with a reason)
    GET    /itp-templates/{id}                 one version + body + version list
    PUT    /itp-templates/{id}                 201, the next version (409 unless editing the latest)
    PATCH  /itp-templates/{id}/status          draft / published / archived, in place
    GET    /projects/{id}/signoff-roles        roles + how many lines need each
    POST   /projects/{id}/signoff-roles        owner; 409 duplicate name (case-insensitive)
    PUT    /signoff-roles/{id}                 owner; `signer_email: null` clears
    DELETE /signoff-roles/{id}                 owner; 409 while lines need it
    GET    /projects/{id}/areas                ordered, each with an ITP roll-up
    POST   /projects/{id}/areas                owner/inspector; appended
    POST   /projects/{id}/areas/bulk           {prefix, start, end, area_type, parent_area_id} ≤ 200
    PUT    /projects/{id}/areas/order          {area_ids}: every area exactly once
    GET    /areas/{id}  PUT /areas/{id}         rename / retype / re-parent (no cycles, same project)
    DELETE /areas/{id}                         409 when any of its ITPs is signed
    GET    /projects/{id}/itps[?area_id]       summaries
    POST   /projects/{id}/itps                 {template_id, area_id?, title?} → frozen copy
    POST   /projects/{id}/itps/bulk            {template_id, area_ids} → one copy per area, all or none
    GET    /projects/{id}/itp-items            every line (for the pin dialog)
    GET    /itps/{id}  PUT /itps/{id}           title / area / status (complete checks blockers)
    DELETE /itps/{id}                          409 once anything is signed ("void it instead")
    PUT    /itp-items/{id}                     {status?, notes?}
    POST   /itp-items/{id}/signatures          in-app sign-off for one required role

`PinCreate` / `PinUpdate` / `PinPublic` gain `itp_item_id` (same project or
404 "ITP item not found"; `null` unlinks). Object hiding as everywhere else:
an area, ITP, line or role of a project the caller cannot see is 404 with
"Area / ITP / ITP item / Sign-off role not found"; a master of another
account is "Template not found". Owner decisions 39–46 are in
`docs/SCREENS.md`.

## Outbound email (increment 13.5)

Block 7.1 (SES invitation emails, deferred on staging) pulled forward as one
outbound-email service, `app/core/email.py`; routes in
`app/api/routes/emails.py`.

    POST /projects/{id}/members                       unchanged body and response; now also emails the invite
    GET  /projects/{id}/emails[?email_type&related_id] owner; send-log rows, newest first (≤ 200)
    POST /projects/{id}/members/{mid}/invite-email     owner; 202 + the new log row
                                                      400 for an owner row, 404 unknown / other project,
                                                      429 within 60 s of a queued/sent invite

* **Send log first, delivery after.** The request writes an `email_send_log`
  row (`queued`, or `skipped` when SMTP is not configured) and returns;
  delivery runs as a FastAPI background task with its own session and moves
  the row to `sent` (with `sent_at` and our `Message-ID`) or `failed` (with
  the reason). A slow or broken mail server never fails or delays an invite.
* **Transport** is plain SMTP (`smtplib`): STARTTLS when `SMTP_TLS`,
  implicit TLS when `SMTP_SSL`, login when `SMTP_USER` is set, timeout
  `SMTP_TIMEOUT_SECONDS`. AWS SES's SMTP interface takes exactly this, so
  production is configuration only. Optional `EMAILS_REPLY_TO` and
  `SES_CONFIGURATION_SET` (sent as `X-SES-CONFIGURATION-SET` for bounce /
  complaint tracking). Links use `APP_PUBLIC_URL` (defaults to
  `FRONTEND_HOST`).
* **Templates.** Branded HTML from React Email in `packages/react-email/`
  (v2.51 palette: forest-green band, gold rule and button, copper labels),
  exported to `backend/app/email-templates/` with Jinja placeholders and
  rendered with autoescaping; plain-text twins in `backend/app/email-text/`.
  Every email is multipart (text + HTML).
* **Local dev and CI** send to Mailpit (the maintained MailCatcher successor
  the template already ships in `compose.override.yml` and
  `test-backend.yml`; web inbox on http://localhost:8025). The test suite
  swaps in an in-memory outbox and never reaches a mail server, except one
  test that sends through Mailpit when it is running (CI).
* The template's unused `send_email` / `test_email` helpers and the
  `emails` package were removed in favour of this service.

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
6. **Weather** was ported in increment 10.5 (above; decision 31 in
   `docs/SCREENS.md`). Report generation was ported in increment 10
   (decisions 25–29 in `docs/SCREENS.md`).

## Configuration

`S3_BUCKET` (default `vrinspector-files`) and `AWS_REGION` (default
`us-east-1`) are plain settings. AWS credentials are **never** in the repo:
boto3 reads them from the runtime (instance role or `AWS_*` environment
variables on the server). The test suite substitutes an in-memory S3 client
and never reaches AWS.

Email (increment 13.5) — owner action at RG-3, nothing real is committed:

| Setting | Production (AWS SES SMTP) | Local / CI |
|---|---|---|
| `SMTP_HOST` | `email-smtp.<region>.amazonaws.com` | `localhost` / `mailpit` |
| `SMTP_PORT` | `587` (or `465` with `SMTP_SSL=true`) | `1025` |
| `SMTP_TLS` | `true` (STARTTLS) | `false` |
| `SMTP_USER` / `SMTP_PASSWORD` | SES SMTP credentials (not the AWS access key pair) | empty |
| `EMAILS_FROM_EMAIL` | an address on the SES-verified domain | `info@example.com` |
| `EMAILS_FROM_NAME` | optional, defaults to `PROJECT_NAME` | — |
| `EMAILS_REPLY_TO` | optional monitored inbox | — |
| `SES_CONFIGURATION_SET` | optional, for bounce / complaint events | — |
| `APP_PUBLIC_URL` | the web app's public URL (links in emails) | `FRONTEND_HOST` |

SES must also have the sending domain verified (DKIM records) and the
account moved out of the SES sandbox before it will mail arbitrary
addresses. With `SMTP_HOST` empty the app runs normally and logs each email
as `skipped`.
