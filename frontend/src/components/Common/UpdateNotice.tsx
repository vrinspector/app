import { RefreshCw } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { dismissUpdate, reloadForUpdate, usePwaState } from "@/lib/pwa/state"

/**
 * "Update available — reload" (rebuild increment 21).
 *
 * When a new version of the app has been published and downloaded in the
 * background, this plain notice sits under the header until the person
 * reloads. Nothing reloads on its own, so a form being filled in is never
 * lost. Changes saved on the device (offline findings, pins, photos) are
 * kept across the reload.
 */
export function UpdateNotice() {
  const { updateAvailable } = usePwaState()
  const [reloading, setReloading] = useState(false)

  if (!updateAvailable) return null

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-b border-vri-gold/40 bg-vri-gold/10 px-3 py-2 text-sm sm:px-4"
      data-testid="update-notice"
    >
      <RefreshCw className="size-4 shrink-0 text-vri-copper" aria-hidden />
      <span className="min-w-0 flex-1">
        <strong>Update available.</strong> A new version of VR Inspector is
        ready. Reload when you are done with what you are typing; anything saved
        on this device stays.
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={dismissUpdate}
          data-testid="update-later"
        >
          Later
        </Button>
        <Button
          size="sm"
          disabled={reloading}
          onClick={() => {
            setReloading(true)
            void reloadForUpdate()
          }}
          data-testid="update-reload"
        >
          {reloading ? "Reloading…" : "Reload"}
        </Button>
      </div>
    </div>
  )
}
