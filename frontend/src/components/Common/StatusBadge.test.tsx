import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { StatusBadge, statusLabel, toneFor } from "./StatusBadge"

describe("StatusBadge vocabulary", () => {
  it("maps the API's stored values to the legacy badge tones", () => {
    // project
    expect(toneFor("active")).toBe("positive")
    expect(toneFor("on_hold")).toBe("neutral")
    expect(toneFor("complete")).toBe("settled")
    // inspection
    expect(toneFor("open")).toBe("attention")
    expect(toneFor("closed")).toBe("settled")
    // finding status (stored with a hyphen) and priority
    expect(toneFor("in-progress")).toBe("attention")
    expect(toneFor("resolved")).toBe("positive")
    expect(toneFor("high")).toBe("critical")
    expect(toneFor("medium")).toBe("attention")
    expect(toneFor("low")).toBe("positive")
    // pins
    expect(toneFor("punch_item")).toBe("critical")
    expect(toneFor("verified")).toBe("positive")
  })

  it("falls back to neutral for unknown or missing values", () => {
    expect(toneFor("something_new")).toBe("neutral")
    expect(toneFor(null)).toBe("neutral")
    expect(toneFor(undefined)).toBe("neutral")
  })

  it("turns stored values into readable labels", () => {
    expect(statusLabel("on_hold")).toBe("On hold")
    expect(statusLabel("in-progress")).toBe("In progress")
    expect(statusLabel("HIGH")).toBe("High")
    expect(statusLabel(null)).toBe("Unknown")
  })
})

describe("<StatusBadge>", () => {
  it("renders the label and exposes the tone for styling", () => {
    render(<StatusBadge value="high" />)
    const badge = screen.getByText("High")
    expect(badge).toHaveAttribute("data-tone", "critical")
    expect(badge.className).toContain("bg-status-critical-bg")
  })

  it("accepts overrides for label and tone", () => {
    render(<StatusBadge value="open" label="3 open" tone="critical" />)
    expect(screen.getByText("3 open")).toHaveAttribute("data-tone", "critical")
  })
})
