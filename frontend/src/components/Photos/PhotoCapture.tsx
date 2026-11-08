import { Camera, Plus } from "lucide-react"
import { useCallback, useRef } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/*
 * Camera-first capture, two parts.
 *
 * `usePhotoPicker` renders the legacy SPA's hidden
 * `<input type="file" accept="image/*" capture="environment">` (which opens
 * the rear camera directly on phones) plus a second input without
 * `capture` for picking existing photos — several at once. Both report
 * their files through one callback and reset so the same shot can be
 * retaken.
 *
 * `CaptureBar` is the sticky bottom bar on phones: Take photo and Log
 * finding as large, gloved-thumb-sized targets that stay reachable while
 * scrolling the findings list. On wider screens the section buttons do the
 * job and the bar is not rendered.
 */

export function usePhotoPicker(onFiles: (files: FileList | null) => void) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onFiles(event.target.files)
      // Allow re-selecting the same file (the change event would not fire).
      event.target.value = ""
    },
    [onFiles],
  )

  const inputs = (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="camera-input"
        onChange={handleChange}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="library-input"
        onChange={handleChange}
      />
    </>
  )

  return {
    inputs,
    openCamera: () => cameraRef.current?.click(),
    openLibrary: () => libraryRef.current?.click(),
  }
}

interface CaptureBarProps {
  onTakePhoto: () => void
  onLogFinding: () => void
  /** Sign-off hides "Log finding"; the camera stays available. */
  canLogFinding: boolean
  className?: string
}

export function CaptureBar({
  onTakePhoto,
  onLogFinding,
  canLogFinding,
  className,
}: CaptureBarProps) {
  return (
    <div
      data-testid="capture-bar"
      className={cn(
        "fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:hidden",
        className,
      )}
    >
      <Button
        size="lg"
        className="h-12 flex-1 text-base"
        onClick={onTakePhoto}
        data-testid="capture-bar-photo"
      >
        <Camera className="size-5" />
        Take photo
      </Button>
      {canLogFinding ? (
        <Button
          size="lg"
          variant="outline"
          className="h-12 flex-1 text-base"
          onClick={onLogFinding}
          data-testid="capture-bar-finding"
        >
          <Plus className="size-5" />
          Log finding
        </Button>
      ) : null}
    </div>
  )
}
