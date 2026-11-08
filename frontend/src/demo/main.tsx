/*
 * Entry point of the clickable demo (demo.html, built with
 * vite.demo.config.ts). Same screens as the real app (src/main.tsx), with:
 *   - a signed-in sample user instead of Auth0 (auth0-stub.tsx),
 *   - an in-browser fake API with sample data instead of the server
 *     (fakeApi.ts), and a fake file store instead of S3 (fakeS3.ts),
 *   - in-memory navigation, because the demo is served from a single page
 *     with no server to answer deep links.
 * Nothing here is part of the production build.
 */
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { StrictMode, useEffect } from "react"
import ReactDOM from "react-dom/client"
import { toast } from "sonner"

import { client } from "@/client/client.gen"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import "@/index.css"
import type { RouterContext } from "@/lib/router-context"
import { routeTree } from "@/routeTree.gen"

import { demoAxios } from "./fakeApi"
import { installFakeS3 } from "./fakeS3"

installFakeS3()
client.setConfig({ baseURL: "", axios: demoAxios })

const report = (error: Error) => {
  toast.error(error.message || "Something went wrong in the demo.")
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: report }),
  mutationCache: new MutationCache({ onError: () => undefined }),
  defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } },
})

const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
  context: { auth: { isAuthenticated: true } } satisfies RouterContext,
  defaultPendingMs: 300,
})

function Demo() {
  useEffect(() => {
    document.title = "VR Inspector Demo"
    const id = window.setTimeout(() => {
      toast.info("You are looking at a demo with sample data.", {
        description:
          "Everything is clickable. Changes stay until you reload the page. Nothing is saved to a server.",
        duration: 9000,
      })
    }, 600)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider
        router={router}
        context={{ auth: { isAuthenticated: true } }}
      />
      <Toaster richColors closeButton />
    </QueryClientProvider>
  )
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="vri-demo-theme">
      <Demo />
    </ThemeProvider>
  </StrictMode>,
)
