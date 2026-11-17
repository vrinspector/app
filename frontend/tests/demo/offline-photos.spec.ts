import { expect, test } from "@playwright/test"

/*
 * Increment 20 — the offline photo queue in a real browser (real IndexedDB)
 * against the clickable demo build, at phone size:
 *
 *   signal off → Take photo on the inspection and Add photo on a finding →
 *   both are kept on the device, shown where they belong as "Not uploaded
 *   yet", counted in the header chip and listed in the sync panel →
 *   signal back → both go up through presign → S3 → register on their own,
 *   land in the inspection's photos and the finding's strip, and leave the
 *   device.
 */

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
)

test.use({ viewport: { width: 412, height: 915 } })

test("photos taken without signal wait on the device, then upload", async ({
  page,
  context,
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
  await expect(page.getByTestId("photo-thumb").first()).toBeVisible()
  const photosBefore = await page.getByTestId("photo-thumb").count()
  const finding = page.getByTestId("finding-card").first()
  await expect(finding).toBeVisible()
  const findingPhotosBefore = await finding.getByTestId("finding-photo").count()

  // --- no signal --------------------------------------------------------
  await context.setOffline(true)
  await expect(page.getByTestId("sync-indicator-label")).toHaveText("Offline")

  await page.getByTestId("camera-input").first().setInputFiles({
    name: "level-3-pour.png",
    mimeType: "image/png",
    buffer: PNG_1x1,
  })
  const siteTile = page.getByTestId("photo-grid").getByTestId("queued-photo")
  await expect(siteTile).toHaveCount(1)
  await expect(siteTile).toHaveAttribute("data-status", "waiting")
  await expect(siteTile.getByTestId("queued-photo-status")).toHaveText(
    "Not uploaded yet",
  )
  await expect(page.getByTestId("photos-queued-count")).toHaveText(
    "+ 1 on this device",
  )

  await finding.getByTestId("finding-photo-input").setInputFiles({
    name: "crack-closeup.png",
    mimeType: "image/png",
    buffer: PNG_1x1,
  })
  await expect(finding.getByTestId("queued-photo")).toHaveCount(1)

  await expect(page.getByTestId("sync-indicator-label")).toHaveText(
    "Offline · 2 waiting",
  )
  await page.getByTestId("sync-indicator").click()
  const panel = page.getByTestId("sync-panel")
  await expect(panel.getByTestId("sync-photo")).toHaveCount(2)
  await expect(panel.getByTestId("sync-photos")).toContainText(
    "Photo for finding",
  )
  await page.keyboard.press("Escape")

  // Kept on the device: a reload with signal back would still have them.
  const kept = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("vri-photo-queue")
        open.onsuccess = () => {
          const tx = open.result.transaction("bytes", "readonly")
          const count = tx.objectStore("bytes").count()
          count.onsuccess = () => resolve(count.result)
          count.onerror = () => reject(count.error)
        }
        open.onerror = () => reject(open.error)
      }),
  )
  expect(kept).toBe(2)

  // --- signal back --------------------------------------------------------
  await context.setOffline(false)
  await expect(page.getByTestId("queued-photo")).toHaveCount(0, {
    timeout: 15_000,
  })
  // The inspection's photos list every photo of the inspection, the finding's
  // included; the finding's strip shows its own.
  await expect(page.getByTestId("photo-thumb")).toHaveCount(photosBefore + 2)
  await expect(finding.getByTestId("finding-photo")).toHaveCount(
    findingPhotosBefore + 1,
  )
  await expect(page.getByTestId("sync-indicator")).toHaveCount(0)
})
