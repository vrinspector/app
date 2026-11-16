# Capacitor shell — evaluation (rebuild increment 19)

PRD v2.63 Block 11: "Capacitor shell (store presence, native camera) follows
Block 11 completion." ADR-009 / the Stack Decision Brief: "Ship PWA first; add
the Capacitor shell when store presence matters." This note records what
wrapping the existing React build in Capacitor would take, what it buys, and
a recommendation. **Nothing is added to the app by this increment** — no
Capacitor packages, no native projects, no store accounts.

## What Capacitor is here

[Capacitor](https://capacitorjs.com) (MIT, Ionic) puts the same Vite/React
build inside a native iOS and Android app (a WebView plus a plugin bridge).
Current line: Capacitor 8 (released December 2025; 8.5 in July 2026). One
codebase stays: the browser app, the PWA and the store apps are the same
`frontend/` build.

## What it would give VR Inspector

| Need | Today (browser / PWA) | With Capacitor |
|---|---|---|
| App Store / Play listing | None | Yes — the main reason to do it |
| Camera | `<input capture="environment">` (works on iOS Safari and Android Chrome; increment 08/11a) | `@capacitor/camera`: faster native picker, EXIF kept, no browser permission prompt per visit |
| Offline storage | PowerSync web SDK on wa-sqlite in the browser (increment 18). Browser storage can be cleared by the user or, on iOS Safari, evicted for sites not opened for a while | PowerSync's **Capacitor SDK** (`@powersync/capacitor`, announced 2025) uses native SQLite on iOS/Android and falls back to the web SDK in a browser — the same schema and upload queue (`src/lib/sync/`) carry over unchanged |
| Photos taken offline | Need a connection (deferred; see "Follow-ups") | Native filesystem makes an offline photo queue straightforward (`@capacitor/filesystem` + PowerSync attachments) |
| Dictation | Web Speech API (Chrome/Safari) | Same, or a native speech plugin |
| Push notifications (hold-point notices) | Email only (increment 14) | Possible later (`@capacitor/push-notifications`) |

## What it would cost

1. **Auth0 in a native shell.** The current PKCE redirect flow targets the web
   origin. The app build needs Auth0's Capacitor pattern: system browser
   (`@capacitor/browser`) + a custom URL scheme or universal link as the
   callback. **Owner action:** add the native callback/logout URLs to the
   Auth0 application. About 1–2 days of work plus testing.
2. **PowerSync client swap.** Replace `@powersync/web` with
   `@powersync/capacitor` behind the existing `database.ts` loader; schema,
   connector and upload queue are unchanged. About 1 day.
3. **Native projects and CI.** `ios/` and `android/` folders, app icons and
   splash in the v2.51 palette, a CI job that builds (not publishes) both.
   iOS builds need a macOS runner. About 2–3 days.
4. **Store accounts and review (owner).** Apple Developer Program (US$99 a
   year) and Google Play Console (US$25 one-time), privacy labels (camera,
   location for the weather/GPS stamp, account data), screenshots, a support
   URL. Apple reviews "website in a wrapper" apps strictly (guideline 4.2),
   so the store build should ship with offline work and the native camera,
   which it would.
5. **Release discipline.** Store builds update on review cycles, not on every
   merge; the web app keeps deploying separately at RG-3.

Rough total: **one to two weeks of development** plus the owner's account,
Auth0 and store-listing steps.

## Recommendation

**Not yet. Ship the PWA first, as the PRD says, and start the Capacitor shell
when a customer or a sale needs a store listing — and only after RG-3** (the
web app deployed, offline sync running against the real service, and the
on-device check in issue #16 done). Reasons:

- Everything a field inspector needs today (camera capture, dictation,
  offline findings and pins) already works in the phone browser.
- Store presence adds recurring cost and review cycles to a low-budget
  project before there are paying users asking for it.
- Nothing in the rebuild blocks it later: the offline layer was written so
  the PowerSync Capacitor SDK drops in behind `src/lib/sync/database.ts`.

**Decision for the owner:** confirm "PWA first, Capacitor when store presence
matters". If a store listing is wanted sooner, the work above becomes its own
increment (proposed: "19b — Capacitor shell").

## Follow-ups noted while evaluating

- **Offline photo queue.** Photos still need a connection (the file goes to
  S3 through a presigned URL that only the API can issue). In the browser
  this needs photos kept in IndexedDB/OPFS until upload; in Capacitor, on the
  native filesystem. Proposed as its own increment; see the issue opened with
  this PR.
- **Installable PWA.** A web app manifest and service worker (so the app opens
  with no signal from the home screen) are a smaller step than Capacitor and
  worth doing first at RG-3.

## Sources

- Capacitor 8 announcement — <https://ionic.io/blog/announcing-capacitor-8>
- Capacitor 8.5 release — <https://ionic.io/blog/capacitor-8-5-released>
- PowerSync Capacitor SDK — <https://www.powersync.com/blog/introducing-the-powersync-capacitor-sdk>, <https://docs.powersync.com/client-sdks/reference/capacitor>
