import { expect, test } from "@playwright/test"

/*
 * Increment 15 — AI capture assistance in a real browser against the clickable
 * demo build (whose in-browser API gives canned AI answers; the real app asks
 * the Claude API). Walks both halves at phone size:
 *
 *   10A  open a site photo → Analyse with AI → the draft is shown, not saved →
 *        File photo → the photo carries its category and defect tags
 *   10B  Log a finding → type the observation → Draft with AI → the fields
 *        fill under an "AI draft" notice → Log finding → the card is marked
 *        AI-assisted and says how it was drafted
 */

test.use({ viewport: { width: 412, height: 915 } })

async function openInspection(page: import("@playwright/test").Page) {
  await page.goto("/demo.html")
  await expect(page.getByTestId("greeting")).toBeVisible()
  await page
    .getByTestId("project-health-cards")
    .getByRole("link", { name: "Cedar Hollow Landfill RNG" })
    .click()
  await page
    .getByRole("link", { name: /Gas upgrading skid: mechanical walkdown/ })
    .first()
    .click()
  await expect(page.getByTestId("inspection-details")).toBeVisible()
}

test("10A: analyse a photo, check the draft, file it", async ({ page }) => {
  await openInspection(page)
  await page.getByTestId("photo-thumb").first().click()
  const viewer = page.getByTestId("photo-viewer")
  await expect(viewer).toBeVisible()
  const filing = viewer.getByTestId("photo-filing")
  await expect(filing).toContainText("Not filed yet.")

  await filing.getByTestId("photo-analyse").click()
  await expect(filing.getByTestId("photo-ai-draft")).toContainText("AI draft")
  await expect(filing.getByTestId("photo-category")).not.toHaveValue("")
  // Nothing is filed until the inspector says so.
  await filing.getByTestId("photo-filing-save").click()
  await expect(filing.getByTestId("photo-filing-editor")).toBeHidden()
  await expect(filing).toContainText("AI-assisted")
  await expect(filing).not.toContainText("Not filed yet.")
})

test("10B: dictated note → AI draft → confirmed finding", async ({ page }) => {
  await openInspection(page)
  await page.getByTestId("log-finding").first().click()
  const dialog = page.getByTestId("finding-form-dialog")
  await expect(dialog).toBeVisible()
  await dialog
    .getByPlaceholder("Describe the issue…")
    .fill("two flange bolts missing at valve xv 205 gridline c4. crew notified")
  await dialog.getByTestId("ai-draft-button").click()

  await expect(dialog.getByTestId("ai-draft-notice")).toContainText(
    "AI draft — check every field",
  )
  await expect(dialog.getByLabel("Title")).toHaveValue(
    "Two flange bolts missing at valve xv 205 gridline c4",
  )
  await expect(dialog.getByLabel("Priority")).toHaveValue("high")
  await expect(dialog.getByTestId("finding-discipline")).toHaveValue("pid")

  await dialog.getByTestId("finding-form-submit").click()
  await expect(dialog).toBeHidden()
  const card = page
    .getByTestId("finding-card")
    .filter({ hasText: "Two flange bolts missing at valve xv 205" })
  await expect(card.getByTestId("finding-ai-assisted")).toBeVisible()
  await card.getByTestId("finding-toggle").click()
  await expect(card.getByTestId("finding-ai-provenance")).toContainText(
    "saved as drafted",
  )
})
