import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  Maximize,
  Minus,
  Plus,
  X,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { type DrawingPublic, DrawingsService, type PinPublic } from "@/client"
import { ErrorState } from "@/components/Common/States"
import { Button } from "@/components/ui/button"
import { type PageSize, usePdfRenderer } from "@/hooks/usePdfRenderer"
import { useViewerGestures } from "@/hooks/useViewerGestures"
import {
  clampZoom,
  drawingFileKind,
  fitWidthZoom,
  formatZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  type PointPercent,
  pinsOnPage,
  scrollForZoom,
  zoomStepIn,
  zoomStepOut,
} from "@/lib/drawings"
import { drawingKeys, pinsQuery, projectKeys } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { PIN_STATUS_OPTIONS } from "@/lib/vocab"
import { PinDetailDialog } from "./PinDetailDialog"
import { PinOverlay } from "./PinOverlay"
import { PinStatusDialog } from "./PinStatusDialog"

/*
 * The drawing viewer (legacy `#modal-drawing-viewer`, Block 8E), as a screen
 * of its own rather than a modal so the phone's back button and a shared
 * link both work:
 *
 *   toolbar  — PDFs: Prev · Page n of N · Next; everyone: − zoom% + · Fit;
 *              Add pin / Cancel (inspectors and owners)
 *   stage    — the rendered page (PDF.js canvas) or the image, inside a
 *              scrollable, pinch-zoomable box with the pin overlay sized to
 *              the drawing so pins stay put at every zoom level
 *   legend   — the five pin statuses in their fixed colours
 *
 * Pins are stored as percentages of the page and, for PDFs, with the page
 * number; the overlay shows the current page's pins only (`pinsOnPage`).
 * Raster drawings have one page, no page controls, and the same zoom, pan
 * and pin behaviour (the legacy image path had neither zoom nor panning).
 */

interface DrawingViewerProps {
  projectId: number
  drawing: DrawingPublic
  /** The presigned GET for the file (drawingViewUrlQuery). */
  viewUrl: string
  canWrite: boolean
  /** Re-mint the view URL and reload, after a load failure. */
  onRetry: () => void
}

interface PendingScroll {
  focal: { x: number; y: number }
  ratio: number
  start: { left: number; top: number }
}

export function DrawingViewer({
  projectId,
  drawing,
  viewUrl,
  canWrite,
  onRetry,
}: DrawingViewerProps) {
  const kind = drawingFileKind(drawing)
  const isPdf = kind === "pdf"
  const queryClient = useQueryClient()

  const stageRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [zoom, setZoom] = useState<number | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pinMode, setPinMode] = useState(false)
  const [placing, setPlacing] = useState<PointPercent | null>(null)
  const [selectedPin, setSelectedPin] = useState<PinPublic | null>(null)
  const [renderedSize, setRenderedSize] = useState<PageSize | null>(null)
  const [naturalSize, setNaturalSize] = useState<PageSize | null>(null)
  const [imageError, setImageError] = useState<Error | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const pendingScrollRef = useRef<PendingScroll | null>(null)
  const dimensionsSentRef = useRef(false)

  const pins = useQuery(pinsQuery(drawing.id))

  // Block 8E R6: record the page size in points the first time page 1 of a
  // PDF without stored dimensions is rendered (legacy `savePdfDimensions`).
  const dimensionsMutation = useMutation({
    mutationFn: (size: PageSize) =>
      DrawingsService.updateDrawingDimensions({
        path: { drawing_id: drawing.id },
        body: {
          page_width_pts: Math.round(size.width * 100) / 100,
          page_height_pts: Math.round(size.height * 100) / 100,
        },
      }),
    onSuccess: (response) => {
      const dims = response.data
      if (!dims) return
      const patch = (d: DrawingPublic) =>
        d.id === drawing.id
          ? {
              ...d,
              page_width_pts: dims.page_width_pts,
              page_height_pts: dims.page_height_pts,
            }
          : d
      queryClient.setQueryData<DrawingPublic>(
        drawingKeys.detail(drawing.id),
        (d) => (d ? patch(d) : d),
      )
      queryClient.setQueryData<DrawingPublic[]>(
        projectKeys.drawings(projectId),
        (list) => list?.map(patch),
      )
    },
  })

  const handleRendered = useCallback(
    (rendered: { pageNumber: number; size: PageSize; unitSize: PageSize }) => {
      setRenderedSize(rendered.size)
      if (
        rendered.pageNumber === 1 &&
        !dimensionsSentRef.current &&
        (!drawing.page_width_pts || !drawing.page_height_pts)
      ) {
        dimensionsSentRef.current = true
        dimensionsMutation.mutate(rendered.unitSize)
      }
    },
    [
      drawing.page_width_pts,
      drawing.page_height_pts,
      dimensionsMutation.mutate,
    ],
  )

  const pdf = usePdfRenderer({
    url: viewUrl,
    enabled: isPdf,
    canvasRef,
    pageNumber,
    zoom,
    onRendered: handleRendered,
  })

  // The page's size at zoom 1: PDF points, or the image's natural pixels.
  const unitSize = isPdf ? pdf.unitSize : naturalSize

  // Initial zoom: fit the page width to the stage (legacy opened at 100 %).
  useEffect(() => {
    if (zoom !== null || !unitSize) return
    const stageWidth = stageRef.current?.clientWidth ?? 0
    setZoom(fitWidthZoom(unitSize.width, stageWidth))
  }, [zoom, unitSize])

  // The drawing box at the committed zoom. Raster sizes are arithmetic; PDF
  // sizes come from the render (optimistically scaled on a zoom change so
  // the box does not snap back while the sharp render is in flight).
  const baseSize = useMemo<PageSize | null>(() => {
    if (!isPdf) {
      if (!naturalSize || zoom === null) return null
      return {
        width: Math.round(naturalSize.width * zoom),
        height: Math.round(naturalSize.height * zoom),
      }
    }
    return renderedSize
  }, [isPdf, naturalSize, zoom, renderedSize])

  const changeZoom = useCallback(
    (next: number, focal?: { x: number; y: number }) => {
      const stage = stageRef.current
      const target = clampZoom(next)
      setZoom((current) => {
        if (current === null) return target
        if (Math.abs(current - target) < 1e-3) return current
        const ratio = target / current
        if (stage) {
          pendingScrollRef.current = {
            focal: focal ?? {
              x: stage.clientWidth / 2,
              y: stage.clientHeight / 2,
            },
            ratio,
            start: { left: stage.scrollLeft, top: stage.scrollTop },
          }
        }
        if (isPdf) {
          setRenderedSize((size) =>
            size
              ? {
                  width: Math.round(size.width * ratio),
                  height: Math.round(size.height * ratio),
                }
              : size,
          )
        }
        return target
      })
    },
    [isPdf],
  )

  // Keep the point under the cursor / pinch still once the box has resized.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after every baseSize change on purpose
  useLayoutEffect(() => {
    const pending = pendingScrollRef.current
    const stage = stageRef.current
    if (!pending || !stage) return
    pendingScrollRef.current = null
    const scroll = scrollForZoom(pending.start, pending.focal, pending.ratio)
    stage.scrollLeft = scroll.left
    stage.scrollTop = scroll.top
  }, [baseSize])

  const { previewScale, suppressClickRef } = useViewerGestures({
    stageRef,
    zoom: zoom ?? 1,
    onZoomChange: (next, focal) => {
      // A pinch has already scrolled the stage live; only wheel zoom passes a focal point.
      if (focal) changeZoom(next, focal)
      else {
        // Commit without a scroll correction: the preview already moved the content.
        setZoom((current) => {
          if (current === null) return clampZoom(next)
          const target = clampZoom(next)
          const ratio = target / current
          if (isPdf) {
            setRenderedSize((size) =>
              size
                ? {
                    width: Math.round(size.width * ratio),
                    height: Math.round(size.height * ratio),
                  }
                : size,
            )
          }
          return target
        })
      }
    },
    enabled: baseSize !== null,
  })

  const fitWidth = useCallback(() => {
    if (!unitSize) return
    const stageWidth = stageRef.current?.clientWidth ?? 0
    changeZoom(fitWidthZoom(unitSize.width, stageWidth))
  }, [unitSize, changeZoom])

  const totalPages = isPdf ? pdf.totalPages : 1
  const goToPage = useCallback(
    (next: number) => {
      setPageNumber(Math.min(totalPages, Math.max(1, next)))
      setSelectedPin(null)
    },
    [totalPages],
  )

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    switch (event.key) {
      case "ArrowLeft":
      case "PageUp":
        if (isPdf) goToPage(pageNumber - 1)
        break
      case "ArrowRight":
      case "PageDown":
        if (isPdf) goToPage(pageNumber + 1)
        break
      case "+":
      case "=":
        changeZoom(zoomStepIn(zoom ?? 1))
        break
      case "-":
      case "_":
        changeZoom(zoomStepOut(zoom ?? 1))
        break
      case "0":
        fitWidth()
        break
      case "Escape":
        setPinMode(false)
        break
      default:
        return
    }
    event.preventDefault()
  }

  const visiblePins = useMemo(
    () => pinsOnPage(pins.data, kind, pageNumber),
    [pins.data, kind, pageNumber],
  )

  const loadError = isPdf ? pdf.error : imageError
  const loading = isPdf ? !pdf.ready && !pdf.error : !imageLoaded && !imageError
  const boxStyle = baseSize
    ? {
        width: Math.round(baseSize.width * previewScale),
        height: Math.round(baseSize.height * previewScale),
      }
    : undefined

  return (
    <div
      className="flex h-[calc(100dvh-5.5rem)] min-h-[22rem] flex-col overflow-hidden rounded-lg border bg-card md:h-[calc(100dvh-13rem)]"
      data-testid="drawing-viewer"
      data-kind={kind}
    >
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-vri-green px-2 py-1.5 text-vri-offwhite sm:px-3"
        data-testid="viewer-toolbar"
      >
        {isPdf ? (
          <div className="flex items-center gap-1" data-testid="page-controls">
            <ToolbarButton
              label="Previous page"
              disabled={pageNumber <= 1}
              onClick={() => goToPage(pageNumber - 1)}
              data-testid="prev-page"
            >
              <ChevronLeft />
            </ToolbarButton>
            <span
              className="min-w-[5.5rem] text-center text-xs font-semibold tabular-nums sm:text-sm"
              data-testid="page-indicator"
              aria-live="polite"
            >
              Page {pageNumber} of {totalPages}
            </span>
            <ToolbarButton
              label="Next page"
              disabled={pageNumber >= totalPages}
              onClick={() => goToPage(pageNumber + 1)}
              data-testid="next-page"
            >
              <ChevronRight />
            </ToolbarButton>
          </div>
        ) : null}

        <div className="flex items-center gap-1" data-testid="zoom-controls">
          <ToolbarButton
            label="Zoom out"
            disabled={zoom === null || zoom <= MIN_ZOOM}
            onClick={() => changeZoom(zoomStepOut(zoom ?? 1))}
            data-testid="zoom-out"
          >
            <Minus />
          </ToolbarButton>
          <span
            className="min-w-[3.25rem] text-center text-xs font-semibold tabular-nums sm:text-sm"
            data-testid="zoom-indicator"
          >
            {zoom === null ? "…" : formatZoom(zoom * previewScale)}
          </span>
          <ToolbarButton
            label="Zoom in"
            disabled={zoom === null || zoom >= MAX_ZOOM}
            onClick={() => changeZoom(zoomStepIn(zoom ?? 1))}
            data-testid="zoom-in"
          >
            <Plus />
          </ToolbarButton>
          <ToolbarButton
            label="Fit to width"
            disabled={!unitSize}
            onClick={fitWidth}
            data-testid="zoom-fit"
          >
            <Maximize />
          </ToolbarButton>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {pinMode ? (
            <span
              className="text-xs font-semibold text-vri-gold"
              role="status"
              data-testid="pin-mode-hint"
            >
              {isPdf
                ? `Tap page ${pageNumber} to place a pin`
                : "Tap the drawing to place a pin"}
            </span>
          ) : (
            <span
              className="text-xs text-vri-offwhite/70"
              data-testid="pin-count"
            >
              {visiblePins.length} pin{visiblePins.length === 1 ? "" : "s"}
              {isPdf ? " on this page" : ""}
            </span>
          )}
          {canWrite ? (
            <Button
              type="button"
              size="sm"
              variant={pinMode ? "default" : "secondary"}
              className={cn(
                "h-8",
                pinMode && "bg-vri-gold text-vri-charcoal hover:bg-vri-gold/90",
              )}
              onClick={() => setPinMode((on) => !on)}
              aria-pressed={pinMode}
              disabled={baseSize === null}
              data-testid="pin-mode"
            >
              {pinMode ? <X /> : <MapPin />}
              {pinMode ? "Cancel" : "Add pin"}
            </Button>
          ) : null}
        </div>
      </div>

      <section
        ref={stageRef}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the stage takes arrow / ± keys for page and zoom
        tabIndex={0}
        className={cn(
          "relative min-w-0 flex-1 contain-inline-size overflow-auto overscroll-contain bg-neutral-800 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vri-gold",
          "[touch-action:none]",
        )}
        aria-label={`${drawing.title || "Drawing"}${isPdf ? `, page ${pageNumber} of ${totalPages}` : ""}`}
        onKeyDown={onKeyDown}
        data-testid="viewer-stage"
      >
        {loadError ? (
          <div className="p-6">
            <ErrorState
              title="Couldn't open this drawing"
              error={loadError}
              onRetry={onRetry}
              className="bg-card"
            />
          </div>
        ) : (
          <div className="grid min-h-full w-max min-w-full place-items-start justify-items-center p-4">
            <div
              className={cn(
                "relative bg-white shadow-lg",
                baseSize === null && "invisible",
              )}
              style={boxStyle}
              data-testid="drawing-box"
            >
              {isPdf ? (
                <canvas
                  ref={canvasRef}
                  className="block h-full w-full"
                  data-testid="pdf-canvas"
                />
              ) : (
                <img
                  src={viewUrl}
                  alt=""
                  draggable={false}
                  className="block h-full w-full select-none"
                  data-testid="raster-image"
                  onLoad={(event) => {
                    const image = event.currentTarget
                    setNaturalSize({
                      width: image.naturalWidth || 1000,
                      height: image.naturalHeight || 1000,
                    })
                    setImageLoaded(true)
                  }}
                  onError={() =>
                    setImageError(
                      new Error(
                        "The image could not be loaded. Its link may have expired.",
                      ),
                    )
                  }
                />
              )}
              {baseSize ? (
                <PinOverlay
                  pins={visiblePins}
                  pinMode={pinMode && canWrite}
                  suppressClickRef={suppressClickRef}
                  onPlace={setPlacing}
                  onSelect={setSelectedPin}
                  selectedPinId={selectedPin?.id ?? null}
                />
              ) : null}
            </div>
          </div>
        )}
        {(loading || (isPdf && pdf.rendering && !renderedSize)) &&
        !loadError ? (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            role="status"
            aria-live="polite"
            data-testid="viewer-loading"
          >
            <span className="flex items-center gap-2 rounded-md bg-black/60 px-3 py-2 text-sm text-white">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {isPdf ? "Opening PDF…" : "Loading drawing…"}
            </span>
          </div>
        ) : null}
      </section>

      <ul
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5 text-xs text-muted-foreground"
        aria-label="Pin status colours"
        data-testid="pin-legend"
      >
        {PIN_STATUS_OPTIONS.map((option) => (
          <li key={option.value} className="flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ background: option.color }}
              aria-hidden="true"
            />
            {option.label}
          </li>
        ))}
        {pins.isError ? (
          <li className="ml-auto text-destructive">
            Pins could not be loaded.
          </li>
        ) : null}
      </ul>

      <PinStatusDialog
        drawingId={drawing.id}
        point={placing}
        pageNumber={isPdf ? pageNumber : 1}
        isPdf={isPdf}
        onClose={() => setPlacing(null)}
      />
      <PinDetailDialog
        projectId={projectId}
        drawingId={drawing.id}
        pin={selectedPin}
        isPdf={isPdf}
        canWrite={canWrite}
        onClose={() => setSelectedPin(null)}
      />
    </div>
  )
}

function ToolbarButton({
  label,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={label}
      title={label}
      className={cn(
        "size-8 text-vri-offwhite hover:bg-white/10 hover:text-white disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  )
}
