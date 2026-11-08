import { Loader2 } from "lucide-react"

import { LogoMark } from "@/components/Common/Logo"
import { cn } from "@/lib/utils"

export function FullPageLoader({
  message = "Checking your session…",
  className,
}: {
  message?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-h-svh flex-col items-center justify-center gap-4 bg-background",
        className,
      )}
      data-testid="full-page-loader"
      role="status"
      aria-live="polite"
    >
      <LogoMark className="size-12" />
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        <span className="text-sm">{message}</span>
      </div>
    </div>
  )
}
