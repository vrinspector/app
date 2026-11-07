import { expect, test } from "@playwright/test"
import { auth0Configured } from "./config.ts"

test("Sign-in page renders the login gate", async ({ page }) => {
  await page.goto("/login")

  await expect(page).toHaveTitle("Sign In - VR Inspector")
  await expect(page.getByTestId("login-gate")).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Sign in to VR Inspector" }),
  ).toBeVisible()
  await expect(page.getByTestId("sign-in-button")).toBeVisible()
})

test("Sign-in page has no password fields (Auth0 hosted login)", async ({
  page,
}) => {
  await page.goto("/login")

  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(page.locator('input[type="email"]')).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Sign up" })).toHaveCount(0)
  await expect(
    page.getByRole("link", { name: "Forgot your password?" }),
  ).toHaveCount(0)
})

test("Sign-in button state follows the Auth0 configuration", async ({
  page,
}) => {
  await page.goto("/login")

  const button = page.getByTestId("sign-in-button")
  if (auth0Configured) {
    await expect(button).toBeEnabled()
    await expect(page.getByTestId("auth-unconfigured")).toHaveCount(0)
  } else {
    await expect(button).toBeDisabled()
    await expect(page.getByTestId("auth-unconfigured")).toBeVisible()
  }
})

test("Sign-in button starts the redirect to Auth0", async ({ page }) => {
  test.skip(!auth0Configured, "needs real Auth0 settings in .env")

  await page.goto("/login")
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/authorize?")),
    page.getByTestId("sign-in-button").click(),
  ])
  const url = new URL(request.url())
  expect(url.searchParams.get("response_type")).toBe("code")
  expect(url.searchParams.get("code_challenge_method")).toBe("S256")
  expect(url.searchParams.get("scope")).toContain("openid")
})
