import { expect, test } from "@playwright/test"

/*
 * Increment 11a — the capture loop end to end, in a real browser against the
 * clickable demo build (fake signed-in user, in-browser API and S3; see
 * src/demo/). PRD v2.63 §4: "drawing tap → saved finding with photo in under
 * 15 seconds on a mid-range Android phone". The device timing is the owner's
 * (REBUILD_PLAN increment 11); this walk proves the flow is one unbroken
 * sequence and records how long the app itself took from tap to saved.
 *
 * The demo is served from a single page with in-memory navigation, so the
 * test walks there by clicking, as a person would.
 */

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
)

test.use({ viewport: { width: 412, height: 915 } }) // a mid-range Android phone

test("drawing tap → pin → finding with photo, linked, in one flow", async ({
  page,
}, testInfo) => {
  await page.goto("/demo.html")
  await expect(page.getByTestId("greeting")).toBeVisible()

  // Dashboard → the sample project → its Site Plan (a PNG, no PDF.js needed).
  await page
    .getByTestId("project-health-cards")
    .getByRole("link", { name: "Cedar Hollow Landfill RNG" })
    .click()
  await page
    .getByTestId("drawing-card")
    .filter({ hasText: "Site Plan" })
    .click()

  const viewer = page.getByTestId("drawing-viewer")
  await expect(viewer).toHaveAttribute("data-kind", "raster")
  await expect(page.getByTestId("raster-image")).toBeVisible()
  await expect(page.getByTestId("pin-mode")).toBeEnabled()
  // The sample Site Plan carries one pin; wait for it so the count below is settled.
  await expect(page.getByTestId("pin-marker")).toHaveCount(1)
  const pinsBefore = 1

  // --- the loop starts with the tap on the sheet ---------------------------
  await page.getByTestId("pin-mode").click()
  await expect(page.getByTestId("pin-mode-hint")).toHaveText(
    "Tap the drawing to place a pin",
  )
  const started = Date.now()
  await page.getByTestId("drawing-box").click({ position: { x: 120, y: 80 } })

  const statusDialog = page.getByTestId("pin-status-dialog")
  await expect(statusDialog).toBeVisible()
  await expect(statusDialog.getByTestId("pin-then-finding")).toHaveAttribute(
    "data-state",
    "checked",
  )
  await statusDialog.getByTestId("pin-status-punch_item").click()

  // Pin saved → the finding form opens with the camera ready and the fields filled.
  const dialog = page.getByTestId("capture-finding-dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("Log a finding at pin #")
  await expect(dialog.getByTestId("capture-title")).toHaveValue(
    /Pin #\d+ — Site Plan/,
  )
  await expect(dialog.getByTestId("capture-location")).toHaveValue(
    /Site Plan — pin #\d+/,
  )
  // The newest open inspection of the project is pre-selected.
  await expect(dialog.getByTestId("capture-inspection")).toHaveValue("1")
  await expect(dialog).toContainText("Gas upgrading skid: mechanical walkdown")

  // "Take photo" opens the rear camera; the test hands the input a file.
  const camera = dialog.getByTestId("camera-input")
  await expect(camera).toHaveAttribute("capture", "environment")
  await camera.setInputFiles({
    name: "IMG_0042.jpg",
    mimeType: "image/png",
    buffer: PNG_1x1,
  })
  const tile = dialog.getByTestId("capture-photo")
  await expect(tile).toBeVisible()
  await expect(tile).toHaveAttribute("data-status", "ready")

  // Dictation needs a microphone; the note is typed here.
  await dialog
    .getByLabel("What you see")
    .fill("Guard missing on the flare skid coupling")
  await dialog.getByTestId("capture-save").click()

  // One confirmation for the whole loop, and the pin is linked.
  await expect(
    page.getByText(/Finding logged with 1 photo and linked to pin #\d+/),
  ).toBeVisible()
  const elapsed = Date.now() - started
  testInfo.annotations.push({
    type: "capture-loop",
    description: `tap → saved finding with photo: ${elapsed} ms (demo build, headless Chromium)`,
  })
  expect(elapsed, "the app's own part of the loop").toBeLessThan(15_000)

  await expect(dialog).toBeHidden()
  await expect(page.getByTestId("pin-mode")).toHaveAttribute(
    "aria-pressed",
    "false",
  )
  await expect(page.getByTestId("pin-marker")).toHaveCount(pinsBefore + 1)

  // The pin's details show the link; following it lands on the finding with its photo.
  await page.getByTestId("pin-marker").last().click()
  const detail = page.getByTestId("pin-detail-dialog")
  await expect(detail).toBeVisible()
  const linked = detail.getByTestId("pin-linked-finding")
  await expect(linked).toContainText("Linked to")
  await expect(linked).toContainText("Gas upgrading skid: mechanical walkdown")
  await linked.getByRole("link").click()

  await expect(page.getByTestId("inspection-details")).toBeVisible()
  const card = page
    .getByTestId("finding-card")
    .filter({ hasText: "Guard missing on the flare skid coupling" })
  await expect(card).toBeVisible()
  await expect(card.getByTestId("finding-photo")).toHaveCount(1)
})

test("'Keep pin only' and the switch keep the legacy pin-only behaviour", async ({
  page,
}) => {
  await page.goto("/demo.html")
  await expect(page.getByTestId("greeting")).toBeVisible()
  await page
    .getByTestId("project-health-cards")
    .getByRole("link", { name: "Cedar Hollow Landfill RNG" })
    .click()
  await page
    .getByTestId("drawing-card")
    .filter({ hasText: "Site Plan" })
    .click()
  await expect(page.getByTestId("pin-mode")).toBeEnabled()
  // The sample Site Plan carries one pin; wait for it so the count below is settled.
  await expect(page.getByTestId("pin-marker")).toHaveCount(1)
  const pinsBefore = 1

  await page.getByTestId("pin-mode").click()
  await page.getByTestId("drawing-box").click({ position: { x: 60, y: 60 } })
  await page
    .getByTestId("pin-status-dialog")
    .getByTestId("pin-status-verified")
    .click()
  const dialog = page.getByTestId("capture-finding-dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByTestId("capture-keep-pin").click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId("pin-marker")).toHaveCount(pinsBefore + 1)

  // Switch off: the status tap places the pin and stops, as before.
  await page.getByTestId("pin-mode").click()
  await page.getByTestId("drawing-box").click({ position: { x: 200, y: 60 } })
  const status = page.getByTestId("pin-status-dialog")
  await status.getByTestId("pin-then-finding").click()
  await status.getByTestId("pin-status-not_started").click()
  await expect(page.getByText("Pin placed")).toBeVisible()
  await expect(page.getByTestId("capture-finding-dialog")).toHaveCount(0)
  await expect(page.getByTestId("pin-marker")).toHaveCount(pinsBefore + 2)
})
