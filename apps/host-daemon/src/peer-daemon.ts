import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import type { ProjectRemote } from '@zana-ai/zcc-domain/product';
import { sshBaseArgs } from './remote-fs.js';
import { HostCommandError } from './host-command-error.js';

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

export function createSystemPeerDaemonSsh(): PeerDaemonSsh {
  return {
    async run(remote, remoteCmd, timeoutMs = SSH_TIMEOUT_MS) {
      const proc = spawn('ssh', [...sshBaseArgs(remote), remoteCmd], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return collectStream(proc, timeoutMs);
    },
    async pipeFile(remote, remoteCmd, filePath, timeoutMs = SSH_TIMEOUT_MS) {
      const proc = spawn('ssh', [...sshBaseArgs(remote), remoteCmd], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const input = createReadStream(filePath);
      input.pipe(proc.stdin!);
      input.on('error', () => proc.kill('SIGKILL'));
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

export function peerStatusCommand(serverHost: string): string {
  const host = requireServerHost(serverHost);
  return [
    `data_dir="$HOME/.zcc-machines/${host}"`,
    'port_file="$data_dir/host-daemon.port"',
    'if [ ! -f "$port_file" ]; then echo not_installed; exit 2; fi',
    'port=$(cat "$port_file")',
    'if curl -sf "http://127.0.0.1:$port/status" 2>/dev/null | grep -q \'"connected":true\'; then echo connected; exit 0; fi',
    'echo disconnected; exit 1'
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
    '  echo "No systemd user bus to restart" >&2',
    '  exit 1',
    'fi'
  ].join('\n');
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

export function peerInstallServiceCommand(input: {
  serverHost: string;
  joinCode: string;
  hostId: string;
  serverUrl: string;
}): string {
  const host = requireServerHost(input.serverHost);
  const label = `ai.zana.zcc-host-daemon.${host}`;
  const unit = `zcc-host-daemon-${host}.service`;
  return [
    `data_dir="$HOME/.zcc-machines/${host}"`,
    'package_dir="$data_dir/runtime"',
    'join_bin="$package_dir/join.cjs"',
    'if [ ! -f "$join_bin" ]; then join_bin="$package_dir/join.mjs"; fi',
    'port_dir="$HOME/.zcc-machines/host-daemon-ports"',
    'port_file="$data_dir/host-daemon.port"',
    'mkdir -p "$port_dir"',
    'node_bin=""',
    'if [ -n "${ZCC_NODE:-}" ] && [ -x "$ZCC_NODE" ]; then node_bin=$ZCC_NODE; fi',
    'if [ -z "$node_bin" ] && command -v node >/dev/null 2>&1; then node_bin=$(command -v node); fi',
    'if [ -z "$node_bin" ] || [ "$("$node_bin" -p "parseInt(process.versions.node,10)" 2>/dev/null || echo 0)" -lt 22 ]; then',
    '  for cand in "$HOME/.nix-profile/bin/node" /nix/store/*-nodejs-22.*/bin/node /nix/store/*-nodejs-24.*/bin/node /nix/store/*-nodejs-slim-22.*/bin/node /nix/store/*-nodejs-slim-24.*/bin/node; do',
    '    [ -x "$cand" ] || continue',
    '    major=$("$cand" -p "parseInt(process.versions.node,10)" 2>/dev/null) || continue',
    '    if [ "$major" -ge 22 ]; then node_bin=$cand; break; fi',
    '  done',
    'fi',
    '[ -n "$node_bin" ] && [ "$("$node_bin" -p "parseInt(process.versions.node,10)" 2>/dev/null || echo 0)" -ge 22 ] || { echo "Node.js >= 22 is required" >&2; exit 1; }',
    'export PATH="$(dirname "$node_bin"):$PATH"',
    '[ -f "$join_bin" ] || { echo "join CLI missing from artifact" >&2; exit 1; }',
    'if [ -f "$data_dir/host-daemon.pid" ]; then old_pid=$(cat "$data_dir/host-daemon.pid"); kill "$old_pid" 2>/dev/null || true; i=0; while [ "$i" -lt 10 ] && kill -0 "$old_pid" 2>/dev/null; do i=$((i + 1)); sleep 1; done; kill -9 "$old_pid" 2>/dev/null || true; fi',
    'if [ -f "$port_file" ]; then port=$(cat "$port_file"); else port=38888; while [ -e "$port_dir/$port" ]; do port=$((port + 1)); done; fi',
    'printf "%s\\n" "$port" > "$port_file"',
    'printf "%s\\n" "$data_dir" > "$port_dir/$port"',
    `join_code=${shQuote(input.joinCode)}`,
    `host_id=${shQuote(input.hostId)}`,
    `server_url=${shQuote(input.serverUrl)}`,
    'export ZCC_DATA_DIR="$data_dir" ZCC_SERVER_URL="$server_url"',
    'nohup "$node_bin" "$join_bin" join --join-code "$join_code" --host-id "$host_id" --server-url "$server_url" --host-daemon-port "$port" --auto-update >>"$data_dir/host-daemon.log" 2>&1 &',
    'join_pid=$!',
    'printf "%s\\n" "$join_pid" > "$data_dir/host-daemon.pid"',
    'i=0',
    'while [ "$i" -lt 60 ]; do',
    '  if curl -sf "http://127.0.0.1:$port/status" 2>/dev/null | grep -q \'"connected":true\'; then break; fi',
    '  i=$((i + 1)); sleep 1',
    'done',
    'if ! curl -sf "http://127.0.0.1:$port/status" 2>/dev/null | grep -q \'"connected":true\'; then',
    '  echo "host daemon did not report connected" >&2; kill "$join_pid" 2>/dev/null || true; exit 1',
    'fi',
    'uname_s=$(uname -s)',
    'if [ "$uname_s" = Darwin ]; then',
    '  kill "$join_pid" 2>/dev/null || true',
    '  sleep 1',
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
    '  printf "%s\\n" "<key>ZCC_SERVER_URL</key><string>$server_url</string>" >> "$plist"',
    '  printf "%s\\n" "</dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>" >> "$plist"',
    '  launchctl unload "$plist" 2>/dev/null || true',
    '  launchctl load "$plist"',
    'elif command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then',
    '  kill "$join_pid" 2>/dev/null || true',
    '  sleep 1',
    '  unit_dir="$HOME/.config/systemd/user"',
    '  mkdir -p "$unit_dir"',
    `  unit="$unit_dir/${unit}"`,
    '  printf "%s\\n" "[Unit]" > "$unit"',
    `  printf "%s\\n" "Description=ZCC host daemon (${host})" >> "$unit"`,
    '  printf "%s\\n" "After=network-online.target" >> "$unit"',
    '  printf "%s\\n" "[Service]" >> "$unit"',
    '  printf "%s\\n" "ExecStart=$node_bin $join_bin join --host-id $host_id --server-url $server_url --host-daemon-port $port --auto-update" >> "$unit"',
    '  printf "%s\\n" "Environment=ZCC_DATA_DIR=$data_dir" >> "$unit"',
    '  printf "%s\\n" "Environment=ZCC_SERVER_URL=$server_url" >> "$unit"',
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
  if (result.code === 2 || result.stdout.includes('not_installed')) {
    return { state: 'not_installed', message: logText(result) || 'Host daemon is not installed' };
  }
  if (result.code === 0 || result.stdout.includes('connected')) {
    return { state: 'connected' };
  }
  return { state: 'disconnected', message: logText(result) || 'Host daemon is not connected' };
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

export async function peerDaemonInstall(
  ssh: PeerDaemonSsh,
  input: {
    remote: ProjectRemote;
    joinCode: string;
    hostId: string;
    serverUrl: string;
    serverHost: string;
    artifactPath: string;
  }
): Promise<{ ok: true; log: string }> {
  if (!existsSync(input.artifactPath)) {
    throw new HostCommandError('artifact_missing', 'host-daemon artifact is missing');
  }
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
      serverUrl: input.serverUrl
    })
  );
  if (installed.code !== 0) {
    throw new HostCommandError('peer_install_failed', logText(installed) || 'Could not install the host daemon');
  }
  return { ok: true, log: `${logText(unpacked)}\n${logText(installed)}`.trim() };
}
