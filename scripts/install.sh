#!/bin/sh
# Octadash installer: https://docs.octadash.com/install
#
#   curl -fsSL https://docs.octadash.com/install.sh | sh
#
# Does the same as the step-by-step guide, in order:
#   1. checks the server (Docker, Docker Compose, git, openssl, CPU with AVX2, memory)
#   2. downloads Octadash into ./octadash (or updates it, if it is already there)
#   3. creates .env with every password and the secret (scripts/generate-env.sh)
#   4. writes your public addresses to .env, if you pass them
#   5. starts everything with docker compose and waits for the panel
#
# Options, as environment variables:
#   OCTADASH_DIR=/opt/octadash                      where to install (default ./octadash)
#   OCTADASH_URL=https://octadash.example.com       public address of the panel
#   OCTADASH_INGEST_URL=https://ingest.example.com  public address of the ingest
#
# Running it again is safe: passwords already in .env are kept.
set -eu

# Everything runs inside main, called on the last line, so a download cut in
# the middle never runs half a script.
main() {
  dir="${OCTADASH_DIR:-octadash}"
  repo="${OCTADASH_REPO:-https://github.com/octadash/octadash.git}"

  step "1/5 Checking this server"
  need docker "Install Docker first: https://docs.docker.com/engine/install/"
  docker compose version >/dev/null 2>&1 ||
    fail "Docker Compose v2 is missing (the 'docker compose' command). https://docs.docker.com/compose/install/"
  docker info >/dev/null 2>&1 ||
    fail "Docker is installed, but this user cannot use it. Run the installer with sudo, or add the user to the docker group."
  need git "Install git first (for example: apt install git)."
  need openssl "Install openssl first (for example: apt install openssl)."
  case "$(uname -m)" in
    x86_64 | amd64)
      if [ -r /proc/cpuinfo ] && ! grep -q -m1 avx2 /proc/cpuinfo; then
        fail "This CPU has no AVX2, so ClickHouse cannot start on it. Ask your provider for the 'host' CPU model, or use an arm64 server. https://docs.octadash.com/self-hosting#requirements"
      fi
      ;;
  esac
  if [ -r /proc/meminfo ]; then
    mb=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)
    if [ "$mb" -lt 3500 ]; then
      warn "This server has ${mb} MB of memory. 4 GB is the target; with less, the stores may be killed for lack of memory."
    fi
  fi
  ok "Server ready"

  step "2/5 Downloading Octadash into $dir"
  if [ -d "$dir/.git" ]; then
    git -C "$dir" pull --ff-only --quiet
    ok "Updated the copy already in $dir"
  elif [ -e "$dir" ]; then
    fail "$dir already exists and is not an Octadash copy. Pick another folder with OCTADASH_DIR=/path."
  else
    git clone --quiet --depth 1 "$repo" "$dir"
    ok "Downloaded"
  fi
  cd "$dir"

  step "3/5 Creating .env with every password"
  sh ./scripts/generate-env.sh >/dev/null
  ok ".env ready (passwords already there were kept)"

  step "4/5 Public addresses"
  if [ -n "${OCTADASH_URL:-}" ]; then set_env OCTADASH_URL "$OCTADASH_URL"; fi
  if [ -n "${OCTADASH_INGEST_URL:-}" ]; then set_env OCTADASH_INGEST_URL "$OCTADASH_INGEST_URL"; fi
  panel=$(sed -n 's/^OCTADASH_URL=//p' .env)
  ingest=$(sed -n 's/^OCTADASH_INGEST_URL=//p' .env)
  ok "Panel: $panel"
  ok "Ingest: $ingest"

  step "5/5 Starting Octadash"
  docker compose up -d --quiet-pull
  if command -v curl >/dev/null 2>&1; then
    port=$(sed -n 's/^WEB_PORT=//p' .env)
    i=0
    until curl -fsS "http://127.0.0.1:${port:-3000}/api/health" >/dev/null 2>&1; do
      i=$((i + 1))
      if [ "$i" -gt 60 ]; then
        warn "The panel did not answer in 2 minutes. See what is happening with: cd $dir && docker compose logs web"
        break
      fi
      sleep 2
    done
    [ "$i" -gt 60 ] || ok "Panel answering"
  fi

  printf '\n%sOctadash is running.%s\n\n' "$bold" "$reset"
  printf '  Open %s to create the owner account.\n' "$panel"
  printf '  For production, put HTTPS in front of the panel (port 3000) and the ingest (port 4000):\n'
  printf '  https://docs.octadash.com/self-hosting/docker-compose\n\n'
}

# Replaces NAME=... in .env, or adds it. | as the sed separator: URLs never contain it.
set_env() {
  if grep -q "^$1=" .env; then
    sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak
  else
    echo "$1=$2" >>.env
  fi
}

if [ -t 1 ]; then
  bold=$(printf '\033[1m') dim=$(printf '\033[2m') red=$(printf '\033[31m') yellow=$(printf '\033[33m') green=$(printf '\033[32m') reset=$(printf '\033[0m')
else
  bold='' dim='' red='' yellow='' green='' reset=''
fi
step() { printf '\n%s%s%s\n' "$bold" "$1" "$reset"; }
ok() { printf '  %s✓%s %s\n' "$green" "$reset" "$1"; }
warn() { printf '  %s!%s %s\n' "$yellow" "$reset" "$1" >&2; }
fail() {
  printf '  %s✗ %s%s\n' "$red" "$1" "$reset" >&2
  exit 1
}
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 not found. $2"; }

main "$@"
