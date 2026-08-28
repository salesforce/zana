#!/bin/sh
# Keep a Linux box up for Settings → Machines. SSH is always on.
# If JOIN_CODE/HOST_ID/ZCC_SERVER_URL are set, enroll at start.
# If ~/.zcc-machines already has auth.json, reconnect.
set -eu

start_sshd() {
  mkdir -p /run/sshd /home/zcc/.zcc-machines /home/zcc/workspace /home/zcc/.ssh
  chown zcc:zcc /home/zcc /home/zcc/.zcc-machines /home/zcc/workspace /home/zcc/.ssh
  chmod 700 /home/zcc/.zcc-machines /home/zcc/.ssh
  if [ -n "${SSH_AUTH_PUBKEYS_DIR:-}" ] && [ -d "$SSH_AUTH_PUBKEYS_DIR" ]; then
    mkdir -p /home/zcc/.ssh
    touch /home/zcc/.ssh/authorized_keys
    chmod 700 /home/zcc/.ssh
    for pub in "$SSH_AUTH_PUBKEYS_DIR"/*.pub; do
      [ -f "$pub" ] || continue
      cat "$pub" >> /home/zcc/.ssh/authorized_keys
    done
    chown -R zcc:zcc /home/zcc/.ssh
    chmod 600 /home/zcc/.ssh/authorized_keys 2>/dev/null || true
  fi
  /usr/sbin/sshd
}

find_auth() {
  find /home/zcc/.zcc-machines -mindepth 2 -maxdepth 2 -name auth.json -type f 2>/dev/null | head -n 1
}

reconnect_existing() {
  auth=$1
  data_dir=$(dirname "$auth")
  server_url=
  if [ -f "$data_dir/.server-url" ]; then
    server_url=$(head -n 1 "$data_dir/.server-url")
  fi
  if [ -z "$server_url" ] && [ -n "${ZCC_SERVER_URL:-}" ]; then
    server_url=$ZCC_SERVER_URL
  fi
  [ -n "$server_url" ] || {
    echo "auth.json exists but no .server-url / ZCC_SERVER_URL; cannot reconnect." >&2
    return 1
  }
  join_bin=
  [ -f "$data_dir/runtime/join.mjs" ] && join_bin="$data_dir/runtime/join.mjs"
  [ -z "$join_bin" ] && [ -f "$data_dir/runtime/join.cjs" ] && join_bin="$data_dir/runtime/join.cjs"
  [ -n "$join_bin" ] || {
    echo "join CLI missing under $data_dir/runtime" >&2
    return 1
  }
  host_id=$(runuser -u zcc -- node -e 'const a=require("fs").readFileSync(process.argv[1],"utf8"); process.stdout.write(JSON.parse(a).hostId)' "$auth")
  port=38888
  if [ -f "$data_dir/host-daemon.port" ]; then
    port=$(head -n 1 "$data_dir/host-daemon.port")
  fi
  echo "Reconnecting host-daemon ($host_id) to $server_url"
  runuser -u zcc -- env HOME=/home/zcc ZCC_DATA_DIR="$data_dir" ZCC_SERVER_URL="$server_url" \
    nohup node "$join_bin" join \
      --host-id "$host_id" \
      --server-url "$server_url" \
      --host-daemon-port "$port" \
      --auto-update \
      >>"$data_dir/host-daemon.log" 2>&1 &
  echo $! > "$data_dir/host-daemon.pid"
}

follow_daemon() {
  auth=$(find_auth)
  [ -n "$auth" ] || {
    echo "host-daemon did not write auth.json" >&2
    exit 1
  }
  data_dir=$(dirname "$auth")
  log="$data_dir/host-daemon.log"
  pid_file="$data_dir/host-daemon.pid"
  touch "$log"
  chown zcc:zcc "$log" 2>/dev/null || true
  echo "Host daemon running. SSH: ssh zcc@127.0.0.1 -p 2222  (password: zcc)"
  echo "Workspace: /home/zcc/workspace"
  if [ -f "$pid_file" ] && command -v tail >/dev/null; then
    pid=$(head -n 1 "$pid_file")
    exec tail --pid="$pid" -f "$log"
  fi
  exec tail -f "$log"
}

start_sshd

if [ -n "${JOIN_CODE:-}" ] && [ -n "${HOST_ID:-}" ] && [ -n "${ZCC_SERVER_URL:-}" ]; then
  /usr/local/bin/zcc-join --join-code "$JOIN_CODE" --host-id "$HOST_ID" --server "$ZCC_SERVER_URL"
  follow_daemon
fi

existing=$(find_auth || true)
if [ -n "$existing" ]; then
  reconnect_existing "$existing"
  follow_daemon
fi

cat <<'EOF'
zcc-docker is idle (no join code).

  Enroll through Heroku (Settings → Add a machine, then):
    docker exec -it zcc-docker zcc-join --join-code <zcde_…> --host-id <id> --server https://<origin>/t/<sessionId>

  Or one-shot from the repo:
    pnpm docker:host-daemon

  SSH (password zcc):
    ssh -p 2222 zcc@127.0.0.1

EOF
exec sleep infinity
