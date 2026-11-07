import { expect, test } from "@playwright/test"

test("Appearance toggle is available on the sign-in page", async ({ page }) => {
  await page.goto("/login")

  await expect(page.getByTestId("theme-button")).toBeVisible()
})

test("Visitor can switch between light and dark", async ({ page }) => {
  await page.goto("/login")

  await page.getByTestId("theme-button").click()
  await page.getByTestId("dark-mode").click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await expect(page.getByTestId("dark-mode")).not.toBeVisible()

  await page.getByTestId("theme-button").click()
  await page.getByTestId("light-mode").click()
  await expect(page.locator("html")).toHaveClass(/light/)
})

test("Selected mode is preserved across reloads", async ({ page }) => {
  await page.goto("/login")

  await page.getByTestId("theme-button").click()
  await page.getByTestId("dark-mode").click()
  await expect(page.locator("html")).toHaveClass(/dark/)

  await page.reload()
  await expect(page.locator("html")).toHaveClass(/dark/)
})
