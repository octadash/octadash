# Self-hosting

Octadash is one Docker image with three roles (`web`, `ingest`, `worker`) and
four stores it installs and manages: Postgres (records), Valkey (the queue
between ingest and worker), ClickHouse (events and charts) and Garage (files:
attachments, replays, profiles). Octadash creates their databases and bucket,
runs their migrations and sets their retention; you never open ClickHouse,
Valkey or Garage. Pick the path that fits you.

Until the first release, use the `edge` image tag (built from `main`).

## Requirements

- **Memory:** 4 GB is the target for a small install (all four stores and the
  three roles on one machine). This is an estimate; the load test before the
  first release replaces it with measured numbers.
- **CPU:** on x86 servers, ClickHouse's official image needs the **x86-64-v3**
  level (AVX2, BMI2, FMA: practically every Intel and AMD CPU since 2015). arm64
  servers work. Check before installing:

  ```bash
  grep -o -m1 avx2 /proc/cpuinfo || echo "no AVX2: ClickHouse will not start on this CPU"
  ```

  Without it the `clickhouse` container restarts in a loop, and `web` and
  `worker` log "ClickHouse did not answer ... its CPU probably lacks AVX2". Some
  cheap VPS plans expose an older virtual CPU model even on new hardware; the
  provider can usually switch it to "host" CPU.
- **Disk:** ClickHouse compresses events well, but plan for growth and keep at
  least a few GB free. Files (attachments, replays, profiles) use at most
  `OCTADASH_STORAGE_LIMIT_GB`, 20 GB by default; past it the oldest day goes
  first. Leave room for both, or point files to an external bucket (below).

## Docker Compose

```bash
git clone https://github.com/octadash/octadash.git
cd octadash
./scripts/generate-env.sh   # copies .env.example to .env and generates every password
docker compose up -d
```

The panel listens on port 3000 and the ingest service on port 4000. In
production, put a reverse proxy with HTTPS in front of both (Caddy, Traefik,
Nginx) and set `OCTADASH_URL` and `OCTADASH_INGEST_URL` to the public addresses.

## Coolify

1. In your project, **+ New** > **Public Repository** >
   `https://github.com/octadash/octadash`.
2. Build pack: **Docker Compose**. Docker Compose Location:
   `/docker-compose.coolify.yml`.
3. Deploy. Coolify generates every password (Postgres, ClickHouse, Valkey,
   Garage), the secret and one domain for the panel (`web`) and one for the
   ingest service (`ingest`). Change the domains under **Domains** if you want
   your own.

## Prebuilt image with your own stores

Postgres can be Neon, Supabase, RDS or any Postgres 16+. ClickHouse (26.8 or
newer, HTTP port) and Valkey (or Redis 7+) can be external too, but the bundled
ones in the compose files are the supported path.

```bash
docker run -d --name octadash-web -p 3000:3000 \
  -e DATABASE_URL=postgres://... \
  -e CLICKHOUSE_URL=http://user:pass@clickhouse.example.com:8123/octadash \
  -e VALKEY_URL=redis://:pass@valkey.example.com:6379 \
  -e OCTADASH_URL=https://octadash.example.com \
  -e OCTADASH_INGEST_URL=https://ingest.example.com \
  -e OCTADASH_SECRET=... \
  ghcr.io/octadash/octadash:edge web
```

Run the same image with `ingest` (port 4000) and `worker` as the command, with
the same `VALKEY_URL`. The worker also needs `OCTADASH_URL` (links in alerts)
and the same `OCTADASH_SECRET` as the panel (it decrypts the alert channels).

## From source

Requires Node.js 22.12+ (24 recommended), pnpm 10, Postgres 16+, ClickHouse
26.8+ and Valkey 8+ (`pnpm db:up` starts all three with Docker).

```bash
pnpm install
pnpm build
DATABASE_URL=postgres://... CLICKHOUSE_URL=http://... pnpm db:migrate
```

Then start `apps/web` (`pnpm --filter @octadash/web start`), `apps/ingest` and
`apps/worker` (`node dist/index.js` in each).

## Environment variables

| Variable                           | Used by        | Description                                                                                                                                                                                                                                 |
| ---------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                     | all            | Postgres connection string                                                                                                                                                                                                                  |
| `OCTADASH_URL`                     | web, worker    | Public URL of the panel                                                                                                                                                                                                                     |
| `OCTADASH_INGEST_URL`              | web            | Public URL of the ingest service                                                                                                                                                                                                            |
| `OCTADASH_SECRET`                  | web, worker    | At least 32 characters; signs sessions, encrypts secrets                                                                                                                                                                                    |
| `OCTADASH_OPEN_SIGNUP`             | web            | `false` by default: only the owner and invited people                                                                                                                                                                                       |
| `LOG_LEVEL`                        | all            | `info` by default                                                                                                                                                                                                                           |
| `PORT`                             | web, ingest    | 3000 for web, 4000 for ingest                                                                                                                                                                                                               |
| `WORKER_HEALTH_PORT`               | worker         | Internal health endpoint, 4100 by default                                                                                                                                                                                                   |
| `OCTADASH_MIGRATE_ON_START`        | all            | `true` by default; migrations run before each role starts                                                                                                                                                                                   |
| `OCTADASH_UPTIME_REFERENCE_URLS`   | worker         | Comma-separated addresses that prove the server is online (Google and Cloudflare by default). Before calling a monitor down the worker reaches one of them, so a network failure on the Octadash server does not read as every product down |
| `OCTADASH_RECEIVED_RETENTION_DAYS` | worker         | Days to keep data no area reads yet (Sentry sessions, check-ins and feedback, PostHog autocapture and profile updates). 30 by default                                                                                                       |
| `OCTADASH_TRACE_RETENTION_DAYS`    | worker         | Days to keep spans from OpenTelemetry traces and Sentry transactions. 14 by default                                                                                                                                                         |
| `OCTADASH_METRIC_RETENTION_DAYS`   | worker         | Days to keep metric data points sent over OpenTelemetry. 30 by default                                                                                                                                                                      |
| `OCTADASH_STORAGE_LIMIT_GB`        | worker         | Most space files may use (20 by default, 0 for no limit). See [File storage](#file-storage)                                                                                                                                                 |
| `STORAGE_*`                        | ingest, worker | Where files are kept. See [File storage](#file-storage)                                                                                                                                                                                     |
| `OCTADASH_UPTIME_ALLOW_PRIVATE`    | worker         | `false` by default. `true` lets monitors check private addresses (localhost, 10.x); for development                                                                                                                                         |

## File storage

Attachments, replays, profiles and anything over 1 MB are kept as files. The
compose runs Garage for them, with its key and bucket made from `.env` on the
first start. **Settings** > **File storage** shows whether it answers and how
much space it uses.

| Variable                    | Default              | What it does                                                                     |
| --------------------------- | -------------------- | -------------------------------------------------------------------------------- |
| `OCTADASH_STORAGE_LIMIT_GB` | `20`                 | Most space files may use. Past it the oldest day is removed first. `0`: no limit |
| `STORAGE_ENDPOINT`          | `http://garage:3900` | The bucket's S3 address                                                          |
| `STORAGE_BUCKET`            | `octadash`           | Bucket name                                                                      |
| `STORAGE_REGION`            | `garage`             | `auto` for R2, the bucket's region for S3                                        |
| `STORAGE_ACCESS_KEY_ID`     | generated            | Key id (`GK...` for the bundled Garage)                                          |
| `STORAGE_SECRET_ACCESS_KEY` | generated            | Secret key                                                                       |
| `GARAGE_RPC_SECRET`         | generated            | Internal secret of the bundled Garage                                            |

Files are kept as long as `OCTADASH_RECEIVED_RETENTION_DAYS` (30 days by
default).

**External bucket.** To keep files in S3, R2 or another S3-compatible store,
create a bucket and a key that can read, write, list and delete in it, and set
the five `STORAGE_*` values in `.env` (for R2: `STORAGE_ENDPOINT=https://<account
id>.r2.cloudflarestorage.com`, `STORAGE_REGION=auto`). Restart. Files already in
Garage stay there; copy them over with `rclone` if you need them. You may then
remove the `garage` service from your compose. On Coolify, set the same values
in the `ingest` and `worker` environment.

## First run

Open the panel. The first visit shows a setup form that creates the owner
account and the organization. After that, sign-up is closed: the owner invites
people from **Members**, which generates a link to send them.

## Outside watcher

If the server running Octadash goes down, no alert goes out. Set up an outside
watcher so someone is told:

1. Create a free account on [Healthchecks.io](https://healthchecks.io) (or run
   your own Healthchecks).
2. Create a check with a 1 minute period and a 5 minute grace time, and choose
   where it alerts you (email, Telegram) on a channel that does not depend on
   this server.
3. In Octadash, **Settings** > **Outside watcher**, paste the check's ping URL.
   Octadash pings it once to test it and then every minute from the worker.

Until this is done, every settings page shows a warning, in red when a monitor
runs on the same server as Octadash. Any URL that answers 2xx to a GET works,
so other heartbeat services do too.

## Health checks

`GET /api/health` (web), `GET /health` (ingest) and `GET :4100/health` (worker)
answer without touching the database, so probes never keep a serverless
Postgres awake.

## How data flows

The ingest checks the key, appends the batch to a Valkey stream and answers
`202` at once; it never waits on ClickHouse. The worker reads the streams, writes
to ClickHouse in batches and deletes an entry only after the write. So:

- ClickHouse down or slow: the ingest keeps accepting, Valkey holds the data and
  the worker catches up when ClickHouse is back. Charts are late, nothing is lost.
- Worker far behind (more than `OCTADASH_INGEST_QUEUE_MAX` entries waiting): the
  ingest answers `429` with `Retry-After`, and SDKs retry later, instead of
  filling the disk.
- Valkey down: the ingest answers `503` and SDKs retry.

## Backups

The compose files keep data in five volumes:

| Volume            | Holds                                       | Back up                                    |
| ----------------- | ------------------------------------------- | ------------------------------------------ |
| `postgres-data`   | accounts, products, keys, alert rules       | yes: `pg_dump` (below) or volume snapshots |
| `clickhouse-data` | events, errors, logs, charts                | yes: `BACKUP` (below) or volume snapshots  |
| `garage-meta`     | the list of files and where their parts are | yes, together with `garage-data` (below)   |
| `garage-data`     | the files (attachments, replays, profiles)  | yes, together with `garage-meta` (below)   |
| `valkey-data`     | data in transit between ingest and worker   | no: it empties itself within seconds       |

Postgres, from the directory with `docker-compose.yml`:

```bash
docker compose exec -T postgres pg_dump -U octadash -Fc octadash > octadash-postgres.dump
```

ClickHouse, into `/var/lib/clickhouse/backups` inside the `clickhouse-data`
volume (copy the file off the machine after):

```bash
set -a; . ./.env; set +a   # loads CLICKHOUSE_PASSWORD
docker compose exec clickhouse clickhouse-client --user octadash --password "$CLICKHOUSE_PASSWORD" \
  --query "BACKUP DATABASE octadash TO File('octadash-$(date +%F).zip')"
```

Garage: take a clean copy of its metadata, then copy both volumes (it also
takes one by itself every 6 hours, kept in `garage-meta/snapshots`):

```bash
docker compose exec garage /garage meta snapshot
docker run --rm -v octadash_garage-meta:/meta -v octadash_garage-data:/data -v "$PWD":/out \
  alpine tar czf /out/octadash-garage-$(date +%F).tgz /meta /data
```

`File()` paths are relative to that folder, which the bundled config allows
(`docker/clickhouse/octadash.xml`). On Coolify, run the
same commands on the server with `docker exec` on each container, or snapshot
the volumes with your provider. Restoring is the reverse: `pg_restore` and
`RESTORE DATABASE octadash FROM File(...)` on a fresh install of the same
version.

## Upgrading

Pull the new image and restart. Each role applies pending migrations on start,
for Postgres and ClickHouse. ClickHouse, Valkey and Garage versions are pinned
in the compose files and move only with Octadash releases.

From a version without file storage: pull the repository, run
`./scripts/generate-env.sh` again (it adds `GARAGE_RPC_SECRET`,
`STORAGE_ACCESS_KEY_ID` and `STORAGE_SECRET_ACCESS_KEY` to your `.env` and keeps
everything else), then `docker compose up -d`.
