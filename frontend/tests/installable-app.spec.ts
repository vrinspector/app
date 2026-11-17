import { expect, type Page, test } from "@playwright/test"

/*
 * Increment 21: installable app that opens with no signal.
 *
 * These run against a production build (the backend serves it in CI's
 * Docker Compose run); the Vite dev server has no service worker, so the
 * tests skip themselves there.
 */

async function hasServiceWorker(page: Page): Promise<boolean> {
  const response = await page.request.get("/sw.js")
  if (!response.ok()) return false
  const type = response.headers()["content-type"] ?? ""
  return type.includes("javascript")
}

async function waitForOfflineReady(page: Page) {
  // Registered, activated and controlling the page: the app's files are
  // stored on the device.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  if (
    !(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
  ) {
    await page.reload()
  }
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true)
}

test("The web app manifest names the app with brand colours and icons", async ({
  page,
}) => {
  await page.goto("/login")
  test.skip(!(await hasServiceWorker(page)), "production build only")

  const href = await page.locator('link[rel="manifest"]').getAttribute("href")
  expect(href).toBeTruthy()
  const manifest = await (await page.request.get(href as string)).json()
  expect(manifest.name).toBe("VR Inspector")
  expect(manifest.display).toBe("standalone")
  expect(manifest.start_url).toBe("/")
  expect(manifest.theme_color).toBe("#2E3D2E")
  expect(manifest.background_color).toBe("#F7F5F0")
  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes)
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]))
  expect(
    manifest.icons.some(
      (icon: { purpose?: string }) => icon.purpose === "maskable",
    ),
  ).toBe(true)
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await page.request.get(icon.src)).ok()).toBe(true)
  }
})

test("The app opens with no signal once it has been opened before", async ({
  page,
  context,
}) => {
  await page.goto("/login")
  test.skip(!(await hasServiceWorker(page)), "production build only")
  await waitForOfflineReady(page)

  await context.setOffline(true)
  try {
    await page.reload()
    await expect(page.getByTestId("login-gate")).toBeVisible()
    // Signing in needs signal, and the page says so plainly.
    await expect(page.getByTestId("login-offline")).toBeVisible()

    // A deep link opens the app too (answered from the device).
    await page.goto("/projects")
    await expect(page.getByTestId("login-gate")).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})

test("API answers and the public pages are never served from the device", async ({
  page,
  context,
}) => {
  await page.goto("/login")
  test.skip(!(await hasServiceWorker(page)), "production build only")
  await waitForOfflineReady(page)

  // Nothing but the app's own build files is kept by the service worker.
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) urls.push(request.url)
    }
    return urls
  })
  expect(cached.length).toBeGreaterThan(0)
  for (const url of cached) {
    const { pathname } = new URL(url)
    expect(pathname).not.toMatch(/^\/api\//)
    expect(pathname).not.toMatch(/^\/sign\//)
  }

  await context.setOffline(true)
  try {
    // The public signing page stays online-only: no app shell offline.
    const signing = await page
      .goto("/sign/offline-check")
      .then(() => "loaded")
      .catch(() => "failed")
    expect(signing).toBe("failed")
  } finally {
    await context.setOffline(false)
  }
})

test("The public signing page does not install the app", async ({
  browser,
}) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto("/sign/not-a-real-token")
    test.skip(!(await hasServiceWorker(page)), "production build only")
    // Give a registration (if any) time to happen.
    await page.waitForTimeout(1500)
    const registrations = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    )
    expect(registrations).toBe(0)
  } finally {
    await context.close()
  }
})
