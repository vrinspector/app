import { expect, test } from "@playwright/test"

test("Root redirects a signed-out visitor to /login", async ({ page }) => {
  await page.goto("/")

  await page.waitForURL("/login")
  await expect(page.getByTestId("login-gate")).toBeVisible()
})

test("Protected route remembers where to return after sign-in", async ({
  page,
}) => {
  await page.goto("/settings")

  await page.waitForURL(/\/login\?returnTo=%2Fsettings/)
  await expect(page.getByTestId("login-gate")).toBeVisible()
})

test("Signed-out visitor never sees the app shell", async ({ page }) => {
  await page.goto("/settings")

  await page.waitForURL(/\/login/)
  await expect(page.getByTestId("user-menu")).toHaveCount(0)
  await expect(page.getByTestId("greeting")).toHaveCount(0)
})

test("Stale local token is ignored (no password-era session)", async ({
  page,
}) => {
  await page.goto("/login")
  await page.evaluate(() => {
    localStorage.setItem("access_token", "invalid_token")
  })
  await page.goto("/settings")

  await page.waitForURL(/\/login/)
  await expect(page.getByTestId("login-gate")).toBeVisible()
})
