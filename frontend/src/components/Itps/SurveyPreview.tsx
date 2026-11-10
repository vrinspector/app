import { lazy, Suspense } from "react"

import { LoadingState } from "@/components/Common/States"

import type { SurveyFormProps } from "./SurveyForm"

const SurveyForm = lazy(() => import("./SurveyForm"))

/** The SurveyJS render of a template body, loaded as its own chunk. */
export function SurveyPreview(props: SurveyFormProps) {
  return (
    <Suspense fallback={<LoadingState message="Opening the form…" />}>
      <SurveyForm {...props} />
    </Suspense>
  )
}
