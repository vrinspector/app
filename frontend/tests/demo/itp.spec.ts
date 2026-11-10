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
  await expect(page.getByTestId("itp-card")).toHaveCount(2)
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
  await expect(page.getByTestId("itp-card")).toHaveCount(5)
  await expect(
    page.getByTestId("itp-card").filter({ hasText: "Concrete pour — Level 2" }),
  ).toBeVisible()
})

test("hold point blocks later lines until signed, then the ITP completes", async ({
  page,
}, testInfo) => {
  await openProject(page)
  await page.getByTestId("itp-card").filter({ hasText: "Stage 1" }).click()
  await expect(page.getByTestId("itp-summary")).toContainText("2 of 5 recorded")

  const lines = page.getByTestId("itp-item")
  const hold = lines.nth(1)
  const cover = lines.nth(2)
  await expect(hold).toContainText("Hold point")
  await expect(cover).toHaveAttribute("data-blocked", "true")
  await expect(cover.getByTestId("itp-result-pass")).toBeDisabled()
  await expect(page.getByTestId("itp-blockers")).toContainText(
    "is waiting for Client engineer",
  )
  await expect(page.getByTestId("itp-complete")).toBeDisabled()
  await page.screenshot({
    path: testInfo.outputPath("itp-hold-waiting.png"),
    fullPage: true,
  })

  // The owner signs for the role that has no signer email.
  await hold.getByTestId("itp-sign").click()
  await page.getByTestId("itp-sign-confirm").click()
  await expect(hold.getByTestId("itp-signature")).toHaveCount(2)
  await expect(cover).toHaveAttribute("data-blocked", "false")

  for (const index of [2, 3, 4]) {
    await lines.nth(index).getByTestId("itp-result-pass").click()
    await expect(lines.nth(index)).toHaveAttribute("data-status", "pass")
  }
  await expect(page.getByTestId("itp-blockers")).toHaveCount(0)
  await page.getByTestId("itp-complete").click()
  await expect(page.getByTestId("itp-summary")).toContainText("Complete")
  await expect(lines.nth(0).getByTestId("itp-result-fail")).toBeDisabled()

  await page.getByTestId("itp-form-tab").click()
  await expect(page.getByTestId("survey-form")).toContainText(
    "Reinforcement inspected before pour",
  )
  await page.screenshot({
    path: testInfo.outputPath("itp-form-view.png"),
    fullPage: true,
  })
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
    "Formwork set out",
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
  await expect(marker).toHaveAttribute("data-itp", "surveillance")

  await page.getByTestId("itp-marking-back").click()
  await expect(
    page.getByTestId("itp-item").first().getByTestId("itp-item-pin"),
  ).toContainText("Site Plan")
})

test("master templates: list, lines, SurveyJS preview, edit → v2", async ({
  page,
}) => {
  await page.goto("/demo.html")
  await expect(page.getByTestId("greeting")).toBeVisible()
  await page.getByRole("button", { name: "Toggle navigation" }).click()
  await page
    .getByTestId("main-nav")
    .getByRole("link", { name: "ITP templates" })
    .click()
  await page.getByTestId("template-card").first().click()
  await expect(page.getByTestId("template-lines").locator("li")).toHaveCount(5)
  await expect(page.getByTestId("survey-form")).toContainText(
    "Pour witnessed · Witness point",
  )

  await page.getByTestId("edit-template").click()
  const editor = page.getByTestId("template-form-dialog")
  await expect(editor.getByTestId("template-check")).toContainText(
    "5 lines · 1 hold point · 2 sign-off roles",
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
