#!/usr/bin/env bash
# Playable Linux remote machine (docker/remote-machine).
#
#   pnpm docker:remote-machine          start the box (SSH + sample workspace)
#   pnpm docker:host-daemon             mint a join code and enroll it
#   pnpm docker:remote-machine down     stop and restore Public app URL
#
# Product HTTP stays on 127.0.0.1. Join uses the Heroku pairing origin when
# the laptop relay is connected; otherwise it publishes a throwaway TCP proxy
# so Docker can reach loopback (same role Tailscale Serve plays on a real
# tailnet). Override with `--relay` or `--local`.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
COMPOSE_DIR="$ROOT/docker/remote-machine"
COMPOSE_FILE="$COMPOSE_DIR/compose.yaml"
PROJECT=zcc-remote-machine
CONTAINER=zcc-docker
SERVER_PORT=${ZCC_SERVER_PORT:-8780}
PROXY_PORT=${ZCC_HOST_DAEMON_PROXY_PORT:-18781}
SSH_PORT=${ZCC_DOCKER_SSH_PORT:-2222}
JOIN_CODE=${JOIN_CODE:-}
HOST_ID=${HOST_ID:-}
MODE=up
JOIN=0
DOOR=auto
FOLLOW=0
KEEP_PUBLIC_URL=${ZCC_KEEP_PUBLIC_URL:-0}
STATE_FILE="$COMPOSE_DIR/.proxy-state"
PID_FILE="$COMPOSE_DIR/.proxy.pid"

compose() {
  docker compose -f "$COMPOSE_FILE" --project-directory "$COMPOSE_DIR" --project-name "$PROJECT" "$@"
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [up|down|logs|join] [options]

  up       Start the Linux box and leave it idle (default)
  join     Mint a join code (or use --join-code) and enroll the box
  logs     Follow container logs
  down     Stop the container, drop the loopback proxy, restore Public app URL

Join options:
  --join-code CODE   From Settings → Machines → Add a machine
  --host-id ID       Host id from that dialog (required with --join-code)
  --local            Enroll via loopback proxy (hits this machine's pnpm dev)
  --relay            Enroll via https://<origin>/t/<sessionId> (Heroku)
                     Fails if the join window has closed (renew in Settings)
                     Default: --relay when the laptop tunnel is connected, else --local
  --follow           Stay attached to logs after start
  --server-port N    Product server port (default ${SERVER_PORT})
  --proxy-port N     Loopback-proxy port (default ${PROXY_PORT})
  --ssh-port N       Host port mapped to the box's SSH (default ${SSH_PORT})

  JOIN_CODE / HOST_ID env vars are accepted as well.

SSH (password zcc, local toy only):
  ssh -p ${SSH_PORT} zcc@127.0.0.1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    up|down|logs|join) MODE=$1; shift ;;
    --join) JOIN=1; MODE=join; shift ;;
    --join-code) JOIN_CODE=${2:-}; JOIN=1; MODE=join; shift 2 ;;
    --host-id) HOST_ID=${2:-}; JOIN=1; MODE=join; shift 2 ;;
    --local) DOOR=local; shift ;;
    --relay) DOOR=relay; shift ;;
    --follow) FOLLOW=1; shift ;;
    --server-port) SERVER_PORT=${2:-}; shift 2 ;;
    --proxy-port) PROXY_PORT=${2:-}; shift 2 ;;
    --ssh-port) SSH_PORT=${2:-}; export ZCC_DOCKER_SSH_PORT=$SSH_PORT; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -n "$JOIN_CODE" && -z "$HOST_ID" ]]; then
  printf '%s\n' '--host-id is required when --join-code is set' >&2
  exit 2
fi
if [[ -n "$HOST_ID" && -z "$JOIN_CODE" ]]; then
  printf '%s\n' '--join-code is required when --host-id is set' >&2
  exit 2
fi

need_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    printf 'Docker is required. Install and start Docker Desktop, then retry.\n' >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    printf 'Docker daemon is not available. Start Docker Desktop, then retry.\n' >&2
    exit 1
  fi
}

stop_proxy() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$PID_FILE"
  fi
}

restore_public_url() {
  if [[ "$KEEP_PUBLIC_URL" = 1 ]]; then
    return 0
  fi
  if [[ ! -f "$STATE_FILE" ]]; then
    return 0
  fi
  local prev port
  prev=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(s.prevPublicAppUrl ?? "")' "$STATE_FILE")
  port=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(String(s.serverPort ?? 8780))' "$STATE_FILE")
  local body
  body=$(PREV="$prev" node --input-type=module -e '
    const prev = process.env.PREV ?? "";
    process.stdout.write(JSON.stringify({ publicAppUrl: prev.length > 0 ? prev : "" }));
  ')
  curl -sf -X PATCH "http://127.0.0.1:${port}/api/v1/config" \
    -H 'content-type: application/json' \
    -d "$body" >/dev/null 2>&1 || true
  rm -f "$STATE_FILE"
}

curl_json() {
  local method=$1 url=$2 data=${3-}
  local body status tmp
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

need_server() {
  if ! curl -sf "http://127.0.0.1:${SERVER_PORT}/api/v1/health" >/dev/null; then
    printf 'No product server on http://127.0.0.1:%s — start `pnpm dev` first.\n' "$SERVER_PORT" >&2
    exit 1
  fi
}

start_proxy() {
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    return 0
  fi
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
  echo $! > "$PID_FILE"
  sleep 0.3
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    printf 'could not bind the Docker proxy on port %s\n' "$PROXY_PORT" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
}

print_play_hints() {
  cat <<EOF

Remote machine: ${CONTAINER}  (hostname zcc-docker)

  Settings → Machines should list it after enroll.
  Sample disk:  /home/zcc/workspace
  logs:         docker logs -f ${CONTAINER}
  shell:        docker exec -it ${CONTAINER} bash
  SSH:          ssh -p ${SSH_PORT} zcc@127.0.0.1   (password: zcc)
  enroll:       docker exec -it ${CONTAINER} zcc-join --join-code <zcde_…> --host-id <id> --server <url>
  stop:         pnpm docker:remote-machine down

EOF
}

wait_connected() {
  local deadline=$((SECONDS + 120))
  until docker logs "$CONTAINER" 2>&1 | grep -Eq 'Host daemon connected|Connected \(service install skipped\)|zcc-host-daemon joined'; do
    if [[ $SECONDS -ge $deadline ]]; then
      printf 'installer did not report connected\n' >&2
      docker logs "$CONTAINER" >&2 || true
      exit 1
    fi
    if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
      printf 'remote-machine container exited before connecting\n' >&2
      docker logs "$CONTAINER" >&2 || true
      exit 1
    fi
    sleep 0.4
  done
}

cmd_down() {
  need_docker
  compose down --remove-orphans >/dev/null 2>&1 || docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  stop_proxy
  restore_public_url
  printf 'Stopped %s.\n' "$CONTAINER"
}

cmd_logs() {
  need_docker
  docker logs -f "$CONTAINER"
}

cmd_up() {
  need_docker
  export JOIN_CODE="${JOIN_CODE:-}" HOST_ID="${HOST_ID:-}" ZCC_SERVER_URL="${ZCC_SERVER_URL:-}"
  compose up -d --build
  print_play_hints
  if [[ "$FOLLOW" = 1 ]]; then
    docker logs -f "$CONTAINER"
  fi
}

cmd_join() {
  need_docker
  need_server
  local public_url door_url
  local config_json mint relay_json relay_state
  config_json=$(curl_json GET "http://127.0.0.1:${SERVER_PORT}/api/v1/config")
  public_url=$(node -e '
    const config = JSON.parse(process.argv[1]).config ?? {};
    process.stdout.write(typeof config.publicAppUrl === "string" ? config.publicAppUrl : "");
  ' "$config_json")
  relay_json=$(curl_json GET "http://127.0.0.1:${SERVER_PORT}/api/v1/relay")
  relay_state=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).state ?? "")' "$relay_json")

  if [[ "$DOOR" = auto ]]; then
    if [[ -n "$public_url" && "$relay_state" = connected ]]; then
      DOOR=relay
    else
      DOOR=local
    fi
  fi

  if [[ "$DOOR" = relay ]]; then
    if [[ -z "$public_url" ]]; then
      printf 'No public app URL configured. Set Settings → Machines → Public app URL, or pass --local.\n' >&2
      exit 1
    fi
    if [[ "$relay_state" != connected ]]; then
      printf 'Relay is %s. Connect the laptop tunnel (or use --local against pnpm dev).\n' "$relay_state" >&2
      exit 1
    fi
    local session_id join_until now_ms
    session_id=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).sessionId ?? "")' "$relay_json")
    join_until=$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).joinUntil ?? 0))' "$relay_json")
    if [[ -z "$session_id" ]]; then
      printf 'Relay is connected but has no session id yet. Retry in a second.\n' >&2
      exit 1
    fi
    now_ms=$(($(date +%s) * 1000))
    if [[ "$join_until" =~ ^[0-9]+$ && "$join_until" -gt 0 && "$now_ms" -ge "$join_until" ]]; then
      printf 'Join window closed. Renew it in Settings → Machines, then retry.\n' >&2
      exit 1
    fi
    door_url="${public_url%/}/t/${session_id}"
  else
    door_url="http://host.docker.internal:${PROXY_PORT}"
    start_proxy
    if [[ "$public_url" != "$door_url" ]]; then
      node --input-type=module -e '
        import { writeFileSync } from "node:fs";
        writeFileSync(process.argv[1], JSON.stringify({
          prevPublicAppUrl: process.argv[2],
          serverPort: Number(process.argv[3]),
          proxyPort: Number(process.argv[4])
        }));
      ' "$STATE_FILE" "$public_url" "$SERVER_PORT" "$PROXY_PORT"
      curl_json PATCH "http://127.0.0.1:${SERVER_PORT}/api/v1/config" \
        "$(node -e 'process.stdout.write(JSON.stringify({ publicAppUrl: process.argv[1] }))' "$door_url")" \
        >/dev/null
    fi
  fi

  if [[ -z "$JOIN_CODE" ]]; then
    mint=$(curl_json POST "http://127.0.0.1:${SERVER_PORT}/api/v1/hosts/join-codes" '{}')
    JOIN_CODE=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).joinCode)' "$mint")
    HOST_ID=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).hostId)' "$mint")
  fi

  printf 'Starting %s → %s\n' "$CONTAINER" "$door_url"
  printf 'host id: %s\n' "$HOST_ID"

  export JOIN_CODE HOST_ID
  export ZCC_SERVER_URL="$door_url"
  compose up -d --build --force-recreate
  wait_connected
  print_play_hints
  printf 'Host daemon is connected. Settings → Machines should show "zcc-docker".\n'
  if [[ "$FOLLOW" = 1 ]]; then
    docker logs -f "$CONTAINER"
  fi
}

case "$MODE" in
  down) cmd_down ;;
  logs) cmd_logs ;;
  join) cmd_join ;;
  up) cmd_up ;;
  *) usage >&2; exit 2 ;;
esac
