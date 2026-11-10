import { expect, type Page, test } from "@playwright/test"

/*
 * Increment 13 — the ITP screens end to end against the clickable demo build
 * (fake signed-in owner, in-browser API with the same hold-point rules as the
 * real one; see src/demo/fakeItp.ts). Walks what a site engineer does: add a
 * numbered series of areas, bulk-apply a master to them, record an ITP past
 * its hold point once it is signed, complete it, mark a line on a drawing,
 * and look at the master and its SurveyJS form.
 */

test.use({ viewport: { width: 412, height: 915 } }) // phone first

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
)

async function openProject(page: Page) {
  await page.goto("/demo.html")
  await expect(page.getByTestId("greeting")).toBeVisible()
  await page
    .getByTestId("project-health-cards")
    .getByRole("link", { name: "Cedar Hollow Landfill RNG" })
    .click()
  await expect(page.getByTestId("itp-list")).toBeVisible()
}

test("areas: add a series, then bulk-apply a template to them", async ({
  page,
}) => {
  await openProject(page)
  await expect(page.getByTestId("itp-card")).toHaveCount(4)
  await expect(page.getByTestId("area-row")).toHaveCount(3)

  await page.getByTestId("add-area-series").click()
  const series = page.getByTestId("bulk-areas-dialog")
  await series.getByTestId("series-end").fill("3")
  await expect(series.getByTestId("series-preview")).toHaveText(
    "3 areas: Level 1 … Level 3",
  )
  await series.getByTestId("save-area-series").click()
  await expect(page.getByTestId("area-row")).toHaveCount(6)

  await page.getByTestId("apply-template").first().click()
  const apply = page.getByTestId("apply-template-dialog")
  await apply.getByTestId("apply-target-areas").check()
  for (const name of ["Level 1", "Level 2", "Level 3"]) {
    await apply.getByText(name, { exact: true }).click()
  }
  await expect(apply.getByTestId("apply-template-submit")).toHaveText(
    "Apply to 3 areas",
  )
  await apply.getByTestId("apply-template-submit").click()
  await expect(page.getByTestId("itp-card")).toHaveCount(7)
  await expect(
    page
      .getByTestId("itp-card")
      .filter({ hasText: "Cast-in-place concrete — Level 2" }),
  ).toBeVisible()
})

test("hold point blocks later lines until signed, then the ITP completes", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000)
  // Stage 3 carries the starter "Piping pressure test": the pre-test checks
  // are passed and the pressure hold is waiting for both signatures.
  await openProject(page)
  await page.getByTestId("itp-card").filter({ hasText: "Stage 3" }).click()
  await expect(page.getByTestId("itp-summary")).toContainText(
    "5 of 10 recorded",
  )

  const lines = page.getByTestId("itp-item")
  const hold = lines.nth(4)
  const holdTime = lines.nth(5)
  await expect(hold).toContainText("Test pressure held")
  await expect(hold).toContainText("Hold point")
  await expect(hold.getByTestId("itp-measured-unit")).toHaveText("psig")
  await expect(holdTime).toHaveAttribute("data-blocked", "true")
  await expect(holdTime.getByTestId("itp-result-pass")).toBeDisabled()
  await expect(page.getByTestId("itp-blockers")).toContainText(
    "is waiting for Contractor",
  )
  await expect(page.getByTestId("itp-complete")).toBeDisabled()
  await page.screenshot({
    path: testInfo.outputPath("itp-hold-waiting.png"),
    fullPage: true,
  })

  // The owner signs for both roles (neither has a signer email).
  for (let i = 0; i < 2; i++) {
    await hold.getByTestId("itp-sign").first().click()
    await page.getByTestId("itp-sign-confirm").click()
    await expect(hold.getByTestId("itp-signature")).toHaveCount(i + 1)
  }
  await expect(holdTime).toHaveAttribute("data-blocked", "false")

  for (const index of [5, 6]) {
    await lines.nth(index).getByTestId("itp-result-pass").click()
    await expect(lines.nth(index)).toHaveAttribute("data-status", "pass")
  }
  // The leak examination is a second hold point that needs a photo.
  const leak = lines.nth(7)
  await expect(leak.getByTestId("itp-result-pass")).toBeDisabled()
  await leak.getByTestId("library-input").setInputFiles({
    name: "leak-check.png",
    mimeType: "image/png",
    buffer: PNG_1x1,
  })
  await expect(leak.getByTestId("itp-photo-on-file")).toBeVisible()
  await leak.getByTestId("itp-result-pass").click()
  for (let i = 0; i < 2; i++) {
    await leak.getByTestId("itp-sign").first().click()
    await page.getByTestId("itp-sign-confirm").click()
    await expect(leak.getByTestId("itp-signature")).toHaveCount(i + 1)
  }
  for (const index of [8, 9]) {
    await lines.nth(index).getByTestId("itp-result-pass").click()
    await expect(lines.nth(index)).toHaveAttribute("data-status", "pass")
  }
  await expect(page.getByTestId("itp-blockers")).toHaveCount(0)
  await page.getByTestId("itp-complete").click()
  await expect(page.getByTestId("itp-summary")).toContainText("Complete")
  await expect(lines.nth(0).getByTestId("itp-result-fail")).toBeDisabled()

  await page.getByTestId("itp-form-tab").click()
  await expect(page.getByTestId("survey-form")).toContainText(
    "Leak examination",
  )
  await page.screenshot({
    path: testInfo.outputPath("itp-form-view.png"),
    fullPage: true,
  })
})

test("line evidence: criteria, required photo, measured value with tolerance", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000)
  // Stage 2 carries the starter "Cast-in-place concrete", not started.
  await openProject(page)
  await page.getByTestId("itp-card").filter({ hasText: "Stage 2" }).click()
  const lines = page.getByTestId("itp-item")
  await expect(lines).toHaveCount(27)
  const mix = lines.nth(0)
  const subgrade = lines.nth(2)

  // H / W / R / I vocabulary and the line's criteria under its title.
  await expect(mix).toContainText("Review")
  await expect(subgrade).toContainText("Witness")
  await expect(mix.getByTestId("itp-line-criteria")).toContainText(
    "ACI 301 Section 4",
  )
  await expect(mix.getByTestId("itp-line-criteria")).toContainText(
    "Project-specific value required — verify before issue",
  )
  await expect(mix.getByTestId("itp-criteria-record")).toContainText(
    "Accepted mix submittal",
  )

  const photo = (name: string) => ({
    name,
    mimeType: "image/png",
    buffer: PNG_1x1,
  })
  // Before work and formwork: the anchor bolts, embeds and grounding lines
  // need a photo before they can pass.
  for (let index = 0; index < 7; index++) {
    const line = lines.nth(index)
    if ((await line.getByTestId("itp-photo-required").count()) > 0) {
      await expect(line.getByTestId("itp-result-pass")).toBeDisabled()
      await line
        .getByTestId("library-input")
        .setInputFiles(photo(`line-${index}.png`))
      await expect(line.getByTestId("itp-photo-on-file")).toBeVisible()
    }
    await line.getByTestId("itp-result-pass").click()
    await expect(line).toHaveAttribute("data-status", "pass")
  }

  // The first rebar hold point: photo, pass, then the third-party inspector
  // releases it and the next rebar line opens up.
  const barMarks = lines.nth(7)
  const spacing = lines.nth(8)
  await expect(barMarks).toContainText("Bar size and grade")
  await expect(spacing).toHaveAttribute("data-blocked", "true")
  await barMarks.getByTestId("library-input").setInputFiles(photo("bars.png"))
  await barMarks.getByTestId("itp-result-pass").click()
  await barMarks.getByTestId("itp-sign").first().click()
  await page.getByTestId("itp-sign-confirm").click()
  await expect(barMarks.getByTestId("itp-signature")).toHaveCount(1)
  await expect(spacing).toHaveAttribute("data-blocked", "false")
  await page.screenshot({
    path: testInfo.outputPath("itp-line-evidence.png"),
    fullPage: true,
  })

  // Measured value with unit and tolerance: the whole-project duct bank
  // allows at most 360° of bends between pull points.
  await openProject(page)
  await page
    .getByTestId("itp-card")
    .filter({ hasText: "Underground conduit" })
    .click()
  const bends = page.getByTestId("itp-item").nth(5)
  await expect(bends).toContainText("Total bends between pull points")
  await expect(bends.getByTestId("itp-measured-unit")).toHaveText("degrees")
  await expect(bends.getByTestId("itp-tolerance")).toContainText("≤ 360")
  const value = bends.getByTestId("itp-measured-input")
  await value.fill("400")
  await value.press("Enter")
  await expect(bends.getByTestId("itp-out-of-tolerance")).toBeVisible()
  await value.fill("270")
  await value.press("Enter")
  await expect(bends.getByTestId("itp-out-of-tolerance")).toHaveCount(0)
  await bends.getByTestId("itp-result-pass").click()
  await expect(bends).toHaveAttribute("data-status", "pass")
  await expect(value).toHaveValue("270")
})

test("an ITP line is marked on a drawing and shows its pin both ways", async ({
  page,
}) => {
  await openProject(page)
  await page.getByTestId("itp-card").filter({ hasText: "Stage 2" }).click()
  const line = page.getByTestId("itp-item").first()
  await line.getByTestId("itp-mark-on-drawing").click()
  await page.getByRole("menuitem", { name: /Site Plan/ }).click()

  await expect(page.getByTestId("itp-marking-banner")).toContainText(
    "Concrete mix design accepted",
  )
  await expect(page.getByTestId("pin-mode")).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(page.getByTestId("raster-image")).toBeVisible()
  await page.getByTestId("drawing-box").click({ position: { x: 150, y: 120 } })
  const dialog = page.getByTestId("pin-status-dialog")
  await expect(dialog).toContainText("marks the ITP line")
  await dialog.getByTestId("pin-status-in_progress").click()
  const marker = page.locator('[data-testid="pin-marker"][data-itp]')
  await expect(marker).toHaveCount(1)
  await expect(marker).toHaveAttribute("data-itp", "review")

  await page.getByTestId("itp-marking-back").click()
  await expect(
    page.getByTestId("itp-item").first().getByTestId("itp-item-pin"),
  ).toContainText("Site Plan")
})

test("master templates: starter library, lines, SurveyJS preview, edit → v2", async ({
  page,
}) => {
  await page.goto("/demo.html")
  await expect(page.getByTestId("greeting")).toBeVisible()
  await page.getByRole("button", { name: "Toggle navigation" }).click()
  await page
    .getByTestId("main-nav")
    .getByRole("link", { name: "ITP templates" })
    .click()
  // The account starts with the four starters, concrete first.
  await expect(page.getByTestId("template-card")).toHaveCount(4)
  await expect(page.getByTestId("template-card").first()).toContainText(
    "Cast-in-place concrete",
  )

  // New template: pick a starter or a blank outline.
  await page.getByTestId("new-template").click()
  const creator = page.getByTestId("template-form-dialog")
  await expect(creator.getByTestId("template-check")).toContainText(
    "27 lines · 8 hold points · 3 sign-off roles",
  )
  await creator
    .getByTestId("template-start")
    .selectOption({ label: "Starter: Piping pressure test" })
  await expect(creator.getByTestId("template-name")).toHaveValue(
    "Piping pressure test",
  )
  await expect(creator.getByTestId("template-check")).toContainText(
    "10 lines · 2 hold points · 3 sign-off roles",
  )
  await creator
    .getByTestId("template-start")
    .selectOption({ label: "Blank outline" })
  await expect(creator.getByTestId("template-check")).toContainText(
    "1 line · 1 hold point · 3 sign-off roles",
  )
  await page.keyboard.press("Escape")

  await page.getByTestId("template-card").first().click()
  await expect(page.getByTestId("template-lines").locator("li")).toHaveCount(27)
  await expect(page.getByTestId("survey-form")).toContainText(
    "Pre-pour release · Hold point",
  )

  await page.getByTestId("edit-template").click()
  const editor = page.getByTestId("template-form-dialog")
  await expect(editor.getByTestId("template-start")).toHaveCount(0)
  await expect(editor.getByTestId("template-check")).toContainText(
    "27 lines · 8 hold points · 3 sign-off roles",
  )
  await editor.getByTestId("template-body").fill('{"pages": []}')
  await expect(editor.getByTestId("template-check")).toContainText(
    "at least one page",
  )
  await expect(editor.getByTestId("save-template")).toBeDisabled()
  await editor.getByTestId("template-body").fill(
    JSON.stringify({
      pages: [
        {
          title: "Only page",
          elements: [
            {
              type: "text",
              name: "a",
              title: "Check A",
              classification: "record",
            },
          ],
        },
      ],
    }),
  )
  await editor.getByTestId("save-template").click()
  await expect(page.getByTestId("template-versions")).toContainText("v2")
  await expect(page.getByTestId("template-lines").locator("li")).toHaveCount(1)
})
