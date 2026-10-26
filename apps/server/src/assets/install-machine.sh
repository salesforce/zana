#!/bin/sh
# zcc remote host-daemon installer. macOS + Linux. Requires Node >= 22.
set -eu

usage() {
  cat >&2 <<'EOF'
Usage: install.sh --join-code <code> --host-id <host-id> --server <url> [--host-daemon-port <port>] [--replace-enrollment]

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
  # -e with a plain write: -p colors numbers when FORCE_COLOR is set.
  major=$("$bin" -e "process.stdout.write(String(parseInt(process.versions.node,10)))" 2>/dev/null) || return 1
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
replace_enrollment=

while [ $# -gt 0 ]; do
  case "$1" in
    --join-code) join_code=${2:-}; shift 2 ;;
    --host-id) host_id=${2:-}; shift 2 ;;
    --server) server_url=${2:-}; shift 2 ;;
    --host-daemon-port) requested_host_daemon_port=${2:-}; shift 2 ;;
    --replace-enrollment) replace_enrollment=--replace-enrollment; shift ;;
    -h|--help) usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

[ -n "$host_id" ] && [ -n "$server_url" ] || usage
[ -n "$join_code" ] || [ -n "${ZCC_CONNECT_HEADER_FILE:-}" ] || usage

server_url=${server_url%/}
server_host=$(printf '%s' "$server_url" | sed -E 's#^https?://##; s#[/:].*##')
[ -n "$server_host" ] || { echo "invalid --server" >&2; exit 2; }
# Scheme://host[:port] only: no path, query, or userinfo ever reaches a marker.
origin=$(printf '%s' "$server_url" | sed -E 's#^(https?://)([^/@]*@)?([^/?\#]+).*#\1\3#')

step=prepare
trap 'rc=$?; [ "$rc" -eq 0 ] || printf "zcc-install: failed step=%s rc=%s\n" "$step" "$rc" >&2' EXIT

data_dir=${ZCC_DATA_DIR:-"$HOME/.zcc-machines/$server_host"}
# Installation state is isolated; the local app's registered projects live separately.
ZCC_PROJECT_CATALOGUE_DATA_DIR=${ZCC_PROJECT_CATALOGUE_DATA_DIR:-"$HOME/.zcc"}
export ZCC_PROJECT_CATALOGUE_DATA_DIR
mkdir -p "$data_dir"
chmod 700 "$data_dir"
# Never erase another identity to make enrollment succeed.
if [ -f "$data_dir/host.id" ]; then
  existing_id=$(tr -d '[:space:]' < "$data_dir/host.id")
  if [ "$existing_id" != "$host_id" ] && [ -z "$replace_enrollment" ]; then
    echo "This installation belongs to another machine. Generate a repair code for it, or use another isolated data directory." >&2
    exit 1
  fi
fi
if [ -n "${ZCC_CONNECT_INSTANCE_ID:-}" ]; then
  # Stable service identity survives address changes and separates instances.
  server_host=$ZCC_CONNECT_INSTANCE_ID
fi

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

step=node
NODE_BIN=$(resolve_node)
PATH="$(dirname "$NODE_BIN"):$PATH"
export PATH
echo "Using $($NODE_BIN -v) at $NODE_BIN"

package_dir="$data_dir/runtime"
mkdir -p "$package_dir"
package_file="$package_dir/zcc-host.tgz"
echo "Downloading host-daemon artifact…"
step=download
# No -f: the status is captured so a failed fetch reports one stable marker.
if [ -n "${ZCC_CONNECT_HEADER_FILE:-}" ]; then
  # Credentials are in a private file, never argv; never follow a redirect.
  code=$(curl -sS --proto '=https' --header "@$ZCC_CONNECT_HEADER_FILE" --max-filesize 268435456 --connect-timeout 10 --max-time 300 --retry 2 -o "$package_file" -w '%{http_code}' "$server_url/install/zcc-host.tgz" 2>/dev/null) || code="curl-exit-$?"
else
  code=$(curl -sSL --connect-timeout 10 --max-time 300 --retry 2 -o "$package_file" -w '%{http_code}' "$server_url/install/zcc-host.tgz" 2>/dev/null) || code="curl-exit-$?"
fi
case "$code" in
  2??) ;;
  *)
    rm -f "$package_file"
    trap - EXIT
    printf 'zcc-install: artifact-unavailable status=%s origin=%s\n' "$code" "$origin" >&2
    exit 1 ;;
esac
step=unpack
tar -xzf "$package_file" -C "$package_dir"
step=install

join_bin=${ZCC_HOST_JOIN_CLI:-}
# Prefer the freshly served ESM bundle over a leftover legacy CJS launcher.
if [ -z "$join_bin" ] && [ -f "$package_dir/join.mjs" ]; then
  join_bin="$package_dir/join.mjs"
fi
if [ -z "$join_bin" ] && [ -f "$package_dir/join.cjs" ]; then
  join_bin="$package_dir/join.cjs"
fi
if [ -z "$join_bin" ] && command -v zcc-host >/dev/null; then
  join_bin=$(command -v zcc-host)
fi
[ -n "$join_bin" ] || { echo "join CLI missing from artifact" >&2; exit 1; }

# Safety refusal must leave the existing service and daemon untouched.
step=enrollment-safety
ZCC_DATA_DIR="$data_dir" "$NODE_BIN" "$join_bin" join --check-enrollment \
  --host-id "$host_id" --server-url "$server_url" ${replace_enrollment:+"$replace_enrollment"}

run_join() {
  # Attempt boundary: readers of host-daemon.log take lines after the last marker.
  printf 'zcc-join: attempt %s host=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$host_id" >>"$data_dir/host-daemon.log"
  ZCC_DATA_DIR="$data_dir" ZCC_SERVER_URL="$server_url" \
    nohup "$NODE_BIN" "$join_bin" join \
      --join-code "$join_code" \
      --host-id "$host_id" \
      --server-url "$server_url" \
      --host-daemon-port "$port" \
      --auto-update \
      ${replace_enrollment:+"$replace_enrollment"} \
      >>"$data_dir/host-daemon.log" 2>&1 &
  join_pid=$!
  printf '%s\n' "$join_pid" > "$data_dir/host-daemon.pid"
}

systemd_user_available() {
  command -v systemctl >/dev/null 2>&1 || return 1
  systemctl --user show-environment >/dev/null 2>&1
}

# Stop the existing owner before starting a replacement. Never signal a saved
# PID until both its command and process start time still match this install.
if [ "$(uname -s)" = Darwin ]; then
  launchctl bootout "gui/$(id -u)/ai.zana.zcc-host-daemon.$server_host" 2>/dev/null || true
elif command -v systemctl >/dev/null 2>&1; then
  systemctl --user stop "zcc-host-daemon-$server_host.service" 2>/dev/null || true
fi
if [ "$(uname -s)" = Darwin ]; then
  for old_unit in "$HOME"/Library/LaunchAgents/ai.zana.zcc-host-daemon.*.plist; do
    [ -f "$old_unit" ] && grep -qF "<string>${host_id:-<none>}</string>" "$old_unit" && ! grep -qF "<string>$package_dir/" "$old_unit" || continue
    launchctl bootout "gui/$(id -u)/$(basename "$old_unit" .plist)" 2>/dev/null || true
    mv -f "$old_unit" "$old_unit.retired" 2>/dev/null || true
    echo "Retired $(basename "$old_unit" .plist): it ran this machine for another server address."
  done
else
  for old_unit in "$HOME"/.config/systemd/user/zcc-host-daemon-*.service; do
    [ -f "$old_unit" ] && grep -qF -- "--host-id ${host_id:-<none>} " "$old_unit" && ! grep -qF -- "$package_dir/" "$old_unit" || continue
    systemctl --user disable --now "$(basename "$old_unit")" 2>/dev/null || true
    mv -f "$old_unit" "$old_unit.retired" 2>/dev/null || true
    systemctl --user daemon-reload 2>/dev/null || true
    echo "Retired $(basename "$old_unit"): it ran this machine for another server address."
  done
fi
host_match=" --host-id ${host_id:-<none>} "
replaced_daemon() {
  case " $1 " in
    *" $package_dir/join.mjs join "*|*" $package_dir/join.cjs join "*|*" ${join_bin:-<none>} join "*) return 0 ;;
    *"/join.mjs join"*"$host_match"*|*"/join.cjs join"*"$host_match"*) return 0 ;;
  esac
  return 1
}
old_pids=""
if [ -f "$data_dir/host-daemon.pid" ]; then old_pids=$(cat "$data_dir/host-daemon.pid"); fi
old_pids="$old_pids $(ps -eo pid= -o command= 2>/dev/null | while read -r old_pid old_command; do if replaced_daemon "$old_command"; then echo "$old_pid"; fi; done)"
for old_pid in $old_pids; do
  case "$old_pid" in ""|*[!0-9]*|0|1) continue ;; esac
  [ "$old_pid" != "$$" ] || continue
  old_command=$(ps -p "$old_pid" -o command= 2>/dev/null || true); old_started=$(ps -p "$old_pid" -o lstart= 2>/dev/null || true)
  [ -n "$old_started" ] && replaced_daemon "$old_command" || continue
  kill "$old_pid" 2>/dev/null || true
  i=0; while [ "$i" -lt 10 ] && [ "$(ps -p "$old_pid" -o lstart= 2>/dev/null || true)" = "$old_started" ]; do i=$((i + 1)); sleep 1; done
  if [ "$(ps -p "$old_pid" -o lstart= 2>/dev/null || true)" = "$old_started" ] && [ "$(ps -p "$old_pid" -o command= 2>/dev/null || true)" = "$old_command" ]; then kill -9 "$old_pid" 2>/dev/null || true; fi
done
rm -f "$data_dir/host-daemon.pid"

step=join
echo "Enrolling host daemon…"
run_join

wait_connected() {
  i=0
  max=${ZCC_INSTALL_WAIT_ATTEMPTS:-60}
  delay=${ZCC_INSTALL_WAIT_DELAY:-1}
  while [ "$i" -lt "$max" ]; do
    if curl -sf --max-time 2 "http://127.0.0.1:$port/status" 2>/dev/null | "$NODE_BIN" -e 'let s="";process.stdin.on("data",b=>{s+=b;if(s.length>4096)process.exit(1)});process.stdin.on("end",()=>{try{const v=JSON.parse(s);process.exit(v.connected===true&&v.hostId===process.argv[1]&&v.serverUrl.replace(/\/$/,"")===process.argv[2]?0:1)}catch{process.exit(1)}})' "$host_id" "$server_url"; then
      return 0
    fi
    i=$((i + 1))
    sleep "$delay"
  done
  return 1
}

dump_join_diagnostics() {
  echo "$1" >&2
  echo "--- /status ---" >&2
  curl -sS --max-time 2 "http://127.0.0.1:$port/status" >&2 || echo "status endpoint unreachable" >&2
  echo "--- host-daemon.log ---" >&2
  if [ -f "$data_dir/host-daemon.log" ]; then
    tail -n 80 "$data_dir/host-daemon.log" >&2
  else
    echo "(no log yet)" >&2
  fi
}

if ! wait_connected; then
  dump_join_diagnostics "host daemon did not report connected"
  kill "$join_pid" 2>/dev/null || true
  exit 1
fi

if [ "${ZCC_INSTALL_SKIP_SERVICE:-}" = 1 ]; then
  echo "Connected (service install skipped)."
  wait "$join_pid" || true
  exit 0
fi

step=service
uname_s=$(uname -s)
if [ "$uname_s" = Darwin ]; then
  kill "$join_pid" 2>/dev/null || true
  sleep 1
  rm -f "$data_dir/host-daemon.pid"
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
    <key>ZCC_PROJECT_CATALOGUE_DATA_DIR</key>
    <string>$ZCC_PROJECT_CATALOGUE_DATA_DIR</string>
    <key>ZCC_HOST_SERVICE_MANAGED</key>
    <string>1</string>
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
elif systemd_user_available; then
  kill "$join_pid" 2>/dev/null || true
  sleep 1
  rm -f "$data_dir/host-daemon.pid"
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
Environment=ZCC_PROJECT_CATALOGUE_DATA_DIR=$ZCC_PROJECT_CATALOGUE_DATA_DIR
Environment=ZCC_SERVER_URL=$server_url
Environment=ZCC_HOST_SERVICE_MANAGED=1
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now "zcc-host-daemon-$server_host.service"
else
  echo "No systemd user bus; leaving the host daemon running in the background."
  echo "Host daemon connected."
  exit 0
fi

if ! wait_connected; then
  dump_join_diagnostics "service-managed daemon did not report connected"
  exit 1
fi
echo "Host daemon connected."
