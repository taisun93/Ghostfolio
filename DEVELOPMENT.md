# Ghostfolio Development Guide

## Development Environment

### Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop)
- [Node.js](https://nodejs.org/en/download) (version `>=22.18.0`)
- Create a local copy of this Git repository (clone)
- Copy the file `.env.dev` to `.env` and populate it with your data (`cp .env.dev .env`)

### Setup

1. Run `npm install`
1. Run `docker compose -f docker/docker-compose.dev.yml up -d` to start [PostgreSQL](https://www.postgresql.org) and [Redis](https://redis.io)
1. Run `npm run database:setup` to initialize the database schema
1. Start the [server](#start-server) and the [client](#start-client)
1. Open https://localhost:4200/en in your browser
1. Create a new user via _Get Started_ (this first user will get the role `ADMIN`)

### Start Server

#### Debug

Run `npm run watch:server` and click _Debug API_ in [Visual Studio Code](https://code.visualstudio.com)

#### Serve

Run `npm run start:server`

### Start Client

#### English (Default)

Run `npm run start:client` and open https://localhost:4200/en in your browser.

#### Other Languages

To start the client in a different language, such as German (`de`), adapt the `start:client` script in the `package.json` file by changing `--configuration=development-en` to `--configuration=development-de`. Then, run `npm run start:client` and open https://localhost:4200/de in your browser.

### Start _Storybook_

Run `npm run start:storybook`

### Migrate Database

With the following command you can keep your database schema in sync:

```bash
npm run database:push
```

## Deploying to Vercel

### Stop Vercel builds (avoid charges)

To stop builds from running on every push and avoid build charges:

1. In **Vercel Dashboard**: open your project → **Settings** → **Git**.
2. Under **Ignored Build Step**, set the command to either:
   - **Never build:** `node scripts/vercel-skip-build-always.mjs`  
     (Vercel will never run a build until you remove or change this.)
   - **Build only when you want:** `node scripts/vercel-ignore-build.mjs`  
     Then leave `DEPLOY_VERCEL` unset; set it to `1` in Environment Variables only when you want a one-off deploy.

3. Save. Future pushes will not trigger a build unless you use the opt-in script and set `DEPLOY_VERCEL=1`.

---

Vercel serves only the **static Angular client**. The client calls the API on the same origin (`/api/v1/...`). So you must run the **NestJS API (with PostgreSQL and Redis) elsewhere** and proxy `/api` from Vercel to that backend.

### 1. Run the API and database elsewhere

- Host the API on [Railway](https://railway.app), [Render](https://render.com), [Fly.io](https://fly.io), or a VPS.
- Provide **PostgreSQL** and **Redis** (see `.env.example` for `DATABASE_URL`, `REDIS_*`, `JWT_SECRET_KEY`, `ACCESS_TOKEN_SALT`).
- Set **`ROOT_URL`** to your Vercel app URL (e.g. `https://your-app.vercel.app`) so auth redirects (Google, OIDC, etc.) point back to the client.
- Run `npm run database:migrate` and `npm run database:seed` (or equivalent) for that environment.
- Note the API base URL (e.g. `https://your-api.railway.app`).

### 2. Proxy `/api` from Vercel to your API

In **`vercel.json`**, add a `rewrites` entry so requests to `/api/*` are sent to your backend. Replace `YOUR_API_BASE_URL` with that URL (no trailing slash):

```json
{
  "buildCommand": "npm run build:production",
  "outputDirectory": "dist/apps/client",
  "rewrites": [
    { "source": "/api/:path*", "destination": "YOUR_API_BASE_URL/api/:path*" }
  ]
}
```

Example: if your API is at `https://ghostfolio-api.railway.app`, use `"destination": "https://ghostfolio-api.railway.app/api/:path*"`.

### 3. Deploy the client on Vercel

- Connect the repo to Vercel and use the existing **Build Command** and **Output Directory** (or the values in `vercel.json` above).
- The root URL serves a redirect page (see `apps/client/src/assets/index.html`) that sends users to a locale path (e.g. `/en/`). The app then loads and calls `/api/v1/info` and other endpoints, which Vercel forwards to your API via the rewrite.

### AI chat history (Postgres on Vercel)

When using the stub API (no backend proxy), AI Commands chat history is stored in Postgres. The serverless route `api/v1/ai-chat/messages.ts` uses **Neon** (or any Postgres) via the `@neondatabase/serverless` driver.

1. Create a Postgres database (e.g. [Neon](https://neon.tech) or add **Vercel Postgres** / **Neon** from the [Vercel Marketplace](https://vercel.com/marketplace)).
2. In the Vercel project, set **Environment Variable** `POSTGRES_URL` or `DATABASE_URL` to your connection string (e.g. `postgresql://user:pass@host/db?sslmode=require`). If neither is set, AI chat will work in-memory only and nothing will be written to Postgres.
3. The table `ai_chat_conversations` is created automatically on first request: one row per conversation per user, with a `messages` jsonb column holding the full conversation array. No migration needed. Writes are awaited before the response so they complete on serverless. (If you had the previous `ai_chat_messages` table, you can drop it.)

Users are identified by the same Bearer token they use for the stub login; when you switch to a real API, use the real user id from the JWT instead.

### Optional: faster builds

The default `build:production` also builds the API and Storybook. To build only the client on Vercel, set **Build Command** to:

```bash
nx run client:copy-assets && nx run client:build:production && npm run replace-placeholders-in-build
```

## Testing

Run `npm test`

## Experimental Features

New functionality can be enabled using a feature flag switch from the user settings.

### Backend

Remove permission in `UserService` using `without()`

### Frontend

Use `@if (user?.settings?.isExperimentalFeatures) {}` in HTML template

## Component Library (_Storybook_)

https://ghostfol.io/development/storybook

## Git

### Rebase

`git rebase -i --autosquash main`

## Dependencies

### Angular

#### Upgrade (minor versions)

1. Run `npx npm-check-updates --upgrade --target "minor" --filter "/@angular.*/"`

### Nx

#### Upgrade

1. Run `npx nx migrate latest`
1. Make sure `package.json` changes make sense and then run `npm install`
1. Run `npx nx migrate --run-migrations`

### Prisma

#### Access database via GUI

Run `npm run database:gui`

https://www.prisma.io/studio

#### Synchronize schema with database for prototyping

Run `npm run database:push`

https://www.prisma.io/docs/concepts/components/prisma-migrate/db-push

#### Create schema migration

Run `npm run prisma migrate dev --name added_job_title`

https://www.prisma.io/docs/concepts/components/prisma-migrate#getting-started-with-prisma-migrate

## SSL

Generate `localhost.cert` and `localhost.pem` files.

```
openssl req -x509 -newkey rsa:2048 -nodes -keyout apps/client/localhost.pem -out apps/client/localhost.cert -days 365 \
  -subj "/C=CH/ST=State/L=City/O=Organization/OU=Unit/CN=localhost"
```
