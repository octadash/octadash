# syntax=docker/dockerfile:1.7
# One image, several roles: `web`, `ingest`, `worker`, `migrate` (see docker/entrypoint.sh).

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# The docs are their own app with their own image (apps/docs/Dockerfile).
RUN pnpm turbo run build --filter=!@octadash/docs

FROM node:24-bookworm-slim AS runtime
ARG OCTADASH_VERSION=0.0.0-dev
ARG OCTADASH_COMMIT=
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    OCTADASH_VERSION=$OCTADASH_VERSION \
    OCTADASH_COMMIT=$OCTADASH_COMMIT
WORKDIR /app

# web: Next.js standalone server (brings its own minimal node_modules)
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./web
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./web/apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./web/apps/web/public
# ingest and worker: single-file bundles, no node_modules needed
COPY --from=build --chown=node:node /repo/apps/ingest/dist ./ingest
COPY --from=build --chown=node:node /repo/apps/worker/dist ./worker
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/octadash

USER node
EXPOSE 3000 4000
ENTRYPOINT ["octadash"]
CMD ["web"]
