import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { FileText, MapPin } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { drawingsQuery } from "@/lib/queries"
import { cn } from "@/lib/utils"

/*
 * "Pin on drawing" (increment 11a): from an inspection, pick one of the
 * project's drawings and open its viewer with `?inspection=N`, so a pin
 * placed there logs its finding straight into this inspection. Hidden when
 * the project has no drawings yet.
 */

interface DrawingPickerMenuProps {
  projectId: number
  inspectionId: number
  /** Icon-only, for the phone capture bar. */
  compact?: boolean
  className?: string
}

export function DrawingPickerMenu({
  projectId,
  inspectionId,
  compact = false,
  className,
}: DrawingPickerMenuProps) {
  const navigate = useNavigate()
  const drawings = useQuery(drawingsQuery(projectId))

  if (!drawings.data?.length) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={compact ? "lg" : "default"}
          className={cn(compact && "h-12 w-12 px-0", className)}
          aria-label={compact ? "Pin on drawing" : undefined}
          data-testid="pin-on-drawing"
        >
          <MapPin className={compact ? "size-5" : undefined} />
          {compact ? null : "Pin on drawing"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel>Open a drawing to place a pin</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {drawings.data.map((drawing) => (
          <DropdownMenuItem
            key={drawing.id}
            onSelect={() =>
              navigate({
                to: "/projects/$projectId/drawings/$drawingId",
                params: {
                  projectId: String(projectId),
                  drawingId: String(drawing.id),
                },
                search: { inspection: inspectionId },
              })
            }
            data-testid="pin-on-drawing-item"
          >
            <FileText />
            <span className="truncate">
              {drawing.title || drawing.filename}
              {drawing.drawing_number ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {drawing.drawing_number}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
