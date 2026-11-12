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

    GET    /itp-templates[?include_archived]   caller's masters, latest version each; an account
                                               with no master is first given the four starters
                                               (13.7, app/itp-library.json, published v1, once)
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

## ITP line evidence (increment 13.6)

Additive changes; no existing request changes meaning.

- `POST /photos/presign`, `POST /photos` take **exactly one** of
  `inspection_id` / `itp_item_id` (422 otherwise). With `itp_item_id` the key
  is bound to `photos/itp-items/{itp_item_id}/…` (a key outside it → 404),
  `finding_id` is refused, and the line must be recordable (409 past an
  unreleased hold point, once signed, on a complete / voided ITP).
  `GET /photos?itp_item_id=N` lists a line's photos (any member).
  `PhotoPublic.inspection_id` is now nullable and gains `itp_item_id`.
  `DELETE /photos/{id}` on a line photo follows the same lock and refuses the
  last photo of a passed photo-required line (409).
- `PUT /itp-items/{id}` accepts `measured_value` (string; `""` / null
  clears). 422 when the line takes no value or a number line gets text; 409
  under the same locks as the result. `status: "pass"` → 409 on a
  photo-required line with no photo.
- `POST /itp-items/{id}/signatures` → 409 on a passed photo-required line
  whose photo is gone.
- `ItpItemPublic` gains `acceptance_criteria`, `reference_doc`,
  `record_required`, `photo_required`, `photo_count`, `value_type`,
  `value_unit`, `value_min`, `value_max`, `measured_value`,
  `out_of_tolerance` (true / false for a number line with limits and a value,
  else null). `classification` is now hold / witness / review / information.
- `POST /projects/{id}/signoff-roles/defaults` (owner) adds whichever of
  Contractor (contractor), Owner's representative (client) and Third-party
  inspector (engineer) is missing and returns the project's roles.

## ITP document numbers and the three-shot set (increment 13.8)

Additive fields only; no route added or removed.

- `POST /projects`, `PUT /projects/{id}` take an optional `code` (letters,
  digits, hyphens, ≤ 20; spaces become hyphens; upper-cased; 422 otherwise).
  On update `""` or `null` clears it. Every project response adds `code`
  (as set, or null) and `itp_code` (the code numbers use: `code`, or one
  derived from the name).
- ITP summaries and details (`GET /projects/{id}/itps`, `GET /itps/{id}`,
  the create / bulk / update responses) and `GET /projects/{id}/itp-items`
  add `seq` and `doc_number` (`ITP-<itp_code>-<seq>`, e.g. `ITP-LC4-007`).
- ITP lines add `photo_set` (`"three_shot"` or null), `shot_slots` (the
  slots that have a photo, in shooting order) and `evidenced` (the line's
  photo rule is met). Pass and sign-off on an unevidenced line → 409 naming
  what is missing ("the three-shot photo set (still missing: Intermediate)").
- `POST /photos` takes optional `shot_slot` (`context` / `intermediate` /
  `closeup`; only for an ITP line whose template asks for the set, else 422)
  and `captured_at`; photo responses return both. Deleting the only photo that
  keeps a passed line evidenced (its last photo, or the last in a slot) → 409.

### Release lines (increment 13.9)

Additive fields only; no route added or removed.

- ITP lines add `result_scale` (`"release"` or null), `approved_label` (e.g.
  "Approved to pour"), `conditions` and `result_label` (the result in words:
  the approved label or "Approved", "Approved with conditions", "Rejected";
  null while pending or on an ordinary line).
- `PUT /itp-items/{id}` takes optional `conditions`. On a release line:
  `{"status": "pass"}` is Approved, `{"status": "pass", "conditions": "…"}`
  Approved with conditions, `{"status": "fail"}` Rejected; `"na"` → 422;
  conditions without an approval → 422; leaving `pass` clears the conditions;
  changing the conditions of a signed line → 409. Conditions on an ordinary
  line → 422.
- Template bodies take `resultScale` (`release` / `none`) and `approvedLabel`
  (≤ 60 characters, only with `resultScale`) per question.

## External sign-off, packs and notices (increment 14)

New routes (`app/api/routes/signoff.py`; PRD v2.63 §5), no legacy counterpart:

| Route | Who | What |
|---|---|---|
| `GET /itps/{id}/sign-links`, `GET /areas/{id}/sign-links` | any member | the links, newest first: role, signer email, `status` (active / used / expired / revoked / replaced), expiry, reminder count, `email_status` |
| `POST /itps/{id}/sign-links`, `POST /areas/{id}/sign-links` | owner, inspector | `{}` → one link per required role with a signer email and at least one ready line; `{signoff_role_id[, signer_email]}` → one link for that role. 201 `{links, skipped}`; each new link carries `link` once |
| `POST /sign-links/{id}/remind` | owner, inspector | 201 a fresh link emailed as a reminder; the old one becomes `replaced` (429 within a minute of sending) |
| `POST /sign-links/{id}/revoke` | owner, inspector | withdraws an unused link |
| `GET /itps/{id}/packs`, `GET /areas/{id}/packs` | any member | pack versions, newest first, each with a presigned `download_url` |
| `POST /itps/{id}/packs`, `POST /areas/{id}/packs` | any member | the current pack; renders version *n+1* only if something on it changed (`regenerated`) |
| `POST /itp-items/{id}/witness-notice` | owner, inspector | `{planned_for?, message?}` → emails the line's signers (witness and hold points only; once a minute) |
| `GET /sign/{token}` | **no account** | what the link signs: project, role, every line with `sign_state` ready / signed / waiting and the reason, `pack_url`; 404 unknown, 410 used / expired / withdrawn / replaced |
| `POST /sign/{token}` | **no account** | `{signer_name, signature_png (PNG data URL), confirm: true, gps_lat?, gps_lng?}` → signs every ready line once (plus one pack-level signature per ITP), uses the link up; 409 if nothing is ready (the link still works) |

Rules: tokens are 256 random bits (`secrets.token_urlsafe(32)`), stored only
as SHA-256; single use; 14 days (`SIGN_LINK_DAYS`); one live link per role
and document (a new request or a reminder replaces the old one). A line is
*ready* for a role on the same terms as in-app signing (recorded Pass / N/A,
photo evidence on file, not behind an unreleased hold point). The drawn
signature is stored in S3 under `signatures/projects/{project_id}/`; the stamp
is server time, the browser's GPS if shared, and the Open-Meteo reading for
the project's location (`itp_signatures.weather`; in-app signatures get it
too). Packs: WeasyPrint, `packs/itps/{id}/v{n}-….pdf` or
`packs/areas/{id}/v{n}-….pdf`, one `itp_sign_packs` row per version, rendered
when the content hash changes and refreshed in the background after every
signature. Emails: `sign_request`, `sign_reminder`, `witness_notice` in the
send log. Scheduled reminders: `python -m app.sign_reminders` reissues links
left unused for `SIGN_REMINDER_AFTER_DAYS` (3), at most `SIGN_REMINDER_MAX`
(2) times — scheduling it is an RG-3 deployment step.

## Drawing revisions and pin moves (increment 14.5)

Owner decision 2026-11-10. Additive: existing drawings are one-revision
sheets, so every legacy route behaves exactly as before for them.

| Route | Who | What |
|---|---|---|
| `GET /drawings?project_id=N[&include_superseded=true]` | any member | current revisions only unless asked |
| `POST /drawings` | owner, inspector | + optional `revision` label |
| `GET /drawings/{id}/revisions` | any member | the sheet's revisions, newest first |
| `POST /drawings/{id}/revisions` | owner, inspector | `{filename, s3_key, file_type, file_size?, page_width_pts?, page_height_pts?, revision?, title?, drawing_number?}` (key from the usual `POST /drawings/presign`, bound to the project prefix) → 201 the new current revision; every pin copied with `carried_from_pin_id` and `position_check: true`; 409 on an old revision or a label already used |
| `PUT /drawings/{id}`, `POST /drawings/{id}/pins`, `PUT` / `DELETE /pins/{id}` | owner, inspector | 409 on an old revision ("kept read-only") |
| `DELETE /drawings/{id}[?revision_only=true]` | owner, inspector | the whole sheet (every revision), or only the current revision (the previous becomes current again); 409 on an old revision |
| `PUT /pins/{id}` | owner, inspector | + `x_pct`, `y_pct`, `page_number` (move) and `position_confirmed: true`; either settles a carried pin (`position_confirmed_by` / `_at`) |

`DrawingPublic` gains `series_id`, `revision`, `superseded_at`, `is_current`,
`revision_count`, `pins_to_check`; `PinPublic` gains `carried_from_pin_id`,
`carried_from_revision`, `position_check`, `position_confirmed_by`,
`position_confirmed_at`. ITP line pin lists (`pins` on ITP items) show only
pins on current revisions.

## AI capture assistance (increment 15)

PRD v2.62 Block 10A (photo analysis) and 10B (voice-to-finding). Drafts are
never saved by themselves; the inspector confirms through the ordinary
routes, sending the draft's id. Every model call is logged in
`ai_suggestions` (prompt text, prompt version, model version, draft or
error, tokens, who asked / confirmed, edited or not).

| Route | Who | What |
|---|---|---|
| `GET /ai/status` | any signed-in user | `{enabled, model, daily_limit, used_today}`; `enabled` is false without `ANTHROPIC_API_KEY` |
| `POST /ai/photo-analysis {photo_id}` | owner, inspector; inspection open | 201 draft `{category, defects:[{type, note, confidence}], severity, title, description}`; 422 for ITP line photos or an unreadable format, 404 for a missing file, 409 signed off, 429 daily cap, 503 off / busy, 502 model failure (logged as `failed`) |
| `POST /ai/voice-finding {inspection_id, transcript, location_ref?}` | owner, inspector; inspection open | 201 draft `{title, status, priority, discipline, description, location_ref}`; 422 empty or over `AI_MAX_TRANSCRIPT_CHARS` |
| `GET /ai/suggestions/{id}` / `GET /ai/suggestions?finding_id=N \| photo_id=N` | any member | the full log row(s) incl. `system_prompt`, `user_prompt`, `input_text`, `error`, tokens, `finding_id` |
| `POST /ai/suggestions/{id}/dismiss` | owner, inspector | draft → `dismissed`; 409 if not a draft |
| `POST /findings` | owner, inspector | + optional `discipline` (drawing vocabulary) and `ai_suggestion_id` (voice or photo draft of the same inspection, 404 otherwise; 409 if dismissed / failed or already behind a finding) — marks the draft `confirmed`, `edited` when any field differs |
| `PUT /findings/{id}` | owner, inspector | + `discipline` |
| `PUT /photos/{id}/tags {category, defect_tags, severity, ai_suggestion_id?}` | owner, inspector; inspection open | files an inspection photo (by hand, or confirming that photo's draft); an empty body clears it |

`FindingPublic` gains `discipline`, `ai_suggestion_id`; `PhotoPublic` gains
`category`, `defect_tags`, `severity`, `tags_confirmed_by`,
`tags_confirmed_at`, `ai_suggestion_id`. Non-members get 404 on every route
above, viewers 403 on the writes.

## AI report drafting + ITP import (increment 16)

PRD v2.62 Block 10C and v2.63 Block 10E, same guardrails as increment 15.

| Route | Who | What |
|---|---|---|
| `POST /ai/report-draft {inspection_id}` | owner, inspector (inspection may be signed off) | 201 draft `{summary}` written from the recorded findings; 429 daily cap, 503 off, 502 model failure (logged as `failed`) |
| `POST /reports/generate {inspection_id, summary?, ai_suggestion_id?}` | any member; `ai_suggestion_id` needs owner / inspector | `summary` (≤ 6000 chars, paragraphs tidied, blank → none) is printed at the top of the PDF and returned on the report; `ai_suggestion_id` must be a `report` draft of the same inspection (404 otherwise, 422 another kind or no summary, 409 not a draft) and is marked `confirmed`, `edited` when the words differ. Without either field the legacy body and response are unchanged |
| `POST /ai/itp-import` (multipart `files[]`, `hint?`) | any signed-in user | 201 draft `{name, description, roles:[{name, party}], sections:[{title, lines:[{title, classification H/W/R/I, acceptance_criteria, reference, record_required, roles, photo_required, value_type none/number/text, unit}]}], notes}`; PDF (≤ 2), .xlsx, .csv, JPEG / PNG / HEIC / WebP; ≤ `AI_IMPORT_MAX_FILES` (8) files, 413 over `AI_IMPORT_MAX_BYTES` (20 MB); 422 unreadable file or no lines read; originals stored in S3 |
| `POST /ai/itp-import/{id}/save {name, description?, draft}` | the account that imported | 201 `ItpTemplatePublic` — a new master (status `draft`) built from the submitted draft and validated like any template (422 with the template error, or "Keep at least one line"); the import is marked `confirmed` with `template_id`; 409 if not a draft; 404 for anyone else |
| `GET /ai/suggestions?template_id=N` | the template's owner | the import behind a master (any version) |

`AiSuggestionPublic.project_id` / `inspection_id` are nullable (imports) and
it gains `template_id` and `source_files` (`name`, `content_type`, `size`).
`ReportPublic` gains `summary` and `ai_suggestion_id`. An ITP import is
visible only to the account that ran it (404 to anyone else).

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

External sign-off (increment 14): `SIGN_LINK_DAYS` (14),
`SIGN_REMINDER_COOLDOWN_SECONDS` (60), `SIGN_REMINDER_AFTER_DAYS` (3),
`SIGN_REMINDER_MAX` (2), `ITP_PACK_AUTOREGENERATE` (true). Signing links in
emails use `APP_PUBLIC_URL`, so it must be the public address of the web app.

SES must also have the sending domain verified (DKIM records) and the
account moved out of the SES sandbox before it will mail arbitrary
addresses. With `SMTP_HOST` empty the app runs normally and logs each email
as `skipped`.

AI capture (increment 15) — owner action at RG-3, nothing real is committed:
`ANTHROPIC_API_KEY` (empty = AI hidden), `AI_MODEL` (`claude-sonnet-4-5`),
`AI_TIMEOUT_SECONDS` (30), `AI_IMAGE_MAX_EDGE` (1568),
`AI_DAILY_LIMIT_PER_USER` (200, 0 = off), `AI_MAX_TRANSCRIPT_CHARS` (4000),
`ANTHROPIC_API_URL` (the Messages API). Tests replace the HTTP transport and
never reach the model.
