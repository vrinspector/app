/*
 * Increment 14 — external sign-off: plain-language labels and small helpers
 * shared by the sign-off panel (ITP and area screens), the witness notice
 * dialog and the public signing page.
 */
import type { SignLinkBatch, SignLinkPublic } from "@/client"
import type { StatusTone } from "@/components/Common/StatusBadge"

export const LINK_STATUS: Record<string, { label: string; tone: StatusTone }> =
  {
    active: { label: "Waiting for signature", tone: "attention" },
    used: { label: "Signed", tone: "positive" },
    expired: { label: "Expired", tone: "neutral" },
    revoked: { label: "Withdrawn", tone: "neutral" },
    replaced: { label: "Replaced by a newer link", tone: "neutral" },
  }

export const EMAIL_STATUS: Record<string, string> = {
  queued: "sending…",
  sent: "emailed",
  failed: "email failed",
  skipped: "not emailed — email is off on this server",
}

/** Can someone on the project still act on this link? */
export function linkActions(link: SignLinkPublic): {
  remind: boolean
  withdraw: boolean
} {
  return {
    remind: link.status === "active" || link.status === "expired",
    withdraw: link.status === "active",
  }
}

/** One toast line for a batch of links that were just requested. */
export function batchSummary(batch: SignLinkBatch): string {
  const n = batch.links.length
  if (!n) return "No signing links sent"
  const who = batch.links.map((l) => l.role_name).join(", ")
  return `Signing link${n === 1 ? "" : "s"} sent to ${who}`
}

/** "Partly cloudy, 61 °F, wind 7 mph" from a signature's weather stamp. */
export function weatherText(
  weather: Record<string, unknown> | null | undefined,
): string | null {
  if (!weather) return null
  const description = weather.description
  const temp = weather.temp_f
  if (typeof description !== "string" || typeof temp !== "number") return null
  const wind = typeof weather.wind_mph === "number" ? weather.wind_mph : null
  return `${description}, ${Math.round(temp)} °F${
    wind === null ? "" : `, wind ${Math.round(wind)} mph`
  }`
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The page a signer sees when a link no longer works, by API status. */
export function goneTitle(status: number | undefined): string {
  if (status === 410) return "This link no longer works"
  if (status === 404) return "This link is not valid"
  return "Couldn't open this link"
}
