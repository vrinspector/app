import { Link } from "@tanstack/react-router"

import { cn } from "@/lib/utils"

interface LogoProps {
  variant?: "full" | "icon" | "responsive"
  /**
   * Surface the logo sits on: "dark" = always-green surfaces such as the
   * sidebar (default); "light" = page background (follows light/dark theme).
   */
  tone?: "dark" | "light"
  className?: string
  asLink?: boolean
}

/**
 * Compass / crosshair mark in the brand colours.
 *
 * Stand-in drawn in code until the official Logo C artwork
 * (VRInspector_Logo_C_ForestGreenGold) is added to the repo; swapping it in
 * only requires changing this component.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="VR Inspector"
      className={cn("size-6 shrink-0", className)}
    >
      <circle cx="32" cy="32" r="30" className="fill-vri-green" />
      <circle
        cx="32"
        cy="32"
        r="22"
        fill="none"
        strokeWidth="3"
        className="stroke-vri-gold"
      />
      <path
        d="M32 12 L36.5 27.5 L52 32 L36.5 36.5 L32 52 L27.5 36.5 L12 32 L27.5 27.5 Z"
        className="fill-vri-offwhite"
      />
      <circle cx="32" cy="32" r="3.5" className="fill-vri-gold" />
    </svg>
  )
}

function Wordmark({
  tone,
  className,
}: {
  tone: "dark" | "light"
  className?: string
}) {
  return (
    <span
      className={cn(
        "font-heading font-bold tracking-wide whitespace-nowrap",
        tone === "dark"
          ? "text-vri-offwhite"
          : "text-vri-green dark:text-vri-offwhite",
        className,
      )}
    >
      VR<span className="text-vri-gold"> Inspector</span>
    </span>
  )
}

export function Logo({
  variant = "full",
  tone = "dark",
  className,
  asLink = true,
}: LogoProps) {
  const content =
    variant === "icon" ? (
      <LogoMark className={className} />
    ) : (
      <span className={cn("inline-flex items-center gap-2 text-lg", className)}>
        <LogoMark className="size-[1.4em]" />
        <Wordmark
          tone={tone}
          className={
            variant === "responsive"
              ? "group-data-[collapsible=icon]:hidden"
              : undefined
          }
        />
      </span>
    )

  if (!asLink) {
    return content
  }

  return (
    <Link to="/" aria-label="VR Inspector home">
      {content}
    </Link>
  )
}
