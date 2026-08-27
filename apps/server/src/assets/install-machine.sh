#!/bin/sh
# zcc remote host-daemon installer. macOS + Linux. Requires Node >= 22.
set -eu

usage() {
  cat >&2 <<'EOF'
Usage: install.sh --join-code <code> --host-id <host-id> --server <url> [--host-daemon-port <port>]

Installs an enrolled ZCC host daemon for one server. Data lives in
~/.zcc-machines/<server-host> and never touches ~/.zcc.

Looks for Node >= 22 on PATH, then nix/nvm/fnm/volta (Salesforce workspaces
often expose Node 20 on PATH while Node 22 lives in the nix store). Override
with ZCC_NODE=/path/to/node.
EOF
  exit 2
}

node_major() {
  bin=$1
  [ -n "$bin" ] && [ -x "$bin" ] || return 1
  major=$("$bin" -p "parseInt(process.versions.node,10)" 2>/dev/null) || return 1
  case "$major" in
    ''|*[!0-9]*) return 1 ;;
  esac
  printf '%s\n' "$major"
}

consider_node() {
  major=$(node_major "$1") || return 1
  if [ "$major" -ge 22 ]; then
    printf '%s\n' "$1"
    return 0
  fi
  return 1
}

resolve_node() {
  if [ -n "${ZCC_NODE:-}" ]; then
    consider_node "$ZCC_NODE" && return 0
    echo "ZCC_NODE is not Node.js >= 22: $ZCC_NODE" >&2
    return 1
  fi
  if command -v node >/dev/null 2>&1; then
    consider_node "$(command -v node)" && return 0
  fi
  for cand in \
    "$HOME/.nix-profile/bin/node" \
    "$HOME/.local/share/fnm/aliases/default/bin/node" \
    "$HOME/.volta/bin/node"
  do
    consider_node "$cand" && return 0
  done
  nvm_root=${NVM_DIR:-$HOME/.nvm}
  if [ -d "$nvm_root/versions/node" ]; then
    for cand in "$nvm_root"/versions/node/v*/bin/node; do
      consider_node "$cand" && return 0
    done
  fi
  if [ "${ZCC_SKIP_NIX_STORE:-}" != 1 ]; then
    for cand in \
      /nix/store/*-nodejs-22.*/bin/node \
      /nix/store/*-nodejs-23.*/bin/node \
      /nix/store/*-nodejs-24.*/bin/node \
      /nix/store/*-nodejs-slim-22.*/bin/node \
      /nix/store/*-nodejs-slim-24.*/bin/node
    do
      consider_node "$cand" && return 0
    done
  fi
  echo "Node.js >= 22 is required (PATH node is too old or missing). Install Node 22+, or set ZCC_NODE." >&2
  return 1
}

if [ "${1:-}" = '--resolve-node' ]; then
  resolve_node || exit 1
  exit 0
fi

join_code=
host_id=
server_url=
requested_host_daemon_port=

while [ $# -gt 0 ]; do
  case "$1" in
    --join-code) join_code=${2:-}; shift 2 ;;
    --host-id) host_id=${2:-}; shift 2 ;;
    --server) server_url=${2:-}; shift 2 ;;
    --host-daemon-port) requested_host_daemon_port=${2:-}; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

[ -n "$join_code" ] && [ -n "$host_id" ] && [ -n "$server_url" ] || usage

server_url=${server_url%/}
server_host=$(printf '%s' "$server_url" | sed -E 's#^https?://##; s#[/:].*##')
[ -n "$server_host" ] || { echo "invalid --server" >&2; exit 2; }

data_dir=${ZCC_DATA_DIR:-"$HOME/.zcc-machines/$server_host"}
mkdir -p "$data_dir"
chmod 700 "$data_dir"

port_dir="$HOME/.zcc-machines/host-daemon-ports"
mkdir -p "$port_dir"
port_file="$data_dir/host-daemon.port"

if [ -n "$requested_host_daemon_port" ]; then
  port=$requested_host_daemon_port
elif [ -f "$port_file" ]; then
  port=$(cat "$port_file")
else
  port=38888
  while [ -e "$port_dir/$port" ]; do
    port=$((port + 1))
  done
fi
printf '%s\n' "$port" > "$port_file"
printf '%s\n' "$data_dir" > "$port_dir/$port"

NODE_BIN=$(resolve_node)
PATH="$(dirname "$NODE_BIN"):$PATH"
export PATH
echo "Using $($NODE_BIN -v) at $NODE_BIN"

package_dir="$data_dir/runtime"
mkdir -p "$package_dir"
package_file="$package_dir/zcc-host.tgz"
echo "Downloading host-daemon artifact…"
curl -fL --connect-timeout 10 --max-time 300 --retry 2 "$server_url/install/zcc-host.tgz" -o "$package_file"
tar -xzf "$package_file" -C "$package_dir"

join_bin=${ZCC_HOST_JOIN_CLI:-}
if [ -z "$join_bin" ] && [ -f "$package_dir/join.mjs" ]; then
  join_bin="$package_dir/join.mjs"
fi
if [ -z "$join_bin" ] && command -v zcc-host >/dev/null; then
  join_bin=$(command -v zcc-host)
fi
[ -n "$join_bin" ] || { echo "join CLI missing from artifact" >&2; exit 1; }

run_join() {
  ZCC_DATA_DIR="$data_dir" ZCC_SERVER_URL="$server_url" \
    "$NODE_BIN" "$join_bin" join \
      --join-code "$join_code" \
      --host-id "$host_id" \
      --server-url "$server_url" \
      --host-daemon-port "$port" \
      --auto-update
}

echo "Enrolling host daemon…"
if [ "${ZCC_INSTALL_SKIP_SERVICE:-}" = 1 ]; then
  run_join &
  join_pid=$!
else
  run_join &
  join_pid=$!
fi

wait_connected() {
  i=0
  max=${ZCC_INSTALL_WAIT_ATTEMPTS:-60}
  delay=${ZCC_INSTALL_WAIT_DELAY:-1}
  while [ "$i" -lt "$max" ]; do
    if curl -sf "http://127.0.0.1:$port/status" 2>/dev/null | grep -q '"connected":true'; then
      return 0
    fi
    i=$((i + 1))
    sleep "$delay"
  done
  return 1
}

if ! wait_connected; then
  echo "host daemon did not report connected" >&2
  kill "$join_pid" 2>/dev/null || true
  exit 1
fi

if [ "${ZCC_INSTALL_SKIP_SERVICE:-}" = 1 ]; then
  echo "Connected (service install skipped)."
  wait "$join_pid" || true
  exit 0
fi

kill "$join_pid" 2>/dev/null || true
sleep 1

uname_s=$(uname -s)
if [ "$uname_s" = Darwin ]; then
  plist="$HOME/Library/LaunchAgents/ai.zana.zcc-host-daemon.$server_host.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.zana.zcc-host-daemon.$server_host</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$join_bin</string>
    <string>join</string>
    <string>--host-id</string>
    <string>$host_id</string>
    <string>--server-url</string>
    <string>$server_url</string>
    <string>--host-daemon-port</string>
    <string>$port</string>
    <string>--auto-update</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ZCC_DATA_DIR</key>
    <string>$data_dir</string>
    <key>ZCC_SERVER_URL</key>
    <string>$server_url</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
PLIST
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load "$plist"
else
  unit_dir="$HOME/.config/systemd/user"
  mkdir -p "$unit_dir"
  unit="$unit_dir/zcc-host-daemon-$server_host.service"
  cat > "$unit" <<UNIT
[Unit]
Description=ZCC host daemon ($server_host)
After=network-online.target

[Service]
ExecStart=$NODE_BIN $join_bin join --host-id $host_id --server-url $server_url --host-daemon-port $port --auto-update
Environment=ZCC_DATA_DIR=$data_dir
Environment=ZCC_SERVER_URL=$server_url
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now "zcc-host-daemon-$server_host.service"
fi

if ! wait_connected; then
  echo "service-managed daemon did not report connected" >&2
  exit 1
fi
echo "Host daemon connected."
