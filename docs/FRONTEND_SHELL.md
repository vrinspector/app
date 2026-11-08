# Frontend shell (increment 06)

How the signed-in application is put together, and the conventions every
screen from increment 07 on follows. Read with `REBUILD_PLAN.md` (Block 9),
`docs/API_PORT.md` (the route contract the screens call) and
`docs/SCREENS.md` (the screens themselves, increment 07 onward).

## Layout

```
routes/__root.tsx        HeadContent, devtools, full-page 404 / error pages
routes/login.tsx         sign-in gate (Auth0 hosted login; see increment 02)
routes/_layout.tsx       the shell: sidebar + header + <Outlet/> + footer;
                         auth guard; in-shell error and not-found fallbacks
routes/_layout/*.tsx     screens (one file per route, code-split by the router)
```

- **Sidebar** (`components/Sidebar/*`): brand logo, primary navigation,
  Appearance (light/dark/system) and the user menu (profile, sign out). It
  collapses to an icon rail on desktop and becomes a sheet on phones; the
  header's toggle button (`aria-label="Toggle navigation"`) opens it.
- **Header**: sticky, carries the current section title and a Help shortcut
  (the legacy SPA's top bar had Help / user badge / Sign out; user and sign
  out now live in the sidebar footer). The Help shortcut hides on `/help`.
- **Main**: `max-w-7xl`, `gap-6` column. Screens start with `<PageHeader>`
  (title, optional eyebrow, description, back arrow, right-aligned actions)
  and stack their content below it.
- **Footer**: copyright and the brand line.

Safe-area padding is applied at the bottom of `<main>` for iPad/iPhone home
indicators; touch targets in the header are ≥ 36 px.

## Navigation

`lib/navigation.ts` is the single list (`NAV_ITEMS`) that feeds the sidebar,
the header title and the dashboard shortcuts. The legacy information
architecture is kept: Dashboard → Projects → (inspections → findings/photos/
drawings → report, members as a per-project panel) → Help. Per-project
sections therefore do not get top-level entries; they arrive as nested routes
under `/projects/$projectId/…` in increments 07–10, and `isNavItemActive`
keeps "Projects" highlighted while inside them. `exact: true` is for the
dashboard only.

Adding a section = one entry in `NAV_ITEMS` + one route file.

## Auth and session

- The router mounts only after the Auth0 SDK has restored (or failed to
  restore) the session, so `_layout`'s `beforeLoad` guard is synchronous: a
  signed-out visitor is redirected to `/login?returnTo=<href>`.
- Every API call asks the SDK for an access token (`getAccessTokenSilently`),
  bounded to 10 s so a stuck renewal cannot leave a screen on a spinner.
  On failure the request goes without a token and the API answers 401.
- **401** anywhere → `redirectToLogin("expired")` (`lib/session.ts`), i.e. a
  full-page navigation to `/login?returnTo=<where they were>&reason=expired`.
  The gate shows "Your session ended" and signs the person back in to the
  same place. `safeReturnTo` only ever accepts in-app paths.
- **403/404** are authorization outcomes the screens handle themselves
  (legacy routers hide objects with 404 — render the in-shell not-found by
  `throw notFound()` from a loader, or an `ErrorState` from a query).
- `useAuth()` exposes `user` (sub/email/name/picture), `permissions` and
  `apiSession` — the state of the `/users/me` round-trip, which the dashboard
  shows as the connection check.

## Loading / empty / error patterns (`components/Common/States.tsx`)

| Component | Use |
|---|---|
| `LoadingState` | short wait, no layout known yet (route pending, first fetch) |
| `ListSkeleton` | a list or table is about to appear; keeps the page from jumping |
| `EmptyState` | the request succeeded and there is nothing to show; takes an icon, title, description and a call to action |
| `ErrorState` | the request failed; shows the API `detail` (or a plain "could not reach the server" sentence) and a **Try again** button when given `onRetry` |
| `QueryState` | wires a TanStack Query result to the three above: `<QueryState query={q} empty={…}>{(data) => …}</QueryState>` |
| `NotFoundState` | the API answered 404 (or the URL id is malformed): "<Noun> not found" with a way back |
| `DetailState` | `QueryState` for one object: 404 → `NotFoundState`, other failures → `ErrorState` with retry |

Route-level: lazily loaded screens show the router's `defaultPendingComponent`
after 300 ms; a screen that throws renders `ErrorState` inside the shell with
a retry that resets the boundary and invalidates the router; `throw notFound()`
renders an in-shell "Not found" with a way back to the dashboard. The
full-page `NotFound` / `ErrorComponent` are reserved for the root route
(unknown URLs, failures outside the shell).

`extractErrorMessage` (`utils.ts`) is the one place API errors are turned into
sentences.

## Brand tokens

`index.css` holds the v2.51 palette as `--color-vri-*` plus the semantic
shadcn tokens for light and dark. Increment 06 adds **status tokens** carrying
the legacy badge colours forward (`.badge-active/open/closed/high/medium/low`):

| Tone | Legacy classes | Used for |
|---|---|---|
| `positive` | `badge-active`, `badge-low` | active project, resolved finding, low priority, verified pin |
| `attention` | `badge-open`, `badge-medium` | open inspection/finding, in-progress, medium priority |
| `critical` | `badge-high` | high priority, punch-item pin |
| `settled` | `badge-closed` | closed inspection, complete project |
| `neutral` | — | on hold, not started/installed, unknown |

Render them with `<StatusBadge value="in-progress" />`
(`components/Common/StatusBadge.tsx`): `toneFor()` maps the API's stored
values (`PROJECT_STATUSES`, `INSPECTION_STATUSES`, `FINDING_STATUSES`,
priorities, `PIN_STATUSES`) to a tone and `statusLabel()` makes the label
("on_hold" → "On hold"). Unknown values fall back to `neutral`, so a new
status never renders unstyled.

## Tests

- **Unit / component** — Vitest + Testing Library (jsdom):
  `bun run test:unit` (`src/**/*.test.{ts,tsx}`, setup in `src/test/setup.ts`).
  `src/test/shell.test.tsx` renders the real route tree with the Auth0 SDK and
  API client mocked and checks the shell end to end (sidebar, header, section
  navigation, connection check incl. retry, signed-out redirect, expired-session
  gate).
- **End-to-end** — Playwright (`bunx playwright test`) covers the signed-out
  journey against the built app; authenticated runs need a real tenant and
  remain an owner action.
- **CI** — `.github/workflows/test-frontend.yml` runs type-check, unit tests
  and a production build on every PR; `playwright.yml` runs the e2e suite.

## Build

`vite.config.ts` splits the vendor libraries (`vendor-auth0`, `vendor-react`,
`vendor-radix`, `vendor-tanstack`) into their own chunks so a screen change
does not invalidate the whole bundle in field devices' caches.
