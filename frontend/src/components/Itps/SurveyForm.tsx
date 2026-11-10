import "survey-core/survey-core.css"

import { useMemo } from "react"
import { Model, Serializer } from "survey-core"
import { Survey } from "survey-react-ui"

import { CLASSIFICATIONS, type Classification } from "@/lib/itp"

/*
 * SurveyJS (MIT form library) rendering an ITP template body — loaded on
 * demand (`SurveyPreview`) so the survey engine is its own chunk and only
 * screens that show a form pay for it.
 *
 * VR Inspector's two template properties are registered with the serializer
 * so SurveyJS keeps them on load: `classification` and `signoffRoles` on a
 * question (the survey-level role list is read by the API and the editor,
 * not by the form). The form is always shown read-only
 * here: the master is a preview, and on an ITP the recorded results come
 * from the line list (the API is the record), mapped onto the matching
 * choice so the form reads as the filled-in paper ITP.
 */

let registered = false
function registerItpProperties() {
  if (registered) return
  registered = true
  Serializer.addProperty("question", {
    name: "classification",
    choices: Object.keys(CLASSIFICATIONS),
  })
  Serializer.addProperty("question", { name: "signoffRoles:string[]" })
}

type Json = Record<string, unknown>

/** Append "· Hold point" etc. to every classified question's title. */
function withClassificationTitles(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withClassificationTitles)
  if (node === null || typeof node !== "object") return node
  const copy: Json = {}
  for (const [key, value] of Object.entries(node as Json)) {
    copy[key] = withClassificationTitles(value)
  }
  const info = CLASSIFICATIONS[copy.classification as Classification]
  if (info) {
    const title =
      typeof copy.title === "string" ? copy.title : String(copy.name ?? "")
    const roles = Array.isArray(copy.signoffRoles)
      ? ` (${(copy.signoffRoles as string[]).join(", ")})`
      : ""
    copy.title = `${title} · ${info.label}${roles}`
  }
  return copy
}

/** "pass" → the choice whose text is "Pass"/"pass", "na" → "N/A". */
function choiceFor(choices: unknown, status: string): unknown {
  if (!Array.isArray(choices)) return undefined
  const norm = (v: unknown) =>
    String(v ?? "")
      .toLowerCase()
      .replace(/[^a-z]/g, "")
  for (const choice of choices) {
    const value =
      choice && typeof choice === "object"
        ? (choice as Json).value
        : (choice as unknown)
    if (norm(value) === norm(status)) return value
  }
  return undefined
}

export interface SurveyFormProps {
  body: Json
  /** element_name → item status, for an ITP's recorded results. */
  results?: Record<string, string>
}

export default function SurveyForm({ body, results }: SurveyFormProps) {
  registerItpProperties()
  const model = useMemo(() => {
    const survey = new Model(withClassificationTitles(body))
    survey.mode = "display"
    survey.questionsOnPageMode = "singlePage"
    survey.showNavigationButtons = false
    survey.showCompletedPage = false
    if (results) {
      const data: Json = {}
      for (const question of survey.getAllQuestions()) {
        const status = results[question.name]
        if (!status || status === "pending") continue
        const json = question.toJSON() as Json
        const value = choiceFor(json.choices, status)
        if (value !== undefined) data[question.name] = value
        else if (question.getType() === "boolean") {
          if (status === "pass") data[question.name] = true
          if (status === "fail") data[question.name] = false
        }
      }
      survey.data = data
    }
    return survey
  }, [body, results])

  return (
    <div
      className="itp-survey overflow-hidden rounded-lg border"
      data-testid="survey-form"
    >
      <Survey model={model} />
    </div>
  )
}
