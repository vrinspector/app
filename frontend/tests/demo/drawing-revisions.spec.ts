import path from "node:path"
import { fileURLToPath } from "node:url"

import { expect, type Page, test } from "@playwright/test"

/*
 * Increment 14.5 — drawing pins, round two, walked on the demo build at
 * phone size: drawing revisions (carried pins with a position check, old
 * revisions read-only, uploading a new revision), pin clustering and pin
 * filters remembered on the device.
 */

test.use({ viewport: { width: 412, height: 915 } }) // a mid-range Android phone

const here = path.dirname(fileURLToPath(import.meta.url))
const SITE_PLAN_PNG = path.resolve(
  here,
  "../../src/demo/assets/sample-site-plan.png",
)

async function openProject(page: Page) {
  await page.goto("/demo.html")
  await expect(page.getByTestId("greeting")).toBeVisible()
  await page
    .getByTestId("project-health-cards")
    .getByRole("link", { name: "Cedar Hollow Landfill RNG" })
    .click()
}

async function openSitePlan(page: Page) {
  await openProject(page)
  const card = page.getByTestId("drawing-card").filter({ hasText: "Site Plan" })
  await expect(card).toHaveCount(1)
  await expect(card.getByTestId("drawing-revision")).toHaveText("Rev B")
  await expect(card.getByTestId("drawing-pins-to-check")).toHaveText(
    "1 pin to check",
  )
  await card.click()
  await expect(page.getByTestId("raster-image")).toBeVisible()
}

test("a carried pin is checked, and the old revision stays read-only", async ({
  page,
}) => {
  await openSitePlan(page)

  const banner = page.getByTestId("pins-to-check-banner")
  await expect(banner).toContainText("1 pin carried from Rev A")
  await expect(
    page.locator('[data-testid="pin-marker"][data-position-check="true"]'),
  ).toHaveCount(1)
  await banner.getByTestId("next-pin-to-check").click()
  const detail = page.getByTestId("pin-detail-dialog")
  await expect(detail.getByTestId("pin-position-check")).toContainText(
    "Carried from Rev A — check position.",
  )
  await detail.getByTestId("pin-confirm-position").click()
  await expect(page.getByText("Pin position confirmed")).toBeVisible()
  await expect(banner).toBeHidden()
  await expect(
    page.locator('[data-testid="pin-marker"][data-position-check="true"]'),
  ).toHaveCount(0)

  // Rev A, from the revision list: read-only, its pin as it was.
  await page.getByTestId("drawing-actions").click()
  await page.getByTestId("show-revisions").click()
  const rows = page.getByTestId("revisions-dialog").getByTestId("revision-row")
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText("Rev B")
  await expect(rows.first()).toContainText("Current")
  await rows.nth(1).click()

  const old = page.getByTestId("old-revision-banner")
  await expect(old).toContainText("You're looking at Rev A")
  await expect(page.getByTestId("raster-image")).toBeVisible()
  await expect(page.getByTestId("pin-marker")).toHaveCount(1)
  await expect(page.getByTestId("pin-mode")).toHaveCount(0)
  await expect(page.getByTestId("pins-to-check-banner")).toHaveCount(0)
  await old.getByTestId("open-current-revision").click()
  await expect(page.getByTestId("old-revision-banner")).toHaveCount(0)
  await expect(page.getByTestId("pin-mode")).toBeVisible()
})

test("uploading Rev C carries the pins over and moves one", async ({
  page,
}) => {
  await openSitePlan(page)
  await page.getByTestId("drawing-actions").click()
  await page.getByTestId("upload-revision").click()
  const dialog = page.getByTestId("new-revision-dialog")
  await expect(dialog.getByTestId("revision-label")).toHaveValue("C")
  await dialog.getByTestId("revision-file-input").setInputFiles(SITE_PLAN_PNG)
  await expect(dialog.getByTestId("revision-file-button")).toContainText(
    "sample-site-plan.png",
  )
  await dialog.getByTestId("revision-upload").click()
  await expect(
    page.getByText("Rev C uploaded — 1 pin carried over to check"),
  ).toBeVisible()
  await expect(page.getByTestId("raster-image")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Site Plan" })).toBeVisible()
  await expect(page.getByText(/Rev C/).first()).toBeVisible()
  await expect(page.getByTestId("pins-to-check-banner")).toContainText(
    "1 pin carried from Rev B",
  )

  // Move the carried pin: the next tap on the sheet is its new spot.
  await page.getByTestId("next-pin-to-check").click()
  await page
    .getByTestId("pin-detail-dialog")
    .getByTestId("pin-move-check")
    .click()
  await expect(page.getByTestId("move-pin-banner")).toBeVisible()
  await page.getByTestId("drawing-box").click({ position: { x: 90, y: 70 } })
  await expect(page.getByText("Pin moved")).toBeVisible()
  await expect(page.getByTestId("move-pin-banner")).toHaveCount(0)
  await expect(page.getByTestId("pins-to-check-banner")).toHaveCount(0)
  await expect(page.getByTestId("pin-marker")).toHaveCount(1)

  // Three revisions now; the project lists the sheet once, at Rev C.
  await page.getByTestId("drawing-actions").click()
  await expect(page.getByTestId("show-revisions")).toHaveText(/Revisions \(3\)/)
  await page.keyboard.press("Escape")
  await page.getByRole("link", { name: "Back to project" }).first().click()
  const card = page.getByTestId("drawing-card").filter({ hasText: "Site Plan" })
  await expect(card).toHaveCount(1)
  await expect(card.getByTestId("drawing-revision")).toHaveText("Rev C")
})

test("pins cluster when zoomed out and filters are remembered", async ({
  page,
}) => {
  await openProject(page)
  await page
    .getByTestId("drawing-card")
    .filter({ hasText: "Upgrading Plant P&ID" })
    .click()
  await expect(page.getByTestId("pdf-canvas")).toBeVisible()
  await expect(page.getByTestId("page-indicator")).toHaveText("Page 1 of 3")
  await expect(page.getByTestId("pin-count")).toHaveText("5 pins on this page")

  // Fit to a phone's width, close pins share a numbered marker …
  const clusters = page.getByTestId("pin-cluster")
  await expect(clusters.first()).toBeVisible()
  const before = await page.getByTestId("zoom-indicator").textContent()
  await clusters.first().click()
  // … and tapping it zooms in on them.
  await expect(page.getByTestId("zoom-indicator")).not.toHaveText(before ?? "")

  await page.getByTestId("zoom-fit").click()
  await page.getByTestId("pin-filter").click()
  await page.getByTestId("pin-filter-status-punch_item").click()
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("pin-count")).toHaveText(
    "3 of 5 pins on this page",
  )
  await expect(page.getByTestId("pin-filter")).toHaveAttribute(
    "data-active",
    "true",
  )

  // Remembered on this device: leave and come back, the filter is still on.
  await page.getByRole("link", { name: "Back to project" }).first().click()
  await page
    .getByTestId("drawing-card")
    .filter({ hasText: "Upgrading Plant P&ID" })
    .click()
  await expect(page.getByTestId("pdf-canvas")).toBeVisible()
  await expect(page.getByTestId("pin-count")).toHaveText(
    "3 of 5 pins on this page",
  )
  await page.getByTestId("pin-filter").click()
  await page.getByTestId("pin-filter-reset").click()
  await expect(page.getByTestId("pin-count")).toHaveText("5 pins on this page")
})
