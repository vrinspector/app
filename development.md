# VR Inspector - Development

## Local Development

For local development, run PostgreSQL and Mailpit with Docker Compose, and run the FastAPI and Vite development servers locally.

Start the supporting services:

```bash
docker compose up -d db mailpit
```

Then, from the `backend` directory, install the dependencies and prepare the database:

```bash
uv sync
uv run bash scripts/prestart.sh
```

`prestart.sh` runs the Alembic migrations. The data-layer baseline is safe to
run against a database that already holds the legacy VR Inspector tables: it
only adds what is missing (see `docs/DATA_MODEL.md`). The backend test suite
creates and drops its own scratch databases on the same server, so the
configured database user must be allowed to `CREATE DATABASE` (the Compose
`db` service's `postgres` user is).

Photo (and, from increment 05, drawing) uploads go browser → S3 through
presigned URLs; the API only signs URLs. Locally this needs AWS credentials in
your shell (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, or an SSO profile)
with access to `S3_BUCKET`; nothing is read from the repo. Without credentials
every other route works and the tests still pass (they use an in-memory S3
stand-in). See `docs/API_PORT.md` for the ported route contract.

Start the FastAPI development server:

```bash
uv run fastapi dev
```

In another terminal, from the project root, install the frontend dependencies and start the Vite development server:

```bash
bun install
bun run dev
```

Now you can open these URLs:

Frontend development server: <http://localhost:5173>

Backend API: <http://localhost:8000>

Automatic interactive API documentation with Swagger UI: <http://localhost:8000/docs>

Mailpit: <http://localhost:8025>

The frontend development server uses the backend at `http://localhost:8000`, as configured in `frontend/.env`.

### Frontend Served by FastAPI

Build the frontend from the `frontend` directory:

```bash
bun run build
```

The build is written to `backend/app/frontend` and served by FastAPI at <http://localhost:8000>. Rebuild the frontend after making frontend changes.

## Full Stack with Docker Compose

To run the backend and built frontend in Docker Compose:

```bash
docker compose run --rm backend bash scripts/prestart.sh
docker compose watch
```

Now you can open these URLs:

Application, with the frontend and API served by FastAPI: <http://localhost:8000>

Automatic interactive API documentation with Swagger UI: <http://localhost:8000/docs>

Adminer, database web administration: <http://localhost:8080>

Traefik UI, to see how the routes are being handled by the proxy: <http://localhost:8090>

Mailpit: <http://localhost:8025>

Stop a locally running FastAPI server before starting the Compose backend because both use port `8000`.

**Note**: The first time you start the stack, it might take a minute for all the services to be ready. To monitor it, use `docker compose logs`, or `docker compose logs backend` for the backend service.

## Mailpit

[Mailpit](https://mailpit.axllent.org) captures emails sent during local development instead of delivering them. The local backend connects to it at `localhost:1025`, and the Compose backend connects to the `mailpit` service. Captured emails are available at <http://localhost:8025>.

## Docker Compose Files and Environment Variables

The main `compose.yml` file contains the configuration shared by the whole stack. Docker Compose loads it automatically.

The `compose.override.yml` file adds local development settings, such as mounting the source code as a volume. Docker Compose also loads it automatically and applies it on top of `compose.yml`.

The `compose.deploy.yml` file contains the deployment-specific settings, including HTTPS and automatic certificate handling. It is explicitly combined with `compose.yml` when deploying the application.

The backend reads local settings from the `.env` file. Docker Compose also uses it for variable interpolation and passes the settings each container needs.

After changing variables, make sure you restart the stack:

```bash
docker compose watch
```

## The `.env` File

The tracked `.env` file contains local development defaults, passwords, and other configuration. Its hostnames use `localhost` for processes running on your machine. Docker Compose overrides hostnames such as the database and SMTP server with their Compose service names.

## Signing in locally (Auth0)

There is no local users table and no password login: identity comes from Auth0 (the access token's `sub` is the identity anchor; `email` is carried for display and the legacy membership checks). The tracked `.env` ships **placeholders**, so a fresh checkout boots, serves the sign-in page, and shows a "Sign-in is not set up for this build" notice.

To sign in on your machine, set these in `.env` (backend) and `frontend/.env` (Vite dev server) to the values of the VR Inspector Auth0 tenant — they are public identifiers, not secrets, but keep the repo copies as placeholders:

* `AUTH0_DOMAIN` / `VITE_AUTH0_DOMAIN` — tenant domain, e.g. `tenant.us.auth0.com`
* `AUTH0_API_AUDIENCE` / `VITE_AUTH0_AUDIENCE` — the API identifier (legacy value: `https://api.vrinspector.com`)
* `VITE_AUTH0_CLIENT_ID` — the Single Page Application's client id

In the Auth0 application settings, allow `http://localhost:5173` and `http://localhost:8000` as Callback URLs, Logout URLs and Web Origins.

Sign-in needs a **secure context**: HTTPS, or `http://localhost` on the same machine. Opening the app from another device over plain HTTP (for example an iPad pointed at `http://192.168.x.x:5173`) shows an "Open VR Inspector over HTTPS" page instead of the sign-in button; use an HTTPS tunnel (ngrok, Cloudflare Tunnel) for device testing. The Playwright suite reaches the app as `http://backend:8000` inside Docker Compose and launches full Chromium with `--unsafely-treat-insecure-origin-as-secure` for that origin only. The backend fetches only the tenant's public JWKS (cached) and, when an access token carries no email claim, looks the email up at `/userinfo` (per-token cache). An Auth0 Action that copies the email into the access token as `https://vrinspector.com/email` avoids that lookup.

Do not store deployment secrets in `.env`. Configure them as described in the [FastAPI Cloud deployment guide](./deployment.md) or the [Docker Compose deployment guide](./deployment-docker-compose.md).

## Pre-commit Hooks and Code Linting

The project uses [prek](https://prek.j178.dev/), a modern alternative to [pre-commit](https://pre-commit.com/), for code linting and formatting.

You can find a file `.pre-commit-config.yaml` with configurations at the root of the project.

### Install `prek` to Run Automatically

`prek` is already part of the dependencies of the project.

From the project root, install the Git hook so that `prek` runs automatically before each commit:

```bash
uv run prek install -f
```

The `-f` flag forces the installation, in case there was already a `pre-commit` hook previously installed.

Now whenever you try to commit, for example with:

```bash
git commit
```

`prek` will check and format the code you are about to commit. If it modifies any files, add those files to Git again before committing.

### Run `prek` Manually

You can also run `prek` manually on all files from the project root:

```bash
uv run prek run --all-files
```
