<p align="center">
  <img src="apps/web/public/logo-magenta.svg" alt="Octadash" width="72" />
</p>

<h1 align="center">Octadash</h1>

<p align="center">
  Open source monitoring for people who run many products.<br />
  Uptime, analytics, errors, revenue, AI cost and logs, one tab per product and one tab for all of them.
</p>

> **Status: early development.** The foundation is in place; modules land one by
> one (see the [roadmap](docs/roadmap.md)). Not ready for production yet.

## Why

If you run ten or twenty products, you end up with an account on PostHog,
Sentry, an uptime service, Stripe, the AI providers and a log tool, and still no
single answer to "how is everything doing?". Octadash puts it in one place you
host yourself, and tells you what each product is missing.

- **Diagnosis first.** Paste a URL and Octadash tells you what the product has
  (analytics, error tracking, health endpoint, SSL) and the next step to see more.
- **Compatible by design.** Point the Sentry SDK, the PostHog SDK or an
  OpenTelemetry exporter at Octadash and it works. Changing one URL is the whole
  migration.
- **Uptime that never wakes your database.** Checks hit a `/health` endpoint
  that answers without a query, and alerts fire after 3 failures in a row.
- **Plug in what you use.** Alert channels (email, Telegram, Slack, Discord,
  webhook) and data sources (Stripe, Asaas, Paddle, OpenAI, Anthropic) are
  integrations you enable per product.
- **Postgres only.** One image, one database, a small VPS.

## Install

```bash
git clone https://github.com/octadash/octadash.git
cd octadash
cp .env.example .env   # fill POSTGRES_PASSWORD and OCTADASH_SECRET
docker compose up -d
```

Coolify, a prebuilt image with your own Postgres, and running from source are
covered in [docs/self-hosting.md](docs/self-hosting.md).

## Develop

Requires Node.js 22.12+ (24 recommended), pnpm 10 and Docker.

```bash
pnpm install
pnpm db:up                 # Postgres on localhost:5432
export DATABASE_URL=postgres://octadash:octadash@localhost:5432/octadash
pnpm db:migrate
pnpm dev                   # web :3000, ingest :4000, worker
```

| Command          | Does                                      |
| ---------------- | ----------------------------------------- |
| `pnpm lint`      | Biome lint and format check               |
| `pnpm format`    | Apply Biome fixes                         |
| `pnpm typecheck` | TypeScript in every package               |
| `pnpm test`      | Vitest (database tests need DATABASE_URL) |
| `pnpm build`     | Build every app                           |

## Repository

```
apps/
  web/            Next.js panel, API and MCP server
  ingest/         Hono service that receives data (Sentry, PostHog, OTLP, Octadash)
  worker/         Jobs: uptime, diagnosis, alerts, syncs, rollups, retention
packages/
  core/           Env parsing, logger, ids
  db/             Kysely client, migrations, partition helpers
  integrations/   Plugin contract for alert channels and data sources
docs/             Architecture decisions, roadmap, self-hosting
```

Why this stack: [docs/adr/0001-stack.md](docs/adr/0001-stack.md).

## Contributing

Pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

[AGPL-3.0](LICENSE). You can use, modify and self-host Octadash freely. If you
offer a modified version as a service, you must publish your changes under the
same license.
