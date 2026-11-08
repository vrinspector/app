import {
  CircleHelp,
  FolderKanban,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react"

/**
 * Primary navigation — one list feeds the sidebar, the header title and the
 * home-screen shortcuts, so adding a section is a one-line change.
 *
 * The legacy SPA's information architecture is kept: the dashboard is the
 * landing screen, everything operational hangs off a project
 * (project → inspections → findings/photos/drawings → report, members as a
 * per-project panel), and Help is reachable from anywhere. Sections that
 * are per-project (inspections, drawings, reports, members) therefore do
 * not get top-level entries; they arrive as nested routes in increments
 * 07–10.
 */
export interface NavItem {
  title: string
  path: string
  icon: LucideIcon
  /** Short line for the home-screen shortcut card. */
  blurb: string
  /** `true` when only an exact pathname match counts as active. */
  exact?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  {
    title: "Dashboard",
    path: "/",
    icon: LayoutDashboard,
    blurb: "Project health and recent inspections at a glance.",
    exact: true,
  },
  {
    title: "Projects",
    path: "/projects",
    icon: FolderKanban,
    blurb: "Every project you are a member of, with its inspections.",
  },
  {
    title: "Help",
    path: "/help",
    icon: CircleHelp,
    blurb: "The user guide: device split, workflows, troubleshooting.",
  },
]

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.path
  return pathname === item.path || pathname.startsWith(`${item.path}/`)
}

/** The section a pathname belongs to, for the header title. */
export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isNavItemActive(item, pathname))
}
