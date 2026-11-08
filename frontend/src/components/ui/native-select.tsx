import { ChevronDownIcon } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A native <select> styled like the Input. Used for the short, fixed
 * vocabularies on the forms (project status, inspection type): on phones and
 * iPads the OS picker is the better control for one-handed field use, it
 * needs no JavaScript to open, and it works with react-hook-form's `register`
 * directly.
 */
function NativeSelect({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          "border-input dark:bg-input/30 dark:hover:bg-input/50 h-9 w-full min-w-0 appearance-none rounded-md border bg-transparent py-1 pr-9 pl-3 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-50"
        aria-hidden="true"
      />
    </div>
  )
}

export { NativeSelect }
