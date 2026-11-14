import { CloudUpload } from "lucide-react"
import { useMemo } from "react"

import type { ItpItemRef, PinPublic } from "@/client"
import { type PointPercent, pinLabel, pointToPercent } from "@/lib/drawings"
import {
  carriedFromText,
  clusterPins,
  clusterStatus,
  needsPositionCheck,
  type PinCluster,
} from "@/lib/pinView"
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
 *
 * Increment 14.5: with `boxSize` given, pins whose markers would overlap at
 * the current zoom collapse into one numbered cluster marker
 * (`clusterPins`); tapping it calls `onOpenCluster` with the marker's
 * screen position so the viewer can zoom in on it. A pin carried from an
 * earlier revision and not yet checked gets a dashed ring and a "?".
 *
 * Increment 19: a pin placed or moved on this device and not uploaded yet
 * gets a dashed border and a small upload badge, and says so to screen
 * readers.
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
  /** Marker labels by pin id (numbered over the whole page, not the filtered list). */
  labels?: Map<number, string>
  /** The rendered drawing box in px; turns clustering on. */
  boxSize?: { width: number; height: number } | null
  onOpenCluster?: (cluster: PinCluster, at: DOMRect) => void
  /** Increment 19: pins with a change saved on this device only. */
  unsyncedIds?: ReadonlySet<number>
}

export function PinOverlay({
  pins,
  itpItems,
  pinMode,
  suppressClickRef,
  onPlace,
  onSelect,
  selectedPinId,
  labels,
  boxSize,
  onOpenCluster,
  unsyncedIds,
}: PinOverlayProps) {
  const clusters = useMemo(
    () =>
      boxSize && onOpenCluster
        ? clusterPins(pins, boxSize)
        : pins.map((pin) => ({
            key: pin.id,
            pins: [pin],
            x_pct: Number(pin.x_pct),
            y_pct: Number(pin.y_pct),
          })),
    [pins, boxSize, onOpenCluster],
  )
  const order = useMemo(
    () => new Map(pins.map((pin, index) => [pin.id, index])),
    [pins],
  )
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
      {clusters.map((cluster) => {
        if (cluster.pins.length > 1) {
          return (
            <ClusterMarker
              key={`cluster-${cluster.key}`}
              cluster={cluster}
              containsSelected={cluster.pins.some(
                (p) => p.id === selectedPinId,
              )}
              onOpen={(rect) => onOpenCluster?.(cluster, rect)}
            />
          )
        }
        const pin = cluster.pins[0]
        return (
          <PinMarker
            key={pin.id}
            pin={pin}
            label={labels?.get(pin.id) ?? pinLabel(pin, order.get(pin.id) ?? 0)}
            itpItem={
              pin.itp_item_id ? itpItems?.get(pin.itp_item_id) : undefined
            }
            selected={pin.id === selectedPinId}
            unsynced={unsyncedIds?.has(pin.id) ?? false}
            onSelect={() => onSelect(pin)}
          />
        )
      })}
    </div>
  )
}

/*
 * Increment 14.5: several pins too close to tell apart at this zoom. The
 * marker is a round badge with the count, coloured by the most urgent status
 * inside it, centred on the pins' mean position.
 */
function ClusterMarker({
  cluster,
  containsSelected,
  onOpen,
}: {
  cluster: PinCluster
  containsSelected: boolean
  onOpen: (rect: DOMRect) => void
}) {
  const status = pinStatusOption(clusterStatus(cluster))
  const toCheck = cluster.pins.filter(needsPositionCheck).length
  return (
    <button
      type="button"
      data-testid="pin-cluster"
      data-count={cluster.pins.length}
      data-pin-marker
      aria-label={`${cluster.pins.length} pins close together${toCheck ? `, ${toCheck} to check` : ""} — zoom in to separate them`}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(event.currentTarget.getBoundingClientRect())
      }}
      className="pointer-events-auto absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center focus-visible:outline-none"
      style={{ left: `${cluster.x_pct}%`, top: `${cluster.y_pct}%` }}
    >
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-full border-[3px] border-white text-xs font-bold text-white",
        )}
        style={{
          background: status.color,
          // A soft halo in the same colour reads as "more than one"; gold
          // when the selected pin is inside.
          boxShadow: `0 0 0 4px ${containsSelected ? "var(--color-vri-gold)" : `${status.color}66`}, 0 2px 8px rgba(0,0,0,.6)`,
        }}
      >
        {cluster.pins.length}
      </span>
      {toCheck ? (
        <span
          className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-vri-gold text-[9px] font-bold text-vri-charcoal"
          aria-hidden="true"
        >
          ?
        </span>
      ) : null}
    </button>
  )
}

interface PinMarkerProps {
  pin: PinPublic
  label: string
  itpItem?: ItpItemRef
  selected: boolean
  /** Increment 19: saved on this device, not uploaded yet. */
  unsynced?: boolean
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
  unsynced = false,
  onSelect,
}: PinMarkerProps) {
  const status = pinStatusOption(pin.status)
  const check = needsPositionCheck(pin)
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
      data-position-check={check ? "true" : undefined}
      data-unsynced={unsynced ? "true" : undefined}
      aria-label={`Pin ${label}: ${status.label}${pin.label ? ` — ${pin.label}` : ""}${itpText}${check ? ` — carried from ${carriedFromText(pin)}, check position` : ""}${unsynced ? " — not uploaded yet" : ""}`}
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
          check &&
            !itpItem &&
            "outline-2 outline-offset-2 outline-dashed outline-vri-gold",
          unsynced && "border-dashed opacity-80",
          selected && "scale-125 ring-2 ring-vri-gold",
        )}
        style={{ background: status.color }}
      >
        {label}
      </span>
      {check ? (
        <span
          className="absolute -top-1.5 -right-2 flex size-4 items-center justify-center rounded-full border border-white bg-vri-gold text-[9px] font-bold text-vri-charcoal"
          aria-hidden="true"
          data-testid="pin-check-badge"
        >
          ?
        </span>
      ) : null}
      {unsynced ? (
        <span
          className="absolute -top-1.5 -left-2 flex size-4 items-center justify-center rounded-full border border-white bg-status-attention-bg text-status-attention-fg"
          aria-hidden="true"
          data-testid="pin-unsynced-badge"
        >
          <CloudUpload className="size-2.5" />
        </span>
      ) : null}
      <span
        className="h-2 w-0.5 opacity-80"
        style={{ background: status.color }}
        aria-hidden="true"
      />
    </button>
  )
}
