import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.join(__dirname, "../../.env") })

const PLACEHOLDER = /changethis|example\./i

const domain = process.env.VITE_AUTH0_DOMAIN ?? ""
const clientId = process.env.VITE_AUTH0_CLIENT_ID ?? ""

/**
 * True when the build under test carries real Auth0 settings. CI runs with
 * placeholders, so the sign-in button is expected to be disabled there and
 * the "not set up" notice shown. End-to-end sign-in against a real tenant
 * needs test-user credentials and is an owner-run check for now.
 */
export const auth0Configured =
  domain.length > 0 &&
  clientId.length > 0 &&
  !PLACEHOLDER.test(domain) &&
  !PLACEHOLDER.test(clientId)
