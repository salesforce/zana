import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import type { ProjectRemote } from '@zana-ai/zcc-domain/product';
import { sshBaseArgs } from './remote-fs.js';
import { HostCommandError } from './host-command-error.js';
import { PeerTunnels } from './peer-tunnels.js';

const SSH_TIMEOUT_MS = 180_000;
const MAX_LOG_BYTES = 256 * 1024;
const SERVER_HOST_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,253}$/;

export type PeerDaemonState = 'connected' | 'disconnected' | 'not_installed';

export interface PeerDaemonSshResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface PeerDaemonSsh {
  tunnel?(remote: ProjectRemote, localPort: number, remotePort: number): Promise<void>;
  untunnel?(remote: ProjectRemote, localPort: number, remotePort: number): void;
  untunnelAll?(remote: ProjectRemote): boolean;
  close?(): void;
  run(remote: ProjectRemote, remoteCmd: string, timeoutMs?: number): Promise<PeerDaemonSshResult>;
  pipeFile(
    remote: ProjectRemote,
    remoteCmd: string,
    filePath: string,
    timeoutMs?: number
  ): Promise<PeerDaemonSshResult>;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function collectStream(
  proc: ReturnType<typeof spawn>,
  timeoutMs: number
): Promise<PeerDaemonSshResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outLen = 0;
    let errLen = 0;
    const done = (result: PeerDaemonSshResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new HostCommandError('peer_timeout', 'Remote host timed out'));
    }, timeoutMs);
    proc.stdout?.on('data', (chunk: Buffer) => {
      outLen += chunk.length;
      if (outLen <= MAX_LOG_BYTES) stdout.push(chunk);
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      errLen += chunk.length;
      if (errLen <= MAX_LOG_BYTES) stderr.push(chunk);
    });
    proc.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new HostCommandError('peer_ssh', error.message));
    });
    proc.on('close', (code) => {
      done({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
  });
}

export type PeerDaemonSpawn = typeof spawn;

export function createSystemPeerDaemonSsh(spawnImpl: PeerDaemonSpawn = spawn): PeerDaemonSsh {
  const tunnels = new PeerTunnels(spawnImpl);
  return {
    tunnel: (remote, localPort, remotePort) => tunnels.open(remote, localPort, remotePort),
    untunnel: (remote, localPort, remotePort) => tunnels.remove(remote, localPort, remotePort),
    untunnelAll: (remote) => tunnels.closeFor(remote),
    close: () => tunnels.close(),
    async run(remote, remoteCmd, timeoutMs = SSH_TIMEOUT_MS) {
      const proc = spawnImpl('ssh', [...sshBaseArgs(remote), remoteCmd], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return collectStream(proc, timeoutMs);
    },
    async pipeFile(remote, remoteCmd, filePath, timeoutMs = SSH_TIMEOUT_MS) {
      const proc = spawnImpl('ssh', [...sshBaseArgs(remote), remoteCmd], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      // SSH often closes stdin mid-auth (BatchMode reject, ControlMaster drop,
      // remote died). Piping the artifact into that socket without a listener
      // is an unhandled Socket EPIPE that kills the whole host-daemon.
      proc.stdin?.on('error', () => {});
      const input = createReadStream(filePath);
      input.on('error', () => proc.kill('SIGKILL'));
      if (proc.stdin) input.pipe(proc.stdin);
      else input.destroy();
      return collectStream(proc, timeoutMs);
    }
  };
}

function requireServerHost(serverHost: string): string {
  if (!SERVER_HOST_RE.test(serverHost)) {
    throw new HostCommandError('invalid_server_host', 'server host is not a valid hostname');
  }
  return serverHost;
}

function logText(result: PeerDaemonSshResult): string {
  return `${result.stdout}${result.stderr}`.trim();
}

/** Connect codes must go to the account installer, never the legacy join CLI. */
export async function peerDaemonConnectInstall(ssh: PeerDaemonSsh, input: {
  remote: ProjectRemote;
  connect: { accountUrl: string; serverId: string; code: string };
}): Promise<{ ok: true; log: string }> {
  const { accountUrl, serverId, code } = input.connect;
  const url = new URL(accountUrl);
  if (url.protocol !== 'https:' || url.origin !== accountUrl || url.username || url.password
    || !PEER_HOST_ID_RE.test(serverId) || !/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/.test(code)) {
    throw new HostCommandError('invalid_request', 'Invalid Connect machine enrollment');
  }
  const script = ['(', 'umask 077', ...peerNodeSelectionLines(), 'export PATH="$(dirname "$node_bin"):$PATH"', `f=$(mktemp); trap 'rm -f "$f"' EXIT; curl --proto '=https' -fsS --connect-timeout 10 --max-time 30 ${shQuote(accountUrl + '/api/connect/host-installer')} -o "$f" && "$node_bin" "$f" --account ${shQuote(accountUrl)} --server-id ${shQuote(serverId)} --code ${shQuote(code)}`, ')'].join('\n');
  const result = await ssh.run(input.remote, script, SSH_TIMEOUT_MS);
  const log = logText(result).replaceAll(code, '[redacted]');
  if (result.code !== 0) throw new HostCommandError('peer_install_failed', log || 'Connect machine installation failed');
  return { ok: true, log };
}

/** Tail remote join output so Install can show why /status never became connected. */
function peerJoinFailureDump(): string[] {
  return [
    'if ! curl -sf "http://127.0.0.1:$port/status" 2>/dev/null | grep -q \'"connected":true\'; then',
    '  echo "host daemon did not report connected" >&2',
    '  echo "--- /status ---" >&2',
    '  curl -sS --max-time 2 "http://127.0.0.1:$port/status" >&2 || echo "status endpoint unreachable" >&2',
    '  echo "--- host-daemon.log ---" >&2',
    '  if [ -f "$data_dir/host-daemon.log" ]; then tail -n 80 "$data_dir/host-daemon.log" >&2; else echo "(no log yet)" >&2; fi',
    '  kill "$join_pid" 2>/dev/null || true; exit 1',
    'fi'
  ];
}

/** Tail /status + host-daemon.log after HostHub never attached. */
export function peerLogDumpCommand(serverHost: string): string {
  const host = requireServerHost(serverHost);
  return [
    `data_dir="$HOME/.zcc-machines/${host}"`,
    'echo "--- /status ---"',
    'if [ -f "$data_dir/host-daemon.port" ]; then',
    '  port=$(cat "$data_dir/host-daemon.port")',
    '  curl -sS --max-time 2 "http://127.0.0.1:$port/status" || echo "status endpoint unreachable"',
    'else',
    '  echo "status endpoint unreachable"',
    'fi',
    'echo "--- host-daemon.log ---"',
    'if [ -f "$data_dir/host-daemon.log" ]; then tail -n 80 "$data_dir/host-daemon.log"; else echo "(no log yet)"; fi'
  ].join('\n');
}

const PEER_HOST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePeerDaemonStatusOutput(
  stdout: string,
  code: number | null
): { state: PeerDaemonState; hostId?: string } {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const statusLine =
    lines.find((line) => /^(connected|disconnected|not_installed)(?:\s|$)/.test(line))
    ?? lines[0]
    ?? '';
  const [token, maybeId] = statusLine.split(/\s+/);
  const hostId = maybeId && PEER_HOST_ID_RE.test(maybeId) ? maybeId : undefined;
  const withId = hostId ? { hostId } : {};
  if (token === 'not_installed') {
    return { state: 'not_installed', ...withId };
  }
  if (token === 'connected') {
    return { state: 'connected', ...withId };
  }
  if (token === 'disconnected') return { state: 'disconnected', ...withId };
  if (code === 2) return { state: 'not_installed', ...withId };
  return { state: 'disconnected', ...withId };
}

export function peerStatusCommand(serverHost: string): string {
  const host = requireServerHost(serverHost);
  return [
    `data_dir="$HOME/.zcc-machines/${host}"`,
    'port_file="$data_dir/host-daemon.port"',
    'host_id=""',
    'if [ -f "$data_dir/host.id" ]; then host_id=$(tr -d "[:space:]" < "$data_dir/host.id"); fi',
    'if [ ! -f "$port_file" ]; then echo "not_installed $host_id"; exit 2; fi',
    'port=$(cat "$port_file")',
    'if curl -sf "http://127.0.0.1:$port/status" 2>/dev/null | grep -q \'"connected":true\'; then echo "connected $host_id"; exit 0; fi',
    'echo "disconnected $host_id"; exit 1'
  ].join('\n');
}

export function peerRestartCommand(serverHost: string): string {
  const host = requireServerHost(serverHost);
  return [
    `label=${shQuote(`ai.zana.zcc-host-daemon.${host}`)}`,
    `unit=${shQuote(`zcc-host-daemon-${host}.service`)}`,
    'uname_s=$(uname -s)',
    'if [ "$uname_s" = Darwin ]; then',
    '  launchctl kickstart -k "gui/$(id -u)/$label" 2>/dev/null || launchctl start "$label"',
    'elif command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then',
    '  systemctl --user restart "$unit"',
    'else',
    `  data_dir="$HOME/.zcc-machines/${host}"`,
    '  join_bin="$data_dir/runtime/join.mjs"',
    ...peerNodeSelectionLines().map(line => `  ${line}`),
    '  export PATH="$(dirname "$node_bin"):$PATH"',
    '  ZCC_DATA_DIR="$data_dir" ZCC_PROJECT_CATALOGUE_DATA_DIR="$HOME/.zcc" "$node_bin" "$join_bin" restart',
    'fi'
  ].join('\n');
}

function peerNodeSelectionLines(): string[] {
  return [
    'node_bin=""',
    'if [ -n "${ZCC_NODE:-}" ] && [ -x "$ZCC_NODE" ]; then node_bin=$ZCC_NODE; fi',
    'if [ -z "$node_bin" ] && command -v node >/dev/null 2>&1; then node_bin=$(command -v node); fi',
    'if [ -z "$node_bin" ] || [ "$("$node_bin" -e "process.stdout.write(String(parseInt(process.versions.node,10)))" 2>/dev/null || echo 0)" -lt 22 ]; then',
    '  for cand in "$HOME/.nix-profile/bin/node" /nix/store/*-nodejs-22.*/bin/node /nix/store/*-nodejs-24.*/bin/node /nix/store/*-nodejs-slim-22.*/bin/node /nix/store/*-nodejs-slim-24.*/bin/node; do',
    '    [ -x "$cand" ] || continue',
    '    major=$("$cand" -e "process.stdout.write(String(parseInt(process.versions.node,10)))" 2>/dev/null) || continue',
    '    if [ "$major" -ge 22 ]; then node_bin=$cand; break; fi',
    '  done',
    'fi',
    '[ -n "$node_bin" ] && [ "$("$node_bin" -e "process.stdout.write(String(parseInt(process.versions.node,10)))" 2>/dev/null || echo 0)" -ge 22 ] || { echo "Node.js >= 22 is required" >&2; exit 1; }'
  ];
}

export function peerUnpackCommand(serverHost: string): string {
  const host = requireServerHost(serverHost);
  return [
    `data_dir="$HOME/.zcc-machines/${host}"`,
    'package_dir="$data_dir/runtime"',
    'mkdir -p "$package_dir"',
    'chmod 700 "$data_dir"',
    'tar -xzf - -C "$package_dir"'
  ].join('\n');
}

/**
 * Stop every daemon this install replaces: the PID file plus any process running
 * this runtime or this host id, whichever Node started it. Never signal a PID
 * alone: it can outlive the process it named.
 */
export function safeStopStandaloneDaemonLines(): string[] {
  return [
    'host_match=" --host-id ${host_id:-<none>} "',
    'replaced_daemon() {',
    '  case " $1 " in',
    '    *" $package_dir/join.mjs join "*|*" $package_dir/join.cjs join "*|*" ${join_bin:-<none>} join "*) return 0 ;;',
    '    *"/join.mjs join"*"$host_match"*|*"/join.cjs join"*"$host_match"*) return 0 ;;',
    '  esac',
    '  return 1',
    '}',
    'old_pids=""',
    'if [ -f "$data_dir/host-daemon.pid" ]; then old_pids=$(cat "$data_dir/host-daemon.pid"); fi',
    'old_pids="$old_pids $(ps -eo pid= -o command= 2>/dev/null | while read -r old_pid old_command; do if replaced_daemon "$old_command"; then echo "$old_pid"; fi; done)"',
    'for old_pid in $old_pids; do',
    '  case "$old_pid" in ""|*[!0-9]*|0|1) continue ;; esac',
    '  [ "$old_pid" != "$$" ] || continue',
    '  old_command=$(ps -p "$old_pid" -o command= 2>/dev/null || true); old_started=$(ps -p "$old_pid" -o lstart= 2>/dev/null || true)',
    '  [ -n "$old_started" ] && replaced_daemon "$old_command" || continue',
    '  kill "$old_pid" 2>/dev/null || true',
    '  i=0; while [ "$i" -lt 10 ] && [ "$(ps -p "$old_pid" -o lstart= 2>/dev/null || true)" = "$old_started" ]; do i=$((i + 1)); sleep 1; done',
    '  if [ "$(ps -p "$old_pid" -o lstart= 2>/dev/null || true)" = "$old_started" ] && [ "$(ps -p "$old_pid" -o command= 2>/dev/null || true)" = "$old_command" ]; then kill -9 "$old_pid" 2>/dev/null || true; fi',
    'done',
    'rm -f "$data_dir/host-daemon.pid"'
  ];
}

/** A host id runs once per machine: retire services that run it for another server address. */
export function retireDuplicateHostServiceLines(): string[] {
  return [
    'if [ "$(uname -s)" = Darwin ]; then',
    '  for old_unit in "$HOME"/Library/LaunchAgents/ai.zana.zcc-host-daemon.*.plist; do',
    '    [ -f "$old_unit" ] && grep -qF "<string>${host_id:-<none>}</string>" "$old_unit" && ! grep -qF "<string>$package_dir/" "$old_unit" || continue',
    '    launchctl bootout "gui/$(id -u)/$(basename "$old_unit" .plist)" 2>/dev/null || true',
    '    mv -f "$old_unit" "$old_unit.retired" 2>/dev/null || true',
    '    echo "Retired $(basename "$old_unit" .plist): it ran this machine for another server address."',
    '  done',
    'else',
    '  for old_unit in "$HOME"/.config/systemd/user/zcc-host-daemon-*.service; do',
    '    [ -f "$old_unit" ] && grep -qF -- "--host-id ${host_id:-<none>} " "$old_unit" && ! grep -qF -- "$package_dir/" "$old_unit" || continue',
    '    systemctl --user disable --now "$(basename "$old_unit")" 2>/dev/null || true',
    '    mv -f "$old_unit" "$old_unit.retired" 2>/dev/null || true',
    '    systemctl --user daemon-reload 2>/dev/null || true',
    '    echo "Retired $(basename "$old_unit"): it ran this machine for another server address."',
    '  done',
    'fi'
  ];
}

export function peerInstallServiceCommand(input: {
  serverHost: string;
  joinCode: string;
  hostId: string;
  serverUrl: string;
  provenance?: 'tunnel' | 'non-tunnel';
  /** One-join consent to replace a prior enrollment; never written to the service unit. */
  replaceEnrollment?: boolean;
}): string {
  const host = requireServerHost(input.serverHost);
  const label = `ai.zana.zcc-host-daemon.${host}`;
  const unit = `zcc-host-daemon-${host}.service`;
  return [
    `data_dir="$HOME/.zcc-machines/${host}"`,
    'package_dir="$data_dir/runtime"',
    'join_bin="$package_dir/join.mjs"',
    'if [ ! -f "$join_bin" ]; then join_bin="$package_dir/join.cjs"; fi',
    'port_dir="$HOME/.zcc-machines/host-daemon-ports"',
    'port_file="$data_dir/host-daemon.port"',
    'mkdir -p "$port_dir"',
    ...peerNodeSelectionLines(),
    'export PATH="$(dirname "$node_bin"):$PATH"',
    '[ -f "$join_bin" ] || { echo "join CLI missing from artifact" >&2; exit 1; }',
    `host_id=${shQuote(input.hostId)}`,
    // Stop the services first so they cannot race the replacement background daemon.
    `if [ "$(uname -s)" = Darwin ]; then launchctl bootout "gui/$(id -u)/${label}" 2>/dev/null || true; elif command -v systemctl >/dev/null 2>&1; then systemctl --user stop ${shQuote(unit)} 2>/dev/null || true; fi`,
    ...retireDuplicateHostServiceLines(),
    ...safeStopStandaloneDaemonLines(),
    'if [ -f "$port_file" ]; then port=$(cat "$port_file"); else port=38888; while [ -e "$port_dir/$port" ]; do port=$((port + 1)); done; fi',
    'printf "%s\\n" "$port" > "$port_file"',
    'printf "%s\\n" "$data_dir" > "$port_dir/$port"',
    `join_code=${shQuote(input.joinCode)}`,
    `server_url=${shQuote(input.serverUrl)}`,
    'export ZCC_DATA_DIR="$data_dir" ZCC_SERVER_URL="$server_url"',
    'export ZCC_PROJECT_CATALOGUE_DATA_DIR="$HOME/.zcc"',
    `export ZCC_HOST_ENROLLMENT_PROVENANCE=${input.provenance === 'tunnel' ? 'tunnel' : 'non-tunnel'}`,
    ...(input.replaceEnrollment ? ['export ZCC_HOST_REPLACE_ENROLLMENT=1'] : []),
    // Marks where this attempt's output begins so the primary reads only its lines.
    'printf "zcc-join: attempt %s host=%s\\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$host_id" >>"$data_dir/host-daemon.log"',
    'nohup "$node_bin" "$join_bin" join --join-code "$join_code" --host-id "$host_id" --server-url "$server_url" --host-daemon-port "$port" --auto-update >>"$data_dir/host-daemon.log" 2>&1 &',
    'join_pid=$!',
    'printf "%s\\n" "$join_pid" > "$data_dir/host-daemon.pid"',
    'i=0',
    'while [ "$i" -lt 60 ]; do',
    '  if curl -sf "http://127.0.0.1:$port/status" 2>/dev/null | grep -q \'"connected":true\'; then break; fi',
    '  i=$((i + 1)); sleep 1',
    'done',
    ...peerJoinFailureDump(),
    'uname_s=$(uname -s)',
    'if [ "$uname_s" = Darwin ]; then',
    '  kill "$join_pid" 2>/dev/null || true',
    '  sleep 1',
    '  rm -f "$data_dir/host-daemon.pid"',
    `  plist="$HOME/Library/LaunchAgents/${label}.plist"`,
    '  mkdir -p "$HOME/Library/LaunchAgents"',
    '  printf "%s\\n" "<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>" > "$plist"',
    `  printf "%s\\n" "<!DOCTYPE plist PUBLIC \\"-//Apple//DTD PLIST 1.0//EN\\" \\"http://www.apple.com/DTDs/PropertyList-1.0.dtd\\">" >> "$plist"`,
    '  printf "%s\\n" "<plist version=\\"1.0\\"><dict>" >> "$plist"',
    `  printf "%s\\n" "<key>Label</key><string>${label}</string>" >> "$plist"`,
    '  printf "%s\\n" "<key>ProgramArguments</key><array>" >> "$plist"',
    '  printf "%s\\n" "<string>$node_bin</string>" >> "$plist"',
    '  printf "%s\\n" "<string>$join_bin</string>" >> "$plist"',
    '  printf "%s\\n" "<string>join</string>" >> "$plist"',
    '  printf "%s\\n" "<string>--host-id</string><string>$host_id</string>" >> "$plist"',
    '  printf "%s\\n" "<string>--server-url</string><string>$server_url</string>" >> "$plist"',
    '  printf "%s\\n" "<string>--host-daemon-port</string><string>$port</string>" >> "$plist"',
    '  printf "%s\\n" "<string>--auto-update</string></array>" >> "$plist"',
    '  printf "%s\\n" "<key>EnvironmentVariables</key><dict>" >> "$plist"',
    '  printf "%s\\n" "<key>ZCC_DATA_DIR</key><string>$data_dir</string>" >> "$plist"',
    '  printf "%s\\n" "<key>ZCC_PROJECT_CATALOGUE_DATA_DIR</key><string>$ZCC_PROJECT_CATALOGUE_DATA_DIR</string>" >> "$plist"',
    '  printf "%s\\n" "<key>ZCC_SERVER_URL</key><string>$server_url</string>" >> "$plist"',
    '  printf "%s\\n" "<key>ZCC_HOST_ENROLLMENT_PROVENANCE</key><string>$ZCC_HOST_ENROLLMENT_PROVENANCE</string>" >> "$plist"',
    '  printf "%s\\n" "<key>ZCC_HOST_SERVICE_MANAGED</key><string>1</string>" >> "$plist"',
    '  printf "%s\\n" "</dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>" >> "$plist"',
    '  launchctl unload "$plist" 2>/dev/null || true',
    '  launchctl load "$plist"',
    'elif command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then',
    '  kill "$join_pid" 2>/dev/null || true',
    '  sleep 1',
    '  rm -f "$data_dir/host-daemon.pid"',
    '  unit_dir="$HOME/.config/systemd/user"',
    '  mkdir -p "$unit_dir"',
    `  unit="$unit_dir/${unit}"`,
    '  printf "%s\\n" "[Unit]" > "$unit"',
    `  printf "%s\\n" "Description=ZCC host daemon (${host})" >> "$unit"`,
    '  printf "%s\\n" "After=network-online.target" >> "$unit"',
    '  printf "%s\\n" "[Service]" >> "$unit"',
    '  printf "%s\\n" "ExecStart=$node_bin $join_bin join --host-id $host_id --server-url $server_url --host-daemon-port $port --auto-update" >> "$unit"',
    '  printf "%s\\n" "Environment=ZCC_DATA_DIR=$data_dir" >> "$unit"',
    '  printf "%s\\n" "Environment=ZCC_PROJECT_CATALOGUE_DATA_DIR=$ZCC_PROJECT_CATALOGUE_DATA_DIR" >> "$unit"',
    '  printf "%s\\n" "Environment=ZCC_SERVER_URL=$server_url" >> "$unit"',
    '  printf "%s\\n" "Environment=ZCC_HOST_ENROLLMENT_PROVENANCE=$ZCC_HOST_ENROLLMENT_PROVENANCE" >> "$unit"',
    '  printf "%s\\n" "Environment=ZCC_HOST_SERVICE_MANAGED=1" >> "$unit"',
    '  printf "%s\\n" "Restart=always" >> "$unit"',
    '  printf "%s\\n" "RestartSec=3" >> "$unit"',
    '  printf "%s\\n" "[Install]" >> "$unit"',
    '  printf "%s\\n" "WantedBy=default.target" >> "$unit"',
    '  systemctl --user daemon-reload',
    `  systemctl --user enable --now ${shQuote(unit)}`,
    'else',
    '  echo "No systemd user bus; leaving the host daemon running in the background."',
    'fi',
    'echo "Host daemon connected."'
  ].join('\n');
}

export async function peerDaemonStatus(
  ssh: PeerDaemonSsh,
  remote: ProjectRemote,
  serverHost: string
): Promise<{ state: PeerDaemonState; message?: string }> {
  const result = await ssh.run(remote, peerStatusCommand(serverHost));
  const parsed = parsePeerDaemonStatusOutput(result.stdout, result.code);
  if (parsed.state === 'not_installed') {
    return {
      ...parsed,
      message: logText(result) || 'Host daemon is not installed'
    };
  }
  if (parsed.state === 'connected') {
    return parsed;
  }
  return { ...parsed, message: logText(result) || 'Host daemon is not connected' };
}

export async function peerDaemonRestart(
  ssh: PeerDaemonSsh,
  remote: ProjectRemote,
  serverHost: string
): Promise<{ ok: true; log: string }> {
  const status = await peerDaemonStatus(ssh, remote, serverHost);
  if (status.state === 'not_installed') {
    throw new HostCommandError('not_installed', 'Host daemon is not installed on that machine');
  }
  const result = await ssh.run(remote, peerRestartCommand(serverHost));
  if (result.code !== 0) {
    throw new HostCommandError('peer_restart_failed', logText(result) || 'Could not restart the host daemon');
  }
  return { ok: true, log: logText(result) };
}

export async function peerDaemonLogs(
  ssh: PeerDaemonSsh,
  remote: ProjectRemote,
  serverHost: string
): Promise<{ log: string }> {
  const result = await ssh.run(remote, peerLogDumpCommand(serverHost));
  return { log: logText(result) };
}

export async function peerDaemonInstall(
  ssh: PeerDaemonSsh,
  input: {
    remote: ProjectRemote;
    joinCode: string;
    hostId: string;
    serverUrl: string;
    serverHost: string;
    artifactPath: string;
    sshTunnel?: { localPort: number; remotePort: number };
    replaceEnrollment?: boolean;
  }
): Promise<{ ok: true; log: string }> {
  if (!existsSync(input.artifactPath)) {
    throw new HostCommandError('artifact_missing', 'host-daemon artifact is missing');
  }
  if (input.sshTunnel) {
    const { localPort, remotePort } = input.sshTunnel;
    if (input.serverUrl !== `http://127.0.0.1:${remotePort}` || !ssh.tunnel) {
      throw new HostCommandError('invalid_server_url', 'SSH tunnel must target the product server on loopback');
    }
    await ssh.tunnel(input.remote, localPort, remotePort);
  }
  try {
    const unpacked = await ssh.pipeFile(input.remote, peerUnpackCommand(input.serverHost), input.artifactPath);
    if (unpacked.code !== 0) {
      throw new HostCommandError('peer_unpack_failed', logText(unpacked) || 'Could not unpack the host-daemon artifact');
    }
    const installed = await ssh.run(
      input.remote,
      peerInstallServiceCommand({
        serverHost: input.serverHost,
        joinCode: input.joinCode,
        hostId: input.hostId,
        serverUrl: input.serverUrl,
        provenance: input.sshTunnel ? 'tunnel' : 'non-tunnel',
        ...(input.replaceEnrollment ? { replaceEnrollment: true } : {})
      })
    );
    if (installed.code !== 0) {
      throw new HostCommandError('peer_install_failed', logText(installed) || 'Could not install the host daemon');
    }
    return { ok: true, log: `${logText(unpacked)}\n${logText(installed)}`.trim() };
  } catch (error) {
    if (input.sshTunnel) ssh.untunnel?.(input.remote, input.sshTunnel.localPort, input.sshTunnel.remotePort);
    throw error;
  }
}
