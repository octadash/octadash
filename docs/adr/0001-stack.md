# ADR 0001: Stack and architecture

- Status: accepted
- Date: 2026-11-27

## Context

Octadash watches many products from one place: uptime, URL diagnosis, web
analytics, product events, errors, revenue, AI cost, infra cost, logs and traces,
plus alerts, a daily summary and an MCP server. It must:

1. Install in one step on a small VPS (Docker Compose, Coolify, Railway, a
   prebuilt image, or from source). No Kubernetes.
2. Accept the wire formats people already use (Sentry SDK, PostHog capture,
   OpenTelemetry/OTLP), so adoption means changing one URL.
3. Use **Postgres only**. No ClickHouse.
4. Never wake a monitored product's database (uptime checks hit `/health`
   endpoints that must not query a database; alert after 3 failures).
5. Grow into a hosted, multi-tenant cloud later without a rewrite.

## Decision

### Language and repository

- **TypeScript everywhere**, Node.js 24 LTS. One language for the panel, the
  ingest service, the worker, SDKs and the CLI.
- **pnpm workspaces + Turborepo** monorepo. **Biome** for lint and format,
  **Vitest** for tests.
- TypeScript pinned to 6.x. TypeScript 7 (the native port) is adopted once
  Next.js and the editor tooling fully support it.

### Three processes, one image

| Role     | Tech                 | Does                                                           |
| -------- | -------------------- | -------------------------------------------------------------- |
| `web`    | Next.js (App Router) | Panel, management API, auth, MCP server                        |
| `ingest` | Hono on Node         | Receives data only: Sentry, PostHog, OTLP and Octadash formats |
| `worker` | Node + pg-boss       | Uptime, diagnosis, alerts, connector syncs, rollups, retention |

All three ship in **one Docker image**; the first argument picks the role.

Why ingest is separate from the panel:

- Ingest is the part that grows with traffic. In the cloud it scales on its own;
  self-hosters can give it more CPU.
- A panel deploy or a slow page never drops incoming events.
- Hono is small and fast, with no React or rendering overhead per request, and
  the compatibility routes (`/api/:id/envelope/`, `/e/`, `/v1/logs`) do not
  collide with the panel's routes.

Each service gets its own public address (for example `octadash.example.com`
and `ingest.example.com`). SDK snippets and DSNs shown in the panel use the
ingest address.

### Database: Postgres, used carefully

- **Postgres 16 or newer, with no required extension.** Octadash runs on the
  bundled Postgres, Neon, Supabase or RDS.
- **Kysely** as the query builder, with migrations written in TypeScript and
  imported statically (they survive bundling). Better Auth, used for accounts
  and organizations, runs on Kysely too, so there is one database layer.
- **High-volume tables** (events, errors, logs, uptime checks) are
  **partitioned by day** with native range partitioning. The worker creates
  upcoming partitions and drops expired ones. Retention is a `DROP TABLE` of a
  partition: instant, no bloat, no vacuum storm. No pg_partman, so no extension.
- **The panel reads rollups, not raw events.** The worker keeps hourly and daily
  aggregate tables per project. Raw events are for drill-down and expire;
  rollups are small and kept.
- **Writes are batched.** Ingest buffers for up to one second (or N rows) and
  writes with multi-row inserts or `COPY`. The trade-off: a crash can lose up to
  one second of events. Every write goes through one `EventSink` interface, so
  the cloud can put a durable queue in front of Postgres later without touching
  the routes.
- `default_toast_compression=lz4` on the bundled Postgres to keep JSON payloads
  small and cheap to compress.

Capacity (estimate, not yet measured): a 4 GB VPS should take a few million
events per month comfortably. A load test runs before the first release and its
numbers replace this sentence.

### Multi-tenancy from day one

- Every customer-data table carries `org_id` and `project_id` (a project is a
  "product" in the UI). Every query goes through a data layer that requires the
  scope; Postgres row-level security can be turned on later as defense in depth
  without schema changes.
- Cloud scale path, still Postgres: **Citus** (open source, distributed
  Postgres) sharding by `org_id`, with time partitions kept inside each shard.
  pg-boss documents Citus support as well.

### Jobs

- **pg-boss** for queues, retries, cron schedules and dead letters, stored in
  Postgres (`pgboss` schema). No Redis to install.
- Uptime scheduling: the worker keeps the monitor list in memory, fires checks
  on time, and writes results in batches. Only state changes (down, recovered)
  become alert jobs. This keeps uptime from turning into thousands of queue rows
  per minute.

### Integrations are plugins

Alert channels and data sources share one contract (`packages/integrations`):
an id, a localized description, a Zod config schema (rendered as the settings
form through `z.toJSONSchema`), the keys that are secret (stored encrypted), and
`test()`. Notification channels add `send()`; sources add the methods their
module needs. Users enable what they want per organization or per product, as in
Coolify's notification settings. Nothing is chosen at install time.

Planned: email (SMTP), Telegram, Slack, Discord, webhook, ntfy and, later,
WhatsApp for alerts; Stripe, Asaas, Paddle, OpenAI, Anthropic and infra
providers as sources.

### Web stack

Next.js (App Router, standalone output), Tailwind CSS 4, shadcn/ui, next-intl
(English and Brazilian Portuguese), Zod, Better Auth (email and password,
OAuth, organizations, 2FA), MCP through the official TypeScript SDK on a
streamable HTTP endpoint.

### Install paths

- Docker Compose (`docker-compose.yml`), the main path.
- Coolify (`docker-compose.coolify.yml`, uses Coolify's generated passwords and
  domains). A template for Coolify's catalog follows.
- Prebuilt image `ghcr.io/octadash/octadash` with your own `DATABASE_URL`.
- Railway template (after the first release).
- From source: `pnpm install && pnpm build`.

Every role applies pending migrations on start (a lock makes parallel starts
safe), so upgrades are "pull the new image and restart".

## Alternatives considered

- **Everything inside Next.js** (ingest as route handlers): simpler at first, but
  couples ingestion to panel deploys and makes ingest scale with the panel.
  Rejected.
- **ClickHouse or TimescaleDB**: better analytics engines, but ClickHouse adds a
  second database to operate, and TimescaleDB's useful features (continuous
  aggregates, compression) are under a non-open-source license and missing on
  most managed Postgres. Rejected in favor of partitions and rollups.
- **Drizzle ORM**: popular, but its migration tooling does not model partitioned
  tables, which are central here. Kysely keeps full SQL control.
- **graphile-worker**: excellent and fast; pg-boss was chosen for built-in
  dead-letter queues, throttling and singleton jobs, which alerts need.
- **Redis/BullMQ**: one more service to install and pay for. Rejected.
- **NestJS**: heavier than the problem needs. Rejected.

## Consequences

- One image and one database keep self-hosting cheap.
- The partition and rollup discipline must be followed by every module that
  stores high-volume data. Code review checks it.
- If Postgres stops being enough for logs at cloud scale, an optional log store
  can be added behind the same interface. That is a later, separate decision.
