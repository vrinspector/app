import { Filter } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  DEFAULT_PIN_FILTERS,
  PIN_LINK_OPTIONS,
  type PinFilters,
  type PinLinkFilter,
  pinFiltersActive,
} from "@/lib/pinView"
import { cn } from "@/lib/utils"
import { PIN_STATUS_OPTIONS } from "@/lib/vocab"

/*
 * Increment 14.5 — pin filters on the viewer toolbar: show / hide pins by
 * status, and by what they are linked to (an ITP line — any, or one ITP —
 * a finding, nothing, or "position to check" after a new revision). The
 * viewer remembers the choice per device and project (`savePinFilters`).
 * The menu stays open while ticking so several statuses can be switched in
 * one go.
 */

export interface ItpChoice {
  id: number
  label: string
}

interface PinFilterMenuProps {
  filters: PinFilters
  onChange: (filters: PinFilters) => void
  /** The project ITPs that have pins on this drawing. */
  itps: ItpChoice[]
  shown: number
  total: number
}

const keepOpen = (event: Event) => event.preventDefault()

export function PinFilterMenu({
  filters,
  onChange,
  itps,
  shown,
  total,
}: PinFilterMenuProps) {
  const active = pinFiltersActive(filters)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(
            "h-8 gap-1.5 px-2 text-vri-offwhite hover:bg-white/10 hover:text-white",
            active && "bg-vri-gold text-vri-charcoal hover:bg-vri-gold/90",
          )}
          aria-label={
            active
              ? `Pin filters on: showing ${shown} of ${total}`
              : "Filter pins"
          }
          data-testid="pin-filter"
          data-active={active ? "true" : "false"}
        >
          <Filter />
          <span className="hidden sm:inline">Filter</span>
          {active ? (
            <span className="tabular-nums" data-testid="pin-filter-count">
              {shown}/{total}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[70dvh] w-64 overflow-y-auto"
        data-testid="pin-filter-menu"
      >
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        {PIN_STATUS_OPTIONS.map((option) => {
          const visible = !filters.hiddenStatuses.includes(option.value)
          return (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={visible}
              onSelect={keepOpen}
              onCheckedChange={(checked) =>
                onChange({
                  ...filters,
                  hiddenStatuses: checked
                    ? filters.hiddenStatuses.filter((s) => s !== option.value)
                    : [...filters.hiddenStatuses, option.value],
                })
              }
              data-testid={`pin-filter-status-${option.value}`}
            >
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ background: option.color }}
                aria-hidden="true"
              />
              {option.label}
            </DropdownMenuCheckboxItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={filters.link}
          onValueChange={(value) =>
            onChange({
              ...filters,
              link: value as PinLinkFilter,
              itpId: value === "itp" ? filters.itpId : null,
            })
          }
        >
          {PIN_LINK_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              onSelect={keepOpen}
              data-testid={`pin-filter-link-${option.value}`}
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {filters.link === "itp" && itps.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Which ITP</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={filters.itpId === null ? "any" : String(filters.itpId)}
              onValueChange={(value) =>
                onChange({
                  ...filters,
                  itpId: value === "any" ? null : Number(value),
                })
              }
            >
              <DropdownMenuRadioItem value="any" onSelect={keepOpen}>
                Any ITP
              </DropdownMenuRadioItem>
              {itps.map((itp) => (
                <DropdownMenuRadioItem
                  key={itp.id}
                  value={String(itp.id)}
                  onSelect={keepOpen}
                  data-testid="pin-filter-itp"
                >
                  <span className="truncate">{itp.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
        {active ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onChange(DEFAULT_PIN_FILTERS)}
              data-testid="pin-filter-reset"
            >
              Show all pins
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
