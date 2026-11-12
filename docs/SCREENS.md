# Screens (increments 07–10)

How the operational screens are built on the shell from increment 06
(`docs/FRONTEND_SHELL.md`), against the API contract in `docs/API_PORT.md`.
Owner decisions are numbered on from `docs/API_PORT.md` (1–10): 11–14 in
increment 07, 15–18 in increment 08, 19–24 in increment 09, 25–30 in
increment 10, 31 in increment 10.5.
The legacy single-file SPA (`vrinspector/frontend` →
`staging_snapshot_20260716/staging_index_with_help_private.html`) is the
behavioural spec: same screens, same request bodies, same vocabulary.

## Increment 07 — projects + inspections

### Routes

| Route | Legacy | Screen |
|---|---|---|
| `/projects` | `renderProjects` | Project list: filter box, count, "New project", one card per project (name, client — location, status badge) |
| `/projects/$projectId` | `openProject` → `renderInspections` | Project: details card, header menu (Edit / Delete project — owners), inspections list with filter box and "New inspection" |
| `/projects/$projectId/inspections/$inspectionId` | `openInspection` + the sign-off bar of `renderFindingsScreen` | Inspection: details, Block 8B sign-off bar, Sign off / Reopen, header menu (Edit / Delete inspection); findings + photos section reserved for increment 08 |

Routes are file-based under `src/routes/_layout/projects/`; "Projects" stays
highlighted in the sidebar for the nested screens (`isNavItemActive`). Every
detail screen has the back arrow the legacy top bar had (`PageHeader
backTo`), so phone navigation does not depend on the sidebar.

### Data

`src/lib/queries.ts` holds the query keys and `queryOptions` for projects,
one project, its members, its inspections and one inspection. Mutations
invalidate by prefix (`["projects", id]` covers the project, its members and
its inspections) — the equivalent of the legacy screen reloads. Successful
edits also `setQueryData` on the object so the screen updates without a
flash.

Request bodies match the legacy SPA's:

| Action | Body |
|---|---|
| Create project | `{name, client, location, status}` — blanks sent as `null`; `created_by` is no longer sent because the API stamps the verified identity |
| Create inspection | `{project_id, status: "open", title, inspection_type, inspector, notes}` |
| Edit project / inspection | the same fields via `PUT` (the legacy SPA had no edit; the API routes exist since increment 04) |
| Sign off / reopen | `PATCH …/signoff`, `PATCH …/reopen`, no body |

Ids in the URL are parsed with `parseId`: anything that is not a positive
integer renders `NotFoundState` without a request. A 404 from the API
renders the same state (the routers hide objects the caller may not see);
other failures render `ErrorState` with a retry (`DetailState` in
`components/Common/States.tsx`). An inspection reached under the wrong
project id also renders not-found.

### Roles

`useProjectRole(projectId)` reads the members list and matches the caller
the way the API does (`user_sub`, else email case-insensitively) to decide
which buttons to show: viewers see no write actions, inspectors no project
edit/delete. While the role is unknown (loading, or the caller is not in the
list) the actions stay visible and a 403 is explained by the toast — the API
is the authority (`docs/API_PORT.md`, role policy).

### Forms

react-hook-form + zod, in a `Dialog`, one component per object used for
both create and edit (`ProjectFormDialog`, `InspectionFormDialog`). Fixed
vocabularies use a styled native `<select>` (`components/ui/native-select`):
on phones and iPads the OS picker is the better one-handed control and it
needs no JavaScript to open. Confirmations (`ConfirmDialog`) replace the
legacy `window.confirm` for deletes and for sign-off.

### Components added

| Component | Use |
|---|---|
| `Common/ListCard` | the tappable card (title, meta line, badges, "›") as a router link |
| `Common/FilterInput` | the client-side contains-filter box over loaded cards |
| `Common/ConfirmDialog` | two-step confirmation with a pending state |
| `Common/States` → `NotFoundState`, `DetailState` | 404-aware single-object pattern |
| `ui/textarea`, `ui/native-select` | form controls the shell did not yet have |

### Tests

`src/test/projects.test.tsx` renders the real route tree with the Auth0 SDK
and the generated client mocked: list rendering and filtering, empty and
error states, create / edit bodies, role gating, delete, sign-off / reopen,
not-found for a hidden object, a malformed id and a cross-project URL.

### Decisions for the owner (increment 07)

11. **Edit and delete exist in the UI.** The legacy SPA could only create
    projects and inspections; the rebuilt screens expose the `PUT`/`DELETE`
    routes ported in increment 04 (owners for projects, inspectors and
    owners for inspections), each behind a confirmation.
12. **Editing a signed-off inspection is disabled** in the menu until it is
    reopened, matching the API's 409 on new findings while closed. The API
    itself still accepts `PUT` on a closed inspection; say the word and the
    backend rejects it too.
13. **New inspections default to type Civil and the signed-in person's
    name as inspector**, the legacy select's first option and the common
    case for a solo inspector. Both are editable in the form.
14. **Creating a project or inspection opens it** instead of returning to
    the list (the legacy SPA reloaded the list). One tap fewer to the first
    inspection or finding.

## Increment 08 — findings + photo capture

Fills the body of `/projects/$projectId/inspections/$inspectionId` (legacy
`renderFindingsScreen`): **Site photos** first, then **Findings**, with the
Block 8A defect-repair workflow and the camera-first capture flow.

### Layout

| Part | Legacy | Screen |
|---|---|---|
| Site photos (N) | photo grid + "📷 Capture Photo" | `PhotosSection`: thumbnail grid (newest first), **Take photo** (rear camera) and **Upload** (library, multi-select), in-flight upload tiles, tap a thumbnail for the full-size viewer |
| Findings (N) | search box, status select, "+ Log Finding", cards | `FindingsSection`: search + status filter (client-side, like `filterFindings`), **Log finding**, one `FindingCard` per finding |
| Capture bar | — | phones only (`sm:hidden`): sticky **Take photo** / **Log finding** at the bottom so the capture loop never needs a scroll back to the top |
| Weather badge | `GET /api/weather` → conditions, °F, humidity, wind | `WeatherBadge` (increment 10.5): the same four readings plus the resolved place, above the photos; silent while loading and absent on any failure, as the legacy badge was |

### Photo capture flow

`usePhotoUpload` runs the legacy three steps per file and never sends the
bytes through the API (Hard Rule 8):

1. `POST /photos/presign` `{inspection_id, filename, content_type}` →
   `{upload_url, s3_key}` (the key is bound to the inspection);
2. `PUT` the file to `upload_url` with the same `Content-Type` — an
   `XMLHttpRequest` so the tile can show progress;
3. `POST /photos` `{inspection_id, s3_key, filename, content_type,
   uploaded_by}` (`uploaded_by` is the display name as the SPA sent; the API
   records the verified identity).

Each file is its own tile from the moment it is picked (local object-URL
preview, "Preparing… / 42% / Saving…"), several can run at once, and a
failure keeps the tile with the reason and **Retry** (from step 1 again) or
discard. On success the registered photo is placed at the front of the
cached list and the list re-read, so the thumbnail is there before the
toast fades.

`usePhotoPicker` renders the two hidden inputs: `accept="image/*"
capture="environment"` for Take photo (opens the rear camera directly on
iOS and Android; a plain file picker on desktop) and `accept="image/*"
multiple` for Upload. Inputs reset after each pick so the same shot can be
retaken.

`PhotoViewerDialog` shows the full image with filename, who and when,
previous / next (arrow keys too), and **Delete photo** for inspectors and
owners (`DELETE /photos/{id}`, confirmed). The legacy grid had no viewer
and no delete.

### Findings

Request bodies match the legacy SPA's:

| Action | Body |
|---|---|
| Log finding | `POST /findings` `{inspection_id, title, description, priority, location_ref, status: "open"}` — blanks as `null` |
| Edit finding | `PUT /findings/{id}` `{title, description, priority, location_ref}` (the legacy SPA had no edit) |
| In progress / Reopen | `PATCH /findings/{id}/status` `{status: "in-progress" \| "open"}` |
| Resolve | `PATCH /findings/{id}/resolve` `{resolution_notes}` — blank as `null` |
| Delete | `DELETE /findings/{id}` (confirmed; drawing pins pointing at it are unlinked, not removed) |

Card actions by status follow the legacy screen exactly: open → **In
progress · Resolve**; in-progress → **Reopen · Resolve**; resolved →
**Reopen**. Cards show the 80-character description excerpt, priority /
status badges, the location reference, and the "Resolved by … — date" line
with the notes; tapping the title expands the full description and dates
(the legacy `viewFinding` was never implemented).

Write actions disappear when the caller is a viewer (`useProjectRole`) or
the inspection is signed off; the API enforces both (403 / 409) and a 409
raised elsewhere is explained by the error toast.

**Dictate** on the description field (`useDictation`) is the legacy Web
Speech API button: shown only where the browser has speech recognition,
appends each transcript to the field, releases the microphone when the
dialog closes. It is the no-AI path; Block 10B adds structuring later.

### Components added

| Component | Use |
|---|---|
| `Findings/FindingsSection`, `FindingCard`, `FindingFormDialog`, `ResolveFindingDialog` | the findings half |
| `Photos/PhotosSection`, `PhotoViewerDialog`, `PhotoCapture` (`usePhotoPicker`, `CaptureBar`) | the photos half and the phone capture bar |
| `hooks/usePhotoUpload`, `hooks/useDictation` | upload queue; speech-to-text |
| `lib/queries.ts` → `findingsQuery`, `photosQuery`, `inspectionKeys.findings/photos` | keys shared by sections and mutations |
| `lib/vocab.ts` → `FINDING_PRIORITY_OPTIONS`, `FINDING_STATUS_OPTIONS` | the legacy select vocabularies |

### Tests

`src/test/findings.test.tsx` (24 cases) renders the real route tree with the
client mocked: list, excerpt and badges; expand; text + status filters;
empty and error states; log / edit / delete bodies; the three status
transitions and resolve with and without notes; a 409 toast; the
signed-off and viewer read-only states; the photo grid and viewer with
delete; the presign → PUT (stubbed `XMLHttpRequest`, body is the `File`,
`Content-Type` set) → register sequence; a failed PUT kept as a tile and
retried; a presign refusal with the API's reason; the phone capture bar.

### Decisions for the owner (increment 08)

15. **Photos can still be added to a signed-off inspection.** The legacy
    screen left "Capture Photo" enabled after sign-off and the API accepts
    it (only findings are refused with 409). The sign-off bar now says so.
    If sign-off should freeze photos too, the backend needs one check and
    the screen hides the camera.
16. **Originals are uploaded, not resized.** As the legacy SPA did. A
    12-megapixel phone photo is 3–6 MB; on 4G that is most of the 15-second
    capture-loop budget. Client-side downscaling (e.g. 2048 px long edge,
    JPEG 85) would make uploads several times faster at the cost of
    evidence resolution — a product call, easy to add to `usePhotoUpload`.
17. **Edit and delete exist for findings and photos**, like increment 07's
    decision 11 for projects and inspections; each behind a confirmation
    and hidden once the inspection is signed off.
18. **The weather badge waited for issue #9** and arrived in increment 10.5
    (decision 31 below).

## Increment 09 — drawings + the Block 8E viewer

Adds **Drawings (N)** to `/projects/$projectId` (legacy
`renderDrawingsSection`) and the viewer as a screen of its own,
`/projects/$projectId/drawings/$drawingId` (legacy `#modal-drawing-viewer`),
so the phone's back button and a shared link both work.

### Drawings section

| Part | Legacy | Screen |
|---|---|---|
| Drawings (N) | thumbnail grid + "📄 Upload Drawing" | `DrawingsSection`: one card per drawing (title, drawing number, discipline badge, PDF badge, date; raster thumbnail when the row has a `thumbnail_url`/`view_url`), filter box once there are more than three, **Upload drawing** (inspectors and owners) |
| Upload | one file, "Uploading…" line | several files at once; each upload is a card at the front of the grid with progress and **Retry** / discard, like the photo tiles |

`useDrawingUpload` runs the legacy three steps per file and never sends the
bytes through the API (Hard Rule 8): `POST /drawings/presign {project_id,
filename, content_type}` → `PUT` to the presigned URL → `POST /drawings
{project_id, s3_key, filename, title, discipline: "general", file_type,
file_size, uploaded_by}` (title is the file name without its extension, as
the SPA sent). The SPA's guard that the returned key starts with
`drawings/projects/{project_id}/` is kept. Files are checked before any
request: PDF, PNG, JPG/JPEG or SVG, 50 MB or less (the limits the Help page
documents).

### Viewer

| Part | Legacy | Screen |
|---|---|---|
| Toolbar | Prev · "Page n of N" · Next, − zoom % + (PDF only) | PDFs: Prev · Page n of N · Next; all drawings: − zoom % + and **Fit to width**; pin count for the page; **Add pin / Cancel** |
| Stage | canvas or `<img>` in a scrolling box | the same, inside a pinch-zoomable, pannable stage (`useViewerGestures`); keyboard: ← → pages, + − zoom, 0 fit, Esc leaves pin mode |
| Pin layer | `#pin-markers` sized to the rendered page | `PinOverlay`, sized to the drawing box: markers at `left: x%; top: y%`, 24 px tall regardless of zoom, so they sit on the same spot at every zoom level and on every page |
| Pin placement | "+ Add Pin" → click → status picker | the same: `PinStatusDialog` offers the five statuses; `POST /drawings/{id}/pins {x_pct, y_pct, status, page_number}` |
| Pin detail | number, page, status, notes, Delete | `PinDetailDialog`: the same, plus status change, label, notes and a **Linked finding** select (findings across the project's inspections) via `PUT /pins/{id}`; Delete confirmed |
| Legend | Help page only | the five statuses in their fixed colours under the stage |
| Header menu | — | **Edit drawing** (title, drawing number, discipline via `PUT /drawings/{id}`) and **Delete drawing** (confirmed; pins cascade) for inspectors and owners |

**PDF path** (`usePdfRenderer`, `lib/pdfjs.ts`): `pdfjs-dist` is bundled
and imported the first time a PDF is opened (its own ~440 kB chunk plus the
worker, served from our origin — the legacy SPA pulled pdf.js 3.11 from a
CDN at start-up because of its literal-URL rule). One page renders into one
canvas at the requested zoom; the legacy Block 8E pipeline is ported as is:
the previous render is cancelled and its `RenderingCancelledException`
ignored, a request id drops stale renders, the backing store is released
before the next allocation, and the device pixel ratio is capped by
`safeRenderDpr` — the Samsung Chrome memory hotfix (≤ 12 M RGBA pixels on
phones, 8 M on ≤ 4 GB devices, 64 M on desktop; longest edge 4096 / 8192;
DPR ≤ 1.25 / 2.0). The first render of page 1 of a PDF without stored
dimensions sends `PATCH /drawings/{id}/dimensions {page_width_pts,
page_height_pts}` (Block 8E R6), once.

**Raster path**: PNG, JPG and SVG render in an `<img>` sized to natural ×
zoom. The legacy image path had neither zoom nor panning; here it shares
the stage, so the same pinch, buttons and pins work on a photo overlay.

**Zoom** is a scale on the page's unit viewport (1.0 = one PDF point per CSS
pixel, the legacy 100 %). Buttons step through `ZOOM_LEVELS` (the legacy
0.5–2.0 plus 0.25 and 3.0); pinch and ctrl/⌘ + wheel move continuously
between 25 % and 300 %; the viewer opens at **fit to width**, so a D-size
sheet appears whole on a phone (≈ 26 %) instead of its top-left corner at
100 %. During a pinch the drawing box is scaled live (the canvas stretched
by CSS); on release the zoom is committed and the page re-rendered sharp.
Scroll offsets are corrected so the point under the fingers or the cursor
stays put (`scrollForZoom`). The stage has `touch-action: none` and
`contain: inline-size`, so the browser never zooms the page underneath and
a wide sheet never widens the shell.

### Components added

| Component | Use |
|---|---|
| `Drawings/DrawingsSection` | the project-screen section with upload cards |
| `Drawings/DrawingViewer`, `PinOverlay`, `PinStatusDialog`, `PinDetailDialog`, `DrawingFormDialog` | the viewer screen |
| `hooks/useDrawingUpload`, `usePdfRenderer`, `useViewerGestures`, `useProjectFindings` | upload queue; PDF.js pipeline; pinch / pan / wheel; findings across a project for the link select |
| `lib/drawings.ts` | the pure viewer maths (file kind, zoom steps, fit, render limits, point → percent, page filter, scroll correction) |
| `lib/pdfjs.ts` | lazy PDF.js loader and the small typed surface the viewer uses |
| `lib/queries.ts` → `drawingsQuery`, `drawingQuery`, `drawingViewUrlQuery`, `pinsQuery`, `projectKeys.drawings`, `drawingKeys` | keys shared by the section, viewer and mutations |
| `lib/vocab.ts` → `DRAWING_DISCIPLINE_OPTIONS`, `DRAWING_FILE_TYPES`, `PIN_STATUS_OPTIONS` (with the legacy `PIN_COLORS`) | vocabularies |

### Tests

`src/lib/drawings.test.ts` (11 cases) covers the maths: file kind, zoom
steps and clamping, fit-to-width, the render limits and DPR reduction,
point → percent, the page filter and the scroll correction.
`src/test/drawings.test.tsx` (21 cases) renders the real route tree with
the client and PDF.js stubbed: the section with badges, empty and viewer
states; the presign → PUT (stubbed `XMLHttpRequest`) → register sequence
and its body; refused file types and an out-of-project key; the PDF viewer
opening from the view URL, page 1 pins, dimension capture (and not when
stored), page navigation with per-page pins and the keyboard, zoom
re-rendering at the new scale with the box tracking it, pin placement with
the legacy body on page 2, pin status / notes update, finding link and
delete, the viewer role, edit and delete drawing, a PDF open failure with
retry, not-found for a hidden drawing and a cross-project URL; the raster
viewer without page controls, with zoom and a pin placed on page 1.

Checked in Chromium against a real three-page 17 × 11 in PDF with PDF.js
rendering at desktop (1280 px) and iPhone 13 widths: fit-to-width opens
the whole sheet on the phone (26 %), a synthetic two-finger pinch commits a
new zoom (26 % → 79 %) with the focal point kept, buttons re-render sharp at
125 %, a wide sheet scrolls inside the stage, pins stay on their spots, and
the dimension capture fires once with 1224 × 792 pt.

### Decisions for the owner (increment 09)

19. **PDF.js is bundled (`pdfjs-dist` 6.x) rather than loaded from a CDN or
    wrapped by react-pdf.** The decision brief lists "PDF.js (keep) via
    react-pdf wrapper"; the wrapper hides the render task, which is exactly
    what the Block 8E memory hotfix (cancel, release, DPR cap) needs to
    control, so the ~60 lines of legacy pipeline are ported directly on
    `pdfjs-dist` instead. Same renderer, no runtime dependency on cdnjs.
20. **The viewer opens at fit-to-width and zooms 25–300 %** (the legacy
    opened at 100 % and clamped 50–200 %). Memory is bounded by the DPR cap,
    not the zoom range, so the Samsung guidance still holds; if 300 % proves
    too soft on large sheets the top step is one constant.
21. **Raster drawings zoom and pan too.** The legacy image path showed the
    picture at its natural size with no controls (and the Help page said
    so). Sharing the stage costs nothing and makes a photo overlay usable on
    a phone. Help copy will need the one sentence updated in increment 10.
22. **Pins can be edited** (status, label, notes, linked finding) from the
    detail dialog using the `PUT /pins/{id}` route added in increment 05
    (decision 10). The legacy dialog offered only Delete. The finding list
    offered is every finding across the project's inspections; a pin may
    only link within its project (decision 8).
23. **Drawings can be renamed and deleted** from the viewer's header menu,
    like decisions 11 and 17 for the other objects. The file itself cannot
    be replaced — pins are tied to its page geometry — so a revised sheet
    is a new upload. Delete is confirmed and removes the pins with it.
24. **Several drawings can be uploaded at once** (the legacy input took
    one). A P&ID set is usually a folder of sheets; each still goes through
    presign → PUT → register on its own, so a failed sheet is retried alone.

## Increment 10 — reports, dashboard, members, Help

The last four pieces of the legacy SPA: the Block 6 dashboard (landing
screen), the Block 4 report button, the "👥 Members" modal and the Help
overlay. Reports needed the one legacy route that had no increment (issue
#9); it is ported here as a backend task, see `docs/API_PORT.md` →
"Reports (increment 10)".

### Dashboard — `/`

| Part | Legacy | Screen |
|---|---|---|
| Tiles | five `dashCard`s | `SummaryTiles`: Projects, Inspections, Open findings, High priority, Photos; a tile turns brick (`--color-vri-brick`, the legacy `#7a2020`) when its count is above zero and asks for attention (open, high) |
| Project Health | table with Inspect buttons | `ProjectHealthTable`: the same seven columns on tablets and desktops (open count in copper, high in red when above zero, "Never" when a project has no inspection), **Inspect** → `/projects/$projectId`; on phones one card per project with the four counts, the whole card tappable |
| Recent Activity | ten cards, not tappable | `RecentActivity`: the same ten, each a `ListCard` that opens the inspection (the API returns `project_id`), with the finding-count badge |
| Header | "All Projects" button | **All projects** in the page header and above the table |

`dashboardQuery` (`["dashboard"]`, `staleTime: 0`) re-reads the roll-up on
every visit, as `loadDashboard` did, instead of every mutation invalidating
it. Loading shows five tile skeletons and a list skeleton; a failure shows
`ErrorState` with retry while the shell and navigation stay usable. The
increment 06 connection card is retired: `/dashboard` is the connection
check now.

### Members — bottom of `/projects/$projectId`

| Part | Legacy | Screen |
|---|---|---|
| List | modal rows: role pill, email, ✕ | `MembersSection`: one row per member — role badge (owner in forest green, others copper), email with "(you)" on the caller's own row, "Signed in" / "Invited — has not signed in yet" from `user_sub`, invite date and inviter; **Remove** (✕) on non-owner rows for owners |
| Invite | email + Inspector/Viewer select + "Send Invite" | the same inline form (`react-hook-form` + zod, `noValidate`), `POST /projects/{id}/members {email, role}`; the role stays selected for the next invite |
| Remove | `confirm()` | `ConfirmDialog`, `DELETE /projects/{id}/members/{member_id}` |

The form and the remove buttons are shown to owners (`useProjectRole`
`canManage`); the API's 403 / 409 (already a member) / 400 (owner) are
explained by the toast. Invalidating `["projects", id, "members"]` also
refreshes the role lookup.

### Reports — bottom of `/projects/$projectId/inspections/$inspectionId`

| Part | Legacy | Screen |
|---|---|---|
| Generate | "📄 Report" in the findings header → `window.open(download_url)` | **Generate report** (`ReportsSection`), `POST /reports/generate {inspection_id}` → the new version is placed at the top of the list with a toast |
| Versions | — | `GET /reports?inspection_id=N`: every version newest first, "Latest" on the first, date, who, "4 findings, 12 photos", size, **Download PDF** (`download_url`, `download` attribute with the server's filename, new tab) |

Any member can generate (the API allows viewers; see decision 27). The
list is re-read on every mount like the photos so a presigned link is
never stale.

### Help — `/help`

The legacy overlay's six sections (getting started, device split, core
workflows, field-to-office hand-off, access, troubleshooting) with the hero,
topic pills and footer actions, rewritten for the rebuilt screens: button
names (Take photo / Upload, Log finding, Upload drawing, Generate report),
the viewer that opens fit-to-width and zooms 25–300 % on PDFs and raster
drawings alike (decisions 20–21), editable pins, the members section, report
versions, photo retry. The pin legend is rendered from `PIN_STATUS_OPTIONS`.
The public guide at vrinspector.com/help stays linked from the header for
people who are not signed in; it is static HTML in the legacy repo and is
not changed here (decision 30).

### Components added

| Component | Use |
|---|---|
| `Dashboard/SummaryTiles`, `ProjectHealthTable`, `RecentActivity` | the dashboard |
| `Members/MembersSection` | list, remove, invite form |
| `Reports/ReportsSection` | versions list + generate |
| `lib/queries.ts` → `dashboardQuery`, `dashboardKeys`, `reportsQuery`, `inspectionKeys.reports` | keys shared by screens and mutations |
| `index.css` → `--color-vri-brick` | the legacy attention red as a token |

### Tests

`src/test/dashboard.test.tsx` (10 cases): tiles and their attention
colouring, the health table's cells and Inspect links, recent activity
cards, navigation into a project, the empty and error states, the
per-visit re-read; the Help guide's sections, topic navigation, pin legend,
rebuilt wording (and no legacy wording), footer shortcuts.
`src/test/members-reports.test.tsx` (10 cases): member rows, badges,
self-marking and remove buttons; invite body and refresh; email validation
and a 409; remove after confirmation with the legacy path; the inspector's
read-only view; the empty list; report versions with details and download
links; generate with the legacy body and the new version at the top; the
empty state and a failure; a viewer generating. Shell tests updated for the
real dashboard. 131 total.

Checked in Chromium at desktop (1280 px) and iPhone 13 widths against a
stubbed API: dashboard, project screen with members, inspection screen
with reports, Help — no console errors; the health table becomes cards on
the phone.

### Decisions for the owner (increment 10)

25. **Reports are ported as part of this increment** (issue #9, option 2):
    `POST /api/v1/reports/generate` with the SPA's body and
    `download_url`, plus list/read routes. The legacy route's source did
    not survive, so the PDF is rebuilt from what the inspection screen
    shows (details, sign-off, summary tiles, findings with resolution,
    photos). If the old report had a section this one lacks, say which.
26. **Every report is a kept version.** The legacy route overwrote nothing
    because it recorded nothing; the rebuild numbers versions per
    inspection and keeps each PDF in S3 under `reports/inspections/{id}/`
    (ADR-009). Generation is on demand and synchronous as before;
    regenerate-on-change as a background task is scheduled with the ITP
    pack (increment 14).
27. **Viewers can generate reports.** A report is a read-out of the record
    and the office reviewer is often a viewer. The route is one role check
    away from inspectors-and-owners only.
28. **The PDF does not open automatically.** The legacy `window.open`
    after a network round-trip is blocked by iOS Safari and Android
    Chrome; the new version appears at the top of the list with a
    Download button and a toast instead.
29. **Photos in the report are downscaled** to 1000 px JPEG thumbnails so
    a report with 30 phone photos is a few MB, not 150. Originals stay in
    S3 untouched (decision 16).
30. **The public help page is not regenerated.** The in-app guide now
    describes the rebuilt app; `vrinspector.com/help` still describes the
    legacy one. It is a static file outside this repo and belongs with the
    cutover (increment 11), when the legacy wording stops being true.

## Increment 10.5 — weather badge

The Block 5 badge from the legacy findings screen (issue #9; owner decision
2026-11-08 to keep the shipped feature for parity), on the route ported in
`docs/API_PORT.md` → "Weather (increment 10.5)".

| Part | Legacy | Screen |
|---|---|---|
| Badge | `weather-badge` above the photos: icon + description, `temp_f °F`, `💧 humidity %`, `🌬 wind mph`; only when the project has a location and the lookup succeeded | `Inspections/WeatherBadge`: the same four readings with lucide icons (sun / cloud / fog / rain / snow / thunderstorm by WMO group) plus the place the geocoder resolved, gold left rule on the off-white token; `role="status"` with a spoken summary |
| Request | `GET /weather?location=<project location>&inspection_id=N` after the photos and findings had loaded | `weatherQuery(inspectionId)` → `GET /api/v1/weather?inspection_id=N` in parallel with the rest of the screen; the API resolves the project's location |
| Failure | badge omitted (`try … catch` around the fetch, "weather non-blocking") | badge omitted: `retry: false`, no toast, no error state |
| Freshness | every screen load | `staleTime` ten minutes, matching the server cache |

### Tests

`src/test/findings.test.tsx` (2 new cases): the badge shows the reading,
the spoken summary and the resolved place, asks by inspection id only and
sits above the photos; a 404 leaves no badge and no toast.
`src/components/Inspections/WeatherBadge.test.ts`: the WMO → icon buckets.
The other screen suites stub `WeatherService` to "no reading".

### Decisions for the owner (increment 10.5)

31. **The screen asks by inspection id and the API resolves the location.**
    The legacy SPA sent the project's location text along with the id; the
    rebuilt route accepts both and falls back to the project's stored
    location, so the badge needs no project data on the client. Readings
    are not stored — the badge is live context, as before. If a reading
    should be stamped on the inspection record (the "auto-log" of Block 5),
    say so: a nullable `weather_*` set on `inspections` or a small table is
    one additive migration, and the ITP signature stamp in increment 14
    will need the same lookup.

## Increment 11a — capture loop: drawing tap → finding with photo

PRD v2.63 §4 acceptance criterion ("drawing tap → saved finding with photo
in under 15 seconds on a mid-range Android phone"; gap raised in issue #16,
owner decision 2026-11-08 to build it). One flow, no screen change:

| Step | Before (increments 08–09) | Now |
|---|---|---|
| Tap the sheet | Add pin → tap → status → pin saved → "Pin placed" | the same, with **"Then log a finding with a photo"** on the status dialog (`PinStatusDialog`), ticked by default and remembered per device (`localStorage` `vri.capture.pinThenFinding`) |
| Finding form | separate: back to the inspection → Log finding | `Findings/CaptureFindingDialog` opens as soon as the pin is saved: **Take photo** (rear camera, `capture="environment"`) and **Dictate** as two large buttons, then "What you see", title, inspection, priority, location |
| Prefill | — | title `Pin #N — <sheet>`, location `<sheet>[, page P] — pin #N`; the first dictated sentence becomes the title unless one was typed (`lib/capture.ts` `titleFromTranscript`) — a photo and a spoken sentence (or nothing) is enough to save |
| Which inspection | n/a | open inspections of the project, newest first; pre-selected from `?inspection=N` on the drawing route (set by **Pin on drawing** below), else the one last used for the project on this device, else the newest open one. No open inspection → the dialog says so, keeps the pin, links to the project |
| Photo | uploaded from the inspection screen, filed under the inspection | `hooks/useStagedPhotoUpload`: presign + S3 PUT start the moment the shutter closes and run while the note is dictated; registration waits for the finding so cancelling leaves no rows |
| Save | — | `POST /findings` → `POST /photos {…, finding_id}` per staged photo → `PUT /pins/{id} {finding_id}`; one toast "Finding logged with 1 photo and linked to pin #N". A failed photo upload never blocks the finding (second toast says to add it from the inspection); a failed link keeps the finding and says to link it from the pin |
| Keep pin only | — | leaves the pin exactly as placed (the legacy outcome); the pin can be linked later from its detail dialog as before |
| Entry from an inspection | — | **Pin on drawing** (`Drawings/DrawingPickerMenu`) in the Findings header and as the third button of the phone capture bar: pick a sheet → viewer with `?inspection=N`. Hidden when the project has no drawings |
| On the inspection | photos in the grid only | photos filed under a finding also show as a thumbnail strip on its card (`FindingCard`, opens the photo viewer); the Site photos grid still carries every photo |

### Components added / changed

| Component | Role |
|---|---|
| `Findings/CaptureFindingDialog` | the capture form; owns the staged uploads and the three-step save |
| `Drawings/PinStatusDialog` | + the "then log a finding" switch; `onPlaced(pin, { logFinding })` |
| `Drawings/DrawingViewer` | opens the capture dialog after a pin when the switch is on; `inspectionId` prop from the route search |
| `Drawings/DrawingPickerMenu` | "Pin on drawing" |
| `hooks/useStagedPhotoUpload` | presign + PUT now, `register(findingId)` later |
| `lib/capture.ts` | inspection choice, remembered switch, default title/location, title from dictation (pure, unit-tested) |
| `Photos/PhotoCapture` → `CaptureBar` | `extra` slot for the compact picker |
| route `drawings/$drawingId` | `validateSearch` for `?inspection=N` (ignored when malformed) |
| demo (`src/demo/`) | `POST /photos` takes `finding_id`, `GET /photos` filters by it, two seeded photos filed under findings 1 and 2 |

Backend: `photos.finding_id` (nullable FK → findings, SET NULL, indexed;
migration `d5a1b7c3e902`, additive), `POST /photos` validates the finding
belongs to the same inspection (404 otherwise), `GET /photos` filters by
`finding_id`. See `docs/API_PORT.md` and `docs/DATA_MODEL.md`.

### Tests

`src/test/capture-loop.test.tsx` (5 cases through the real route tree):
the whole loop with the photo registered after the finding and the pin
linked, "Uploading photo…" while the PUT is still in flight; `?inspection=`
pre-selection; Keep pin only + the switch off (legacy toast, remembered);
no open inspection; a failed upload still saves the finding.
`src/test/findings.test.tsx` (+3): photo strip on the card, Pin on drawing
navigates with the inspection, hidden without drawings. `src/lib/capture.test.ts`
(9): the pure choices. `src/test/drawings.test.tsx` runs with the switch
off so the legacy pin-only behaviour stays covered.

`frontend/tests/demo/capture-loop.spec.ts` — the Playwright walk the
increment asked for, in a real Chromium at a 412 × 915 viewport against the
clickable demo build (new Playwright project `demo`, which builds and serves
`dist-demo` itself; the `chromium` project is unchanged). It records the
app's own tap → saved time as a test annotation (≈3 s headless) and asserts
it under 15 s; the stopwatch run on a real phone remains the owner's
(increment 11, `docs/PARITY_CHECKLIST.md` §11 path C).

### Decisions for the owner (increment 11a)

32. **The status tap goes straight on to the finding form by default.** A
    pin placed for its own sake (a verified item, say) costs one extra tap
    ("Keep pin only"), or the switch is unticked once and remembered on the
    device. The alternative — a separate "Log finding here" mode button —
    would have added a tap to every capture. Say so if pin-only should be
    the default instead.
33. **Photos are now filed under the finding they were taken for**
    (`photos.finding_id`, additive). The legacy schema had no such link, so
    "finding with photo" could only mean "a photo somewhere in the same
    inspection". Site photos taken from the inspection screen are unchanged
    (NULL). The report still lists photos under the inspection; grouping
    them under their findings in the PDF is a small follow-up if wanted.
34. **A finding logged from a drawing goes into the open inspection the
    inspector came from, or the last one used, or the newest.** The
    inspection is shown in the form and can be changed. Drawings belong to
    the project, not to an inspection, so some choice has to be made; if a
    project usually has one open inspection this is invisible.

## Increment 13 — ITP screens and Areas (Block 9.5)

New screens:

* **ITP templates** (`/itp-templates`, new sidebar entry): the signed-in
  person's masters, latest version of each, with status, line count and hold
  points; "Show archived". **New template** opens an editor with name,
  description, status and the SurveyJS JSON, pre-filled with a worked
  concrete-pour example; the box is checked as it is typed
  ("5 lines · 1 hold point · 2 sign-off roles", or the exact problem) with
  the same rules the API applies.
* **Template** (`/itp-templates/$templateId`): the line list with
  classification and signing roles, the **SurveyJS form preview** (MIT
  `survey-core` / `survey-react-ui` 3.2.2, loaded as its own chunk), version
  links, **Edit** (saves the next version) and Publish / Move to draft /
  Archive.
* **Project screen** gains **ITPs** (cards with area, status, recorded
  progress, waiting hold points; area filter; **Apply template**;
  **Sign-off roles**) and **Areas** (add one, **Add a series** such as Level
  1–12, rename / retype / nest, move up / down, delete; each row shows its
  ITP progress and opens the area).
* **Apply template** dialog: a master, then the whole project or any number
  of areas with Select all — one frozen copy per area in a single request.
* **Area** (`/projects/$projectId/areas/$areaId`): its ITPs with completion
  and hold-point status, areas inside it, Apply template pre-set to it.
  Increment 14 adds the area's combined sign-off pack here.
* **ITP** (`/projects/$projectId/itps/$itpId`): the checklist by section with
  large Pass / Fail / N/A buttons per line, classification badges, notes,
  required roles with **Sign as …** and the recorded signatures (time and,
  when the device allows, GPS), a lock on every line past an unreleased hold
  point, the list of what still blocks completion, **Mark complete**, and
  Rename / move to area, Reopen, Void / Restore (owner), Delete (unsigned
  only). **Form view** renders the frozen copy with SurveyJS with the
  recorded results filled in.
* **Pins both ways:** each line lists the pins that mark it (opening the
  drawing) and has **Mark on drawing**, which opens the viewer in pin mode
  with a banner naming the line; the placed pin is linked to it. On the
  drawing, a pin that marks a line has a square outline — brick while its
  hold point waits, green once released, amber for other lines — and the pin
  dialog has an **ITP line** picker and a link back to the ITP.

Demo build: `src/demo/fakeItp.ts` answers every new route with the same
rules, seeded with one master and three stages of the sample landfill
project (two with the master applied, the first part-recorded with its hold
point half-signed and marked by a pin on the P&ID).

Tests: backend 33 new (`tests/api/routes/test_itps.py`, `test_areas.py`,
`tests/core/test_itp_template.py`); frontend 9 new unit tests
(`src/lib/itp.test.ts`) and 4 Playwright walks in the demo at phone size
(`tests/demo/itp.spec.ts`): series + bulk apply, hold point → sign → complete
→ form view, mark a line on a drawing and back, template preview + edit → v2.

### Decisions for the owner (increment 13)

39. **Templates are written as JSON**, starting from the worked example. The
    SurveyJS visual form builder is a paid product (the stack brief chose the
    free form library); the AI import in Block 10E is the friendlier way in.
    Every question must say whether it is a hold point, witness point,
    surveillance or record, and a hold point must name at least one role.
40. **Only the person who made a master can apply it** (follows decision
    35, masters belong to an account until the app has a company record).
    Inspectors can make and apply their own.
41. **A hold point locks every later line** until all its roles have
    signed, and the hold line itself must be recorded Pass or N/A before it
    can be signed. A signed line's result cannot be changed.
42. **"Complete" needs every line recorded, no failed lines and every hold
    point released.** Witness-point signatures are shown but do not block
    completion (the witness may decline to attend).
43. **In-app signing:** a role with a signer email is signed only by the
    member signed in with that email (whatever their project role — a client
    engineer invited as a viewer can sign); a role without one is signed by
    a project owner. The time and, if allowed, the phone's GPS are recorded
    now; the drawn signature, weather stamp and no-account email links are
    increment 14.
44. **Signed ITPs cannot be deleted, only voided** (owner only), and a
    voided or complete ITP is read-only until restored or reopened.
45. **Owners manage sign-off roles; owners and inspectors manage areas and
    apply templates.** Viewers can read everything.
46. **Drafts can be applied; archived masters cannot.** Archive hides a
    master from the list and the Apply dialog without touching copies in use.

## Increment 13.5 — email delivery (member invites)

The Members section on the project screen (owners only) now shows, under
each non-owner member, the outcome of their latest invite email from the
send log: "Invite emailed 10 Nov 2026", "Sending invite email…" (the list
re-reads every two seconds while any invite is queued), "Invite email failed
— try Resend invite" (the reason is in the tooltip) or "Invite not emailed —
email is off on this server". **Resend invite** appears on members who have
not signed in yet; a second press within a minute is refused with a plain
message. Adding a member says "Member added — invite email on its way".
Inspectors and viewers never request the owner-only log. The Help page's
"Permissions and access" section says so. The demo records invites instead
of sending them (`src/demo/fakeApi.ts`, one seeded invite on Cedar Hollow).

The invite email itself (React Email, `packages/react-email/emails/member_invite.tsx`):
forest-green VR Inspector band with the gold rule, "You've been added to a
project", who added them, the project, client, role (with one sentence on
what the role can do) and the address to sign in with, a gold **Open the
project** button linking to `/projects/{id}`, and the same link in plain
text. A preview is in `docs/email-previews/member_invite.png`.

### Tests

Backend 17 new tests (`tests/api/routes/test_emails.py`,
`tests/core/test_email.py`, plus the migration guard in
`tests/alembic/test_data_layer_baseline.py`): invite → branded multipart
email + `sent` row; markup in a project name is escaped; transport failure →
`failed` row and the invite still succeeds; unconfigured SMTP → `skipped`;
resend cooldown (429), owner row (400), other project (404); log is
owner-only (403 inspector, 404 outsider, 401 anonymous) and filterable; the
log survives member and project deletion; SMTP transport over a real socket
to an in-process SMTP server, STARTTLS / implicit TLS / no-login paths, a
closed port raising; Mailpit end to end when it is running (CI). Frontend 4
new unit tests (`src/test/members-reports.test.tsx`) and a Playwright walk
in the demo at phone size (`tests/demo/invite-email.spec.ts`).

### Decisions for the owner (increment 13.5)

47. **Adding a member always emails them.** There is no "add without
    emailing" switch; say if you want one.
48. **Mailpit stands in for MailCatcher.** The plan says MailCatcher; the
    template already ships Mailpit, its maintained successor with the same
    SMTP port (1025) and a web inbox (http://localhost:8025), and CI already
    starts it. Nothing else changes.
49. **One attempt per send, then the owner decides.** A failed invite is
    shown as failed with a Resend button rather than retried automatically,
    so a wrong address is not hammered. Increment 14's reminders can add
    timed retries if wanted.
50. **Resend is limited to once a minute per member** and is offered only
    until the person signs in.
51. **The invite comes from `EMAILS_FROM_EMAIL`** with the display name
    "VR Inspector", not from the owner's own address (SES can only send
    from the verified domain). The owner's email is named in the body.
    Set `EMAILS_REPLY_TO` if replies should reach a real inbox.
52. **SES set-up is yours at RG-3:** verify the sending domain (DKIM DNS
    records), request production access (leave the SES sandbox), create SES
    SMTP credentials, and put them in the server environment — the settings
    table is in `docs/API_PORT.md` → Configuration.

## Increment 13.6 — ITP line evidence (owner review 2026-11-10)

Every ITP line can now carry what it asks for and the evidence that answers it.

- **Criteria under the title.** Acceptance criteria, reference document and
  record required (template properties `acceptanceCriteria`, `reference`,
  `recordRequired`) are copied onto the line at import and shown under the
  line title (`LineCriteria`); they will print in the pack (increment 14).
- **Photos on any line.** *Take photo* (rear camera) and *Upload* under the
  result buttons, using the same presign → S3 → register flow as site photos
  with `itp_item_id` in place of `inspection_id` (`useItpPhotoUpload`).
  Thumbnails open the usual photo viewer. A line whose template sets
  `photoRequired: true` shows **Photo required before Pass**, its Pass button
  stays disabled until a photo is on file, and then shows **Photo on file**.
  The API refuses Pass and sign-off on such a line without a photo.
- **Measured values.** Number and text lines (`valueType`, or a SurveyJS
  `text` / `comment` question) show a large entry box with the unit beside it
  and the required range ("required ≥ 1.5 in"). The value is saved on Enter or
  when the box loses focus, alongside Pass / Fail / N/A; a number outside
  `min` / `max` is flagged **Out of tolerance** in brick (not refused).
- **Vocabulary.** Hold (H) / Witness (W) / Review (R) / Information (I).
  Stored `surveillance` → `information` and `record` → `review` (migration
  `a9d4c2e7f318`); template bodies may still use the old words or the letters.
- **Roles.** Parties are labelled Contractor / Owner's representative /
  Third-party inspector (stored as contractor / client / engineer). The
  Sign-off roles dialog offers **Add default roles** while any of the three is
  missing. The starter template uses Contractor and Owner's representative and
  US customary units (inches). (Replaced by the starter library in 13.7.)

### Tests (increment 13.6)

- Backend: `tests/api/routes/test_itp_evidence.py` (7 tests: import copies
  evidence and vocabulary, photo-required blocks Pass and sign-off, evidence
  locked past a hold point / on signed lines / on voided ITPs, last required
  photo cannot be deleted from a passed line, measured value normalising and
  tolerance, photo parent rules, default roles), parser tests in
  `tests/core/test_itp_template.py`, migration round trip in
  `tests/alembic/test_data_layer_baseline.py`.
- Frontend: parser tests in `src/lib/itp.test.ts`; Playwright demo walk
  "line evidence: criteria, required photo, measured value with tolerance"
  in `tests/demo/itp.spec.ts` at phone width.

### Decisions for the owner (increment 13.6)

53. **An ITP line photo belongs to the line, not to an inspection.** ITPs are
    not tied to an inspection, so `photos.inspection_id` became nullable and a
    check keeps every photo attached to exactly one of an inspection or an
    ITP line. Line photos do not appear in the inspection photo grid, the
    dashboard photo count or the inspection report.
54. **Evidence locks with the line.** Photos and measured values can be added
    or changed only while the line itself can be recorded: not past an
    unreleased hold point, not once the line is signed, not on a complete or
    voided ITP. The last photo of a passed photo-required line cannot be
    deleted until the line is set back to pending.
55. **Out of tolerance flags, it does not block.** The inspector still chooses
    Pass or Fail; a flagged value with Pass stays visible to the signer.
56. **Which lines take a value:** a template question with `valueType`
    (number / text), or a SurveyJS `text` (number when `inputType: number`)
    or `comment` question. `valueType: "none"` turns it off. Choice and
    yes/no questions take a result only.
57. **Default roles are offered, not forced.** A project gets the three default
    roles from the *Add default roles* button or from a template that names
    them; templates that name other roles still create those.

## Increment 13.7 — starter template library (owner review 2026-11-10)

Replaces the five-line concrete placeholder with four worked master templates
that every new account starts with.

- **The library.** `backend/app/itp-library.json` (copied to
  `frontend/src/lib/itpLibrary.json`; a backend test fails if the two differ
  in content) holds:

  | Starter | Lines | Hold points | Sections |
  |---|---|---|---|
  | Cast-in-place concrete (ACI 301 / 318; ASTM C31, C39, C94, C138, C143, C172, C231, C1064) | 27 | 8 | 1 Before work · 2 Formwork and embeds · 3 Rebar inspection · 4 Pre-pour release · 5 Placement and after |
  | Earthwork and compaction | 9 | 2 | Before work · Placement · Acceptance |
  | Underground conduit / duct bank before backfill | 12 | 1 | Before work · Installation · Before encasement or backfill |
  | Piping pressure test | 10 | 2 | Before the test · Test · After the test |

  Every line has a measurable acceptance criterion, a reference, the record
  required and an H / W / R / I code; every hold point needs a photo and
  names the roles that release it. Where the number is set by the project
  rather than the code (specified cover, slump and air targets, compaction
  percentage, test pressure, tolerances) the criterion ends *"Project-specific
  value required — verify before issue."* and no `min` / `max` is invented.
  Numbers the codes do fix are stated: clear spacing (ACI 318 §25.2), cover
  tolerance (ACI 117), discharge within 90 min / 300 revolutions (ASTM C94),
  95 °F concrete temperature (the line's `max`), cylinder frequency and
  sampling times (ACI 318 §26.12, ASTM C31 / C172), 7-day curing above 50 °F
  (ACI 318 §26.5.3), the 28-day acceptance rule (ACI 318 §26.12.3), 360° of
  bends between pull points (NEC 344.26 / 352.26). Text is our own; nothing
  is copied from a third-party product.
- **Concrete outline as reviewed.** 1 Before work — mix design (R), rebar shop
  drawings and mill certificates (R), subgrade / compaction (W). 2 Formwork and
  embeds — dimensions / line / level, anchor-bolt template surveyed before the
  pour, embeds / sleeves / penetrations, cast-in grounding (W). 3 Rebar
  inspection — bar size and grade, spacing, laps, ties, chairs / supports,
  clear cover (measured, in), cleanliness: each a hold point with a photo,
  released by the Third-party inspector. 4 Pre-pour release — hot / cold
  weather plan (R, N/A when neither applies) and the release hold signed by
  Contractor + Owner's representative. 5 Placement and after — batch tickets
  incl. water added (R), slump / air / temperature / unit weight entered as
  values (W), cylinders with set IDs and initial curing (W), consolidation (I),
  curing method and duration (W), stripping (I), post-pour anchor-bolt survey
  (R), 7 / 28-day results (R).
- **Seeding.** `GET /api/v1/itp-templates` gives an account that has never had
  a master (no row of any status) the four starters as published version 1
  masters it owns, once (`app/core/itp_library.py`; a per-account advisory
  lock stops two first requests seeding twice). No API shape changed. After
  that they are ordinary masters: edit (new version), archive, apply. They are
  never re-added. `ITP_STARTER_LIBRARY=false` turns seeding off.
- **New template → Start from.** The editor offers each starter or a *Blank
  outline* (one section, one hold-point line showing every field, the three
  default roles); picking one fills name, description and JSON.
- **Demo.** The sample account's masters are the four starters. Project 1:
  concrete on Stage 1 (in progress — submittals and formwork passed, first
  rebar hold released, second waiting for the inspector) and Stage 2 (not
  started); the pressure test on Stage 3 (pressure hold passed at 225 psig,
  waiting for both signatures); the duct bank for the whole project.
- **Phone width.** List cards no longer push past the screen edge when a
  description is long (`ListCard` grid item `min-w-0`). The template detail's
  line table is still cramped on a phone; increment 13.8 (look and feel) takes
  that on.

### Tests (increment 13.7)

- Backend: `tests/core/test_itp_library.py` (library parses, every line has a
  criterion / reference / code, holds need a photo and roles, number lines a
  unit, "per spec" never alone, the concrete outline, frontend copy matches)
  and `tests/api/routes/test_itp_library.py` (new account seeded once and in
  order, accounts independent, archived starters stay archived, an account
  with masters is left alone, the concrete starter imports with its evidence
  and blocking, setting off, the seed function is idempotent).
- Frontend: `src/lib/itpLibrary.test.ts` and the concrete starter in
  `src/lib/itp.test.ts`; the Playwright demo walks in `tests/demo/itp.spec.ts`
  now run on the starters (pressure test completed past two hold points,
  concrete line evidence and the first rebar hold, duct-bank bends tolerance,
  the Start-from picker).

### Decisions for the owner (increment 13.7)

58. **Starters are seeded into the account, not shared.** Each account gets
    its own editable copies the first time it opens its templates; there is
    no central library that changes under people. A later library update
    reaches existing accounts only through *New template → Start from*.
59. **When to seed:** only an account with no master at all. An account that
    already made its own templates (or archived the starters) is left alone.
60. **Rebar lines are released by the Third-party inspector** (IBC 1705.3
    special inspection), the pre-pour and backfill / fill releases by
    Contractor + Owner's representative, the pressure hold and leak check by
    Contractor + Third-party inspector. Witness lines name the Owner's
    representative as the notified party; change any of these per master.
61. **Project-specific numbers are left blank on purpose.** Lines such as
    clear cover or test pressure take a measured value but carry no min / max
    until you edit the master; the starter will not guess a project's number.

## Increment 13.8 — ITP look and feel (owner review 2026-11-10)

The ITP screen was tightened after the owner compared it with HoldPoint; the
green / cream / copper palette and serif headings stay.

- **Document numbers.** Every project ITP has a number
  `ITP-<PROJECT CODE>-<SEQ>` (e.g. `ITP-CH-RNG-002`), shown in copper
  monospace above the title on ITP cards and in the ITP screen's eyebrow (and
  later in the pack PDF). `SEQ` is 1, 2, 3 … per project, given when the ITP
  is created and never reused. The PROJECT CODE is the new optional **ITP
  code** field in *New project / Edit project* (letters, digits, hyphens; up
  to 20; upper-cased as typed). Left blank, a code is derived from the project
  name (initials of its words, or the first four letters of a one-word name)
  and the field's hint shows the numbers that result ("ITPs are numbered
  ITP-LC4-001, ITP-LC4-002 … (from the project name)").
- **Section header bars.** Each template section is a card with a forest-green
  header bar: serif section title, "done / total", and a brick **Sign-off
  required** chip while a hold point in that section is unreleased.
- **One lock notice per section.** Lines past an unreleased hold point no
  longer each carry a banner. The section shows one notice above its first
  locked line — "Locked from line 9 until the hold point on line 8, “Bar size
  and grade”, is signed off by Third-party inspector" (or "This section is
  locked …" when the whole section is) — and locked lines hide Pass / Fail /
  N/A entirely and show a small lock in the gutter.
- **Line cards.** Line number and an H / W / R / I letter chip sit in a fixed
  left gutter (the chip's full name is its tooltip and accessible label; a
  released hold point's chip turns green). Padding is tighter. A **failed
  line is tinted brick** with its note directly under the result buttons
  ("Failed: …"); tapping Fail on a line without a note opens the note box.
- **Three-shot photos** (owner's field guide Ch. 10). A template question can
  set `photoSet: "three_shot"`; the line then shows three labelled slots —
  **Context** ("Wide shot that shows where this is …"), **Intermediate** ("The
  element and what is around it …"), **Close-up with scale** ("Tight on the
  detail with a tape, ruler or scale card in the frame") — each with Take and
  Upload. The line reads "Three-shot set: n of 3 — needed before Pass" until
  every slot has a photo, then "Three-shot set on file"; the API refuses Pass
  and sign-off until then. Extra photos in a slot are allowed; unlabelled
  photos show under "Other photos". The concrete starter's *Bar spacing* hold
  point uses it (13.9 revisits the library).
- **Capture metadata.** Photos are still uploaded byte-for-byte (EXIF intact
  in S3). Every new photo now also records `captured_at` — the time the device
  stamped on the file — next to the upload time.

### Tests (increment 13.8)

- Backend: `tests/api/routes/test_itp_look_and_feel.py` (numbers per project,
  bulk apply continues the sequence, gaps are not reused, code set / relabel /
  refused / cleared, owner only; three-shot pass and sign gating, slot rules,
  `captured_at`, last-photo-in-slot protection), `tests/core/test_doc_numbers.py`
  (derived codes, normalising, `photoSet` spellings), migration backfill and
  guards in `tests/alembic/test_data_layer_baseline.py`.
- Frontend: `src/lib/itp.test.ts` (codes, numbers, `photoSet`, evidence gap),
  `src/test/projects.test.tsx` (ITP code field and preview); Playwright demo
  walks in `tests/demo/itp.spec.ts` at phone width — the new "look and feel"
  walk (numbers on cards and header, five section bars, three lock notices,
  19 locked lines without buttons, the failed forms line, Fail opens the note,
  editing the project code relabels the cards) and the three-shot set on
  *Bar spacing* in the line-evidence walk.

### Decisions for the owner (increment 13.8)

62. **The number follows the project code.** It is worked out when shown, so
    changing a project's ITP code relabels all of its ITPs; the sequence part
    never changes. Say so if a number should be frozen once an ITP is issued
    or signed.
63. **Numbers count per project, gaps stay.** A deleted ITP's number is not
    given out again (as in a document register). Voided ITPs keep theirs.
64. **Derived code when none is set:** initials of the project name's words
    (up to six), or the first four letters of a one-word name. The sample
    project uses an owner-set code, CH-RNG.
65. **Three-shot set replaces the single photo rule on a line** that asks for
    it; extra photos in a slot are fine. Hints are one line each, from the
    field guide's wording in spirit, not quoted.
66. **Capture time is the device's file time.** A phone camera stamps it at
    the shutter; a photo picked from the library carries the file's own date.
    The original file (with any EXIF GPS / time) is kept unchanged in S3.

## Increment 13.9 — book-aligned templates (owner decision 2026-11-10)

The starter library now follows the owner's two published books (sources in
`docs/reference/FIELD_GUIDE_EXCERPTS.md` and
`COMMISSIONING_GUIDE_EXCERPTS.md`, cleared for verbatim use). Every line's
**Reference** names the checklist and item number ("Field guide Checklist A-1
item 7; …") so a line can be traced back to the book.

- **Cast-in-place concrete** (48 lines, 7 hold points) in eight sections:
  1 Before work (rebar, formwork and embedded-items submittals; subgrade);
  2–6 all 25 items of **Checklist A-1** in its five groups — formwork and
  shoring (1–6), reinforcement (7–12, all hold points released by the
  Third-party inspector, each needing a photo), embedded items (13–16, plus
  cast-in grounding), concrete mix and delivery readiness (17–22),
  documentation (23–25); then the **written pre-pour release**; 7 the
  during-pour test set (batch tickets incl. water added, frequency, slump
  C143, air C231, unit weight C138, temperature C1064, four labelled
  cylinders C31, cylinder initial curing 60–80 °F as a value with limits,
  placement, consolidation); 8 post-pour curing and protection (start within
  30 minutes, duration, hot- and cold-weather lines per Ch. 5, stripping,
  post-pour anchor-bolt survey, 7- / 28-day results).
  *Rebar size and spacing* (item 7) asks for the bar count in every row and
  column, spacing measured in at least three locations (entered as a value),
  and the **three-shot photo set**.
- **Release lines.** A template question can set `resultScale: "release"`
  (and `approvedLabel`). The line shows **Approved to pour / Approved with
  conditions / Rejected** instead of Pass / Fail / N/A. *Approved with
  conditions* opens a box to list each condition ("Approve with these
  conditions" stays disabled until something is written); the conditions
  show under the line in a copper-edged box with *Edit conditions* until the
  line is signed. *Rejected* is the brick result and opens the note. The
  status badge reads the result in words, and the Form view ticks the
  matching choice.
- **New starters:** Structural steel connections (A-2, 24 items + signed
  acceptance), Piping pressure test (hydrostatic) (A-3, replaces the 13.7
  version: 25 items with holds on the blind walkdown, test pressure and
  leakage), Electrical pre-energization (A-4, 28 items; the authorization to
  energize is a hold for a new **Owner's electrical engineer** role),
  Instrument calibration (A-5, 20 items, as-found / as-left errors as
  values), and the commissioning guide's Appendix A gates — Pre-commissioning
  readiness, Cold commissioning, Hot commissioning and Ready for startup
  (RFSU) — each 25 items verified by the **Discipline lead** and countersigned
  by the **Commissioning manager**, ending in the authorization as a hold
  (RFSU signed by commissioning, operations, safety and process engineering).
  Earthwork and the duct bank are unchanged from 13.7.
- **Known-errors list.** Book figures that disagree with the standard they
  cite, or that the project sets, read "Project-specific value required —
  verify before issue." The list and the reasons are in
  `docs/reference/KNOWN_ERRORS.md`; a backend test keeps them out.
- **Demo.** Stage 1 concrete has every pre-pour check done, the six rebar
  holds released and the release *Approved with conditions* waiting for the
  Contractor and Owner's representative; Stage 2 has the failed forms line;
  Stage 3 is the new pressure test waiting on the blind-walkdown hold.

### Tests (increment 13.9)

- Backend: `tests/core/test_itp_library.py` (eleven starters parse; every line
  measurable, referenced and with a record; known-error figures absent; each
  book checklist's items present in order; A-1's 25 items in the five groups;
  release, three-shot and the test-set lines), `tests/api/routes/test_itp_release.py`
  (parser rules; Approved / with conditions / Rejected; N/A and stray
  conditions refused; signed release frozen and releasing the hold),
  `tests/api/routes/test_itp_library.py` (seeding and import of the new
  concrete), migration guards in `tests/alembic/test_data_layer_baseline.py`.
- Frontend: `src/lib/itp.test.ts` (resultScale parser port, release helpers),
  `src/lib/itpLibrary.test.ts`; Playwright demo walks at phone width — a new
  release walk (conditions shown, Approved to pour, Rejected with note,
  conditions required, both signatures open the test set) and the existing
  walks reworked on the new starters (the pressure test walked to Complete).

### Decisions for the owner (increment 13.9)

67. **Known-errors list drafted by the session.** No list was found, so
    `docs/reference/KNOWN_ERRORS.md` lists 26 book figures replaced by
    "Project-specific value required — verify before issue", each with the
    reason. Please confirm or strike rows; a confirmed figure can go back in.
68. **Release lines keep Pass / Fail underneath.** Approved and Approved with
    conditions both count as passed (the pour may proceed once signed);
    Rejected counts as failed. N/A is not offered on a release line.
69. **Only the concrete pre-pour release uses the three-way result.** The
    other books' results are two-way (Accepted / Rejected, Pass / Fail,
    Authorized to energize / Do not energize) and stay Pass / Fail holds.
    Any of them can be switched with `resultScale` in the master.
70. **Every rebar check is a hold point**, as in 13.7; the three-shot set is
    on item 7 (size and spacing), the others need one photo each.
71. **Commissioning roles.** The commissioning starters use Discipline lead,
    Commissioning manager and Operations manager (plus Safety manager / PSM
    coordinator, Process engineer and Construction manager on RFSU) instead
    of Contractor / Owner's representative / Third-party inspector.
72. **Existing accounts keep their masters.** Seeding still happens once, for
    accounts with no masters, so an account seeded with the 13.7 library does
    not get the new starters automatically (no live accounts yet). *New
    template → Start from* offers every new starter.

## Increment 14 — external sign-off (PRD v2.63 §5)

| Where | What |
|---|---|
| ITP screen → **Sign-off** tab | `Itps/SignoffPanel`: **Sign-off pack** (Get the current pack → Download vN; versions with time, size, signatures) and **Signatures by email** (Email signing links, Send to one person…, each link with role, email, status, sent / emailed / works-until, **Copy link** and **Open signing page** right after sending, **Remind**, **Withdraw**). Viewers see both cards without the buttons |
| Area screen | the same panel for the area: one combined pack and one link per signer covering every ITP in the area |
| ITP line | signatures show "by email link", the weather stamp and the drawn signature; witness and hold point lines with unsigned roles have **Send notice** (Expected + Message) |
| `/sign/<token>` (no account) | brand header; project, document, "You are signing as …", link expiry, counts, **Download the full pack (PDF)**; per ITP the lines for this signer with result, value, conditions, notes and **Ready for you** / **Signed** / **Not ready: reason** (Show all lines toggles the rest); the form: full name, drawn signature (`signature_pad`, MIT), "I have reviewed…", "Add my location"; then a thank-you with what was signed and the weather; used / expired / withdrawn / replaced / unknown links get a plain explanation. A signed-in visitor (someone previewing from the panel) gets **Back to the app** |

Demo: `src/demo/fakeSignoff.ts` answers every route with the same rules and
seeds a link for Stage 1's Owner's representative —
`demo.html?start=/sign/demo-owners-rep` opens it directly; the pack download is
a real pack rendered by the API (`src/demo/assets/sample-pack.pdf`).

Tests: backend 16 new (`tests/api/routes/test_signoff.py`,
`tests/core/test_signing.py`) plus the migration guard; frontend 8 new unit
tests (`src/test/signing.test.tsx`, `src/lib/signoff.test.ts`) and 2
Playwright walks in the demo at phone size (`tests/demo/signoff.spec.ts`:
pack → open the link → draw on a real canvas → sign → back on the ITP with
the stamp, pack v2).

### Decisions for the owner (increment 14)

73. **One link signs every ready line for that signer, once.** If more lines
    become ready later, send a new link (or let the reminder do it). Lines
    that are not ready are shown with the reason and left alone.
74. **Reminders send a new link.** Only a fingerprint of each link is kept
    (so a leaked database cannot be used to sign), which means the old link
    cannot be re-sent; a reminder issues a fresh one and the old one says
    "replaced by a newer one". Automatic reminders (after 3 days, at most
    twice) run from a scheduled job set up at RG-3 deployment.
75. **The signer types their name and draws a signature; their email is the
    one the link was sent to.** No account, no code by SMS. Say if you want a
    one-time code as a second check for hold points.
76. **The weather stamp is the reading at the project's location** (same
    service as the weather badge), not at the signer's GPS position. In-app
    signatures now get it too. If the weather service is down, the signature
    still goes through without it.
77. **Packs are made when asked for and after every signature,** and only
    when something on them changed — opening the pack twice does not create
    two versions. Every version is kept in S3. Photos print as thumbnails (up
    to six per line); the line shows a compact signature mark and each
    ITP ends with a signature register carrying the full stamps.
78. **Owners and inspectors send, remind and withdraw links and notices;**
    viewers can see the links and download packs.
79. **Witness / hold point notices** go to the line's signers that have an
    email, with a free-text "expected" time and message; they are not
    calendar invites.
80. **An area pack covers the area's own ITPs** (not those of areas nested
    inside it) and leaves voided ITPs out.

## Increment 14.5 — drawing pins, round two (owner decision 2026-11-10)

The normalized-coordinate pin overlay stays as it is; three things are added.

| Where | What |
|---|---|
| Drawing screen → **⋯** menu | **Upload new revision** (file + revision label, suggested from the current one: A → B, 0 → 1, P1 → P2; an unlabelled sheet becomes Rev A), **Revisions (n)** (newest first, current marked, each opens in the viewer), **Delete Rev X only** (the previous revision becomes current again) and **Delete drawing (all revisions)**. The header names the revision ("Rev B", or "Rev A (old revision)") |
| Viewer, current revision | pins copied from the previous revision carry a dashed gold ring and a "?"; a banner "*n* pins carried from Rev A — check their positions" with **Next pin to check**; the pin's details say "Carried from Rev A — check position" with **Position is right** and **Move pin**; once settled it says who checked it and when |
| Viewer, old revision | a banner "You're looking at Rev A, replaced on …. It is kept as it was: its pins can't be changed." with **Open Rev B**; no Add pin, pin details read-only, no Edit / Delete / Upload in the menu |
| Viewer, any pin | **Move** in the pin's details: the next tap on the sheet (on the page shown) is the pin's new spot |
| Viewer toolbar → **Filter** | show / hide by status (five ticks) and **Show**: All pins / Linked to an ITP line (any, or *Which ITP*) / Linked to a finding / Not linked / Position to check; the button turns gold and shows "3/5" while a filter is on, the pin count reads "3 of 5 pins"; **Show all pins** resets. Remembered on the device per project (`localStorage` key `vri.pinFilters.v1.<project>`) |
| Viewer, any zoom | pins whose markers would overlap (centres closer than 22 px at the current zoom) collapse into a round numbered **cluster** coloured by its most urgent status; tapping it zooms in just enough to separate them, keeping them under the finger; pins on the very same spot list themselves to pick from instead |
| Project → Drawings | one card per sheet at its current revision, with a "Rev B" tag and "*n* pins to check" |

Not included, as decided: tiled rendering for very large sheets (only if the
on-device check in issue #16 shows slow zoom).

Demo: the Site Plan is on Rev B with Rev A kept read-only and one carried pin
waiting for a check; the P&ID has two valves close enough to cluster when
zoomed out. Every route answers in `src/demo/fakeApi.ts`.

Tests: backend 17 new (`tests/api/routes/test_drawing_revisions.py`) plus the
migration guard; frontend 24 new unit tests (`src/test/pinView.test.ts`, 7
viewer tests in `src/test/drawings.test.tsx`) and 3 Playwright walks in the
demo at phone size (`tests/demo/drawing-revisions.spec.ts`).

### Decisions for the owner (increment 14.5)

81. **A revision is its own drawing record grouped with its sheet.** Rev A
    keeps its file, its pins and their history untouched; Rev B starts with
    copies. Findings and ITP lines linked from a pin stay linked from the
    copy; an ITP line lists only the pins on current revisions.
82. **Every pin is carried, whatever its status,** at the same page and
    x / y, flagged until someone presses **Position is right** or moves it.
    If the new revision has fewer pages, pins on the missing pages stay
    flagged and are reached with **Next pin to check**; move them to a page
    that exists.
83. **An unlabelled sheet becomes Rev A** the first time it is revised, and
    the suggestion follows the last label. Labels are stored upper-case
    without a typed "Rev" and must be unique within the sheet.
84. **Old revisions cannot be deleted on their own** — they are the record
    of what the sheet showed. Deleting the current revision alone brings the
    previous one back; deleting the drawing removes every revision.
85. **Pins can now be moved** (any pin, not only carried ones) — the legacy
    app had no move; a move is an ordinary edit, no history is kept of the
    old position except on the old revision.
86. **Clusters start at 22 px** between marker points (a marker is 24 px
    wide) and are coloured by the most urgent status inside (punch item,
    then not installed, in progress, not started, verified). Filters are per
    device and project, not shared with the team.

## Increment 15 — AI capture assistance (PRD v2.62 Block 10A / 10B)

The guardrails decide the shape of every screen: AI output is only ever a
**draft** in a form the inspector already uses, marked with a gold "AI
draft" notice, and nothing is saved until the inspector's own button. The
save carries the draft's id so the server logs the confirmation (and whether
anything was changed) next to the prompt and model version. With no API key
on the server (`GET /ai/status` → `enabled: false`) every AI button is
hidden and the screens are exactly as before.

| Where | What |
|---|---|
| Inspection → **Log a finding** | **Draft with AI** beside Dictate, once there is a note: the dictated / typed description is structured into title, priority, discipline, description and location (and status, when the note says it is being fixed or already fixed). Gold notice "AI draft — check every field. Nothing is saved until you tap Log finding." with **Undo** (puts the inspector's own words back; the draft is logged as dismissed). New optional **Discipline** select (drawing disciplines) on create and edit |
| Drawing → pin → capture form (11a) | the same, and automatic: when **Dictate → Stop** ends with a note, the draft is asked for at once, so the loop is tap → photo → speak → check → **Save finding** (PRD v2.62 §3). The title is left alone if the inspector typed one. **Discipline** starts from the drawing's own discipline |
| Inspection → photo → viewer | under each site photo: its filing (category, defect tags, severity, "AI-assisted") and **Analyse with AI** / **File photo**. Analysis shows the draft in an editor: category, defect toggles with the model's confidence and a note of where in the frame, severity. **File photo** confirms (edited or not), **Log as finding** opens Log a finding pre-filled with the draft's title, description and severity-as-priority, **Dismiss** sets it aside. Filing by hand works without AI. ITP line evidence is not analysed |
| Finding card | discipline beside the location, a copper **AI-assisted** mark; expanded, "Drafted with AI from a dictated note / a photo, edited before saving / saved as drafted", the model version, prompt version, who asked and confirmed, and the transcript |

Demo: the in-browser API answers the AI routes with canned photo analyses
for the five sample photos and a small keyword reading of a note
(`src/demo/fakeAi.ts`), labelled as the demo model. Playwright walks both
halves at phone size (`tests/demo/ai-capture.spec.ts`).

Tests: backend 21 new (`tests/api/routes/test_ai.py`, the model replaced by
`tests/utils/claude.py`) plus the migration guard; frontend 9 new unit tests
(`src/test/ai.test.tsx`) and 2 Playwright demo walks.

### Decisions for the owner (increment 15)

87. **Model and cost.** The server asks for `claude-sonnet-4-5` (setting
    `AI_MODEL`, changeable without code) and logs the exact version that
    answered. Photos are sent as a 1568-pixel JPEG copy (the original in S3
    is untouched). Each person can ask for at most 200 drafts a day
    (`AI_DAILY_LIMIT_PER_USER`, 0 = no cap) — a cost guard for a low-budget
    project; past it the screens say so and the form is filled by hand.
88. **The API key is an owner action at RG-3** (`ANTHROPIC_API_KEY` in the
    server environment, never in the repo). Until then AI stays hidden in the
    real app; the demo shows it with canned answers.
89. **What is sent to the model:** the photo (straight from S3, server side)
    or the transcript, plus the inspection's type and title and the location
    already filled in. Nothing else — no names, no project or client. This is
    the PRD guardrail "no photo or transcript leaves S3 / RDS except to the
    contracted model API".
90. **Dictation drafts automatically in the capture form** (the 15-second
    loop) but only on request in Log a finding. Say so if either should be
    the other way.
91. **Photo vocabulary.** Categories: progress, defect, safety, materials,
    equipment, documentation, other. Defects are the five the PRD names
    (crack, corrosion, water ingress, damage, safety hazard); severity low /
    medium / high, which becomes the finding's priority on Log as finding.
    "Log as finding" does not yet file the photo under the new finding;
    attach it from the inspection screen if needed (small follow-up).
92. **The AI log is kept even when a draft is dismissed or fails**, and a
    database downgrade refuses to drop it. Viewers can read it; only owners
    and inspectors can ask for or act on drafts, and only while the
    inspection is open.
