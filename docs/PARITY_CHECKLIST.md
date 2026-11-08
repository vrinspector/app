# Parity checklist — legacy staging SPA vs the rebuilt app

Increment 11 of `REBUILD_PLAN.md`; acceptance criteria from PRD v2.63 §4
(Block 9): every verified v2.61 behaviour reproduced and confirmed by a
side-by-side staging checklist, pin alignment parity at every zoom level,
the capture loop under 15 seconds on a mid-range Android phone, pinch-zoom
with button fallback, brand tokens and state patterns throughout, and a
device pass on iPhone Safari, Android Chrome, iPad Safari and desktop.

This file has two halves. The **code parity read** (columns "Current app",
"Rebuilt app", "Parity") was filled in from the source: the legacy SPA
(`vrinspector/frontend` → `staging_snapshot_20260716/staging_index_with_help_private.html`)
against the screens documented in `docs/SCREENS.md`, `docs/FRONTEND_SHELL.md`
and `docs/API_PORT.md`. The **side-by-side result** column is empty: it is
filled in by the owner with both apps open on the same staging database, and
the increment is marked done only when that column is complete and the
sign-off block at the end is filled in.

Parity codes: **Same** — behaves as the current app; **Changed (dec. n)** —
deliberately different, recorded as owner decision *n* in `docs/API_PORT.md`
or `docs/SCREENS.md` (**Changed (inc. NN)** when the change is a property of
the shell or of increment NN as a whole, see `docs/FRONTEND_SHELL.md` /
`docs/SCREENS.md`); **New (dec. n)** — exists only in the rebuilt app;
**Gap** — in the current app or the PRD but not yet in the rebuilt app.

## How to run it

1. Open the current app (`https://staging.vrinspector.com`) in one browser tab
   or on one device, and the rebuilt app's preview in another. Both must point
   at the **same staging database and S3 bucket** (PRD v2.63 §4: "same
   database, same API: no data migration"), so a project created in one shows
   up in the other after a refresh. Where the preview runs is an owner
   decision — see the increment 11 issue on GitHub.
2. Sign in to both with the same Auth0 account. Run the checklist once as an
   **owner** of a test project; the rows marked *(viewer)* or *(inspector)*
   need a second sign-in with that role (invite a second address from the
   Members section).
3. Work through the tables in order. For each row, do the step in the current
   app, do it in the rebuilt app, and write **Pass** (same result, or the
   recorded change is acceptable), **Differs** (with a note of what you saw),
   or **Skip** (with why). A "Differs" on a row marked *Changed* means the
   decision needs revisiting, not that the port is wrong.
4. Then do the capture-loop timing and the device pass, and fill in the
   sign-off block.

Use a throwaway test project named `Parity YYYY-MM-DD` so the rows that
create, edit and delete things do not touch real inspections.

## 1. Sign-in, shell and navigation

| # | Step | Current app | Rebuilt app | Parity | Side-by-side result |
|---|---|---|---|---|---|
| 1.1 | Open the app signed out | Login gate: "VR Inspector — Inspect. Document. Verify.", **Sign In** | `/login`: "Sign in to VR Inspector", **Sign in**; same Auth0 hosted page | Same | |
| 1.2 | Sign in | Auth0 code flow with PKCE, token kept for the tab | Auth0 SDK, same flow; silent renewal bounded at 10 s | Same | |
| 1.3 | Land after sign-in | Dashboard | Dashboard (`/`) | Same | |
| 1.4 | Who am I | Name/email badge in the top bar | Name/email in the sidebar footer (icon rail on tablets, sheet on phones) | Changed (inc. 06) | |
| 1.5 | Sign out | **Sign Out** in the top bar → Auth0 logout → login gate | **Sign out** in the sidebar user menu → Auth0 logout → `/login` | Same | |
| 1.6 | Session expiry | Request fails; screen shows "Error: 401" | Sent to `/login?reason=expired` with "Sign in again to pick up where you left off", returns to the same screen | Changed (inc. 06) | |
| 1.7 | Go back | ← in the top bar walks dashboard ← projects ← project ← inspection | ← in every page header, plus the browser/phone back button and shareable URLs | Changed (inc. 06) | |
| 1.8 | Help | **Help** in the top bar opens the guide overlay | **Help** in the header and in the sidebar opens `/help` | Same | |
| 1.9 | Brand | Forest green / parchment / copper palette, Bootstrap badge colours | v2.51 palette tokens, status badge colours carried over (light and dark) | Same | |
| 1.10 | Loading / empty / error | "Loading…" text; "No … yet." boxes; "Error: …" box | Skeletons; empty states with a next action; error states with **Retry** | Changed (inc. 06) | |
| 1.11 | Phone layout | Single column, top bar | Single column, sidebar collapses to a sheet, sticky capture bar on inspections | Changed (inc. 06) | |

## 2. Dashboard (`/`)

| # | Step | Current app | Rebuilt app | Parity | Side-by-side result |
|---|---|---|---|---|---|
| 2.1 | Summary tiles | Projects, Inspections, Open Findings, High Priority, Photos; Open/High turn red above zero | The same five tiles with the same numbers; brick colour above zero | Same | |
| 2.2 | Project Health table | Project, Insp, Open, High, Photos, Last Insp, **Inspect** | Same seven columns; open count in copper, high in red; "Never" when no inspection | Same | |
| 2.3 | Project Health on a phone | Horizontal scroll of the table | One card per project with the four counts, the whole card tappable | Changed (inc. 10) | |
| 2.4 | **Inspect** | Opens the project | Opens the project | Same | |
| 2.5 | **All Projects** | Opens the project list | **All projects** in the header and above the table | Same | |
| 2.6 | Recent Activity | Ten cards (title, project — inspector, date, "N findings"), not tappable | The same ten cards, each opens the inspection | Changed (inc. 10) | |
| 2.7 | Numbers refresh | Re-read every time the dashboard opens | Re-read every visit (not cached) | Same | |

## 3. Projects (`/projects`)

| # | Step | Current app | Rebuilt app | Parity | Side-by-side result |
|---|---|---|---|---|---|
| 3.1 | List | "Projects (N)", filter box, cards: name, client — location, status badge, › | The same, as `ListCard`s | Same | |
| 3.2 | Filter box | Hides cards whose name/client/location do not contain the text | Same, client-side | Same | |
| 3.3 | **+ New Project** | Modal: Project Name *, Client / Owner, Location, Status (Active / On Hold / Complete) → **Create Project** → back to the list | Dialog with the same fields and vocabulary → **Create** → opens the new project | Changed (dec. 14) | |
| 3.4 | Required name | Toast "Project name required" | Inline validation message | Same | |
| 3.5 | Empty list | "No projects yet. Create your first project." | Empty state with **New project** | Same | |
| 3.6 | Tap a card | Opens the project | Opens `/projects/{id}` | Same | |

## 4. Project screen (`/projects/{id}`)

| # | Step | Current app | Rebuilt app | Parity | Side-by-side result |
|---|---|---|---|---|---|
| 4.1 | Header | Project name, ← | Project name, ←, details card (client, location, status), owner menu | Same | |
| 4.2 | Edit project *(owner)* | — | **Edit** in the header menu: same fields as create | New (dec. 11) | |
| 4.3 | Delete project *(owner)* | — | **Delete** with confirmation; inspections, findings, photos, drawings go with it | New (dec. 11) | |
| 4.4 | Drawings section | "Drawings (N)", thumbnails with discipline and PDF badges, **📄 Upload Drawing** (one file) | Cards with the same badges, **Upload drawing** (several files; PDF, PNG, JPG, SVG ≤ 50 MB), filter box once there are more than three | Changed (dec. 24) | |
| 4.5 | Upload a drawing | "Uploading drawing…" line; thumbnail appears on reload | Upload card with progress and **Retry**; card appears when registered | Same | |
| 4.6 | Refused file (e.g. .docx or > 50 MB) | Browser file picker filters by type; a bad type fails at presign | Refused before any request, with the reason | Same | |
| 4.7 | Inspections section | "Inspections (N)", filter box, **+ New Inspection**, **👥 Members**, cards: title, inspector — date, status + type badges | The same list and filter; **New inspection**; Members is a section lower on the page (row 8) | Same | |
| 4.8 | **+ New Inspection** | Modal: Title *, Type (Civil, Structural, Mechanical, Electrical, Piping / P&ID, General), Inspector Name, Notes → **Create Inspection** → back to the list | Same fields and vocabulary; type defaults to Civil and inspector to the signed-in name → opens the new inspection | Changed (dec. 13, 14) | |
| 4.9 | Tap an inspection card | Opens the inspection | Opens `/projects/{id}/inspections/{id}` | Same | |
| 4.10 | Inspector / viewer view *(inspector, viewer)* | All buttons shown; the API refuses with 403 | Viewers see no write buttons; inspectors see no project edit/delete; a 403 is still explained if it happens | Changed (dec. 1–6, role policy) | |

## 5. Inspection screen (`/projects/{id}/inspections/{id}`)

| # | Step | Current app | Rebuilt app | Parity | Side-by-side result |
|---|---|---|---|---|---|
| 5.1 | Header | Inspection title, ← | Title, ←, details (type, inspector, date, notes), menu (Edit / Delete) | Same | |
| 5.2 | Weather badge | Conditions, °F, humidity, wind above the photos (when the project has a location) | **Not shown** — the weather route is not ported (issue #9) | Gap | |
| 5.3 | Site photos grid | "Site Photos (N)", thumbnails with filename, **📷 Capture Photo** | "Site photos (N)", thumbnails newest first, **Take photo** (rear camera) and **Upload** (library, several) | Same | |
| 5.4 | Take a photo on a phone | Camera opens directly; "Uploading photo…"; toast "Photo uploaded"; grid reloads | Camera opens directly; tile with progress; thumbnail in place before the toast fades; **Retry** on failure | Same | |
| 5.5 | Photo upload path | Presign → direct PUT to S3 → register (bytes never pass through the API) | The same three steps, same bodies | Same | |
| 5.6 | Tap a photo | — | Full-size viewer with filename, who/when, previous/next, **Delete photo** *(inspector, owner)* | New (dec. 17) | |
| 5.7 | Photos after sign-off | **Capture Photo** still enabled | **Take photo / Upload** still enabled; the sign-off bar says so | Same (dec. 15) | |
| 5.8 | Findings header | "Findings (N)", search box, All Status / Open / In Progress / Resolved, **+ Log Finding**, **✓ Sign Off**, **📄 Report** | "Findings (N)", search + status filter, **Log finding**; **Sign off** in the sign-off bar; **Generate report** in the Reports section (row 7) | Same | |
| 5.9 | Search and status filter | Hides cards client-side | Same | Same | |
| 5.10 | **+ Log Finding** | Modal: Title *, Description with **🎤 Dictate**, Priority (High / Medium / Low, Medium selected), Location Reference → **Log Finding** | Dialog with the same fields, defaults and **Dictate** (shown where the browser can dictate) | Same | |
| 5.11 | Dictate | Web Speech, appends the transcript to the description; alert on unsupported browsers | Same; button hidden instead of an alert where unsupported | Same | |
| 5.12 | Finding card | Title, 80-character excerpt, priority + status badges, location reference; resolved cards dimmed with "✓ Resolved by … — date" and the notes | The same; tapping the title expands the full description and dates | Same | |
| 5.13 | Status buttons by state | open → **→ In Progress · ✓ Resolve**; in-progress → **↺ Reopen · ✓ Resolve**; resolved → **↺ Reopen** | The same three sets | Same | |
| 5.14 | Resolve | Modal for resolution notes → resolved | Dialog for notes → resolved | Same | |
| 5.15 | Edit / delete a finding | — | **Edit** (same fields) and **Delete** (confirmed; pins pointing at it are unlinked) | New (dec. 17) | |
| 5.16 | Sign off | **✓ Sign Off** → bar "🔒 Signed off by … — date" with **↺ Reopen**; **+ Log Finding** disabled | **Sign off** (confirmed) → the same bar with **Reopen**; Log finding and edits hidden until reopened | Same (dec. 12) | |
| 5.17 | Log a finding while signed off (API) | 409 from the API | Button hidden; a 409 raised anyway is explained by a toast | Same | |
| 5.18 | Phone capture bar | — | Sticky **Take photo / Log finding** at the bottom of the screen on phones | New (inc. 08) | |

## 6. Drawing viewer (`/projects/{id}/drawings/{id}`)

Pin alignment is the acceptance criterion that matters most here (PRD §4):
place pins in both apps and confirm each sits on the same feature of the
sheet at every zoom step and after a page change.

| # | Step | Current app | Rebuilt app | Parity | Side-by-side result |
|---|---|---|---|---|---|
| 6.1 | Open a PDF drawing | Modal viewer; page 1 at 100 %; Prev · "Page n of N" · Next; − % + (50–200 %) | Own screen; page 1 **fit to width**; the same page controls; − % + and **Fit** (25–300 %) | Changed (dec. 20) | |
| 6.2 | Open a PNG/JPG drawing | Picture at natural size, no zoom, no page controls | Same stage as PDFs: zoom, pinch and pan; no page controls | Changed (dec. 21) | |
| 6.3 | Page navigation | Prev / Next re-render the page; pins of that page only | Same, plus ← → keys | Same | |
| 6.4 | Zoom buttons | Steps 50 / 75 / 100 / 125 / 150 / 200 % | Steps 25 … 300 % plus **Fit**; sharp re-render at each step | Changed (dec. 20) | |
| 6.5 | Pinch-zoom and pan (phone/tablet) | Browser page zoom only | Two-finger pinch zooms the sheet around the fingers; one-finger drag pans; the page beneath never zooms | New (PRD §4 criterion) | |
| 6.6 | Memory safeguard on phones | Samsung Chrome hotfix: render DPR capped, previous render cancelled and released | The same pipeline ported; same caps | Same | |
| 6.7 | Pins hold position across zoom | Overlay sized to the rendered page; markers at x %, y % | Same maths; markers 24 px at every zoom | Same | |
| 6.8 | Pins hold position across pages | Pins carry `page_number`; only the current page's pins show | Same | Same | |
| 6.9 | Pin colours | Verified green, In Progress blue, Punch Item yellow, Not Installed red, Not Started grey | The same five, legend under the stage | Same | |
| 6.10 | **+ Add Pin** → tap → status | Status picker at the tap point; pin saved with x %, y %, status, page | **Add pin** → tap → status dialog → saved with the same body; Esc cancels | Same | |
| 6.11 | Tap a pin | Detail: number, page, status, notes, **Delete** | Detail: the same, plus status change, label, notes and **Linked finding** (findings across the project), **Delete** confirmed | Changed (dec. 22) | |
| 6.12 | Dimension capture | First render of a PDF without stored dimensions saves page width/height | Same, once | Same | |
| 6.13 | Edit / delete the drawing *(inspector, owner)* | — | Header menu: **Edit drawing** (title, number, discipline), **Delete drawing** (confirmed; pins go with it) | New (dec. 23) | |
| 6.14 | Close the viewer | ✕ on the modal | ← or the phone back button; the URL can be shared | Changed (inc. 09) | |

## 7. Reports

| # | Step | Current app | Rebuilt app | Parity | Side-by-side result |
|---|---|---|---|---|---|
| 7.1 | Generate | **📄 Report** on the findings header; screen shows "Generating report…"; PDF opens in a new tab | **Generate report** in the Reports section; the new version appears at the top of the list with **Download PDF** and a toast | Changed (dec. 28) | |
| 7.2 | Report content | Legacy PDF (its source did not survive the transfer) | Details, sign-off state, summary tiles, findings with resolution notes, photo thumbnails | Changed (dec. 25) — **compare the two PDFs section by section and note anything missing** | |
| 7.3 | Versions | None kept | Every report kept, newest first, with date, who, counts and size | New (dec. 26) | |
| 7.4 | Viewer generates *(viewer)* | Allowed | Allowed | Same (dec. 27) | |
| 7.5 | Photo size in the PDF | Unknown | Thumbnails at 1000 px; originals untouched | Changed (dec. 29) | |

## 8. Members

| # | Step | Current app | Rebuilt app | Parity | Side-by-side result |
|---|---|---|---|---|---|
| 8.1 | Open | **👥 Members** modal on the project screen | **Members** section at the bottom of the project screen | Changed (inc. 10) | |
| 8.2 | List | Role pill (Owner green, others copper), email, ✕ on non-owners | The same, plus "(you)", "Signed in" / "Invited — has not signed in yet", invite date and inviter | Same | |
| 8.3 | Invite | Email + Inspector / Viewer + **Send Invite**; toast; list reloads | Same inline form; the role stays selected for the next invite | Same | |
| 8.4 | Invite an existing member | Toast "Error: …" | Toast explaining the 409 | Same | |
| 8.5 | Remove *(owner)* | `confirm()` → removed → toast | Confirmation dialog → removed | Same | |
| 8.6 | Non-owner view *(inspector)* | Form and ✕ shown; API refuses | Form and **Remove** hidden | Changed (dec. 1–6, role policy) | |

## 9. Help (`/help`)

| # | Step | Current app | Rebuilt app | Parity | Side-by-side result |
|---|---|---|---|---|---|
| 9.1 | Sections | Getting started, device split, core workflows, field-to-office hand-off, access, troubleshooting; hero, topic pills, footer | The same six, rewritten for the rebuilt buttons and viewer; pin legend from the vocabulary | Changed (inc. 10) | |
| 9.2 | Public guide | `vrinspector.com/help` describes the current app | Still linked, still describes the current app — to be regenerated at cutover | Gap (dec. 30) | |

## 10. PRD §4 acceptance criteria not covered by a screen row

| # | Criterion | Rebuilt app | Parity | Side-by-side result |
|---|---|---|---|---|
| 10.1 | Brand palette tokens replace stock Bootstrap colours | `index.css` tokens; status badges keep the legacy colours as tokens | Same | |
| 10.2 | Loading skeletons, empty states, error states throughout | `LoadingState`, `ListSkeleton`, `EmptyState`, `ErrorState`, `QueryState`, `DetailState` on every screen | Same | |
| 10.3 | Touch targets sized for gloved use | shadcn defaults (36–40 px buttons); capture bar buttons 48 px — **check on a phone with gloves or a stylus** | Verify | |
| 10.4 | Capture loop: drawing tap → saved finding with photo in under 15 s on a mid-range Android phone | See §11. There is no single tap-to-finding flow yet: a pin links to an **existing** finding; a new finding and its photo are logged on the inspection screen | Gap — see the increment 11 issue | |
| 10.5 | Pinch-to-zoom and pan; button zoom retained | Both present (rows 6.4–6.5) | Same | |
| 10.6 | Device pass: iPhone Safari, Android Chrome, iPad Safari, desktop | See §12 | Owner | |

## 11. Capture-loop timing

The PRD defines the loop as **drawing tap → saved finding with photo**, under
15 seconds on a mid-range Android phone. Time it with a stopwatch (or a
screen recording) in both apps, three runs each, on a phone on mobile data
rather than office Wi-Fi. Start the clock on the first tap and stop it when
the finding card is visible with its photo registered.

Because neither app has a single tap-to-finding flow today, time the two
halves that exist, then the closest end-to-end path:

| Run | Path | Current app | Rebuilt app | Notes |
|---|---|---|---|---|
| A1–A3 | Inspection screen → **Take photo** → shutter → thumbnail in the grid | | | upload of a full-size phone photo; see decision 16 on downscaling |
| B1–B3 | Inspection screen → **Log finding** → title, priority → save → card visible | | | |
| C1–C3 | Drawing viewer → **Add pin** → tap → status → (back to the inspection) → **Take photo** → **Log finding** → save | | | the nearest end-to-end path to the PRD loop today |
| D | Mid-range Android used (model, Android version, network) | | | |

Median of each triple goes in the sign-off block. If C is over 15 s in the
rebuilt app, the fix belongs to a short capture-loop UX increment (see the
increment 11 issue), not to this checklist.

## 12. Device pass

One pass per device, on the rebuilt app, each row a short note (what was
checked, anything odd). The open RG-2 iPad items fold in here if still open.

| Device | Browser | Sign-in | Dashboard | Projects / inspection | Photo capture | Drawing viewer (pinch, pins) | Report download | Notes |
|---|---|---|---|---|---|---|---|---|
| iPhone | Safari | | | | | | | |
| Android (mid-range) | Chrome | | | | | | | |
| iPad | Safari | | | | | | | |
| Desktop | Chrome / Edge | | | | | | | |
| Desktop | Safari / Firefox (optional) | | | | | | | |

## 13. Sign-off

| Item | Value |
|---|---|
| Date of the side-by-side run | |
| Preview URL of the rebuilt app | |
| Rows marked Differs (list the numbers) | |
| Capture-loop medians (A / B / C, rebuilt app, seconds) | |
| Device pass complete (yes / no, missing devices) | |
| Owner decisions revisited (numbers) | |
| Legacy SPA may be retired after cutover tasks (yes / no) | |
| Signed off by / date | |

When this block is complete, the PR that carries the filled-in checklist
marks increment 11 `[x]` in `REBUILD_PLAN.md`; the same sign-off is recorded
in the PRD before the legacy SPA is retired (PRD v2.63 §4, approach step 3).
