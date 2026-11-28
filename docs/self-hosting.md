# Self-hosting

Octadash is one Docker image with three roles (`web`, `ingest`, `worker`) and a
Postgres database. Pick the path that fits you.

Until the first release, use the `edge` image tag (built from `main`).

## Docker Compose

```bash
git clone https://github.com/octadash/octadash.git
cd octadash
cp .env.example .env
# fill POSTGRES_PASSWORD (openssl rand -hex 24) and OCTADASH_SECRET (openssl rand -base64 48)
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
3. Deploy. Coolify generates the database credentials, the secret and one
   domain for the panel (`web`) and one for the ingest service (`ingest`).
   Change them under **Domains** if you want your own.

## Prebuilt image with your own Postgres

Works with Neon, Supabase, RDS or any Postgres 16+.

```bash
docker run -d --name octadash-web -p 3000:3000 \
  -e DATABASE_URL=postgres://... \
  -e OCTADASH_URL=https://octadash.example.com \
  -e OCTADASH_INGEST_URL=https://ingest.example.com \
  -e OCTADASH_SECRET=... \
  ghcr.io/octadash/octadash:edge web
```

Run the same image with `ingest` (port 4000) and `worker` as the command.

## From source

Requires Node.js 22.12+ (24 recommended), pnpm 10 and Postgres 16+.

```bash
pnpm install
pnpm build
DATABASE_URL=postgres://... pnpm db:migrate
```

Then start `apps/web` (`pnpm --filter @octadash/web start`), `apps/ingest` and
`apps/worker` (`node dist/index.js` in each).

## Environment variables

| Variable                    | Used by     | Description                                               |
| --------------------------- | ----------- | --------------------------------------------------------- |
| `DATABASE_URL`              | all         | Postgres connection string                                |
| `OCTADASH_URL`              | web         | Public URL of the panel                                   |
| `OCTADASH_INGEST_URL`       | web         | Public URL of the ingest service                          |
| `OCTADASH_SECRET`           | web, worker | At least 32 characters; signs sessions, encrypts secrets  |
| `OCTADASH_OPEN_SIGNUP`      | web         | `false` by default: only the owner and invited people     |
| `LOG_LEVEL`                 | all         | `info` by default                                         |
| `PORT`                      | web, ingest | 3000 for web, 4000 for ingest                             |
| `WORKER_HEALTH_PORT`        | worker      | Internal health endpoint, 4100 by default                 |
| `OCTADASH_MIGRATE_ON_START` | all         | `true` by default; migrations run before each role starts |

## First run

Open the panel. The first visit shows a setup form that creates the owner
account and the organization. After that, sign-up is closed: the owner invites
people from **Members**, which generates a link to send them.

## Health checks

`GET /api/health` (web), `GET /health` (ingest) and `GET :4100/health` (worker)
answer without touching the database, so probes never keep a serverless
Postgres awake.

## Upgrading

Pull the new image and restart. Each role applies pending migrations on start.
