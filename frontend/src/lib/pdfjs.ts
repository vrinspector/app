import type {
  PDFPageProxy,
  RenderParameters,
  RenderTask,
} from "pdfjs-dist/types/src/display/api"

/*
 * PDF.js, loaded on demand. The legacy SPA fetched pdf.js 3.11 from a CDN
 * at start-up (its literal-URL rule left no other option); the rebuild
 * bundles `pdfjs-dist` and imports it the first time a PDF drawing is
 * opened, so the projects, inspections and findings screens never pay for
 * the ~400 kB library and the worker is served from our own origin.
 *
 * The small surface the viewer uses is wrapped in our own types so the
 * components and the tests do not depend on pdfjs-dist's module layout.
 */

export interface PdfViewport {
  width: number
  height: number
}

export type PdfRenderTask = Pick<RenderTask, "promise" | "cancel">

export interface PdfPage {
  getViewport(params: { scale: number }): PdfViewport
  render(params: {
    canvas: HTMLCanvasElement | null
    canvasContext?: CanvasRenderingContext2D
    viewport: PdfViewport
    transform?: number[]
  }): PdfRenderTask
}

export interface PdfDocument {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPage>
  /** Release the worker and its memory; call when the viewer closes. */
  destroy(): void
}

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | undefined

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString()
      return pdfjs
    })
  }
  return pdfjsPromise
}

function wrapPage(page: PDFPageProxy): PdfPage {
  return {
    getViewport: ({ scale }) => page.getViewport({ scale }),
    render: (params) =>
      page.render({
        canvas: params.canvas,
        canvasContext: params.canvasContext,
        viewport: params.viewport as RenderParameters["viewport"],
        transform: params.transform,
      }),
  }
}

/**
 * Open the PDF at `url` (the presigned S3 GET). The returned document must be
 * `destroy()`ed when the viewer closes to release the worker's memory.
 */
export async function openPdf(url: string): Promise<PdfDocument> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ url })
  const doc = await task.promise
  return {
    numPages: doc.numPages,
    getPage: async (pageNumber) => wrapPage(await doc.getPage(pageNumber)),
    destroy: () => {
      void task.destroy()
    },
  }
}

/** Legacy `renderPdfPage` ignored PDF.js's cancellation error; same here. */
export function isRenderingCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "RenderingCancelledException"
  )
}
