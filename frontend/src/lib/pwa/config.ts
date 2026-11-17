/*
 * Installable app (rebuild increment 21; issue #39; docs/CAPACITOR_EVALUATION.md
 * "PWA first, no app-store shell").
 *
 * vite-plugin-pwa (MIT) writes the web app manifest and a Workbox service
 * worker into the production build. The service worker keeps only the app's
 * own files (the build output: scripts, styles, fonts, icons, the SQLite
 * WebAssembly and the PDF.js worker) on the device, so a home-screen icon
 * opens with no signal and shows the synced copy (PowerSync, increment 18).
 *
 * Deliberately NOT cached by the service worker:
 *   - API answers (`/api/...`): no runtime caching routes at all, so every
 *     API call goes to the network exactly as before;
 *   - presigned S3 URLs (other origin, never intercepted) and tokens;
 *   - the public signing page and the public ITP generator, which stay
 *     online-only (their navigations are never answered from the cache).
 *
 * Updates: `registerType: "prompt"` — a new version waits until the person
 * taps "Reload" on the "Update available" notice (components/Common/UpdateNotice.tsx), so a
 * form being filled in is never reloaded underneath them.
 */
import type { VitePWAOptions } from "vite-plugin-pwa"

export const BRAND_GREEN = "#2E3D2E"
export const BRAND_OFFWHITE = "#F7F5F0"

/**
 * Navigations the service worker must leave to the network: the API and its
 * docs, and the two public pages that stay online-only.
 */
export const ONLINE_ONLY_NAVIGATIONS: RegExp[] = [
  /^\/api\//,
  /^\/docs/,
  /^\/redoc/,
  /^\/sign\//,
  /^\/itp-generator/,
]

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: "prompt",
  // Registered by src/lib/pwa/register.ts (signed-in app only), not by an
  // injected script on every page.
  injectRegister: false,
  // The icons are part of the build output and already matched by
  // workbox.globPatterns below; listing them again would precache them twice.
  includeManifestIcons: false,
  manifest: {
    id: "/",
    name: "VR Inspector",
    short_name: "VR Inspector",
    description:
      "Field inspection for construction QA/QC. Inspect. Document. Verify.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: BRAND_GREEN,
    background_color: BRAND_OFFWHITE,
    lang: "en-US",
    categories: ["business", "productivity", "utilities"],
    icons: [
      {
        src: "/assets/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/assets/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/assets/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  },
  workbox: {
    // The app's own build output only.
    globPatterns: ["**/*.{js,mjs,css,html,svg,png,ico,woff,woff2,wasm}"],
    // PowerSync also ships "multiple ciphers" SQLite builds that are only
    // loaded for an encrypted database; the app does not use encryption, so
    // they are not kept on the device (saves about 3.7 MB).
    globIgnores: ["**/mc-wa-sqlite*.wasm"],
    // Only Vite's content-hashed files may skip Workbox's own revision hash;
    // the icons and favicon under /assets keep their names between versions.
    dontCacheBustURLsMatching: /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/,
    // SQLite (wa-sqlite) and PDF.js ship multi-megabyte files the app needs
    // offline; the default 2 MiB limit would leave them out.
    maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
    navigateFallback: "/index.html",
    navigateFallbackDenylist: ONLINE_ONLY_NAVIGATIONS,
    // No runtimeCaching: API answers, presigned URLs and tokens are never
    // stored by the service worker.
    runtimeCaching: [],
    cleanupOutdatedCaches: true,
    clientsClaim: false,
    skipWaiting: false,
  },
  devOptions: {
    enabled: false,
  },
}
