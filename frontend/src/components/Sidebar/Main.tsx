import { Link as RouterLink, useRouterState } from "@tanstack/react-router"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { isNavItemActive, type NavItem } from "@/lib/navigation"

interface MainProps {
  items: NavItem[]
}

export function Main({ items }: MainProps) {
  const { isMobile, setOpenMobile } = useSidebar()
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })

  const handleMenuClick = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu data-testid="main-nav">
          {items.map((item) => {
            const isActive = isNavItemActive(item, currentPath)

            return (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={isActive}
                  asChild
                >
                  <RouterLink
                    to={item.path}
                    onClick={handleMenuClick}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
