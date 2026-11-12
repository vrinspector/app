import { expect, test } from "@playwright/test"

/*
 * Increment 16 — AI report drafting (10C) and ITP import (10E) in a real
 * browser against the clickable demo build (canned AI answers in-browser),
 * at phone size:
 *
 *   10C  Reports → Draft with AI → the summary box fills under an "AI draft"
 *        notice → edit → Generate report → the new version shows its
 *        AI-assisted summary
 *   10E  ITP templates → Import with AI → choose a file → Read with AI →
 *        review the drafted lines (fix one, add one) → Save as master
 *        template → the template page lists the lines and says it was
 *        imported with AI
 */

test.use({ viewport: { width: 412, height: 915 } })

test("10C: draft the report summary with AI, edit it, generate", async ({
  page,
}) => {
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

  await page.getByTestId("report-ai-draft").click()
  const box = page.getByTestId("report-summary")
  await expect(box).toHaveValue(/finding/)
  await expect(page.getByTestId("ai-draft-notice")).toContainText(
    "Generate report",
  )
  await box.press("End")
  await box.pressSequentially(" Reviewed on site.")
  await page.getByTestId("generate-report").click()

  const latest = page.getByTestId("report-row").first()
  await expect(latest).toContainText("Latest")
  const preview = latest.getByTestId("report-summary-preview")
  await expect(preview).toContainText("AI-assisted summary")
  await expect(preview).toContainText("Reviewed on site.")
  await expect(page.getByTestId("report-summary-editor")).toBeHidden()
})

test("10E: import an ITP, review the draft, save it as a master", async ({
  page,
}) => {
  await page.goto("/demo.html")
  await expect(page.getByTestId("greeting")).toBeVisible()
  await page.getByRole("button", { name: "Toggle navigation" }).click()
  await page
    .getByTestId("main-nav")
    .getByRole("link", { name: "ITP templates" })
    .click()
  await page.getByTestId("import-template").click()

  const dialog = page.getByTestId("itp-import-dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId("import-read")).toBeDisabled()
  await dialog.getByTestId("import-file-input").setInputFiles({
    name: "bolting-itp.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% demo\n"),
  })
  await expect(dialog.getByTestId("import-file-list")).toContainText(
    "bolting-itp.pdf",
  )
  await dialog.getByTestId("import-read").click()

  const review = dialog.getByTestId("import-review")
  await expect(review).toBeVisible()
  await expect(dialog.getByTestId("import-ai-notice")).toContainText(
    "check every line",
  )
  await expect(dialog.getByTestId("import-notes")).toContainText("cut off")
  await expect(dialog.getByTestId("import-line")).toHaveCount(5)
  await expect(dialog.getByTestId("import-check")).toContainText(
    "5 lines · 1 hold point · 3 sign-off roles",
  )

  // Make the witness on snug-tight a hold point: it needs a signer already set.
  const snug = dialog.getByTestId("import-line").nth(3)
  await snug.getByTestId("import-line-classification").selectOption("H")
  await expect(dialog.getByTestId("import-check")).toContainText(
    "2 hold points",
  )
  // Add a line in the last section; it needs words before saving.
  await dialog.getByTestId("import-add-line").last().click()
  await expect(dialog.getByTestId("import-check")).toContainText(
    "needs a description",
  )
  await expect(dialog.getByTestId("import-save")).toBeDisabled()
  await dialog
    .getByTestId("import-line-title")
    .last()
    .fill("Bolt tension spot check after pretensioning")
  await expect(dialog.getByTestId("import-check")).toContainText("6 lines")

  await dialog.getByTestId("import-name").fill("Steel bolting (imported)")
  await dialog.getByTestId("import-save").click()

  await expect(
    page.getByRole("heading", { name: "Steel bolting (imported)" }),
  ).toBeVisible()
  await expect(page.getByTestId("template-ai-provenance")).toContainText(
    "Imported with AI, edited before saving",
  )
  await expect(page.getByTestId("template-ai-provenance")).toContainText(
    "bolting-itp.pdf",
  )
  await expect(page.getByTestId("template-lines").locator("li")).toHaveCount(6)
})
