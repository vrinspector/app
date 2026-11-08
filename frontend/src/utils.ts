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

/** HTTP status of an API error, if it is one. */
export function errorStatus(err: unknown): number | undefined {
  return err instanceof AxiosError ? err.response?.status : undefined
}

/**
 * The legacy routers hide objects the caller may not see behind 404, so
 * "not found" and "not yours" render the same way on the screens.
 */
export function isNotFoundError(err: unknown): boolean {
  return errorStatus(err) === 404
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
