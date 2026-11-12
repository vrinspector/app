import { Eraser } from "lucide-react"
import { useEffect, useRef } from "react"
import SignaturePadLib from "signature_pad"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/*
 * Increment 14: a drawn signature (signature_pad, MIT). Finger, stylus or
 * mouse. The canvas follows its container's width and the device's pixel
 * ratio (capped at 2 so the PNG stays small); resizing clears it, as the
 * library recommends. `onChange` receives a PNG data URL after each stroke,
 * or null once cleared.
 */
export function SignaturePad({
  onChange,
  className,
  label = "Draw your signature",
}: {
  onChange: (dataUrl: string | null) => void
  className?: string
  label?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<SignaturePadLib | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pad = new SignaturePadLib(canvas, {
      penColor: "#2b2b2b",
      backgroundColor: "rgba(0,0,0,0)",
      minWidth: 0.8,
      maxWidth: 2.6,
    })
    padRef.current = pad
    const emit = () =>
      onChangeRef.current(pad.isEmpty() ? null : pad.toDataURL("image/png"))
    pad.addEventListener("endStroke", emit)

    const resize = () => {
      const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2)
      const width = canvas.offsetWidth
      const height = canvas.offsetHeight
      if (!width || !height) return
      canvas.width = width * ratio
      canvas.height = height * ratio
      canvas.getContext("2d")?.scale(ratio, ratio)
      pad.clear()
      onChangeRef.current(null)
    }
    resize()
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize)
    observer?.observe(canvas)
    return () => {
      observer?.disconnect()
      pad.removeEventListener("endStroke", emit)
      pad.off()
      padRef.current = null
    }
  }, [])

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="relative">
        <canvas
          ref={canvasRef}
          aria-label={label}
          role="img"
          className="block h-40 w-full touch-none rounded-md border-2 border-dashed border-vri-copper/60 bg-white"
          data-testid="signature-canvas"
        />
        <span className="pointer-events-none absolute bottom-3 left-4 right-4 border-b border-vri-charcoal/30" />
        <span className="pointer-events-none absolute bottom-4 left-4 text-xs text-muted-foreground">
          ✕
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label} with your finger or a stylus.</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            padRef.current?.clear()
            onChange(null)
          }}
          data-testid="signature-clear"
        >
          <Eraser />
          Clear
        </Button>
      </div>
    </div>
  )
}
