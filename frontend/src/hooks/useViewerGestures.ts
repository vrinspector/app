import { useEffect, useRef, useState } from "react"

import {
  clampZoom,
  distance,
  MAX_ZOOM,
  MIN_ZOOM,
  midpoint,
  scrollForZoom,
} from "@/lib/drawings"

/*
 * Touch and pointer handling for the drawing stage — the part the legacy
 * viewer did not have (it relied on the browser's own page zoom, which the
 * Help page flagged as a crash risk at 200 % on Samsung Chrome):
 *
 *   • pinch with two fingers → zoom about the pinch point. While the fingers
 *     move the drawing box is scaled live (`previewScale`, the canvas is
 *     stretched by CSS); when they lift the zoom is committed and the page
 *     re-rendered sharp at the new scale.
 *   • one finger / mouse drag → pan by scrolling the stage, in pin mode too,
 *     so a sheet can be positioned before tapping. A drag sets
 *     `suppressClickRef` so the release is not taken as a pin placement.
 *   • ctrl/⌘ + wheel (trackpad pinch on laptops) → zoom about the cursor.
 *
 * The stage has `touch-action: none`, so the browser never scrolls or zooms
 * the page underneath; every gesture over the drawing is handled here. The
 * ± buttons in the toolbar remain for devices without multi-touch.
 */

interface Pointer {
  x: number
  y: number
}

interface PinchState {
  startDistance: number
  startZoom: number
  focal: Pointer
  startScroll: { left: number; top: number }
  ratio: number
}

interface UseViewerGesturesOptions {
  stageRef: React.RefObject<HTMLElement | null>
  zoom: number
  onZoomChange: (zoom: number, focal?: Pointer) => void
  enabled: boolean
}

const DRAG_THRESHOLD_PX = 6

export function useViewerGestures({
  stageRef,
  zoom,
  onZoomChange,
  enabled,
}: UseViewerGesturesOptions) {
  const [previewScale, setPreviewScale] = useState(1)
  const suppressClickRef = useRef(false)
  const pointersRef = useRef(new Map<number, Pointer>())
  const pinchRef = useRef<PinchState | null>(null)
  const dragRef = useRef<{
    pointerId: number
    last: Pointer
    moved: number
    active: boolean
  } | null>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const onZoomChangeRef = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !enabled) return

    const stagePoint = (event: { clientX: number; clientY: number }) => {
      const rect = stage.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    const beginPinch = () => {
      const [a, b] = Array.from(pointersRef.current.values())
      pinchRef.current = {
        startDistance: Math.max(1, distance(a, b)),
        startZoom: zoomRef.current,
        focal: midpoint(a, b),
        startScroll: { left: stage.scrollLeft, top: stage.scrollTop },
        ratio: 1,
      }
      dragRef.current = null
      suppressClickRef.current = true
    }

    const endPinch = () => {
      const pinch = pinchRef.current
      if (!pinch) return
      pinchRef.current = null
      setPreviewScale(1)
      const next = clampZoom(pinch.startZoom * pinch.ratio)
      if (Math.abs(next - pinch.startZoom) > 1e-3) {
        onZoomChangeRef.current(next, pinch.focal)
      }
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return
      // Marker taps and dialog clicks are not stage gestures.
      if ((event.target as Element | null)?.closest("[data-pin-marker]")) return
      const point = stagePoint(event)
      pointersRef.current.set(event.pointerId, point)
      if (pointersRef.current.size === 2) {
        beginPinch()
      } else if (pointersRef.current.size === 1) {
        dragRef.current = {
          pointerId: event.pointerId,
          last: point,
          moved: 0,
          active: false,
        }
        suppressClickRef.current = false
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const point = stagePoint(event)
      if (!pointersRef.current.has(event.pointerId)) return
      pointersRef.current.set(event.pointerId, point)

      const pinch = pinchRef.current
      if (pinch && pointersRef.current.size >= 2) {
        const [a, b] = Array.from(pointersRef.current.values())
        const raw = distance(a, b) / pinch.startDistance
        const bounded = clampZoom(pinch.startZoom * raw) / pinch.startZoom || 1
        pinch.ratio = Math.min(
          MAX_ZOOM / pinch.startZoom,
          Math.max(MIN_ZOOM / pinch.startZoom, bounded),
        )
        setPreviewScale(pinch.ratio)
        const scroll = scrollForZoom(
          pinch.startScroll,
          pinch.focal,
          pinch.ratio,
        )
        stage.scrollLeft = scroll.left
        stage.scrollTop = scroll.top
        return
      }

      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const dx = point.x - drag.last.x
      const dy = point.y - drag.last.y
      drag.moved += Math.hypot(dx, dy)
      drag.last = point
      if (!drag.active && drag.moved > DRAG_THRESHOLD_PX) {
        drag.active = true
        suppressClickRef.current = true
        try {
          stage.setPointerCapture(event.pointerId)
        } catch {
          // Pointer capture is not available on every engine; panning still works.
        }
      }
      if (drag.active) {
        stage.scrollLeft -= dx
        stage.scrollTop -= dy
      }
    }

    const onPointerEnd = (event: PointerEvent) => {
      pointersRef.current.delete(event.pointerId)
      if (pinchRef.current && pointersRef.current.size < 2) {
        endPinch()
        pointersRef.current.clear()
      }
      if (dragRef.current?.pointerId === event.pointerId) {
        dragRef.current = null
        if (stage.hasPointerCapture?.(event.pointerId)) {
          try {
            stage.releasePointerCapture(event.pointerId)
          } catch {
            // ignore
          }
        }
      }
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.01)
      const next = clampZoom(zoomRef.current * factor)
      if (Math.abs(next - zoomRef.current) > 1e-3) {
        onZoomChangeRef.current(next, stagePoint(event))
      }
    }

    stage.addEventListener("pointerdown", onPointerDown)
    stage.addEventListener("pointermove", onPointerMove)
    stage.addEventListener("pointerup", onPointerEnd)
    stage.addEventListener("pointercancel", onPointerEnd)
    stage.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      stage.removeEventListener("pointerdown", onPointerDown)
      stage.removeEventListener("pointermove", onPointerMove)
      stage.removeEventListener("pointerup", onPointerEnd)
      stage.removeEventListener("pointercancel", onPointerEnd)
      stage.removeEventListener("wheel", onWheel)
      pointersRef.current.clear()
      pinchRef.current = null
      dragRef.current = null
    }
  }, [stageRef, enabled])

  return { previewScale, suppressClickRef }
}
