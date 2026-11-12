import { useQuery } from "@tanstack/react-query"
import { Sparkles } from "lucide-react"

import { AiService, type AiSuggestionLog } from "@/client"
import { aiKeys } from "@/lib/ai"
import { formatDateTime } from "@/lib/format"

/*
 * The defensibility line under an AI-assisted finding (PRD v2.62 Block 10
 * guardrail: prompts and model versions are logged per finding). Shown when
 * the finding card is expanded: which model drafted it, with which prompt
 * version, who asked, who confirmed and whether they edited the draft — and,
 * for a dictated finding, the words as transcribed.
 */

export function AiProvenance({ findingId }: { findingId: number }) {
  const log = useQuery({
    queryKey: aiKeys.findingLog(findingId),
    queryFn: async () =>
      (
        await AiService.listSuggestions({
          query: { finding_id: findingId },
        })
      ).data as AiSuggestionLog[],
    staleTime: 5 * 60_000,
  })
  const row = log.data?.[0]
  if (!row) return null
  return (
    <div
      className="rounded-md border border-vri-gold/40 bg-vri-gold/5 p-2 text-xs text-muted-foreground"
      data-testid="finding-ai-provenance"
    >
      <p className="flex items-center gap-1 font-medium text-foreground">
        <Sparkles className="size-3.5 text-vri-copper" aria-hidden="true" />
        Drafted with AI from{" "}
        {row.kind === "photo" ? "a photo" : "a dictated note"}
        {row.edited ? ", edited before saving" : ", saved as drafted"}
      </p>
      <p className="mt-0.5">
        Model {row.model} · prompt {row.prompt_version} · asked by{" "}
        {row.requested_by} {formatDateTime(row.created_at)}
        {row.decided_by ? ` · confirmed by ${row.decided_by}` : ""}
      </p>
      {row.input_text ? (
        <p className="mt-1 italic">“{row.input_text}”</p>
      ) : null}
    </div>
  )
}
