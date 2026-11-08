import { useEffect, useRef, useState } from "react"

import { pdfRenderLimits, safeRenderDpr } from "@/lib/drawings"
import {
  isRenderingCancelled,
  openPdf,
  type PdfDocument,
  type PdfRenderTask,
} from "@/lib/pdfjs"

/*
 * The Block 8E PDF.js pipeline (legacy `openDrawingViewer` → `renderPdfPage`)
 * as a hook:
 *
 *   • open the document from the presigned URL once; destroy it on unmount
 *   • render one page at a time into the one canvas, at the requested zoom
 *     and a device pixel ratio capped by `safeRenderDpr` (the Samsung
 *     Chrome memory hotfix), releasing the previous backing store first
 *   • cancel a render still in flight when the page or zoom changes and
 *     ignore its RenderingCancelledException; a request id guards against a
 *     stale render landing after a newer one
 *   • report the page's unit size (points, zoom 1) so the viewer can fit the
 *     width and the dimension capture (Block 8E R6) can PATCH it
 */

export interface PageSize {
  width: number
  height: number
}

export interface RenderedPage {
  pageNumber: number
  /** CSS pixels of the rendered page at the requested zoom. */
  size: PageSize
  /** Points (zoom 1.0) — the PDF MediaBox size. */
  unitSize: PageSize
}

interface UsePdfRendererOptions {
  url: string | undefined
  enabled: boolean
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  pageNumber: number
  /** `null` until the viewer has decided the initial (fit-to-width) zoom. */
  zoom: number | null
  onRendered: (rendered: RenderedPage) => void
}

export function usePdfRenderer({
  url,
  enabled,
  canvasRef,
  pageNumber,
  zoom,
  onRendered,
}: UsePdfRendererOptions) {
  const [doc, setDoc] = useState<PdfDocument | null>(null)
  const [unitSize, setUnitSize] = useState<PageSize | null>(null)
  const [totalPages, setTotalPages] = useState(1)
  const [error, setError] = useState<Error | null>(null)
  const [rendering, setRendering] = useState(false)
  const requestIdRef = useRef(0)
  const taskRef = useRef<PdfRenderTask | null>(null)
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  // Open the document.
  useEffect(() => {
    if (!enabled || !url) return
    let cancelled = false
    let opened: PdfDocument | null = null
    setError(null)
    setDoc(null)
    setUnitSize(null)
    openPdf(url)
      .then(async (pdf) => {
        if (cancelled) {
          pdf.destroy()
          return
        }
        opened = pdf
        const first = await pdf.getPage(1)
        if (cancelled) return
        const unit = first.getViewport({ scale: 1 })
        setUnitSize({ width: unit.width, height: unit.height })
        setTotalPages(pdf.numPages || 1)
        setDoc(pdf)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(
          cause instanceof Error
            ? cause
            : new Error("The PDF could not be opened."),
        )
      })
    return () => {
      cancelled = true
      requestIdRef.current += 1
      try {
        taskRef.current?.cancel()
      } catch {
        // ignore
      }
      taskRef.current = null
      opened?.destroy()
    }
  }, [url, enabled])

  // Render the current page at the current zoom.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!doc || !canvas || zoom === null) return
    const requestId = ++requestIdRef.current
    let active = true
    setRendering(true)

    const run = async () => {
      if (taskRef.current) {
        try {
          taskRef.current.cancel()
          await taskRef.current.promise
        } catch {
          // a cancelled render rejects; that is expected
        }
        taskRef.current = null
      }
      const page = await doc.getPage(pageNumber)
      if (!active || requestId !== requestIdRef.current) return
      const unit = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: zoom })
      const dpr = safeRenderDpr(
        viewport.width,
        viewport.height,
        typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
        pdfRenderLimits(),
      )
      const width = Math.floor(viewport.width)
      const height = Math.floor(viewport.height)
      // Release the previous backing store before allocating the next one.
      canvas.width = 1
      canvas.height = 1
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr))
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr))
      const context = canvas.getContext("2d", { alpha: false })
      if (context) {
        const task = page.render({
          canvas,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        })
        taskRef.current = task
        try {
          await task.promise
        } catch (cause) {
          if (isRenderingCancelled(cause)) return
          throw cause
        } finally {
          if (taskRef.current === task) taskRef.current = null
        }
      }
      if (!active || requestId !== requestIdRef.current) return
      onRenderedRef.current({
        pageNumber,
        size: { width, height },
        unitSize: { width: unit.width, height: unit.height },
      })
    }

    run()
      .catch((cause: unknown) => {
        if (!active || requestId !== requestIdRef.current) return
        setError(
          cause instanceof Error
            ? cause
            : new Error("The page could not be drawn."),
        )
      })
      .finally(() => {
        if (active && requestId === requestIdRef.current) setRendering(false)
      })

    return () => {
      active = false
    }
  }, [doc, canvasRef, pageNumber, zoom])

  return { ready: doc !== null, unitSize, totalPages, error, rendering }
}
