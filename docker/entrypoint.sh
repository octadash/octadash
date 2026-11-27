#!/bin/sh
# Starts one Octadash role. Every role applies pending migrations first
# (safe to run in parallel); set OCTADASH_MIGRATE_ON_START=false to skip.
set -e

role="${1:-web}"

migrate() {
  if [ "${OCTADASH_MIGRATE_ON_START:-true}" = "true" ]; then
    node /app/worker/migrate.js
  fi
}

case "$role" in
  web)
    migrate
    cd /app/web
    export HOSTNAME=0.0.0.0 PORT="${PORT:-3000}"
    exec node apps/web/server.js
    ;;
  ingest)
    migrate
    exec node /app/ingest/index.js
    ;;
  worker)
    migrate
    exec node /app/worker/index.js
    ;;
  migrate)
    exec node /app/worker/migrate.js
    ;;
  *)
    exec "$@"
    ;;
esac
