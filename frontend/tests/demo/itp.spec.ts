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

/** Pass one line: a photo when it needs one, then Pass, then any signatures. */
async function passLine(page: Page, line: ReturnType<Page["getByTestId"]>) {
  const slots = line.getByTestId("itp-shot-slot")
  if ((await slots.count()) > 0) {
    for (let n = 0; n < 3; n++) {
      await slots
        .nth(n)
        .getByTestId("library-input")
        .setInputFiles({
          name: `shot-${n}.png`,
          mimeType: "image/png",
          buffer: PNG_1x1,
        })
      await expect(slots.nth(n)).toHaveAttribute("data-filled", "true")
    }
  } else if ((await line.getByTestId("itp-photo-required").count()) > 0) {
    await line.getByTestId("library-input").setInputFiles({
      name: "evidence.png",
      mimeType: "image/png",
      buffer: PNG_1x1,
    })
    await expect(line.getByTestId("itp-photo-on-file")).toBeVisible()
  }
  await line.getByTestId("itp-result-pass").click()
  await expect(line).toHaveAttribute("data-status", "pass")
  const hold =
    (await line
      .getByTestId("itp-classification-chip")
      .getAttribute("aria-label")) === "Hold point"
  if (!hold) return
  const signs = line.getByTestId("itp-sign")
  const count = await signs.count()
  for (let i = 0; i < count; i++) {
    await signs.first().click()
    await page.getByTestId("itp-sign-confirm").click()
    await expect(line.getByTestId("itp-signature")).toHaveCount(i + 1)
  }
}

test("hold point blocks later lines until signed, then the ITP completes", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  // Stage 3 carries the starter "Piping pressure test (hydrostatic)" from
  // the field guide's Checklist A-3: the package checks are passed and the
  // first boundary-walkdown hold (blinds) waits for both signatures.
  await openProject(page)
  await page.getByTestId("itp-card").filter({ hasText: "Stage 3" }).click()
  await expect(page.getByTestId("itp-summary")).toContainText(
    "7 of 25 recorded",
  )

  const lines = page.getByTestId("itp-item")
  await expect(lines).toHaveCount(25)
  const hold = lines.nth(6)
  const next = lines.nth(7)
  await expect(hold).toContainText("Every blind on the isolation list")
  await expect(hold.getByTestId("itp-classification-chip")).toHaveAttribute(
    "aria-label",
    "Hold point",
  )
  await expect(hold.getByTestId("itp-line-criteria")).toContainText(
    "Field guide Checklist A-3 item 7",
  )
  await expect(next).toHaveAttribute("data-blocked", "true")
  // 13.8: a locked line has no result buttons; one notice per section says
  // why (the hold's own section and the four after it).
  await expect(next.getByTestId("itp-result-pass")).toHaveCount(0)
  await expect(page.getByTestId("itp-section-lock")).toHaveCount(5)
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
  await expect(next).toHaveAttribute("data-blocked", "false")

  // The test pressure is a hold with a measured value in psig.
  await expect(lines.nth(15)).toContainText("Test pressure recorded")
  await expect(lines.nth(15).getByTestId("itp-measured-unit")).toHaveText(
    "psig",
  )
  // Walk the rest: the pressure and leak holds need a photo and both
  // signatures; every other line passes.
  for (let index = 7; index < 25; index++) {
    await passLine(page, lines.nth(index))
  }
  await expect(page.getByTestId("itp-blockers")).toHaveCount(0)
  await page.getByTestId("itp-complete").click()
  await expect(page.getByTestId("itp-summary")).toContainText("Complete")
  await expect(lines.nth(0).getByTestId("itp-result-fail")).toBeDisabled()

  await page.getByTestId("itp-form-tab").click()
  await expect(page.getByTestId("survey-form")).toContainText(
    "No visible leakage",
  )
  await page.screenshot({
    path: testInfo.outputPath("itp-form-view.png"),
    fullPage: true,
  })
})

test("release line: Approved to pour / with conditions / Rejected, in writing", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000)
  // Stage 1 concrete (13.9): every Checklist A-1 check done, the rebar holds
  // released, and the written pre-pour release recorded "Approved with
  // conditions" — waiting for the Contractor and the Owner's representative.
  await openProject(page)
  await page.getByTestId("itp-card").filter({ hasText: "Stage 1" }).click()
  const lines = page.getByTestId("itp-item")
  await expect(lines).toHaveCount(48)
  const release = lines.filter({ hasText: "Pre-pour release (in writing)" })
  await expect(release.getByTestId("itp-item-status")).toHaveText(
    "Approved with conditions",
  )
  await expect(release.getByTestId("itp-item-conditions")).toContainText(
    "Re-tie two loose bars at grid C7",
  )
  await expect(release.getByTestId("itp-result-na")).toHaveCount(0)
  await expect(release.getByTestId("itp-release-approved")).toHaveText(
    "Approved to pour",
  )
  await expect(release.getByTestId("itp-release-conditional")).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  const batch = lines.filter({ hasText: "Batch tickets reviewed" })
  await expect(batch).toHaveAttribute("data-blocked", "true")
  await page.screenshot({
    path: testInfo.outputPath("itp-release-conditional.png"),
    fullPage: true,
  })

  // Plain approval drops the conditions; Rejected is the brick result.
  await release.getByTestId("itp-release-approved").click()
  await expect(release.getByTestId("itp-item-status")).toHaveText(
    "Approved to pour",
  )
  await expect(release.getByTestId("itp-item-conditions")).toHaveCount(0)
  await release.getByTestId("itp-release-rejected").click()
  await expect(release).toHaveAttribute("data-status", "fail")
  await expect(release.getByTestId("itp-item-status")).toHaveText("Rejected")
  await release.getByTestId("itp-note").fill("Mud on the bottom mat at C4")
  await release.getByRole("button", { name: "Save note" }).click()

  // Approved with conditions asks for them in writing first.
  await release.getByTestId("itp-release-conditional").click()
  const conditions = release.getByTestId("itp-conditions")
  await expect(release.getByTestId("itp-conditions-save")).toBeDisabled()
  await conditions.fill("1. Clean the bottom mat at C4 and re-inspect")
  await release.getByTestId("itp-conditions-save").click()
  await expect(release.getByTestId("itp-item-status")).toHaveText(
    "Approved with conditions",
  )
  await expect(release.getByTestId("itp-item-conditions")).toContainText(
    "Clean the bottom mat",
  )

  // Both parties sign; the during-pour test set opens up.
  for (let i = 0; i < 2; i++) {
    await release.getByTestId("itp-sign").first().click()
    await page.getByTestId("itp-sign-confirm").click()
    await expect(release.getByTestId("itp-signature")).toHaveCount(i + 1)
  }
  await expect(batch).toHaveAttribute("data-blocked", "false")
  await expect(release.getByTestId("itp-release")).toHaveCount(1)
  await expect(release.getByTestId("itp-release-approved")).toBeDisabled()

  await page.getByTestId("itp-form-tab").click()
  await expect(page.getByTestId("survey-form")).toContainText(
    "Pre-pour release (in writing)",
  )
})

test("line evidence: criteria, required photo, measured value with tolerance", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000)
  // Stage 2 carries the starter "Cast-in-place concrete": the before-work
  // submittals accepted, the forms failed (13.8 sample).
  await openProject(page)
  await page.getByTestId("itp-card").filter({ hasText: "Stage 2" }).click()
  const lines = page.getByTestId("itp-item")
  await expect(lines).toHaveCount(48)
  const submittal = lines.nth(0)
  const subgrade = lines.nth(3)

  // H / W / R / I vocabulary (the gutter chip) and the line's criteria.
  const chip = (line: typeof submittal) =>
    line.getByTestId("itp-classification-chip")
  await expect(chip(submittal)).toHaveText("R")
  await expect(chip(submittal)).toHaveAttribute("aria-label", "Review")
  await expect(chip(subgrade)).toHaveText("W")
  await expect(submittal.getByTestId("itp-line-criteria")).toContainText(
    "ACI 301 Section 3",
  )
  await expect(subgrade.getByTestId("itp-line-criteria")).toContainText(
    "Project-specific value required — verify before issue",
  )
  await expect(submittal.getByTestId("itp-criteria-record")).toContainText(
    "Approved shop drawings",
  )

  const photo = (name: string) => ({
    name,
    mimeType: "image/png",
    buffer: PNG_1x1,
  })
  // Before work and Checklist A-1 formwork and shoring: some lines need a
  // photo before they can pass.
  for (let index = 0; index < 10; index++) {
    const line = lines.nth(index)
    if ((await line.getAttribute("data-status")) === "pass") continue
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

  // The rebar hold point (Checklist A-1 item 7): bars counted, spacing
  // measured at three locations, and the three-shot set before Pass.
  const spacing = lines.nth(10)
  const cover = lines.nth(11)
  await expect(spacing).toContainText("Rebar size and spacing")
  await expect(spacing.getByTestId("itp-line-criteria")).toContainText(
    "at least three locations",
  )
  await expect(cover).toHaveAttribute("data-blocked", "true")
  const slots = spacing.getByTestId("itp-shot-slot")
  await expect(slots).toHaveCount(3)
  await expect(slots.nth(2)).toContainText("Close-up with scale")
  await expect(spacing.getByTestId("itp-three-shot-needed")).toContainText(
    "0 of 3",
  )
  await expect(spacing.getByTestId("itp-result-pass")).toBeDisabled()
  for (const [n, slot] of ["context", "intermediate", "closeup"].entries()) {
    await slots
      .nth(n)
      .getByTestId("library-input")
      .setInputFiles(photo(`${slot}.png`))
    await expect(slots.nth(n)).toHaveAttribute("data-filled", "true")
  }
  await expect(spacing.getByTestId("itp-three-shot-complete")).toBeVisible()
  await spacing.getByTestId("itp-result-pass").click()
  await expect(spacing).toHaveAttribute("data-status", "pass")
  await spacing.getByTestId("itp-sign").first().click()
  await page.getByTestId("itp-sign-confirm").click()
  await expect(spacing.getByTestId("itp-signature")).toHaveCount(1)
  await expect(cover).toHaveAttribute("data-blocked", "false")
  await expect(cover.getByTestId("itp-measured-unit")).toHaveText("in")
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
    "Rebar submittal approved",
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
  // The account starts with the eleven book-aligned starters, concrete first.
  await expect(page.getByTestId("template-card")).toHaveCount(11)
  await expect(page.getByTestId("template-card").first()).toContainText(
    "Cast-in-place concrete",
  )

  // New template: pick a starter or a blank outline.
  await page.getByTestId("new-template").click()
  const creator = page.getByTestId("template-form-dialog")
  await expect(creator.getByTestId("template-check")).toContainText(
    "48 lines · 7 hold points · 3 sign-off roles",
  )
  await creator
    .getByTestId("template-start")
    .selectOption({ label: "Starter: Piping pressure test (hydrostatic)" })
  await expect(creator.getByTestId("template-name")).toHaveValue(
    "Piping pressure test (hydrostatic)",
  )
  await expect(creator.getByTestId("template-check")).toContainText(
    "25 lines · 3 hold points · 3 sign-off roles",
  )
  await creator
    .getByTestId("template-start")
    .selectOption({ label: "Starter: Ready for startup (RFSU)" })
  await expect(creator.getByTestId("template-check")).toContainText(
    "26 lines · 1 hold point · 6 sign-off roles",
  )
  await creator
    .getByTestId("template-start")
    .selectOption({ label: "Blank outline" })
  await expect(creator.getByTestId("template-check")).toContainText(
    "1 line · 1 hold point · 3 sign-off roles",
  )
  await page.keyboard.press("Escape")

  await page.getByTestId("template-card").first().click()
  await expect(page.getByTestId("template-lines").locator("li")).toHaveCount(48)
  await expect(page.getByTestId("survey-form")).toContainText(
    "Pre-pour release (in writing) · Hold point",
  )

  await page.getByTestId("edit-template").click()
  const editor = page.getByTestId("template-form-dialog")
  await expect(editor.getByTestId("template-start")).toHaveCount(0)
  await expect(editor.getByTestId("template-check")).toContainText(
    "48 lines · 7 hold points · 3 sign-off roles",
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

test("look and feel: document numbers, section bars, one lock notice, failed lines", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000)
  await openProject(page)
  // The sample project's owner set the ITP code CH-RNG; numbers follow it.
  const cards = page.getByTestId("itp-card")
  await expect(cards.first().getByTestId("itp-doc-number")).toHaveText(
    "ITP-CH-RNG-001",
  )
  await expect(
    cards.filter({ hasText: "Stage 2" }).getByTestId("itp-doc-number"),
  ).toHaveText("ITP-CH-RNG-002")

  await cards.filter({ hasText: "Stage 2" }).click()
  await expect(page.getByTestId("page-header")).toContainText("ITP-CH-RNG-002")

  // Eight section bars; the reinforcement one says sign-off is required.
  const sections = page.getByTestId("itp-section")
  await expect(sections).toHaveCount(8)
  const rebar = sections.filter({ hasText: "3 Reinforcement (hold points)" })
  await expect(rebar.getByTestId("itp-section-signoff")).toHaveText(
    "Sign-off required",
  )
  await expect(sections.first().getByTestId("itp-section-signoff")).toHaveCount(
    0,
  )
  // One lock notice per locked stretch, not one per line: the reinforcement
  // section (after its first hold point) and the five sections after it.
  await expect(page.getByTestId("itp-section-lock")).toHaveCount(6)
  await expect(rebar.getByTestId("itp-section-lock")).toContainText(
    "Locked from line 12",
  )
  const locked = page.locator('[data-testid="itp-item"][data-blocked="true"]')
  await expect(locked).toHaveCount(37)
  await expect(locked.getByTestId("itp-result-pass")).toHaveCount(0)

  // The failed forms line: tinted, with its note directly beneath.
  const forms = page.getByTestId("itp-item").nth(4)
  await expect(forms).toHaveAttribute("data-status", "fail")
  await expect(forms.getByTestId("itp-item-note")).toContainText(
    "out of line at gridline C",
  )
  await expect(forms.getByTestId("itp-line-number")).toHaveText("5")
  await page.screenshot({
    path: testInfo.outputPath("itp-look-and-feel.png"),
    fullPage: true,
  })

  // Failing a line opens its note at once.
  const clean = page.getByTestId("itp-item").nth(5)
  await clean.getByTestId("itp-result-fail").click()
  await expect(clean.getByTestId("itp-note")).toBeVisible()
  await clean.getByTestId("itp-note").fill("Standing water at grid B2")
  await clean.getByRole("button", { name: "Save note" }).click()
  await expect(clean.getByTestId("itp-item-note")).toContainText(
    "Standing water",
  )

  // The owner changes the project code: every number follows.
  await openProject(page)
  await page.getByTestId("project-actions").click()
  await page.getByRole("menuitem", { name: /Edit/ }).click()
  const form = page.getByTestId("project-form-dialog")
  await form.getByTestId("project-code").fill("chl 4")
  await expect(form.getByTestId("project-code-preview")).toContainText(
    "ITP-CHL-4-001",
  )
  await form.getByTestId("project-form-submit").click()
  await expect(form).toHaveCount(0)
  await expect(cards.first().getByTestId("itp-doc-number")).toHaveText(
    "ITP-CHL-4-001",
  )
})
