# Architecture

How Octadash is built and why. What it does and in which order lives in
[product.md](product.md); how to install it, in [self-hosting.md](self-hosting.md).

Decided on 2026-11-27, revised on 2026-11-28 (storage moved from Postgres only
to Postgres, Valkey and ClickHouse; URL diagnosis removed). Changing a decision
here means editing this file in the same pull request as the code, with the
reason in the commit message.

## Context

Octadash watches many products from one place: uptime, web analytics, product
events, errors, revenue, AI cost, infra cost, logs and traces, plus alerts, a
daily summary and an MCP server. It must:

1. Install in one step on a small VPS (Docker Compose, Coolify, Railway, a
   prebuilt image, or from source). No Kubernetes.
2. Accept the wire formats people already use (Sentry SDK, PostHog capture,
   OpenTelemetry/OTLP), so adoption means changing one URL.
3. Ship everything it needs in the install (Postgres, Valkey, ClickHouse) and
   manage it: migrations, generated passwords, retention. The person installing
   never opens ClickHouse or Valkey.
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

| Role     | Tech                 | Does                                                                                                                                       |
| -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `web`    | Next.js (App Router) | Panel, management API, auth, MCP server                                                                                                    |
| `ingest` | Hono on Node         | Receives data only: Sentry, PostHog, OTLP and Octadash formats. Validates the key, puts the payload on a Valkey stream and answers at once |
| `worker` | Node + pg-boss       | Reads the ingest streams and writes to ClickHouse; uptime, alerts, connector syncs, rollups, retention                                     |

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

### Storage: Postgres, Valkey and ClickHouse

All three ship in `docker-compose.yml` and in the Coolify compose, with pinned
versions and passwords generated at install. Each has one job.

| Store      | Holds                                                                                     | Why this one                                                          |
| ---------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Postgres   | records: accounts, organizations, products, keys, monitors, alert rules, channels, issues | relational, transactional, what Better Auth and pg-boss already use   |
| Valkey     | the ingest buffer (streams), cache, rate limits, uptime state between checks              | ingest must answer in milliseconds and never wait on a database       |
| ClickHouse | raw events, pageviews, error occurrences, logs, spans, AI calls, uptime results; rollups  | high-volume time series, fast aggregation, compression, TTL retention |

#### Postgres

- **Postgres 16 or newer, with no required extension.** Runs on the bundled
  Postgres, Neon, Supabase or RDS.
- **Kysely** as the query builder, with migrations written in TypeScript and
  imported statically (they survive bundling). Better Auth, used for accounts
  and organizations, runs on Kysely too, so there is one layer for records.
- No high-volume table lives in Postgres. Error issues (the grouped error, its
  status and assignee) are records and stay here; each occurrence goes to
  ClickHouse.

#### Valkey

- Valkey (the open source fork of Redis, BSD license) receives every payload the
  ingest accepts, on one stream per kind (`events`, `errors`, `logs` and so on).
- The worker reads the streams in consumer groups, writes to ClickHouse in
  batches and acknowledges only after the write. A worker restart loses nothing
  that was acknowledged by the ingest.
- Streams have a maximum length. If the worker falls far behind, the ingest
  answers `429` with `Retry-After` instead of filling the disk; the SDKs retry.
- Valkey runs with append-only persistence on its own volume.

#### ClickHouse

- One database, created and migrated by Octadash on start (same lock as the
  Postgres migrations). Migrations live in `packages/db` next to the Postgres
  ones and are never edited after release.
- Every table carries `org_id` and `project_id` and is ordered by them first, so
  one product, one organization or every product is the same query with a
  different filter. This is what makes the "All products" view cheap.
- **Retention is a table TTL**, set from the retention configured per area.
- **The panel reads rollups when it can.** Materialized views keep hourly and
  daily aggregates; raw rows are for drill-down.
- Every write goes through one `EventSink` interface, so tests can use an
  in-memory sink and the cloud can change the transport without touching the
  routes.

#### Running the three

- **Pinned versions** in the compose files; upgrades come with Octadash releases.
- **CPU**: the official ClickHouse amd64 image needs the x86-64-v3 level (AVX2
  and friends, practically every x86 CPU after 2015). arm64 works. The install
  docs say so and the worker logs a clear error when ClickHouse refuses to start.
- **Memory**: the bundled ClickHouse runs with a low-memory profile so a 4 GB VPS
  is enough. Estimate, not measured: the load test before the first release
  replaces this sentence with numbers.
- **Backups**: three volumes (Postgres, ClickHouse, Valkey). self-hosting.md
  documents backing up the first two; Valkey only holds data in transit.
- **Bring your own** Postgres keeps working (`DATABASE_URL`). An external
  ClickHouse or Valkey (`CLICKHOUSE_URL`, `VALKEY_URL`) is allowed but not the
  default path.

### Multi-tenancy from day one

- Every customer-data table carries `org_id` and `project_id` (a project is a
  "product" in the UI). Every query goes through a data layer that requires the
  scope; Postgres row-level security can be turned on later as defense in depth
  without schema changes.
- Cloud scale path: ClickHouse tables are already ordered by `org_id`, so
  sharding by organization is a cluster setting, not a rewrite. Postgres only
  holds records, which stay small.

### Jobs

- **pg-boss** for jobs: retries, cron schedules and dead letters, stored in
  Postgres (`pgboss` schema). Jobs are few and need transactions (an alert is
  sent once). The ingest firehose goes through Valkey streams, not pg-boss.
- Uptime scheduling: the worker keeps the monitor list in memory, fires checks
  on time, and writes results to ClickHouse in batches. Only state changes
  (down, recovered) become alert jobs. This keeps uptime from turning into
  thousands of queue rows per minute.
- Alert rules are rows in Postgres (`alert_rule`): the organization's defaults
  are seeded on first use, and a product can have its own row for any kind.
  Every threshold is editable. See [product.md](product.md#alerts) for the three
  kinds (emergency, signal, data).
- Incidents (`incident`) do not know their kinds: a kind, a level, a
  `dedupe_key` (one open incident per key, by a partial unique index) and
  free-form `data`. A new area adds kinds to `RULE_DEFAULTS` and opens
  incidents; storage, delivery and the panel need no change.
- Delivery: an incident waits `notify_after` (the rule's delay, "down for 2
  minutes"), then the `alerts-notify` job claims what is due with
  `FOR UPDATE SKIP LOCKED` and sends one message per channel and event. Ten
  products down at once is one message listing them. An incident resolved
  before anyone was told closes silently. The job is woken when an incident
  opens or closes and also runs every minute.
- Channel secrets (bot tokens, SMTP passwords, API keys) are encrypted with
  AES-256-GCM under a key derived from `OCTADASH_SECRET`, so the worker needs
  the same secret as the panel. Each channel has its own message language.
- "I'm on it" on an emergency: any member sets `acknowledged_by` and
  `acknowledged_at`; the first person keeps it. The incident stays open (the
  strip stays red) until its cause is resolved. Reminders, when they come, skip
  incidents someone took.
- Live updates: whoever changes incidents, monitors or the outside watcher
  publishes a small event on Valkey (`octadash:live:org:<id>`, or
  `octadash:live:instance` for the whole install). Each panel process holds one
  subscriber connection shared by every open screen and forwards events over
  Server-Sent Events (`/api/live`); the screen then fetches its own data again.
  Events name what changed, never the data, so nothing reaches a viewer who may
  not see it. Several panel processes all receive every event. TV mode uses the
  same stream. A lost event costs only freshness: the next load is right.

### Integrations are plugins

Alert channels and data sources share one contract (`packages/integrations`):
an id, a localized description, a Zod config schema (rendered as the settings
form through `z.toJSONSchema`), the keys that are secret (stored encrypted), and
`test()`. Notification channels add `send()`; sources add the methods their
module needs. Users enable what they want per organization or per product, as in
Coolify's notification settings. Nothing is chosen at install time.

Built: email (SMTP and Resend), Telegram and webhook. The full list of planned connectors is in
[product.md](product.md#connectors).

### Areas can be switched off

Each area (traffic, errors, money and so on) declares a manifest: its id, the
areas it depends on (funnels need product usage), the source integrations it
accepts and the metrics it provides.

- Every area is on when Octadash is installed. There are no presets.
- Per product, "I won't use this" hides an area's card from that product's page;
  it stays listed under "Also available for this product" and can come back.
- An instance switch (advanced settings) turns an area off everywhere: it
  registers no ingest route, schedules no worker job, and is hidden from the
  panel and the MCP server. Its data stays until retention removes it.
- The base (accounts, products, uptime, alerts) cannot be switched off.

Because `ingest` and `worker` are bundled into single files, third-party
modules and integrations arrive by pull request into this repository, the way
Coolify's service catalog grows. Loading third-party code at runtime is a later
decision: it would run with access to the instance's database.

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

### Getting data in: compatible formats and own SDKs

The ingest accepts the formats people already send, so an existing app moves by
changing one URL:

- Sentry envelopes (`/api/:id/envelope/`) for errors, from any Sentry SDK.
- PostHog capture (`/e/`, `/batch/`, `/capture/`, `/i/v1/...`) for events and
  `$ai_generation`.
- OTLP over HTTP (`/v1/logs`, `/v1/traces`, `/v1/metrics`) for logs, traces and
  `gen_ai` spans.

Octadash writes its own SDKs only where it adds something: one browser script
(traffic, errors and events) and a Node.js and Next.js package. Every other
language uses the Sentry, PostHog or OpenTelemetry SDK. The docs carry a
"supported SDKs" table with the versions tested, and CI runs those real SDKs
against the ingest on every pull request and once a week against their latest
releases, so a format change upstream shows up as a failing build instead of
lost data.

Keys belong to sources. A source is one part of a product ("Site, Next.js",
"API, .NET") with its own key (`source_key`); the key tells the ingest the
product and the source, also inside a Sentry DSN. A source can hold a new key
and an old one with a revocation time, so an app is redeployed before the old
key stops. The area of each piece of data comes from its kind, never from the
key: one browser script sends page views (Traffic) and product events (Product
usage) with one key. The worker routes each batch:

- data of a kind a source had not sent adds that area to the source, so the
  area's setup lists it with no action;
- data for an area marked "I won't use this" is not stored; the area counts it
  (`discarded_events`) so its card can say it is receiving data while off. The
  ingest stays a thin, fast door with no lookup per area.

Keys from before sources (product keys) keep working, without a source, until
the setup screens create sources; then they are dropped.

Traffic needs no cookie. The browser script (`/o/v1/script.js`, served by the
ingest) sends `$pageview` with `$current_url` and `$referrer`, PostHog's names,
so PostHog's web SDK fills the same columns. The ingest turns each request into
columns Traffic reads directly (`path`, `referrer_host`, `utm_*`, `browser`,
`os`, `device`, `country`, `is_bot`) and a `visitor_id`: a hash of a random
salt of the day (kept in Valkey for two days), the product, the address and the
browser. The address itself is never stored, and once the salt expires no one
can link two days. A source can count returning visitors instead
(`source.visitor_mode = 'persistent'`, off by default): its snippet carries
`data-visitor="persistent"`, the script keeps a random id in the site's
localStorage and sends it as `$visitor_id`, and the ingest stores a hash of it
with the product as `visitor_id`, never the id itself. The ingest ignores the
id when the source counts by the day, so the setting in the panel decides.
Turning it on is the site owner's choice, consent included where the law asks
for it. When the app names the person (`distinct_id`), that name counts
instead. The country comes from a proxy header (Cloudflare,
CloudFront, Vercel); without one it stays empty. Bots are stored with
`is_bot = 1` and shown apart, not dropped. Traffic queries take a list of
products or null for all of them, so All products, a group and one product
are the same query.

### URL diagnosis removed

The first version read a product's address from outside and guessed what it
had installed (`packages/diagnosis`). It is removed in step 1 of the roadmap:
guessing from HTML was often wrong, and the product page now asks what to set
up instead. The checks that were reliable (certificate, HTTP to HTTPS redirect,
security headers, SPF and DMARC) move into uptime.

## Alternatives considered

- **Everything inside Next.js** (ingest as route handlers): simpler at first, but
  couples ingestion to panel deploys and makes ingest scale with the panel.
  Rejected.
- **Postgres only, with daily partitions and rollups** (the 2026-11-27
  decision): one database to run, but analytics on Postgres hits a ceiling
  early, and every query over many products would fight the record tables.
  Reversed on 2026-11-28 in favor of ClickHouse, on the condition that Octadash
  installs and manages it so nobody has to operate it by hand.
- **TimescaleDB**: its useful features (continuous aggregates, compression) are
  under a non-open-source license and missing on most managed Postgres.
  Rejected.
- **Kafka** (what PostHog and Sentry run): built for far more traffic than a
  self-hosted Octadash sees, and heavy on memory. Valkey streams give the same
  "accept now, process behind" shape. Rejected.
- **Drizzle ORM**: popular, but its migration tooling does not model partitioned
  tables, which are central here. Kysely keeps full SQL control.
- **graphile-worker**: excellent and fast; pg-boss was chosen for built-in
  dead-letter queues, throttling and singleton jobs, which alerts need.
- **Redis/BullMQ for jobs**: rejected on 2026-11-27 as one more service. Valkey
  is now in the install for the ingest buffer, but jobs stay on pg-boss, which
  keeps them transactional with the records they touch.
- **NestJS**: heavier than the problem needs. Rejected.

## Consequences

- One image and three managed stores. The install is still one command, and a
  4 GB VPS is the target until the load test says otherwise.
- The ingest never writes to a database on the request path, so a slow
  ClickHouse delays charts, not the customer's app.
- Every high-volume table goes to ClickHouse with `org_id` and `project_id`
  first in its order key and a TTL. Code review checks it.
- Upstream SDK format changes are caught by CI, not by users.
