import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  ChevronLeft,
  ChevronRight,
  History,
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
import { CaptureFindingDialog } from "@/components/Findings/CaptureFindingDialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useCustomToast from "@/hooks/useCustomToast"
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
  pinLabel,
  pinsOnPage,
  scrollForZoom,
  zoomStepIn,
  zoomStepOut,
} from "@/lib/drawings"
import { formatDate } from "@/lib/format"
import {
  applyPinFilters,
  carriedFromText,
  loadPinFilters,
  needsPositionCheck,
  type PinCluster,
  type PinFilters,
  pinFiltersActive,
  revisionLabel,
  savePinFilters,
  zoomToSeparate,
} from "@/lib/pinView"
import {
  drawingKeys,
  drawingRevisionsQuery,
  itpItemsQuery,
  pinsQuery,
  projectKeys,
} from "@/lib/queries"
import { cn } from "@/lib/utils"
import { PIN_STATUS_OPTIONS, pinStatusOption } from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"
import { PinDetailDialog } from "./PinDetailDialog"
import { type ItpChoice, PinFilterMenu } from "./PinFilterMenu"
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
 *
 * Increment 11a: placing a pin can carry straight on to the finding form
 * (`CaptureFindingDialog`), so one tap on the sheet ends in a saved finding
 * with its photo linked to the pin — the PRD's capture loop.
 *
 * Increment 14.5 (drawing pins, round two):
 *   revisions — an old revision opens read-only with a banner pointing at
 *               the current one; on the current one, pins carried from the
 *               previous revision are flagged until confirmed or moved, with
 *               a "Next pin to check" walk through them
 *   clusters  — overlapping markers collapse into a numbered cluster that
 *               zooms in on tap (or lists its pins when they share a spot)
 *   filters   — by status and by link (ITP line / finding / none / to
 *               check), remembered per device and project
 */

interface DrawingViewerProps {
  projectId: number
  drawing: DrawingPublic
  /** The presigned GET for the file (drawingViewUrlQuery). */
  viewUrl: string
  canWrite: boolean
  /** Re-mint the view URL and reload, after a load failure. */
  onRetry: () => void
  /** The inspection the viewer was opened from, pre-selected for new findings. */
  inspectionId?: number | null
  /**
   * Increment 13 ("Mark on drawing" on an ITP line): new pins mark this
   * line, and the viewer opens in pin mode with a banner naming it.
   */
  itpItemId?: number | null
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
  inspectionId = null,
  itpItemId = null,
}: DrawingViewerProps) {
  const kind = drawingFileKind(drawing)
  const isPdf = kind === "pdf"
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  // Increment 14.5: an old revision is kept exactly as it was.
  const isOldRevision = Boolean(drawing.superseded_at)
  const canEdit = canWrite && !isOldRevision

  const stageRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [zoom, setZoom] = useState<number | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pinMode, setPinMode] = useState(itpItemId !== null && canEdit)
  const [placing, setPlacing] = useState<PointPercent | null>(null)
  const [selectedPin, setSelectedPin] = useState<PinPublic | null>(null)
  const [capturePin, setCapturePin] = useState<PinPublic | null>(null)
  const [renderedSize, setRenderedSize] = useState<PageSize | null>(null)
  const [naturalSize, setNaturalSize] = useState<PageSize | null>(null)
  const [imageError, setImageError] = useState<Error | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const pendingScrollRef = useRef<PendingScroll | null>(null)
  const dimensionsSentRef = useRef(false)
  const [filters, setFiltersState] = useState<PinFilters>(() =>
    loadPinFilters(projectId),
  )
  const setFilters = useCallback(
    (next: PinFilters) => {
      setFiltersState(next)
      savePinFilters(projectId, next)
    },
    [projectId],
  )
  // A pin being moved: the next tap on the sheet is its new position.
  const [movingPin, setMovingPin] = useState<PinPublic | null>(null)
  // Pins sharing one spot that zooming cannot separate.
  const [clusterList, setClusterList] = useState<PinPublic[] | null>(null)
  const revisions = useQuery({
    ...drawingRevisionsQuery(drawing.id),
    enabled: isOldRevision || (drawing.revision_count ?? 1) > 1,
  })
  const currentRevision = revisions.data?.find((r) => r.is_current)

  const pins = useQuery(pinsQuery(drawing.id))
  // Block 9.5: the project's ITP lines, so pins that mark one render as a
  // hold / witness point and the banner can name the line being marked.
  const itpItems = useQuery(itpItemsQuery(projectId))
  const itpItemsById = useMemo(
    () => new Map((itpItems.data ?? []).map((item) => [item.id, item])),
    [itpItems.data],
  )
  const markingItem =
    itpItemId !== null ? itpItemsById.get(itpItemId) : undefined

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
        setMovingPin(null)
        break
      default:
        return
    }
    event.preventDefault()
  }

  const pagePins = useMemo(
    () => pinsOnPage(pins.data, kind, pageNumber),
    [pins.data, kind, pageNumber],
  )
  // Marker numbers come from the whole page, so filtering never renumbers.
  const pinLabels = useMemo(
    () => new Map(pagePins.map((pin, index) => [pin.id, pinLabel(pin, index)])),
    [pagePins],
  )
  const visiblePins = useMemo(
    () => applyPinFilters(pagePins, filters, itpItemsById),
    [pagePins, filters, itpItemsById],
  )
  const filtering = pinFiltersActive(filters)
  const itpChoices = useMemo<ItpChoice[]>(() => {
    const seen = new Map<number, ItpChoice>()
    for (const pin of pins.data ?? []) {
      const item = pin.itp_item_id ? itpItemsById.get(pin.itp_item_id) : null
      if (item && !seen.has(item.project_itp_id)) {
        seen.set(item.project_itp_id, {
          id: item.project_itp_id,
          label: item.doc_number
            ? `${item.doc_number} · ${item.itp_title}`
            : item.itp_title,
        })
      }
    }
    return [...seen.values()]
  }, [pins.data, itpItemsById])
  const pinsToCheck = useMemo(
    () =>
      isOldRevision
        ? []
        : (pins.data ?? [])
            .filter(needsPositionCheck)
            .sort(
              (a, b) =>
                (a.page_number || 1) - (b.page_number || 1) || a.id - b.id,
            ),
    [pins.data, isOldRevision],
  )

  const showNextToCheck = () => {
    const next = pinsToCheck[0]
    if (!next) return
    if (isPdf) setPageNumber(next.page_number || 1)
    // Make sure the filters don't hide the pin we are about to open.
    if (filtering && !applyPinFilters([next], filters, itpItemsById).length) {
      setFilters({ hiddenStatuses: [], link: "check", itpId: null })
    }
    setSelectedPin(next)
  }

  const openCluster = useCallback(
    (cluster: PinCluster, at: DOMRect) => {
      const stage = stageRef.current
      if (!stage || !baseSize || zoom === null) return
      const next = zoomToSeparate(cluster, baseSize, zoom, MAX_ZOOM)
      if (next <= zoom + 1e-3) {
        setClusterList(cluster.pins)
        return
      }
      const stageRect = stage.getBoundingClientRect()
      changeZoom(next, {
        x: at.left + at.width / 2 - stageRect.left,
        y: at.top + at.height / 2 - stageRect.top,
      })
    },
    [baseSize, zoom, changeZoom],
  )

  const moveMutation = useMutation({
    mutationFn: async ({
      pin,
      point,
    }: {
      pin: PinPublic
      point: PointPercent
    }) =>
      (
        await DrawingsService.updatePin({
          path: { pin_id: pin.id },
          body: {
            x_pct: point.x_pct,
            y_pct: point.y_pct,
            page_number: isPdf ? pageNumber : 1,
          },
        })
      ).data as PinPublic,
    onSuccess: (saved) => {
      queryClient.setQueryData<PinPublic[]>(drawingKeys.pins(drawing.id), (c) =>
        c?.map((p) => (p.id === saved.id ? saved : p)),
      )
      queryClient.invalidateQueries({ queryKey: drawingKeys.pins(drawing.id) })
      queryClient.invalidateQueries({
        queryKey: drawingKeys.detail(drawing.id),
      })
      queryClient.invalidateQueries({
        queryKey: projectKeys.drawings(projectId),
      })
      showSuccessToast("Pin moved")
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
    onSettled: () => setMovingPin(null),
  })

  const handlePlace = (point: PointPercent) => {
    if (movingPin) {
      moveMutation.mutate({ pin: movingPin, point })
      return
    }
    setPlacing(point)
  }

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
      {isOldRevision ? (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted px-3 py-2 text-sm"
          role="status"
          data-testid="old-revision-banner"
        >
          <History className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            You're looking at{" "}
            <strong>{revisionLabel(drawing) ?? "an earlier revision"}</strong>
            {drawing.superseded_at
              ? `, replaced on ${formatDate(drawing.superseded_at)}`
              : ""}
            . It is kept as it was: its pins can't be changed.
          </span>
          {currentRevision ? (
            <Link
              to="/projects/$projectId/drawings/$drawingId"
              params={{
                projectId: String(projectId),
                drawingId: String(currentRevision.id),
              }}
              className="font-semibold text-vri-green underline-offset-2 hover:underline"
              data-testid="open-current-revision"
            >
              Open {revisionLabel(currentRevision) ?? "the current revision"}
            </Link>
          ) : null}
        </div>
      ) : null}
      {movingPin ? (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-vri-gold/20 px-3 py-2 text-sm"
          role="status"
          data-testid="move-pin-banner"
        >
          <span className="min-w-0 flex-1">
            Tap the drawing where pin{" "}
            <strong>
              {pinLabels.get(movingPin.id) ??
                movingPin.tag_number ??
                `#${movingPin.id}`}
            </strong>{" "}
            belongs{isPdf ? " (change page first if it moved pages)" : ""}.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => setMovingPin(null)}
            data-testid="move-pin-cancel"
          >
            Cancel
          </Button>
        </div>
      ) : pinsToCheck.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-status-attention-bg px-3 py-2 text-sm text-status-attention-fg"
          role="status"
          data-testid="pins-to-check-banner"
        >
          <span className="min-w-0 flex-1">
            <strong>
              {pinsToCheck.length} pin{pinsToCheck.length === 1 ? "" : "s"}
            </strong>{" "}
            carried from {carriedFromText(pinsToCheck[0])} — check{" "}
            {pinsToCheck.length === 1 ? "its position" : "their positions"}.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 border-current bg-transparent"
            onClick={showNextToCheck}
            data-testid="next-pin-to-check"
          >
            Next pin to check
          </Button>
        </div>
      ) : null}
      {itpItemId !== null ? (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-status-attention-bg px-3 py-2 text-sm text-status-attention-fg"
          role="status"
          data-testid="itp-marking-banner"
        >
          <span className="min-w-0 flex-1">
            {markingItem ? (
              <>
                Placing a pin for ITP line{" "}
                <strong>“{markingItem.requirement}”</strong> (
                {markingItem.itp_title})
              </>
            ) : (
              "Placing a pin for an ITP line"
            )}
          </span>
          {markingItem ? (
            <Link
              to="/projects/$projectId/itps/$itpId"
              params={{
                projectId: String(projectId),
                itpId: String(markingItem.project_itp_id),
              }}
              className="font-semibold underline-offset-2 hover:underline"
              data-testid="itp-marking-back"
            >
              Back to the ITP
            </Link>
          ) : null}
        </div>
      ) : null}
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
          <PinFilterMenu
            filters={filters}
            onChange={setFilters}
            itps={itpChoices}
            shown={visiblePins.length}
            total={pagePins.length}
          />
          {movingPin ? null : pinMode ? (
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
              {filtering
                ? `${visiblePins.length} of ${pagePins.length}`
                : visiblePins.length}{" "}
              pin
              {(filtering ? pagePins.length : visiblePins.length) === 1
                ? ""
                : "s"}
              {isPdf ? " on this page" : ""}
            </span>
          )}
          {canEdit && !movingPin ? (
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
                  itpItems={itpItemsById}
                  pinMode={(pinMode || movingPin !== null) && canEdit}
                  suppressClickRef={suppressClickRef}
                  onPlace={handlePlace}
                  onSelect={setSelectedPin}
                  selectedPinId={selectedPin?.id ?? movingPin?.id ?? null}
                  labels={pinLabels}
                  boxSize={baseSize}
                  onOpenCluster={openCluster}
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
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rotate-45 border-2 border-status-critical-fg bg-transparent"
            aria-hidden="true"
          />
          ITP hold point
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="flex size-3.5 items-center justify-center rounded-full bg-vri-gold text-[8px] font-bold text-vri-charcoal"
            aria-hidden="true"
          >
            ?
          </span>
          Position to check
        </li>
        {pins.isError ? (
          <li className="ml-auto text-destructive">
            Pins could not be loaded.
          </li>
        ) : null}
      </ul>

      <PinStatusDialog
        drawingId={drawing.id}
        itpItem={markingItem ?? null}
        point={placing}
        pageNumber={isPdf ? pageNumber : 1}
        isPdf={isPdf}
        onClose={() => setPlacing(null)}
        onPlaced={(pin, { logFinding }) => {
          if (pin.itp_item_id) {
            setPinMode(false)
            queryClient.invalidateQueries({
              queryKey: projectKeys.itpItems(projectId),
            })
            queryClient.invalidateQueries({ queryKey: ["itps"] })
            return
          }
          if (logFinding && canEdit) {
            setPinMode(false)
            setCapturePin(pin)
          }
        }}
      />
      <CaptureFindingDialog
        projectId={projectId}
        drawing={drawing}
        isPdf={isPdf}
        pin={capturePin}
        preferredInspectionId={inspectionId}
        onClose={() => setCapturePin(null)}
      />
      <PinDetailDialog
        projectId={projectId}
        drawingId={drawing.id}
        pin={selectedPin}
        isPdf={isPdf}
        canWrite={canEdit}
        onClose={() => setSelectedPin(null)}
        onMove={(pin) => {
          setSelectedPin(null)
          setPinMode(false)
          setMovingPin(pin)
        }}
      />
      <ClusterListDialog
        pins={clusterList}
        labels={pinLabels}
        onClose={() => setClusterList(null)}
        onPick={(pin) => {
          setClusterList(null)
          setSelectedPin(pin)
        }}
      />
    </div>
  )
}

/*
 * Increment 14.5: pins that sit on the very same spot never separate by
 * zooming, so at full zoom their cluster lists them to pick from.
 */
function ClusterListDialog({
  pins,
  labels,
  onClose,
  onPick,
}: {
  pins: PinPublic[] | null
  labels: Map<number, string>
  onClose: () => void
  onPick: (pin: PinPublic) => void
}) {
  return (
    <Dialog open={pins !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="pin-cluster-dialog">
        <DialogHeader>
          <DialogTitle>{pins?.length ?? 0} pins at this spot</DialogTitle>
          <DialogDescription>Pick the pin to open.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-1.5">
          {(pins ?? []).map((pin) => {
            const status = pinStatusOption(pin.status)
            return (
              <li key={pin.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:border-vri-gold"
                  onClick={() => onPick(pin)}
                  data-testid="pin-cluster-item"
                >
                  <span
                    className="flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                    style={{ background: status.color }}
                  >
                    {labels.get(pin.id) ?? pin.tag_number ?? pin.id}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {pin.label || status.label}
                  </span>
                  {needsPositionCheck(pin) ? (
                    <span className="text-xs text-status-attention-fg">
                      check position
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
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
