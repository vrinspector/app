import { Link, type LinkProps } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Small copper eyebrow above the title, e.g. the parent project's name. */
  eyebrow?: ReactNode
  /**
   * Where the back arrow goes. The legacy SPA walked
   * dashboard → projects → inspections → findings with a top-bar "←"; the
   * rebuild keeps that affordance for phone use alongside the sidebar.
   */
  backTo?: LinkProps["to"]
  backLabel?: string
  /** Right-aligned actions (buttons, menus). Wraps under the title on phones. */
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  eyebrow,
  backTo,
  backLabel = "Back",
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      data-testid="page-header"
      className={cn(
        "flex flex-col gap-3 border-b border-vri-gold/40 pb-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        {backTo ? (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="-ml-2 shrink-0 text-vri-gold hover:text-vri-gold"
            data-testid="back-link"
          >
            <Link to={backTo} aria-label={backLabel}>
              <ArrowLeft className="size-5" />
            </Link>
          </Button>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-wider text-vri-copper">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  )
}
