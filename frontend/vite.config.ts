/// <reference types="vitest/config" />
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vite"

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    outDir: "../backend/app/frontend",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // Keep the large, rarely-changing vendor libraries in their own
        // chunks so a screen change does not invalidate the whole bundle in
        // the browser cache (field devices on 4G reload often).
        codeSplitting: {
          groups: [
            { name: "vendor-auth0", test: /node_modules[\\/]@auth0[\\/]/ },
            {
              name: "vendor-react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            { name: "vendor-radix", test: /node_modules[\\/]@radix-ui[\\/]/ },
            {
              name: "vendor-tanstack",
              test: /node_modules[\\/]@tanstack[\\/]/,
            },
          ],
        },
      },
    },
  },
  // Increment 18: PowerSync's SQLite (wa-sqlite, WebAssembly) runs in web
  // workers; Vite must not pre-bundle it, and workers are ES modules.
  optimizeDeps: {
    exclude: ["@journeyapps/wa-sqlite", "@powersync/web"],
  },
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  // Component/unit tests (Vitest + Testing Library, jsdom). End-to-end
  // tests live in ./tests and run with Playwright against the built app.
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    clearMocks: true,
  },
})
