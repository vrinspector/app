import { expect, type Page, test } from "@playwright/test"

/*
 * Increment 14 — external sign-off end to end against the clickable demo
 * build (in-browser API with the same rules as the real one; see
 * src/demo/fakeSignoff.ts). Stage 1 concrete has its written pre-pour
 * release waiting for the Owner's representative, and a signing link is
 * seeded for them: make the pack, open the link, draw a signature on a real
 * canvas, sign, and see the signature back on the ITP. Phone size.
 */

test.use({ viewport: { width: 412, height: 915 } })

async function openStage1(page: Page) {
  await page.goto("/demo.html")
  await expect(page.getByTestId("greeting")).toBeVisible()
  await page
    .getByTestId("project-health-cards")
    .getByRole("link", { name: "Cedar Hollow Landfill RNG" })
    .click()
  await page
    .getByTestId("itp-card")
    .filter({ hasText: "Stage 1" })
    .first()
    .click()
  await expect(page.getByTestId("itp-summary")).toBeVisible()
}

async function draw(page: Page) {
  const canvas = page.getByTestId("signature-canvas")
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  if (!box) throw new Error("no canvas")
  await page.mouse.move(box.x + 30, box.y + box.height * 0.6)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      box.x + 30 + i * 20,
      box.y + box.height * (i % 2 ? 0.3 : 0.7),
      { steps: 3 },
    )
  }
  await page.mouse.up()
}

test("pack, signing link, drawn signature, back on the ITP", async ({
  page,
}) => {
  await openStage1(page)
  await page.getByTestId("itp-signoff-tab").click()

  // The pack: version 1, and asking again keeps version 1.
  await page.getByTestId("pack-current").click()
  await expect(page.getByTestId("pack-versions")).toContainText("Version 1")
  await expect(page.getByTestId("pack-download")).toHaveAttribute(
    "href",
    /sample-pack/,
  )
  await page.getByTestId("pack-current").click()
  await expect(
    page.getByText("Version 1 is still current — nothing has changed"),
  ).toBeVisible()

  // The seeded link for the Owner's representative.
  const link = page
    .getByTestId("sign-link")
    .filter({ hasText: "Owner's representative" })
  await expect(link).toContainText("Waiting for signature")
  await link.getByTestId("link-open").click()

  // The signing page (no account).
  await expect(page.getByText(/You are signing as/)).toContainText(
    "Owner's representative",
  )
  const ready = page.locator('[data-testid="sign-line"][data-state="ready"]')
  await expect(ready.first()).toBeVisible()
  const count = await ready.count()
  expect(count).toBeGreaterThan(0)
  await expect(
    ready.filter({ hasText: "Approved with conditions" }),
  ).toHaveCount(1)

  const submit = page.getByTestId("sign-submit")
  await expect(submit).toBeDisabled()
  await page.getByTestId("signer-name").fill("Morgan Reyes")
  await draw(page)
  await page.getByTestId("sign-confirm").click()
  await page.getByLabel(/Add my location/).click()
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.getByTestId("sign-done")).toContainText(
    `You signed ${count} line`,
  )

  // Back on the ITP: the link is used, the signature shows with its stamp.
  await page.getByTestId("sign-back").click()
  await expect(page.getByTestId("itp-summary")).toBeVisible()
  await page.getByTestId("itp-signoff-tab").click()
  await expect(
    page.getByTestId("sign-link").filter({ hasText: "Owner's representative" }),
  ).toContainText("Signed")
  // Something changed, so the pack moves to version 2.
  await page.getByTestId("pack-current").click()
  await expect(page.getByTestId("pack-versions")).toContainText("Version 2")
  await page.getByRole("tab", { name: "Checklist" }).click()
  const signature = page
    .getByTestId("itp-signature")
    .filter({ hasText: "Morgan Reyes" })
    .first()
  await expect(signature).toContainText("by email link")
  await expect(signature).toContainText("Partly cloudy")
  await expect(signature.getByTestId("itp-signature-image")).toBeVisible()
})

test("the demo opens a signing link straight from its URL", async ({
  page,
}) => {
  await page.goto("/demo.html?start=/sign/demo-owners-rep")
  await expect(page.getByText(/You are signing as/)).toBeVisible()
  await page.goto("/demo.html?start=/sign/not-a-real-link")
  await expect(page.getByTestId("sign-gone")).toContainText(
    "This link is not valid",
  )
})
