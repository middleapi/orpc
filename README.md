# Base

Base is a Nuxt 4 application for running the personal applications in this
repo. It uses oRPC for the API layer, Nuxt UI for the interface, Drizzle ORM
with Postgres for data, and Better Auth for authentication.

## Getting Started

Install dependencies:

```bash
pnpm install
```

Start the local Postgres database:

```bash
docker compose up -d
```

Create the database tables and load the playground data:

```bash
pnpm db:push
pnpm db:seed
```

Start the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.
Open [http://localhost:3000/api](http://localhost:3000/api) to view the Scalar API client.

## Worktrees

For git worktrees, use the bootstrap helper to set up a worktree-specific
`.env`, database, and dev port before starting development:

```bash
pnpm worktree:up
```

The script reuses the shared local Postgres container, creates a
worktree-specific database, pushes the schema, seeds the database, and starts
the app on the worktree's `NUXT_PORT`.

If you want `worktree:up` to keep the Nuxt dev server attached to your terminal
instead of starting it in the background, run:

```bash
pnpm worktree:up --foreground
```

## Database

The app uses [Drizzle ORM](https://orm.drizzle.team/) with a local Postgres
database. By default it connects to:

```text
postgres://postgres:postgres@localhost:5433/base
```

Override this with `DATABASE_URL` in `.env`.

Run Drizzle Studio for Base on its project-specific port:

```bash
pnpm db:studio
```

This uses the default `drizzle.config.ts` and serves Studio on
[http://localhost:4984](http://localhost:4984), so it can run alongside other
projects that use different Studio ports.

Authentication uses [Better Auth](https://better-auth.com/) with email and
password enabled. Better Auth is mounted at `/api/auth/*` and stores users,
sessions, accounts, and verification records in the same Postgres database.
The `/api` reference page serves a single OpenAPI document that includes the
Base API plus the supported Better Auth email/password endpoints.

## Market Trends

read_when: changing market trend indexes, Trigger.dev scheduling, or the market
trend API.

The platform includes `/apps/market-trends`, backed by the
`/api/apps/market-trends/indexes` Base endpoint and the
`market_trends.market_trend_indexes` table.
Run `pnpm db:push` after pulling this schema.

Market data can be refreshed manually from the Market Trends app, or periodically with
Trigger.dev:

```bash
pnpm dev:trigger
```

Set `TRIGGER_PROJECT_REF`, `TRIGGER_SECRET_KEY`, and optionally
`MARKET_TRENDS_CRON` in `.env`. The default cron is every 15 minutes.
