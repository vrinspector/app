import { Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface FilterInputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** Accessible name; defaults to the placeholder. */
  label?: string
  className?: string
}

/**
 * The legacy SPA's "Filter projects..." / "Filter inspections..." box: a
 * client-side contains-filter over the loaded cards. Clears with one tap.
 */
export function FilterInput({
  value,
  onChange,
  placeholder,
  label,
  className,
}: FilterInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        inputMode="search"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        data-testid="filter-input"
        className="pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground"
          onClick={() => onChange("")}
          aria-label="Clear filter"
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  )
}
