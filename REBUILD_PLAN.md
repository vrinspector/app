# VR Inspector Rebuild Plan

Single source of truth for rebuild increments. Automated and interactive sessions both work from this file.

## Session rules

1. Read `README.md`, this file, and (in the attached Claude Project / Dropbox) PRD v2.63 and the Rebuild Stack Decision Brief before writing code.
2. Pick the **first unchecked increment**. Do that increment only.
3. Branch `rebuild/NN-slug` → implement → tests pass locally → push → open PR titled `Increment NN: <name>` with a summary and test evidence. Do not merge.
4. Mark an increment `[x]` only in the PR that implements it (the checkbox lands when the PR merges). Never mark ahead of evidence.
5. **Never deploy** to staging or production from these sessions. RG-1/RG-2 evidence and all deploys are owner actions.
6. Porting spec: the legacy SQL and routes are authoritative for behavior. Current staging snapshots live in the July 16, 2026 transfer package (`03_Current_Implementation/`), baseline-committed to the legacy repos.
7. Hard Rules in force: Auth0 identity (sub as anchor), INTEGER PKs (+ public_id), `/api/v1/` external prefix, S3-only file storage. No secrets in the repo — placeholders only.
8. If an increment is blocked, open an issue describing the blocker, leave the box unchecked, and stop.
9. **Deployment is switched off by design.** The `Deploy` and `Deploy with Docker Compose` workflows in this repo, and the legacy `Deploy ... to Staging` workflows in vrinspector/backend and vrinspector/frontend, were disabled on 2026-11-06 after the legacy ones auto-fired (and failed harmlessly) on a merge. Do not re-enable or add any deploy workflow. Deployment is re-established deliberately at release gate RG-3 after RG-1 evidence is recorded (PRD v2.63 §8).

## Increments

### Block 9 — platform + feature parity (PRD v2.63 §4)

- [x] 00 — Scaffold template skeleton, README, this plan (initial commit)
- [x] 01 — Project config pass: VR Inspector naming/branding tokens (v2.51 palette) in frontend theme; strip template example "items" feature; CI green on a clean clone
- [x] 02 — Auth: replace template password auth with Auth0 (OIDC code flow on frontend, JWT validation on backend, `sub` anchor + email display). No local users table
- [x] 03 — Data layer: SQLModel models + Alembic baseline matching the live schema (projects, inspections, findings, photos, members, drawings, inspection_pins — INTEGER PKs, page_number, page_width/height_pts). Migration applies cleanly to a copy of the real schema
- [x] 04 — API port 1: projects, inspections, findings, photos, members routes (legacy SQL as spec; same request/response shapes under `/api/v1/`)
- [x] 05 — API port 2: drawings + pins incl. presign, register, view-url, dimensions, deletes — porting the authorization hardening (membership checks, 404 object-hiding, project-bound upload keys) with the local authz test suite ported to pytest
- [x] 06 — Frontend shell: layout, nav, auth/session, brand tokens, loading/empty/error state patterns
- [x] 07 — Screens: projects + inspections
- [x] 08 — Screens: findings + photo capture (camera-first flow)
- [x] 09 — Drawing viewer: PDF.js canvas, page nav, pinch-zoom/pan + button fallback, pin overlay parity at all zoom levels, page-aware pins; raster path
- [x] 10 — Screens: reports, dashboard, member management, Help
- [ ] 11 — Parity checklist run vs legacy staging (side-by-side), capture-loop timing (<15 s target), device pass notes → results recorded in PR; owner signs off before legacy retirement

### Block 9.5 — ITP / hold points + external sign-off (PRD v2.63 §5)

- [ ] 12 — ITP data model + migrations (itp_templates, project_itps, itp_items, signoff_roles, itp_signatures, external_sign_tokens; pins.itp_item_id FK)
- [ ] 13 — ITP UI: template JSON (SurveyJS) render, frozen-copy import, item status/hold-point blocking, pin linkage both directions
- [ ] 14 — External sign-off: magic-link tokens (≥128-bit, single-use, 14-day expiry, revocable), signature_pad capture, time/GPS/weather stamp, pack PDF regenerate-on-change (WeasyPrint), versions in S3

### Block 10 — AI capture (PRD v2.63 §6)

- [ ] 15 — 10A photo analysis + 10B voice-to-finding (Claude API; draft-until-confirmed guardrails)
- [ ] 16 — 10C report drafting + 10E ITP import
- [ ] 17 — 10D public ITP generator (rate-limited, watermarked, no-account)

### Block 11 — offline (PRD v2.63 §7)

- [ ] 18 — PowerSync service container + sync rules (project-membership buckets via Auth0 JWT); client SQLite + upload queue against existing write endpoints
- [ ] 19 — Offline UX: unsynced indicators, manual sync, conflict audit trail; Capacitor shell evaluation

## Status log

| Date | Increment | PR | Result |
|---|---|---|---|
| 2026-11-06 | 00 | initial commit | Skeleton scaffolded from fastapi/full-stack-fastapi-template @ aabb901 |
| 2026-11-07 | 01 | #4 | Merged (squash) after all CI checks passed: brand tokens (v2.51 palette), template "items" feature removed, CI on `main` |
| 2026-11-07 | 02 | #5 | Merged (squash) after all CI checks passed: Auth0 OIDC (PKCE) on the frontend, JWT/JWKS validation on the backend, `sub` anchor + email display, local `user` table and password auth removed |
| 2026-11-07 | 03 | #6 | Merged (squash) after all CI checks passed: SQLModel tables for the 7 domain tables + reconciling Alembic baseline `b7d3e9a1c204` (creates on a fresh DB; adds only missing columns/indexes on the live schema; downgrade refuses to drop populated tables). Verified against an empty DB and a reconstructed legacy schema with rows; `docs/DATA_MODEL.md` records column provenance. Owner action: replace the reconstructed schema with a `pg_dump --schema-only` of staging (issue #7) |
| 2026-11-07 | 04 | #8 | Merged (squash) after all CI checks passed: projects, members, inspections (+ Block 8B sign-off/reopen), findings (+ Block 8A status/resolve), photos (presign → S3 → register, presigned `view_url`) and the Block 6 dashboard roll-up ported to SQLModel under `/api/v1/` with the SPA's request/response shapes; membership authz with 404 object-hiding carried over, Auth0 `sub` anchored on first sight, role policy (viewer/inspector/owner) added for owner confirmation; `docs/API_PORT.md` records the contract and inferred decisions. Weather + report routes tracked in issue #9 |
| 2026-11-07 | 05 | #10 | Merged (squash) after all CI checks passed: Block 8D/8E drawings + pins ported from `staging_drawings_block8e.py` to SQLModel under `/api/v1/`: presign (project-bound keys), register (prefix check → 404), list/get/put/delete, dimensions, view-url, pins list/create/delete, plus `GET/PUT /pins/{id}`; the legacy `test_drawings_authorization.py` suite ported to pytest (same fixture, walks and `detail` strings) with role, vocabulary and cascade tests (9 new, 89 total, 99% coverage). Frontend client regenerated. Owner decisions 7–10 in `docs/API_PORT.md` |
| 2026-11-08 | 06 | #11 | Merged (squash) after all CI checks passed: signed-in shell: brand sidebar (icon rail / phone sheet) + sticky header with section title and Help shortcut, `PageHeader`, `NAV_ITEMS` as the single navigation list (Dashboard, Projects, Help — legacy IA kept, per-project sections nest later); session hand-off on 401 → `/login?returnTo&reason=expired` with the gate explaining it, 10 s bound on silent token renewal; `LoadingState`/`ListSkeleton`/`EmptyState`/`ErrorState`/`QueryState` patterns, in-shell error and not-found fallbacks; status tokens (legacy badge colours, light + dark) with `StatusBadge`; dashboard home with connection check and shortcuts, Projects/Help section stubs. Vitest + Testing Library added (36 tests incl. a shell test over the real route tree with Auth0/API mocked) and `test-frontend.yml` CI (type-check, unit, build); Playwright 15 passed / 1 skipped (needs tenant). `docs/FRONTEND_SHELL.md` records the conventions |
| 2026-11-08 | 07 | #12 | Merged (squash) after all CI checks passed: projects + inspections screens ported from the legacy SPA onto the shell: `/projects` (filterable card list, New project), `/projects/$projectId` (details, owner Edit/Delete menu, filterable inspections list, New inspection with inspector pre-filled), `/projects/$projectId/inspections/$inspectionId` (details, Block 8B sign-off bar, Sign off / Reopen, Edit/Delete; findings + photos section reserved for 08). Same request bodies as the legacy SPA; `lib/queries.ts` query keys; `useProjectRole` hides write/manage actions from viewers/inspectors (API remains the authority); `NotFoundState`/`DetailState` for 404 object-hiding and malformed ids; native `<select>` for fixed vocabularies; `ConfirmDialog` for deletes and sign-off. 19 new Vitest tests through the real route tree (55 total), type-check, lint and production build green locally; screens checked at desktop and phone widths against a stubbed API. `docs/SCREENS.md` records routes, bodies and owner decisions 11–14 |
| 2026-11-08 | 08 | #13 | Merged (squash) after all CI checks passed: findings + photo capture fill the inspection screen (legacy `renderFindingsScreen`): Site photos grid with camera-first capture (`capture="environment"` Take photo + multi-select Upload; presign → direct S3 PUT with progress → register, per-file tiles with retry; full-size viewer with prev/next and delete), Findings with search + status filter, Log/Edit/Delete finding, Block 8A In progress / Reopen / Resolve (notes) actions per status, expandable cards, Web Speech dictation on the description; sticky phone capture bar (Take photo / Log finding). Same request bodies as the legacy SPA; write actions hidden for viewers and after sign-off. 24 new Vitest tests through the real route tree (79 total), type-check, lint and production build green locally; screens checked at desktop and phone widths against a stubbed API. Weather badge deferred to issue #9. `docs/SCREENS.md` records the flow and owner decisions 15–18 |
| 2026-11-08 | 09 | #14 | Merged (squash) after all CI checks passed: drawings section on the project screen (cards with discipline / PDF badges, multi-file Upload drawing with per-file progress and retry: presign → direct S3 PUT → register, project-prefix key guard, PDF/PNG/JPG/SVG ≤ 50 MB) and the Block 8E viewer as its own route `/projects/$projectId/drawings/$drawingId`: bundled PDF.js (`pdfjs-dist`, lazy chunk + own worker) rendering one page per canvas with the legacy cancel / release / DPR-cap pipeline ported, Prev / Next + page indicator, − % + and Fit buttons, pinch-zoom and pan with focal-point correction, ctrl+wheel, keyboard; pin overlay sized to the rendered box so pins hold at every zoom and only the current page's pins show; raster drawings share the stage; Add pin → status picker → `POST …/pins {x_pct, y_pct, status, page_number}`; pin detail with status / label / notes / linked-finding edit (`PUT /pins/{id}`) and delete; dimension capture `PATCH …/dimensions` once per PDF; Edit / Delete drawing in the header menu. 32 new tests (111 total), type-check, lint and production build green locally; checked in Chromium against a real 3-page PDF at desktop and iPhone widths (fit-to-width 26 %, pinch 26 → 79 %). `docs/SCREENS.md` records the flow and owner decisions 19–24 |
| 2026-11-08 | 10 | #15 | Reports, dashboard, members and Help. Backend: the Block 4 report route ported as a backend task (issue #9, option 2) — `POST /api/v1/reports/generate {inspection_id}` renders the inspection report (details, sign-off, summary tiles, findings with Block 8A resolution, embedded photo thumbnails) with WeasyPrint, writes it to S3 as the next numbered version under `reports/inspections/{id}/` and returns the row with `download_url`; `GET /reports?inspection_id`, `GET /reports/{id}`; new `inspection_reports` table (migration `c4e8f2a7b911`, additive, guarded downgrade); Pango libs in the Dockerfile and `test-backend.yml`. 5 new backend tests (94 total, 99% coverage). Frontend: dashboard (`/`) with the five tiles (brick when attention is needed), Project Health table → cards on phones, Recent Activity cards that open the inspection, re-read per visit; Members section on the project screen (role badges, signed-in state, owner-only Remove with confirmation, Invite by email with Inspector/Viewer); Reports section on the inspection screen (Generate report, versions newest first with Download PDF); the in-app Help guide rewritten for the rebuilt screens (decisions 20–21 applied) with the public guide linked. 20 new Vitest tests (131 total), type-check, lint and production build green; checked in Chromium at desktop and iPhone widths against a stubbed API. `docs/SCREENS.md` records the screens and owner decisions 25–30; `docs/API_PORT.md` / `docs/DATA_MODEL.md` the route and table |
