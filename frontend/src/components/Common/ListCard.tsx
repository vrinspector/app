import { Link, type LinkProps } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

interface ListCardProps {
  title: string
  /** One line under the title: "client — location", "inspector — date". */
  meta?: string
  /** Badges and other small details on the bottom row. */
  badges?: ReactNode
  to: LinkProps["to"]
  params?: LinkProps["params"]
  className?: string
  "data-testid"?: string
}

/**
 * The legacy SPA's tappable `.card` (title, meta line, badge row, "›"), as
 * a router link. The whole card is the hit target — important on a phone
 * with gloves on — and the title is the accessible name.
 */
export function ListCard({
  title,
  meta,
  badges,
  to,
  params,
  className,
  "data-testid": testId = "list-card",
}: ListCardProps) {
  return (
    <li className="list-none">
      <Link
        to={to}
        params={params}
        data-testid={testId}
        className={cn(
          "group flex items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-vri-gold focus-visible:outline-2 focus-visible:outline-ring",
          className,
        )}
      >
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{title}</h3>
          {meta ? (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {meta}
            </p>
          ) : null}
          {badges ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {badges}
            </div>
          ) : null}
        </div>
        <ChevronRight
          className="size-5 shrink-0 text-vri-gold transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
    </li>
  )
}
