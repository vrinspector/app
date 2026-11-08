import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"

/*
 * Shared loading / empty / error patterns.
 *
 * Every screen from increment 07 on renders its data through these so the
 * app reads as one product: the legacy SPA's `.loading` / `.empty` blocks
 * (copper italic text, centred icon) become LoadingState / EmptyState, and
 * its "Error: …" fallback becomes ErrorState with a retry. Pick by shape:
 *
 *   LoadingState   short wait, no layout known yet (route pending, first fetch)
 *   ListSkeleton   list/table about to appear — keeps the page from jumping
 *   EmptyState     the request succeeded and there is nothing to show
 *   ErrorState     the request failed; offers "Try again" when given onRetry
 *   QueryState     wires a TanStack Query result to the three above
 */

interface LoadingStateProps {
  message?: string
  className?: string
}

export function LoadingState({
  message = "Loading…",
  className,
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="loading-state"
      className={cn(
        "flex items-center justify-center gap-2 py-12 text-vri-copper italic",
        className,
      )}
    >
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      <span className="text-sm">{message}</span>
    </div>
  )
}

interface ListSkeletonProps {
  /** Rows to draw. Three is enough to read as "a list is coming". */
  rows?: number
  className?: string
}

export function ListSkeleton({ rows = 3, className }: ListSkeletonProps) {
  return (
    <output
      aria-busy="true"
      aria-label="Loading"
      data-testid="list-skeleton"
      className={cn("flex flex-col gap-3", className)}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-lg border bg-card p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-3 w-2/3" />
        </div>
      ))}
    </output>
  )
}

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: ReactNode
  /** Primary call to action, e.g. a "New project" button. */
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div
          className="mb-1 text-vri-copper [&>svg]:size-10"
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? (
        <div className="max-w-md text-sm text-muted-foreground">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

interface ErrorStateProps {
  title?: string
  /** An Error (API detail is extracted) or a ready-made message. */
  error?: unknown
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return extractErrorMessage(error)
  if (typeof error === "string" && error.trim()) return error
  return "Something went wrong."
}

export function ErrorState({
  title = "Something went wrong",
  error,
  onRetry,
  retryLabel = "Try again",
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      data-testid="error-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-card px-4 py-10 text-center",
        className,
      )}
    >
      <AlertTriangle className="size-8 text-destructive" aria-hidden="true" />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {errorMessage(error)}
      </p>
      {onRetry ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={onRetry}
          data-testid="retry-button"
        >
          <RefreshCw />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * The subset of a TanStack Query result the pattern needs. Typed structurally
 * so screens can pass `useQuery(...)` straight in.
 */
export interface QueryLike<T> {
  data: T | undefined
  isPending: boolean
  isError: boolean
  error: unknown
  refetch: () => unknown
}

interface QueryStateProps<T> {
  query: QueryLike<T>
  /** Decides "empty"; defaults to `[]`, `null` and `undefined`. */
  isEmpty?: (data: T) => boolean
  loading?: ReactNode
  empty: ReactNode
  errorTitle?: string
  children: (data: T) => ReactNode
}

const defaultIsEmpty = (data: unknown) =>
  data == null || (Array.isArray(data) && data.length === 0)

export function QueryState<T>({
  query,
  isEmpty = defaultIsEmpty,
  loading = <ListSkeleton />,
  empty,
  errorTitle,
  children,
}: QueryStateProps<T>) {
  if (query.isPending) return <>{loading}</>
  if (query.isError) {
    return (
      <ErrorState
        title={errorTitle}
        error={query.error}
        onRetry={() => query.refetch()}
      />
    )
  }
  const data = query.data as T
  if (isEmpty(data)) return <>{empty}</>
  return <>{children(data)}</>
}
