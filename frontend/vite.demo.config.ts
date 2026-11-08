/*
 * Clickable demo build: `bun run build:demo` → frontend/dist-demo/.
 *
 * The real screens, but with Auth0 replaced by a signed-in sample user and
 * the API/S3 replaced by an in-browser fake with sample data (src/demo/).
 * Relative asset paths so the output can be opened from any folder or
 * published as a static page. Never deployed as the application.
 */
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react-swc"
import { defineConfig, type Plugin } from "vite"

/*
 * The static-page host rejects text files that contain raw control bytes,
 * and the minified PDF.js worker has a few hundred inside string literals.
 * Rewriting each as a \xNN escape is equivalent JavaScript.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control bytes is the point
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const escapeControl = (text: string) =>
  text.replace(
    CONTROL,
    (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  )
function escapeControlBytes(): Plugin {
  return {
    name: "vri-demo-escape-control-bytes",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (!/\.m?js$/.test(file.fileName)) continue
        if (file.type === "chunk") {
          file.code = escapeControl(file.code)
        } else {
          const text =
            typeof file.source === "string"
              ? file.source
              : new TextDecoder().decode(file.source)
          file.source = escapeControl(text)
        }
      }
    },
  }
}

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist-demo",
    emptyOutDir: true,
    rolldownOptions: {
      input: path.resolve(import.meta.dirname, "demo.html"),
    },
  },
  resolve: {
    alias: {
      "@auth0/auth0-react": path.resolve(
        import.meta.dirname,
        "./src/demo/auth0-stub.tsx",
      ),
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    escapeControlBytes(),
  ],
})
