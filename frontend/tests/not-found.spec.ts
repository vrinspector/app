import { expect, test } from "@playwright/test"

test("Unknown route shows the 404 page", async ({ page }) => {
  await page.goto("/this-page-does-not-exist")

  await expect(page.getByTestId("not-found")).toBeVisible()
  await expect(page.getByText("404")).toBeVisible()
})

test("404 page offers a way back", async ({ page }) => {
  await page.goto("/nope")

  await expect(page.getByRole("link", { name: "Go Back" })).toBeVisible()
})
