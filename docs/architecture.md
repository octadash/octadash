# Architecture

How Octadash is built and why. What it does and in which order lives in
[product.md](product.md); how to install it, in the [public docs](https://docs.octadash.com/self-hosting)
(source in `apps/docs`).

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

### Storage: Postgres, Valkey, ClickHouse and Garage

All four ship in `docker-compose.yml` and in the Coolify compose, with pinned
versions and passwords generated at install. Each has one job.

| Store      | Holds                                                                                     | Why this one                                                          |
| ---------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Postgres   | records: accounts, organizations, products, keys, monitors, alert rules, channels, issues | relational, transactional, what Better Auth and pg-boss already use   |
| Valkey     | the ingest buffer (streams), cache, rate limits, uptime state between checks              | ingest must answer in milliseconds and never wait on a database       |
| ClickHouse | raw events, pageviews, error occurrences, logs, spans, AI calls, uptime results; rollups  | high-volume time series, fast aggregation, compression, TTL retention |
| Garage     | files: Sentry attachments, replays and profiles, anything over 1 MB                       | S3-compatible, one small binary, so an external S3 or R2 drops in     |

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

#### Garage (file storage)

- What does not fit a ClickHouse row is kept as a file, whole: Sentry
  attachments, replays and profiles always, and any other item over 1 MB.
  The row in `received` keeps the item's facts and where the file is
  (`encoding = 'file'`, `{ meta, file: { key, bytes, content_type } }`).
  Files are masked like rows: JSON and text go through the same masking,
  bytes are kept as sent.
- Keys start with the day the file arrived:
  `files/<day>/<org>/<product>/<kind>/<id>`. Retention removes whole days,
  and the per-organization folder right after the day is where the cloud
  will count quotas.
- The bundled store is [Garage](https://garagehq.deuxfleurs.fr) v2, one node
  with no replication (`--single-node --default-bucket`): it makes its key
  and the `octadash` bucket from `.env` on first start, so there is nothing
  to set up. Metadata in SQLite, with a snapshot every 6 hours
  (`docker/garage/garage.toml`). It is not reachable from outside the
  compose.
- Any S3-compatible bucket works instead (S3, R2, Backblaze, a Garage or
  SeaweedFS of your own): `STORAGE_ENDPOINT`, `STORAGE_BUCKET`,
  `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`. The
  client signs requests itself (`packages/storage`, aws4fetch), with no
  native code, so it bundles.
- **Octadash applies retention and the size limit itself**, not bucket rules,
  so it behaves the same on every store. Every hour the worker removes the
  days older than `OCTADASH_RECEIVED_RETENTION_DAYS` (the same as the rows that
  point to them), and past `OCTADASH_STORAGE_LIMIT_GB` (20 GB by default) it
  removes the oldest days first, never today, writing a `dropped:file` row per
  product with the count and reason `storage_limit`. Its last look goes to
  Valkey for the panel: **Settings** > **File storage**, a banner on settings
  pages while storage is not set, not answering or almost full, and a red bar
  in the emergency strip while it is not answering.
- Storage down while an item arrives: an item under 1 MB stays in its row as
  before; a bigger one is counted (`storage_unavailable`) and the error is
  logged.
- The ingest writes the file before it answers, so a file is never held in
  Valkey's memory. A Sentry envelope may be up to 20 MB (40 MB unpacked),
  the attachment limit most Sentry SDKs apply by default.

#### Running the four

- **Pinned versions** in the compose files; upgrades come with Octadash releases.
- **CPU**: the official ClickHouse amd64 image needs the x86-64-v3 level (AVX2
  and friends, practically every x86 CPU after 2015). arm64 works. The install
  docs say so and the worker logs a clear error when ClickHouse refuses to start.
- **Memory**: the bundled ClickHouse runs with a low-memory profile so a 4 GB VPS
  is enough. Estimate, not measured: the load test before the first release
  replaces this sentence with numbers.
- **Backups**: Postgres, ClickHouse and Garage (two volumes, metadata and
  data). The self-hosting docs document each; Valkey only holds data in transit.
- **Bring your own** Postgres keeps working (`DATABASE_URL`), and so does an
  external bucket for files (`STORAGE_*`). An external ClickHouse or Valkey
  (`CLICKHOUSE_URL`, `VALKEY_URL`) is allowed but not the default path.
- **Nothing is installed from the panel.** That would need the Docker socket,
  which is root on the server. Every store comes with the compose, and an
  external one is set in `.env`.

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
- TV mode (`/tv`) is a signed-in screen; its settings live in the address
  (`scope`, `m`, `per`, `sound`). A TV that is not signed in uses a private link
  (`/tv/<token>`, table `tv_link`): one per organization, the token is shown
  once and stored as a SHA-256 hash, and `/api/live?tv=<token>` streams the
  same events for that organization. The screen also reloads every 30 seconds,
  so its numbers move without any event.

### Errors

- The ingest reads Sentry events (envelopes, gzip or not, and the old
  `/store/`) and the same JSON from the Octadash script at `/o/v1/errors`, and
  queues one row per event on the `errors` stream with its fingerprint. Every
  other envelope item (sessions, transactions, check-ins, feedback, client
  reports, replays, attachments, and types an SDK starts sending later) goes
  to `received` as it came (see "Nothing received is thrown away"). PostHog's
  `$exception` is read as a Sentry event and joins the same issues.
- Grouping: the app's `fingerprint` wins (`{{ default }}` stands for the usual
  one). Otherwise the main exception's type and the app's own frames (module or
  file without the build hash, and function), or every frame when none is the
  app's; with no stack, the message with numbers, ids and addresses taken out.
  A new build or a moved line keeps the same issue.
- The worker groups each batch by product and fingerprint, finds or creates the
  issue in Postgres (`error_issue`, one transaction per issue, row locked) and
  writes every event to ClickHouse (`errors`, 90 days) with the issue's id.
  Each row also keeps the whole event as the SDK sent it, masked (`event`):
  contexts, extra, request, modules, `debug_meta` for source maps, frame
  variables, measurements. The other columns hold what the screens read today.
  A resolved issue comes back as Regressed with its next event; "Resolve in
  next release" keeps the release it was last seen in and comes back only with
  an event from another one. An ignored issue comes back when its condition
  (more events, more people, a date) is met.
- The person an error hit is the user the app sent (id, else e-mail, else
  name), or the browser's daily visitor hash marked `v:`. An e-mail or a
  document number is kept only as a hash marked `h:`; a plain user id is kept,
  because it finds the person's support case. The address is never stored.
- Error spike (`error_spike`): every minute the worker takes the products with
  an issue seen in the last 15 minutes (`error_issue.last_seen` is indexed) plus
  those with an open spike, and reads from ClickHouse, by the table's sort key,
  their errors in the last 15 minutes against the same hour on each of the last
  7 days scaled to 15 minutes. Ignored issues never count. It opens when the
  count reaches the rule's multiple of normal and its minimum (5× and 20 by
  default), names the top 3 issues, and closes when the last 15 minutes fall
  back under. The issues it names show "Spike" in the list.

### Product usage

- Events arrive in the Octadash format (`/o/v1/events`, the script's
  `track()`) or from PostHog SDKs (`/e/`, `/i/v0/e/`, `/batch/`, `/capture/`;
  JSON, gzip, or base64 in a form). `/flags/`, `/decide/` and
  `/array/<key>/config` answer with no flags and every extra of posthog-js off
  (autocapture, recordings, surveys), and `/static/*.js` sends the snippet to
  PostHog's CDN for the library. Events that are not product events
  (`$autocapture`, `$web_vitals`, `$set`, `/engage/` and others) go to
  `received`, masked, and `$exception` goes to Errors.
  Tested with posthog-js 1.x and posthog-node 5.x.
- Privacy at the door, for every event: `distinct_id` is stored as a hash of
  the product and the id, never as sent; the script's `identify(id)` and
  PostHog's `identify` both end there. Properties whose name says e-mail,
  phone, CPF, CNPJ, password, address and the like, or whose value looks like
  an e-mail or a document number, are dropped, as are PostHog's person
  properties (`$set`, `$set_once`) and the ids it repeats in properties.
- A product event is any event but page views; a person is the hashed id, else
  the visitor hash of the day. Sign-ups are the standard names
  (`signup.completed`, `signed_up` and the ones other tools use), with no
  setting. "Came back week 1" and the weekly cohorts count only identified
  people, since a visitor hash changes every day.
- Postgres keeps what people decide (`key_event`, `funnel`); ClickHouse keeps
  the events. Funnels use `windowFunnel` per person within the funnel's days.
- Key event stopped (`key_event_stopped`): every minute the worker reads, for
  each key event, when it last came and how many come per hour at this time of
  day (the same hour of the last 7 days). It opens when the silence passes the
  time the rule's `expected` events normally take (5 by default), never less
  than `silence` minutes (30); an event too rare at this hour (a wait over a
  day) never fires. It closes with the next event, not when the hour turns
  quiet; unmarking the key event closes it without a message.

### Logs

- Lines arrive over OpenTelemetry's OTLP/HTTP at `/v1/logs` (also
  `/otlp/v1/logs`), protobuf or JSON, gzip or not, with the source key in
  `x-octadash-key` or `Authorization: Bearer`. Protobuf is read by a small
  wire-format decoder (`apps/ingest/src/otlp.ts`), so the bundle needs no
  generated code. Tested with the OpenTelemetry JS exporters (proto and http).
- Sentry's own logs (envelope items of type `log`) are read into the same
  rows, so a Sentry SDK with logs turned on lands next to OTLP.
- Masking at the door: e-mails, card numbers (Luhn), CPF, CNPJ, SSN, bearer
  tokens, JWTs, private keys, well-known API key shapes, `password=` and
  `user:password@` are replaced in the message and in every attribute, and
  attributes named like a secret (password, token, authorization, cookie...)
  are masked whole. Each line keeps how many values were masked.
- ClickHouse `logs` keeps the message, the level (from the severity number,
  else the word Serilog, Python or pino send), `service.name`, trace and span
  ids, the line's attributes and the resource's. Each line carries its
  product's retention (`project_area.retention_days`, 14 days by default) and
  parts are cut by retention and day, so the TTL drops whole parts. Choosing a
  shorter retention deletes older lines at once.
- Search (`clickhouse/log-query.ts`), Seq-style: words and phrases search the
  message; `field:value`, `field>n`, `level>=warn`, `product:slug`,
  `trace:<id>`, `-` to negate, `*` as a wildcard. Every value travels as a
  query parameter.
- Errors keep the trace id Sentry SDKs send (`contexts.trace.trace_id`), so a
  log line finds its error and the other way round.
- Log alert (`log_alert`): a saved search (`log_search`) with Alert on runs
  every minute over the lines since it was turned on, at most the last hour.
  Each product with a match gets its own emergency; it closes after `silence`
  minutes (15) without a match. Deleting the search or turning Alert off
  closes it without a message.

### Money

- Gateways (`packages/integrations/src/money`): Stripe, Asaas and Paddle,
  each turning its charges and subscriptions into one shape (`MoneyPayment`,
  `MoneySubscription`, amounts in minor units, no conversion). Read-only by
  contract: only GET requests. Stripe is pinned to API version `2024-06-20`
  and refuses a secret key (`sk_`); a restricted key is asked for.
- A connection (`connection`) is one gateway account of the organization; its
  key and webhook secret are encrypted with `OCTADASH_SECRET`. Each product it
  serves (`connection_project`) picks its payments by a rule: the whole
  account, some gateway products, or a `product` metadata value (Asaas: the
  external reference). The most specific rule wins, so a shared account
  counts nothing twice; payments no rule picks are not stored.
- The worker (`money-sync`, every minute) imports 12 months for a new
  connection, then reads the last 3 days of payments every 5 minutes (so a
  late refund is seen) and lists subscriptions every hour. Webhooks reach the
  panel at `/hooks/<gateway>/<token>`, are checked (Stripe and Paddle
  signatures, Asaas access token) and stored at once; a failure answers 500 so
  the gateway sends it again.
- ClickHouse `payments` and `subscriptions` are ReplacingMergeTree by
  connection and id, read with FINAL: a payment sent again (paid, then
  refunded) replaces itself. Customers are kept as hashes. MRR at a moment is
  the sum of subscriptions started and not ended by then, without trials, at
  each subscription's current price.
- Exchange rates (`fx_rate`, every day filled) come from the European Central
  Bank through Frankfurter (`money-fx`, every 6 hours, no key). Totals convert
  each payment at the rate of its day into the organization's currency.
- Payments failing (`payments_failing`): every minute, per product, the
  charges of the last 15 minutes; it opens at `percent` (20) failed with at
  least `charges` (10) charges and closes when the share falls back under.

### Costs

- Providers (`packages/integrations/src/costs`): OpenAI (admin key, the
  organization costs report, daily buckets) and Anthropic (Admin API key, the
  cost analytics report, hourly buckets from yesterday on), each turning its
  report into one shape (`CostItem`: a stretch of time, the provider's tag,
  a line item and an amount in minor units with fractions). Read-only by
  contract. A fixed bill (a VPS, a domain) is a connection with no provider:
  `fixed_cost` holds the amount, currency and month or year, counted day by
  day when read.
- Cost connections share the `connection` table with payment gateways. Each
  product's part (`cost_share`) is the provider tags it claims (OpenAI
  projects, Anthropic workspaces) and whether it shares the rest; the
  connection's `split` divides the rest equally, by each product's traffic
  that day, or by fixed percents (`splitCost`). Division happens when reading,
  so a changed split applies to the whole history.
- The worker (`costs-sync`, every 5 minutes) imports 90 days for a new
  connection, then reads the last 3 days every hour, replacing them in
  `cost_day` so late corrections land. Spend per hour (`cost_hour`) comes from
  the provider's hours, or from the growth of today's total between reads.
  Costs are small, so they stay in Postgres.
- Cost runaway (`cost_runaway`): every 10 minutes, per product, its latest
  hour of AI spend against its average hour over the last 7 days; it opens at
  `times` (3) the normal and at least `dollars` (5) US dollars, and closes
  when an hour falls back under or after 6 hours without spend.
- `cost_budget` keeps a product's monthly budget in the organization's
  currency, with the percent at which the forecast warns.

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
OAuth, organizations, 2FA). The MCP server is `POST /api/mcp`: Streamable
HTTP answered with JSON (no stream, no session), small enough to need no SDK
(`apps/web/src/lib/mcp.ts`). It authenticates with an organization's API token
(`oct_...`, stored as a hash, revocable) whose scopes give each item (products,
sources, keys, monitors, alerts, each area, settings) no access, read or write,
with delete apart (`packages/db/src/token-scopes.ts`). Each tool in
`apps/web/src/server/mcp-tools.ts` declares the scopes it needs, and a token
sees only the tools it can use. Coding assistants get the `octadash-setup`
Agent Skill from the `octadash/skills` repository (MIT), also a Claude Code
plugin marketplace.

### Public docs

`apps/docs` is docs.octadash.com: Fumadocs on Next.js with static output,
served by nginx from its own image (`apps/docs/Dockerfile`, built from the
repository root) and deployed on its own, only when its files change. The main
image does not build it. It shares one package with the panel,
`packages/snippets`, the code people paste to send data, so Set up and the docs
show the same code. English pages have no prefix and Portuguese ones live under
`/pt`; a page without its `.pt.mdx` file shows the English text with a notice.
Search is a static index in the page, `llms.txt` and a Markdown copy of each
page serve people who install with an AI agent. Pages are not versioned until
1.0: a page says since which version something exists, and if an old
self-hosted version ever needs its own docs, its tag is published on a
subdomain.

### Install paths

- Docker Compose (`docker-compose.yml`), the main path.
- Coolify (`docker-compose.coolify.yml`, uses Coolify's generated passwords and
  domains). A template for Coolify's catalog follows.
- Prebuilt image `ghcr.io/octadash/octadash` with your own `DATABASE_URL`.
- Railway template (after the first release).
- From source: `pnpm install && pnpm build`.

Every role applies pending migrations on start (a lock makes parallel starts
safe), so upgrades are "pull the new image and restart".

### Traces

- Spans arrive over OTLP/HTTP at `/v1/traces` (also `/otlp/v1/traces`),
  protobuf or JSON, read by the same small decoder as logs
  (`apps/ingest/src/otlp-traces.ts`). Sentry transactions (the root span and
  its children) and standalone `span` items are read into the same shape, so
  a Sentry SDK with tracing on and an OpenTelemetry SDK land in one table.
  What a transaction carries that is not a span (request, user, contexts,
  breadcrumbs) goes to `received` without its span list.
- The worker writes them to ClickHouse `spans`, in OpenTelemetry's shape
  (trace and span ids, parent, kind, status, attributes, resource, events and
  links), masked like logs. Kept 14 days (`OCTADASH_TRACE_RETENTION_DAYS`)
  until each product has its own setting. Errors and log lines already carry
  the trace id that finds them.
- A span with no valid trace or span id belongs to no trace: OTLP answers it
  as rejected, and a Sentry one leaves a `dropped:` count.
- There is no Traces screen yet; the data is kept so the screen starts with
  history.

### Metrics

- Data points arrive over OTLP/HTTP at `/v1/metrics` (also
  `/otlp/v1/metrics`), protobuf or JSON (`apps/ingest/src/otlp-metrics.ts`).
  Every type is read whole: gauges and sums, histograms with their buckets,
  exponential histograms and summaries, and exemplars, which link a point to
  the trace it came from.
- The worker writes them to ClickHouse `metrics`, one row per point: gauges
  and sums in `value`, histograms in `count`, `sum`, `min`, `max` and their
  buckets, the rest in `extra` (JSON). Attributes are masked like logs. Kept
  30 days (`OCTADASH_METRIC_RETENTION_DAYS`) until each product has its own
  setting. There is no Metrics screen yet.

### Uptime facts and heartbeat output

- Each check row keeps what the check learned besides up or down: the address
  the name resolved to, the final URL and every redirect, whether http sends
  people to https and who issued the certificate (deeper checks), and, when
  the check failed, what the server answered (`detail`: its headers without
  cookies and the first KB of the body).
- A heartbeat ping sent by POST carries the job's output (`curl --data-binary
  @backup.log`). It is kept with the ping, masked, up to its last 100,000
  characters, and lands in `detail` of the ping's row.

### Nothing received is thrown away

Data that reaches the ingest and could ever be useful is kept, even when no
screen reads it yet: the area that comes later starts with its history.

- What an area reads goes to that area's stream (`events`, `errors`, `logs`).
- What no area reads yet goes to the `received` stream and the ClickHouse
  table `received`, as it came: one row per item with its `kind`
  (`sentry.session`, `posthog.$autocapture`), the body as JSON, text or base64,
  and the masked values counted. Kept 30 days (`OCTADASH_RECEIVED_RETENTION_DAYS`).
- A kind nobody has seen before is kept there by default. The default is keep,
  not drop.
- Masking still applies (`apps/ingest/src/received.ts`): secrets and personal
  fields by name, a person's name inside a person object, e-mails, documents,
  cards and keys inside any text, and ids of a person replaced by the
  product's hash.
- Leaving data out is the exception. Every case is in `DISCARDS`
  (`apps/ingest/src/fates.ts`) with its reason, and the ones taken with a 200
  answer leave a `dropped:<kind>` row in `received` with the count, so nothing
  goes missing silently. Today: personal data (masked), areas marked "I won't
  use this" (counted on the card), error events beyond the limit of one
  request, and, only when file storage is missing, down or full, files.
- Files (replays, attachments, profiles, anything over 1 MB) go to file
  storage, whole (see Garage above).
- `fates.test.ts` fails when a route has no entry in `ROUTES`, or when any
  Sentry item type or PostHog event stops reaching a stream.

### Getting data in: compatible formats and own SDKs

The ingest accepts the formats people already send, so an existing app moves by
changing one URL:

- Sentry envelopes (`/api/:id/envelope/`) for errors, from any Sentry SDK.
- PostHog capture (`/e/`, `/i/v0/e/`, `/batch/`, `/capture/`) for events;
  `$ai_generation` and the newer `/i/v1/...` endpoints come with their areas.
- OTLP over HTTP (`/v1/logs`, `/v1/traces`, `/v1/metrics`) for logs, traces and
  `gen_ai` spans. All three are kept.

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

Keys from before sources (product keys) became a source named "Main" in
migration 0017, so every key belongs to a source; the keys did not change. A
new product starts with no key: its sources, and their keys, come from each
area's setup or from Product settings › Sources.

A product's address follows its name. Renaming keeps the old address in
`project_slug_alias`, so links and bookmarks keep working; a product that takes
the address later wins over the old one.

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
up instead. The checks that were reliable (certificate, HTTP to HTTPS redirect)
moved into uptime. Security headers, SPF and DMARC are not built yet: they go to
the Security area in the backlog ([product.md](product.md#security-new-area)).

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
