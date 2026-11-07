import { AxiosError } from "axios"

/**
 * A person-readable message for an API or runtime error: the FastAPI
 * `detail` when there is one, a plain sentence when the server could not be
 * reached, the error's own message otherwise.
 */
export function extractErrorMessage(err: Error): string {
  if (err instanceof AxiosError) {
    const errDetail = (err.response?.data as any)?.detail
    if (Array.isArray(errDetail) && errDetail.length > 0) {
      return errDetail[0].msg
    }
    if (typeof errDetail === "string") {
      return errDetail
    }
    if (!err.response) {
      return "Could not reach the VR Inspector server. Check your connection and try again."
    }
    return err.message
  }
  if (err.message) return err.message
  return "Something went wrong."
}

export const handleError = function (this: (msg: string) => void, err: Error) {
  const errorMessage = extractErrorMessage(err)
  this(errorMessage)
}

export const getInitials = (name: string): string => {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
}
