# Screens (increments 07–10)

How the operational screens are built on the shell from increment 06
(`docs/FRONTEND_SHELL.md`), against the API contract in `docs/API_PORT.md`.
Owner decisions are numbered on from `docs/API_PORT.md` (1–10): 11–14 in
increment 07, 15–18 in increment 08.
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
| Weather badge | `GET /api/weather` | **not shown yet** — the route is not ported (issue #9); the section slots in above the photos once it is |

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
18. **The weather badge waits for issue #9.** Nothing on this screen calls
    `/weather`; when the route is ported the badge slots in above the
    photos.

## Later increments

- 09 — drawings section + viewer join the project screen.
- 10 — members panel joins the project screen; reports, dashboard roll-up,
  in-app Help.
