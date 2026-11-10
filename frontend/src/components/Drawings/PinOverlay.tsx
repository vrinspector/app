import type { ItpItemRef, PinPublic } from "@/client"
import { type PointPercent, pinLabel, pointToPercent } from "@/lib/drawings"
import { cn } from "@/lib/utils"
import { pinStatusOption } from "@/lib/vocab"

/*
 * The pin layer over the rendered drawing (legacy `#pin-markers` +
 * `renderPins`). It is sized by its parent to exactly the drawing's rendered
 * box, so markers placed at `left: x%; top: y%` sit on the same spot at every
 * zoom level and on every page; the marker itself keeps its 24 px size, as
 * the legacy did, so it stays tappable when the sheet is zoomed out.
 *
 * In pin mode the layer takes the clicks (legacy `handleDrawingClick`) and
 * reports the percentage point; otherwise it is transparent to pointer
 * events and only the markers are interactive.
 */

interface PinOverlayProps {
  pins: PinPublic[]
  /** Block 9.5: ITP lines by id, so a pin that marks one shows it. */
  itpItems?: Map<number, ItpItemRef>
  pinMode: boolean
  /** Set while a pan or pinch is in progress so the release is not a placement. */
  suppressClickRef: React.MutableRefObject<boolean>
  onPlace: (point: PointPercent) => void
  onSelect: (pin: PinPublic) => void
  selectedPinId?: number | null
}

export function PinOverlay({
  pins,
  itpItems,
  pinMode,
  suppressClickRef,
  onPlace,
  onSelect,
  selectedPinId,
}: PinOverlayProps) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users place pins through the markers and the status dialog; the layer is a pointer target only.
    // biome-ignore lint/a11y/noStaticElementInteractions: see above.
    <div
      data-testid="pin-overlay"
      data-pin-mode={pinMode ? "true" : "false"}
      className={cn(
        "absolute inset-0 select-none",
        pinMode ? "cursor-crosshair" : "pointer-events-none",
      )}
      onClick={(event) => {
        if (!pinMode) return
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          return
        }
        const point = pointToPercent(
          event.currentTarget.getBoundingClientRect(),
          event.clientX,
          event.clientY,
        )
        if (point) onPlace(point)
      }}
    >
      {pins.map((pin, index) => (
        <PinMarker
          key={pin.id}
          pin={pin}
          label={pinLabel(pin, index)}
          itpItem={pin.itp_item_id ? itpItems?.get(pin.itp_item_id) : undefined}
          selected={pin.id === selectedPinId}
          onSelect={() => onSelect(pin)}
        />
      ))}
    </div>
  )
}

interface PinMarkerProps {
  pin: PinPublic
  label: string
  itpItem?: ItpItemRef
  selected: boolean
  onSelect: () => void
}

/*
 * Increment 13 (PRD v2.63 §5, "pins render a distinct hold-point style when
 * linked"): a pin that marks an ITP line gets a square outline in the
 * classification's colour — brick while a hold point waits for sign-off,
 * green once released — and its accessible name says so.
 */
export function PinMarker({
  pin,
  label,
  itpItem,
  selected,
  onSelect,
}: PinMarkerProps) {
  const status = pinStatusOption(pin.status)
  const isHold = itpItem?.classification === "hold"
  const itpText = itpItem
    ? ` — ITP ${isHold ? "hold point" : itpItem.classification}${isHold ? (itpItem.released ? " (released)" : " (waiting for sign-off)") : ""}: ${itpItem.requirement}`
    : ""
  return (
    <button
      type="button"
      data-testid="pin-marker"
      data-pin-id={pin.id}
      data-pin-status={pin.status}
      data-pin-marker
      data-itp={
        itpItem ? (isHold ? "hold" : itpItem.classification) : undefined
      }
      data-itp-released={itpItem ? String(itpItem.released) : undefined}
      aria-label={`Pin ${label}: ${status.label}${pin.label ? ` — ${pin.label}` : ""}${itpText}`}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      className="pointer-events-auto absolute z-10 flex -translate-x-1/2 -translate-y-full flex-col items-center focus-visible:outline-none"
      style={{ left: `${pin.x_pct}%`, top: `${pin.y_pct}%` }}
    >
      <span
        className={cn(
          "flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white px-1 text-[10px] font-bold whitespace-nowrap text-white shadow-[0_2px_6px_rgba(0,0,0,.6)] transition-transform",
          itpItem && "rounded-sm outline-3 outline-offset-1",
          itpItem &&
            (isHold
              ? itpItem.released
                ? "outline-status-positive-fg"
                : "outline-status-critical-fg"
              : "outline-status-attention-fg"),
          selected && "scale-125 ring-2 ring-vri-gold",
        )}
        style={{ background: status.color }}
      >
        {label}
      </span>
      <span
        className="h-2 w-0.5 opacity-80"
        style={{ background: status.color }}
        aria-hidden="true"
      />
    </button>
  )
}
