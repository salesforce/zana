#!/usr/bin/env bash
# Prove a Linux container can download /install.sh, enroll with a join code,
# and show up as connected on GET /api/v1/hosts.
#
# Product HTTP stays on 127.0.0.1. A throwaway TCP proxy on 0.0.0.0 is only for
# this test so Docker Desktop can reach the loopback server (same role Tailscale
# Serve plays on a real tailnet).
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SERVER_PORT=${ZCC_MACHINE_JOIN_SERVER_PORT:-18780}
PROXY_PORT=${ZCC_MACHINE_JOIN_PROXY_PORT:-18781}
DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/zcc-docker-join-XXXXXX")
PUBLIC_URL="http://host.docker.internal:${PROXY_PORT}"
IMAGE=${ZCC_MACHINE_JOIN_IMAGE:-zcc-remote-machine:test}
CONTAINER="zcc-machine-join-$$"

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker is required. Install and start Docker Desktop, then retry.\n' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf 'Docker daemon is not available. Start Docker Desktop, then retry.\n' >&2
  exit 1
fi

SERVER_PID=""
PROXY_PID=""
cleanup() {
  if [[ -n "$CONTAINER" ]]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  if [[ -n "$PROXY_PID" ]]; then
    kill "$PROXY_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT INT TERM

cd "$ROOT"
ZCC_SERVER_PORT="$SERVER_PORT" \
  ZCC_DATA_DIR="$DATA_DIR" \
  ZCC_APP_URL="$PUBLIC_URL" \
  pnpm exec tsx --tsconfig tsconfig.json apps/server/src/http/listen.ts >/tmp/zcc-docker-join-server.log 2>&1 &
SERVER_PID=$!

deadline=$((SECONDS + 30))
until curl -sf "http://127.0.0.1:${SERVER_PORT}/api/v1/health" >/dev/null 2>&1; do
  if [[ $SECONDS -ge $deadline ]]; then
    printf 'product server did not become ready\n' >&2
    cat /tmp/zcc-docker-join-server.log >&2 || true
    exit 1
  fi
  sleep 0.2
done

node --input-type=module -e "
import net from 'node:net';
const proxy = net.createServer((client) => {
  const upstream = net.connect(${SERVER_PORT}, '127.0.0.1');
  client.pipe(upstream);
  upstream.pipe(client);
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
});
proxy.listen(${PROXY_PORT}, '0.0.0.0');
" &
PROXY_PID=$!
sleep 0.3

mint=$(curl -sf -X POST "http://127.0.0.1:${SERVER_PORT}/api/v1/hosts/join-codes" \
  -H 'content-type: application/json' \
  -d '{}')
join_code=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).joinCode)" "$mint")
host_id=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).hostId)" "$mint")

docker build -t "$IMAGE" "$ROOT/docker/remote-machine" >/dev/null

docker run -d \
  --name "$CONTAINER" \
  --hostname zcc-docker \
  --add-host=host.docker.internal:host-gateway \
  -e ZCC_SERVER_URL="$PUBLIC_URL" \
  -e JOIN_CODE="$join_code" \
  -e HOST_ID="$host_id" \
  "$IMAGE" >/dev/null

deadline=$((SECONDS + 120))
until docker logs "$CONTAINER" 2>&1 | grep -Eq 'Host daemon connected|Connected \(service install skipped\)|zcc-host-daemon joined'; do
  if [[ $SECONDS -ge $deadline ]]; then
    printf 'installer did not report connected\n' >&2
    docker logs "$CONTAINER" >&2 || true
    cat /tmp/zcc-docker-join-server.log >&2 || true
    exit 1
  fi
  if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
    printf 'installer container exited before connecting\n' >&2
    docker logs "$CONTAINER" >&2 || true
    cat /tmp/zcc-docker-join-server.log >&2 || true
    exit 1
  fi
  sleep 0.5
done

hosts=$(curl -sf "http://127.0.0.1:${SERVER_PORT}/api/v1/hosts")
node -e '
const hosts = JSON.parse(process.argv[1]);
const id = process.argv[2];
const row = hosts.find((h) => h.id === id);
if (!row) {
  console.error("enrolled host missing from GET /api/v1/hosts", hosts);
  process.exit(1);
}
if (row.status !== "connected") {
  console.error("enrolled host is not connected", row);
  process.exit(1);
}
console.log("docker machine join ok:", row.id, row.status, row.name);
' "$hosts" "$host_id"
