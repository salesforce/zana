#!/usr/bin/env bash
# Attach a Linux host-daemon container to the product server already running
# on this machine (pnpm dev). The container stays up for manual UI testing
# (Settings → Machines, new project / thread host picker). Ctrl+C stops it.
#
# Product HTTP stays on 127.0.0.1. A throwaway TCP proxy on 0.0.0.0 is only so
# Docker Desktop can reach loopback — the same role Tailscale Serve plays on a
# real tailnet.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SERVER_PORT=${ZCC_SERVER_PORT:-8780}
PROXY_PORT=${ZCC_HOST_DAEMON_PROXY_PORT:-18781}
IMAGE=${ZCC_HOST_DAEMON_IMAGE:-node:22-bookworm}
CONTAINER=${ZCC_HOST_DAEMON_NAME:-zcc-host-daemon}
HOSTNAME_LABEL=${ZCC_HOST_DAEMON_HOSTNAME:-zcc-docker}
JOIN_CODE=${JOIN_CODE:-}
HOST_ID=${HOST_ID:-}
KEEP_PUBLIC_URL=${ZCC_KEEP_PUBLIC_URL:-0}
PUBLIC_URL="http://host.docker.internal:${PROXY_PORT}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Run a host-daemon in Docker against the Zana server already listening on
loopback (default http://127.0.0.1:${SERVER_PORT}). Requires \`pnpm dev\`.

Options:
  --join-code CODE   Use a code from Settings → Machines → Add machine
  --host-id ID       Host id from that dialog (required with --join-code)
  --server-port N    Product server port (default ${SERVER_PORT})
  --proxy-port N     Port Docker uses to reach the server (default ${PROXY_PORT})
  --name NAME        Container name (default ${CONTAINER})
  -h, --help         Show this help

Environment:
  JOIN_CODE / HOST_ID     Same as --join-code / --host-id
  ZCC_KEEP_PUBLIC_URL=1   Leave Public app URL pointed at the Docker proxy
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --join-code) JOIN_CODE=${2:-}; shift 2 ;;
    --host-id) HOST_ID=${2:-}; shift 2 ;;
    --server-port) SERVER_PORT=${2:-}; shift 2 ;;
    --proxy-port) PROXY_PORT=${2:-}; PUBLIC_URL="http://host.docker.internal:${PROXY_PORT}"; shift 2 ;;
    --name) CONTAINER=${2:-}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -n "$JOIN_CODE" && -z "$HOST_ID" ]]; then
  printf '--host-id is required when --join-code is set\n' >&2
  exit 2
fi
if [[ -n "$HOST_ID" && -z "$JOIN_CODE" ]]; then
  printf '--join-code is required when --host-id is set\n' >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker is required. Install and start Docker Desktop, then retry.\n' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf 'Docker daemon is not available. Start Docker Desktop, then retry.\n' >&2
  exit 1
fi

if ! curl -sf "http://127.0.0.1:${SERVER_PORT}/api/v1/health" >/dev/null; then
  printf 'No product server on http://127.0.0.1:%s — start `pnpm dev` first.\n' "$SERVER_PORT" >&2
  exit 1
fi

PROXY_PID=""
PREV_PUBLIC_URL=""
DID_PATCH_URL=0
cleanup() {
  if [[ -n "$CONTAINER" ]]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  if [[ -n "$PROXY_PID" ]]; then
    kill "$PROXY_PID" >/dev/null 2>&1 || true
  fi
  if [[ "$DID_PATCH_URL" = 1 && "$KEEP_PUBLIC_URL" != 1 ]]; then
    body=$(PREV="$PREV_PUBLIC_URL" node --input-type=module -e '
      const prev = process.env.PREV ?? "";
      process.stdout.write(JSON.stringify({ publicAppUrl: prev.length > 0 ? prev : "" }));
    ')
    curl -sf -X PATCH "http://127.0.0.1:${SERVER_PORT}/api/v1/config" \
      -H 'content-type: application/json' \
      -d "$body" >/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

node --input-type=module -e "
import net from 'node:net';
const proxy = net.createServer((client) => {
  const upstream = net.connect(${SERVER_PORT}, '127.0.0.1');
  client.pipe(upstream);
  upstream.pipe(client);
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
});
proxy.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
proxy.listen(${PROXY_PORT}, '0.0.0.0', () => {
  process.stdout.write('proxy listening on 0.0.0.0:${PROXY_PORT}\n');
});
" &
PROXY_PID=$!
sleep 0.3
if ! kill -0 "$PROXY_PID" 2>/dev/null; then
  printf 'could not bind the Docker proxy on port %s\n' "$PROXY_PORT" >&2
  exit 1
fi

curl_json() {
  local method=$1 url=$2 data=${3-}
  local body status
  local tmp
  tmp=$(mktemp)
  if [[ -n "$data" ]]; then
    status=$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$url" \
      -H 'content-type: application/json' -d "$data" || true)
  else
    status=$(curl -sS -o "$tmp" -w '%{http_code}' "$url" || true)
  fi
  body=$(cat "$tmp")
  rm -f "$tmp"
  if [[ "$status" != 2* ]]; then
    printf '%s %s failed: HTTP %s\n%s\n' "$method" "$url" "$status" "$body" >&2
    if [[ "$url" == *'/api/v1/hosts/'* && "$status" == 404 ]]; then
      printf 'Restart `pnpm dev` so the product server loads the hosts/join-codes API.\n' >&2
    fi
    exit 22
  fi
  printf '%s' "$body"
}

config_json=$(curl_json GET "http://127.0.0.1:${SERVER_PORT}/api/v1/config")
PREV_PUBLIC_URL=$(node -e '
  const config = JSON.parse(process.argv[1]).config ?? {};
  process.stdout.write(typeof config.publicAppUrl === "string" ? config.publicAppUrl : "");
' "$config_json")
if [[ "$PREV_PUBLIC_URL" != "$PUBLIC_URL" ]]; then
  curl_json PATCH "http://127.0.0.1:${SERVER_PORT}/api/v1/config" \
    "$(node -e 'process.stdout.write(JSON.stringify({ publicAppUrl: process.argv[1] }))' "$PUBLIC_URL")" \
    >/dev/null
  DID_PATCH_URL=1
fi

if [[ -z "$JOIN_CODE" ]]; then
  mint=$(curl_json POST "http://127.0.0.1:${SERVER_PORT}/api/v1/hosts/join-codes" '{}')
  JOIN_CODE=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).joinCode)' "$mint")
  HOST_ID=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).hostId)' "$mint")
fi

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
printf 'Starting %s (hostname %s) → %s\n' "$CONTAINER" "$HOSTNAME_LABEL" "$PUBLIC_URL"
printf 'host id: %s\n' "$HOST_ID"

docker run -d \
  --name "$CONTAINER" \
  --hostname "$HOSTNAME_LABEL" \
  --add-host=host.docker.internal:host-gateway \
  -e SERVER="$PUBLIC_URL" \
  -e JOIN_CODE="$JOIN_CODE" \
  -e HOST_ID="$HOST_ID" \
  "$IMAGE" \
  bash -lc '
set -euo pipefail
command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null; }
mkdir -p /workspace
printf "Zana Docker host-daemon workspace\n" > /workspace/README.txt
curl -fL "$SERVER/install.sh" -o /tmp/install.sh
export ZCC_INSTALL_SKIP_SERVICE=1 ZCC_INSTALL_WAIT_ATTEMPTS=40 ZCC_INSTALL_WAIT_DELAY=0.5
exec sh /tmp/install.sh --join-code "$JOIN_CODE" --host-id "$HOST_ID" --server "$SERVER"
' >/dev/null

deadline=$((SECONDS + 90))
until docker logs "$CONTAINER" 2>&1 | grep -q "Connected (service install skipped)."; do
  if [[ $SECONDS -ge $deadline ]]; then
    printf 'installer did not report connected\n' >&2
    docker logs "$CONTAINER" >&2 || true
    exit 1
  fi
  if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
    printf 'host-daemon container exited before connecting\n' >&2
    docker logs "$CONTAINER" >&2 || true
    exit 1
  fi
  sleep 0.4
done

cat <<EOF

Host daemon is connected.

  Settings → Machines should show "${HOSTNAME_LABEL}" (id ${HOST_ID}) as online.
  New project / new thread can pick that machine.

  logs:    docker logs -f ${CONTAINER}
  shell:   docker exec -it ${CONTAINER} bash
  stop:    Ctrl+C  (or docker rm -f ${CONTAINER})

EOF

docker logs -f "$CONTAINER"
