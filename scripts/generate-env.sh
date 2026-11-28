#!/bin/sh
# Creates .env from .env.example and fills every empty password and the secret
# with random values. Safe to run again: values already set are kept, and a
# .env from an older version gets the lines it lacks.
set -e
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env
# A last line without a newline would swallow a line added below.
[ -z "$(tail -c1 .env)" ] || echo >>.env

fill() {
  name="$1"
  value="$2"
  grep -q "^$name=" .env || echo "$name=" >>.env
  if grep -q "^$name=$" .env; then
    # | as the separator: base64 and hex values never contain it.
    sed -i.bak "s|^$name=$|$name=$value|" .env && rm -f .env.bak
    echo "generated $name"
  fi
}

fill POSTGRES_PASSWORD "$(openssl rand -hex 24)"
fill CLICKHOUSE_PASSWORD "$(openssl rand -hex 24)"
fill VALKEY_PASSWORD "$(openssl rand -hex 24)"
fill OCTADASH_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
echo ".env is ready. Set OCTADASH_URL and OCTADASH_INGEST_URL to your public addresses."
