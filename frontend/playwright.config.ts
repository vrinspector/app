import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173'

/*
 * The clickable demo build (fake signed-in user + in-browser API, see
 * src/demo/) is where the signed-in flows can be walked end to end without
 * an Auth0 tenant. It is built and served by this config on its own port;
 * tests under tests/demo/ run against it (project "demo").
 */
const demoPort = Number(process.env.PLAYWRIGHT_DEMO_PORT ?? 4174)
const demoURL = `http://127.0.0.1:${demoPort}`

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI ? 'blob' : 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /*
     * The Auth0 SDK needs the Web Crypto API, which browsers only expose on
     * secure contexts (HTTPS or localhost). In Docker Compose the app is
     * reached as http://backend:8000, so tell Chromium to treat that origin
     * as secure. Test-only; production is served over HTTPS.
     */
    launchOptions: {
      args: [`--unsafely-treat-insecure-origin-as-secure=${baseURL}`],
    },
  },

  /* Configure projects for major browsers */
  // Sign-in is handled by Auth0's hosted page, so there is no stored
  // authenticated state here: the "chromium" project covers the signed-out
  // experience against the real stack. Authenticated end-to-end runs against
  // a real tenant are an owner action until test-user credentials exist; the
  // "demo" project walks the signed-in screens against the demo build.
  projects: [
    {
      name: 'chromium',
      testIgnore: /tests[\\/]demo[\\/]/,
      use: {
        ...devices['Desktop Chrome'],
        // Full Chromium (new headless) rather than chrome-headless-shell: the
        // headless shell ignores --unsafely-treat-insecure-origin-as-secure.
        channel: 'chromium',
      },
    },
    {
      name: 'demo',
      testMatch: /tests[\\/]demo[\\/].*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        baseURL: demoURL,
        launchOptions: { args: [] },
      },
    },

    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: [
    ...(process.env.PLAYWRIGHT_BASE_URL
      ? []
      : [
          {
            command: 'bun run dev',
            url: baseURL,
            reuseExistingServer: !process.env.CI,
          },
        ]),
    {
      // The demo build for the "demo" project (see above).
      command: `bun run build:demo && bunx vite preview --config vite.demo.config.ts --host 127.0.0.1 --port ${demoPort} --strictPort`,
      url: `${demoURL}/demo.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
