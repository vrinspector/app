import { describe, expect, it } from "vitest"

import { activeNavItem, isNavItemActive, NAV_ITEMS } from "./navigation"

const byTitle = (title: string) => {
  const item = NAV_ITEMS.find((i) => i.title === title)
  if (!item) throw new Error(`no nav item ${title}`)
  return item
}

describe("navigation", () => {
  it("keeps the legacy information architecture: dashboard, projects, help", () => {
    expect(NAV_ITEMS.map((i) => i.path)).toEqual(["/", "/projects", "/help"])
  })

  it("marks the dashboard active only on the exact home path", () => {
    const dashboard = byTitle("Dashboard")
    expect(isNavItemActive(dashboard, "/")).toBe(true)
    expect(isNavItemActive(dashboard, "/projects")).toBe(false)
  })

  it("keeps a section active on its nested screens", () => {
    const projects = byTitle("Projects")
    expect(isNavItemActive(projects, "/projects")).toBe(true)
    expect(isNavItemActive(projects, "/projects/12/inspections/3")).toBe(true)
    expect(isNavItemActive(projects, "/projectsx")).toBe(false)
  })

  it("resolves the header title from the pathname", () => {
    expect(activeNavItem("/help")?.title).toBe("Help")
    expect(activeNavItem("/projects/7")?.title).toBe("Projects")
    expect(activeNavItem("/settings")).toBeUndefined()
  })
})
