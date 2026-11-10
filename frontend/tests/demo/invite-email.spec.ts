import { expect, test } from "@playwright/test"

/*
 * Increment 13.5 — member invite emails, walked in a real browser against the
 * clickable demo build. The demo never sends mail; it records what the server
 * would send, so the Members section shows the same outcome lines an owner
 * sees on the real app ("Invite emailed …", "Resend invite").
 */

test.use({ viewport: { width: 412, height: 915 } }) // phone, as in the field

test("owner adds a member, sees the invite emailed, and can resend later", async ({
  page,
}) => {
  await page.goto("/demo.html")
  await expect(page.getByTestId("greeting")).toBeVisible()
  await page
    .getByTestId("project-health-cards")
    .getByRole("link", { name: "Cedar Hollow Landfill RNG" })
    .click()

  const list = page.getByTestId("member-list")
  await expect(list).toBeVisible()

  // The seeded viewer was emailed three days ago and has not signed in.
  const viewerRow = page
    .getByTestId("member-row")
    .filter({ hasText: "qa.lead@example.com" })
  await expect(viewerRow.getByTestId("invite-email-status")).toHaveText(
    /Invite emailed/,
  )
  await expect(viewerRow.getByTestId("resend-invite")).toBeVisible()

  // Add someone new.
  const form = page.getByTestId("invite-form")
  await form.getByTestId("invite-email").fill("site.engineer@example.com")
  await form.getByTestId("send-invite").click()
  await expect(
    page.getByText("Member added — invite email on its way"),
  ).toBeVisible()
  const newRow = page
    .getByTestId("member-row")
    .filter({ hasText: "site.engineer@example.com" })
  await expect(newRow.getByTestId("invite-email-status")).toHaveAttribute(
    "data-status",
    "sent",
  )

  // An immediate resend is refused politely; the older invite can be resent.
  await newRow.getByTestId("resend-invite").click()
  await expect(page.getByText(/just sent to this member/)).toBeVisible()
  await viewerRow.getByTestId("resend-invite").click()
  await expect(
    page.getByText("Invite sent again to qa.lead@example.com"),
  ).toBeVisible()
})
