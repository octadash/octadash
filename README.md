<p align="center">
  <img src="apps/web/public/logo-magenta.svg" alt="Octadash" width="72" />
</p>

<h1 align="center">Octadash</h1>

<p align="center">
  Open source monitoring for people who run many products.<br />
  Uptime, analytics, errors, revenue, AI cost and logs, one tab per product and one tab for all of them.
</p>

> **Status: early development.** The foundation is in place; modules land one by
> one (see the [roadmap](docs/product.md#roadmap-to-10)). Not ready for production yet.

## Why

If you run ten or twenty products, you end up with an account on PostHog,
Sentry, an uptime service, Stripe, the AI providers and a log tool, and still no
single answer to "how is everything doing?". Octadash puts it in one place you
host yourself, and tells you what each product is missing.

- **Create a product with just its name.** Its page shows every area (uptime,
  traffic, errors, money, AI cost, logs) with what it is for and how to set it up
  for your platform, and each card turns into that area's summary once data arrives.
- **Compatible by design.** Point the Sentry SDK, the PostHog SDK or an
  OpenTelemetry exporter at Octadash and it works. Changing one URL is the whole
  migration.
- **Uptime that never wakes your database.** Checks hit a `/health` endpoint
  that answers without a query, and alerts fire after 3 failures in a row.
- **Plug in what you use.** Alert channels (email, Telegram, Slack, Discord,
  webhook) and data sources (Stripe, Asaas, Paddle, OpenAI, Anthropic) are
  integrations you enable per product.
- **Everything in the box.** One image plus Postgres, Valkey and ClickHouse,
  installed and managed by Octadash on a small VPS. You never touch ClickHouse.
  (ClickHouse and Valkey arrive with step 1 of the [roadmap](docs/product.md#roadmap-to-10).)

## Install

```bash
git clone https://github.com/octadash/octadash.git
cd octadash
./scripts/generate-env.sh   # creates .env with every password and the secret
docker compose up -d
```

Coolify, a prebuilt image with your own Postgres, and running from source are
covered in [docs/self-hosting.md](docs/self-hosting.md).

## Develop

Requires Node.js 22.12+ (24 recommended), pnpm 10 and Docker.

```bash
pnpm install
pnpm db:up                 # Postgres :5432, ClickHouse :8123, Valkey :6379
export DATABASE_URL=postgres://octadash:octadash@localhost:5432/octadash
export CLICKHOUSE_URL=http://octadash:octadash@localhost:8123/octadash
export VALKEY_URL=redis://:octadash@localhost:6379
pnpm db:migrate
cp .env.example apps/web/.env.local   # set DATABASE_URL and OCTADASH_SECRET there
pnpm dev                   # web :3000, ingest :4000, worker
```

Open http://localhost:3000: the first visit creates the owner account.

| Command          | Does                                     |
| ---------------- | ---------------------------------------- |
| `pnpm lint`      | Biome lint and format check              |
| `pnpm format`    | Apply Biome fixes                        |
| `pnpm typecheck` | TypeScript in every package              |
| `pnpm test`      | Vitest (store tests need the URLs above) |
| `pnpm build`     | Build every app                          |

## Repository

```
apps/
  web/            Next.js panel, API and MCP server
  ingest/         Hono service that receives data (Sentry, PostHog, OTLP, Octadash)
  worker/         Jobs: uptime, alerts, syncs, rollups, retention
packages/
  auth/           Better Auth setup: accounts, organizations, sign-up policy
  core/           Env parsing, logger, ids
  db/             Postgres (Kysely) and ClickHouse clients and migrations
  integrations/   Plugin contract for alert channels and data sources
  queue/          Valkey streams between the ingest and the worker
  uptime/         One uptime check: status, response time, redirects, HTTPS, certificate
docs/             product.md (what and when), architecture.md (how), self-hosting.md
```

Why this stack: [docs/architecture.md](docs/architecture.md). What is planned: [docs/product.md](docs/product.md).

## Contributing

Pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

[AGPL-3.0](LICENSE). You can use, modify and self-host Octadash freely. If you
offer a modified version as a service, you must publish your changes under the
same license.
