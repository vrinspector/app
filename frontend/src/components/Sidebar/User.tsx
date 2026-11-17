import { Link as RouterLink } from "@tanstack/react-router"
import { ChevronsUpDown, LogOut, Settings } from "lucide-react"
import { useState } from "react"

import { ConfirmDialog } from "@/components/Common/ConfirmDialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import useAuth, { type SessionUser } from "@/hooks/useAuth"
import { usePhotoQueue } from "@/lib/photoQueue"
import { useSync } from "@/lib/sync/context"
import { waitingWords } from "@/lib/sync/status"
import { getInitials } from "@/utils"

function UserInfo({ user }: { user: SessionUser }) {
  const primary = user.name || user.email || "Inspector"
  const secondary = user.name ? user.email : undefined
  return (
    <div className="flex items-center gap-2.5 w-full min-w-0">
      <Avatar className="size-8">
        {user.picture ? <AvatarImage src={user.picture} alt="" /> : null}
        <AvatarFallback className="bg-vri-gold text-vri-charcoal font-semibold">
          {getInitials(primary)}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col items-start min-w-0">
        <p className="text-sm font-medium truncate w-full">{primary}</p>
        {secondary ? (
          <p className="text-xs opacity-70 truncate w-full">{secondary}</p>
        ) : null}
      </div>
    </div>
  )
}

export function User({ user }: { user: SessionUser | null }) {
  const { logout } = useAuth()
  const { isMobile, setOpenMobile } = useSidebar()
  const { snapshot } = useSync()
  const photos = usePhotoQueue()
  const [confirming, setConfirming] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  if (!user) return null

  const handleMenuClick = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }
  const signOut = async () => {
    setSigningOut(true)
    try {
      await logout()
    } finally {
      setSigningOut(false)
    }
  }
  // Increment 19: signing out removes this device's offline copy, including
  // changes not uploaded yet, so say so first. Increment 20: the same for
  // photos kept on the device (waiting, or refused and kept for a Retry).
  const photoCount = photos.items.length
  const handleLogout = async () => {
    if (snapshot.pending > 0 || photoCount > 0) {
      setConfirming(true)
      return
    }
    await signOut()
  }
  const waiting = snapshot.pending
  const items = waiting + photoCount

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              data-testid="user-menu"
            >
              <UserInfo user={user} />
              <ChevronsUpDown className="ml-auto size-4 opacity-70" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <UserInfo user={user} />
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <RouterLink to="/settings" onClick={handleMenuClick}>
              <DropdownMenuItem>
                <Settings />
                User Settings
              </DropdownMenuItem>
            </RouterLink>
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut />
              Log Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ConfirmDialog
          open={confirming}
          onOpenChange={(open) => {
            if (!signingOut) setConfirming(open)
          }}
          title={
            photoCount > 0 && waiting === 0
              ? "Photos not uploaded yet"
              : "Changes not uploaded yet"
          }
          description={
            <>
              <span data-testid="signout-waiting">
                {waitingWords(waiting, photoCount)}
              </span>{" "}
              {items === 1 ? "is" : "are"} saved only on this device. Signing
              out deletes {items === 1 ? "it" : "them"}. Connect and wait for
              the header to say <strong>Synced</strong> to keep{" "}
              {items === 1 ? "it" : "them"}.
            </>
          }
          confirmLabel="Sign out anyway"
          variant="destructive"
          pending={signingOut}
          onConfirm={() => void signOut()}
        />
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
