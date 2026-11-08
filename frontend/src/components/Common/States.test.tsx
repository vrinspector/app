import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AxiosError, type AxiosResponse } from "axios"
import { describe, expect, it, vi } from "vitest"

import {
  EmptyState,
  ErrorState,
  errorMessage,
  ListSkeleton,
  LoadingState,
  type QueryLike,
  QueryState,
} from "./States"

const apiError = (status: number, detail?: unknown) => {
  const err = new AxiosError("Request failed")
  if (status > 0) {
    err.response = {
      status,
      data: detail === undefined ? {} : { detail },
    } as AxiosResponse
  }
  return err
}

describe("errorMessage", () => {
  it("prefers the API's detail string", () => {
    expect(errorMessage(apiError(404, "Project not found"))).toBe(
      "Project not found",
    )
  })

  it("reads FastAPI validation errors", () => {
    expect(
      errorMessage(apiError(422, [{ msg: "field required", loc: ["name"] }])),
    ).toBe("field required")
  })

  it("explains a network failure in plain words", () => {
    expect(errorMessage(apiError(0))).toMatch(/could not reach/i)
  })

  it("falls back for unknown errors", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom")
    expect(errorMessage(undefined)).toBe("Something went wrong.")
    expect(errorMessage("custom text")).toBe("custom text")
  })
})

describe("state components", () => {
  it("LoadingState announces itself to assistive tech", () => {
    render(<LoadingState message="Loading projects…" />)
    expect(screen.getByRole("status")).toHaveTextContent("Loading projects…")
  })

  it("ListSkeleton draws the requested rows", () => {
    render(<ListSkeleton rows={4} />)
    expect(screen.getByTestId("list-skeleton").children).toHaveLength(4)
  })

  it("EmptyState shows title, description and the action", () => {
    render(
      <EmptyState
        title="No projects yet"
        description="Create your first project."
        action={<button type="button">New project</button>}
      />,
    )
    expect(
      screen.getByRole("heading", { name: "No projects yet" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Create your first project.")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "New project" }),
    ).toBeInTheDocument()
  })

  it("ErrorState offers a retry when given one", async () => {
    const onRetry = vi.fn()
    render(
      <ErrorState error={apiError(500, "Server hiccup")} onRetry={onRetry} />,
    )
    expect(screen.getByRole("alert")).toHaveTextContent("Server hiccup")
    await userEvent.click(screen.getByTestId("retry-button"))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("ErrorState hides the retry button without a handler", () => {
    render(<ErrorState error="nope" />)
    expect(screen.queryByTestId("retry-button")).not.toBeInTheDocument()
  })
})

describe("<QueryState>", () => {
  const query = <T,>(over: Partial<QueryLike<T>>): QueryLike<T> => ({
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  })
  const renderState = (q: QueryLike<string[]>) =>
    render(
      <QueryState
        query={q}
        empty={<EmptyState title="Nothing here" />}
        errorTitle="Could not load"
      >
        {(items) => (
          <ul>
            {items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
      </QueryState>,
    )

  it("shows the skeleton while pending", () => {
    renderState(query({ isPending: true }))
    expect(screen.getByTestId("list-skeleton")).toBeInTheDocument()
  })

  it("shows the error with a retry wired to refetch", async () => {
    const refetch = vi.fn()
    renderState(query({ isError: true, error: new Error("down"), refetch }))
    expect(
      screen.getByRole("heading", { name: "Could not load" }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByTestId("retry-button"))
    expect(refetch).toHaveBeenCalled()
  })

  it("shows the empty state for an empty list", () => {
    renderState(query({ data: [] }))
    expect(screen.getByTestId("empty-state")).toHaveTextContent("Nothing here")
  })

  it("renders the data otherwise", () => {
    renderState(query({ data: ["Landfill Gas", "Substation"] }))
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
  })
})
