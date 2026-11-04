import { removeTreeWithoutFollowingLinksAsync } from '@zana-ai/zcc-agent-process-utils';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, rm, symlink, readlink, lstat, copyFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { list, extract } from 'tar';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { joinServerUrl } from './server-url.js';
import { connectHostFetch, readConnectHostAccess } from './connect-access.js';

export const SELF_UPDATE_INITIAL_RETRY_DELAY_MS = 5_000;
export const SELF_UPDATE_MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
export const SELF_UPDATE_MAX_BYTES = 16 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const FILES = new Set(['package.json', 'join.mjs', 'zcc-provider-bridge-worker.mjs', 'zcc-pi-bridge.mjs', 'zcc-plugin-host-worker.mjs']);
const LEGACY_FILES = new Set(['package.json', 'join.mjs', 'bb-provider-bridge-worker.mjs', 'bb-pi-bridge.mjs', 'zcc-plugin-host-worker.mjs']);
const ALLOWED_FILES = new Set([...FILES, ...LEGACY_FILES]);
interface UpdateAttempt { attemptedAt: number; attemptCount: number; protocolVersion: number }
interface PendingUpdate { entry: string; backup: string; generation: string }
export type ProtocolSelfUpdateResult = 'failed' | 'skipped' | 'updated' | 'backoff';
const pending = new Map<string, Promise<ProtocolSelfUpdateResult>>();
type Options = {
  dataDir: string; serverUrl: string; enabled: boolean; force?: boolean; now?: number;
  fetchFn?: typeof fetch;
  /** Tests may supply a validator; production always executes the staged bundle. */
  validate?: (entry: string, protocolVersion: number) => Promise<void>;
};

async function atomicJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

async function readBounded(response: Response, max: number): Promise<Buffer> {
  if (!response.ok || Number(response.headers.get('content-length')) > max || !response.body) throw new Error('Invalid update response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) throw new Error('Host update exceeds size limit');
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } finally { await reader.cancel().catch(() => {}); }
}

export function validateHostBundle(entry: string, protocol: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // Exit status is the protocol probe: no piped CLI output to truncate in Electron.
    const child = spawn(process.execPath, [entry, '--check-protocol', String(protocol)], {
      cwd: dirname(entry), stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Host update validation timed out')); }, TIMEOUT_MS);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Host update validation failed')); });
  });
}

export function handleProtocolMismatch(options: Options): Promise<ProtocolSelfUpdateResult> {
  if (!options.enabled) return Promise.resolve('skipped');
  const existing = pending.get(options.dataDir);
  if (existing) return existing;
  const task = update(options).catch(error => {
    console.error('Host update failed:', error instanceof Error ? error.message : 'unknown error');
    return 'failed' as const;
  }).finally(() => pending.delete(options.dataDir));
  pending.set(options.dataDir, task);
  return task;
}

async function update(options: Options): Promise<ProtocolSelfUpdateResult> {
  const now = options.now ?? Date.now();
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
  const attemptFile = join(options.dataDir, 'host-daemon-update-attempt.json');
  let previous: UpdateAttempt | null = null;
  try { previous = JSON.parse(await readFile(attemptFile, 'utf8')); } catch { /* first attempt */ }
  if (previous && Number.isFinite(previous.attemptedAt)) {
    const delay = Math.min(SELF_UPDATE_INITIAL_RETRY_DELAY_MS * 2 ** Math.max(0, (previous.attemptCount || 1) - 1), SELF_UPDATE_MAX_RETRY_DELAY_MS);
    if (now - previous.attemptedAt < delay) return 'backoff';
  }
  // Record before I/O, including failed metadata requests, to bound retry storms.
  await atomicJson(attemptFile, { attemptedAt: now, attemptCount: (previous?.attemptCount ?? 0) + 1, protocolVersion: HOST_RPC_PROTOCOL_VERSION });
  const fetchFn = connectHostFetch(options.serverUrl, readConnectHostAccess(options.dataDir, options.serverUrl)?.credential, options.fetchFn ?? fetch);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const metadata = JSON.parse((await readBounded(await fetchFn(joinServerUrl(options.serverUrl, '/install/version'), { signal, redirect: 'error' }), 4096)).toString());
  const remote = metadata.protocolVersion;
  if (!Number.isSafeInteger(remote) || remote <= HOST_RPC_PROTOCOL_VERSION) return 'skipped';
  const bytes = await readBounded(await fetchFn(joinServerUrl(options.serverUrl, '/install/zcc-host.tgz'), { signal, redirect: 'error' }), SELF_UPDATE_MAX_BYTES);
  const unpacked = await promisify(gunzip)(bytes, { maxOutputLength: MAX_UNPACKED_BYTES });
  const runtime = join(options.dataDir, 'runtime');
  const generation = `release-${randomUUID()}`;
  const stage = join(runtime, generation);
  const archive = join(runtime, `.update-${randomUUID()}.tar`);
  await mkdir(stage, { recursive: true, mode: 0o700 });
  let promoted = false;
  let backupPath: string | undefined;
  let pendingWritten = false;
  try {
    await writeFile(archive, unpacked, { mode: 0o600 });
    const seen = new Set<string>();
    let invalid = false;
    await list({ file: archive, strict: true, onReadEntry(entry) {
      // macOS tar may include AppleDouble metadata. Never extract it.
      if (entry.path.startsWith('._') && entry.type === 'File') return;
      if (entry.type !== 'File' || !ALLOWED_FILES.has(entry.path) || seen.has(entry.path)) invalid = true;
      seen.add(entry.path);
    } });
    if (invalid || !([FILES, LEGACY_FILES].some(files => seen.size === files.size && [...files].every(file => seen.has(file))))) throw new Error('Invalid host update archive entries');
    await extract({ file: archive, cwd: stage, strict: true, filter: path => ALLOWED_FILES.has(path), noChmod: true });
    await (options.validate ?? validateHostBundle)(join(stage, 'join.mjs'), remote);
    const entry = 'join.mjs';
    const backup = `.previous-${randomUUID()}.mjs`;
    const installed = join(runtime, entry);
    backupPath = join(runtime, backup);
    const stat = await lstat(installed);
    if (stat.isSymbolicLink()) await symlink(await readlink(installed), join(runtime, backup));
    else await copyFile(installed, join(runtime, backup));
    await atomicJson(join(runtime, 'update-pending.json'), { entry, backup, generation } satisfies PendingUpdate);
    pendingWritten = true;
    const temporary = join(runtime, `.launcher-${randomUUID()}.mjs`);
    try {
      await symlink(relative(runtime, join(stage, 'join.mjs')), temporary);
      await rename(temporary, installed); // one atomic change; companions remain together in the generation
      promoted = true;
    } finally { await rm(temporary, { force: true }); }
    return 'updated';
  } finally {
    await rm(archive, { force: true });
    if (!promoted) {
      if (pendingWritten) await rm(join(runtime, 'update-pending.json'), { force: true });
      if (backupPath) await rm(backupPath, { force: true });
      await removeTreeWithoutFollowingLinksAsync(stage);
    }
  }
}

async function readPending(dataDir: string): Promise<PendingUpdate | null> {
  try {
    const record = JSON.parse(await readFile(join(dataDir, 'runtime/update-pending.json'), 'utf8')) as PendingUpdate;
    if (record.entry !== 'join.mjs' || !/^\.previous-[a-f0-9-]+\.mjs$/.test(record.backup) || !/^release-[a-f0-9-]+$/.test(record.generation)) return null;
    return record;
  } catch { return null; }
}

/** Called only after the replacement daemon completes its server handshake. */
export async function confirmHostUpdate(dataDir: string): Promise<void> {
  const record = await readPending(dataDir);
  if (!record) return;
  const runtime = join(dataDir, 'runtime');
  await rm(join(runtime, 'update-pending.json'), { force: true });
  await rm(join(runtime, record.backup), { force: true });
  for (const entry of await readdir(runtime)) {
    if (/^release-[a-f0-9-]+$/.test(entry) && entry !== record.generation) await removeTreeWithoutFollowingLinksAsync(join(runtime, entry));
  }
}

/** Restore the last executable if the new daemon cannot complete startup. */
export async function rollbackHostUpdate(dataDir: string): Promise<boolean> {
  const record = await readPending(dataDir);
  if (!record) return false;
  const runtime = join(dataDir, 'runtime');
  await rename(join(runtime, record.backup), join(runtime, record.entry));
  await rm(join(runtime, 'update-pending.json'), { force: true });
  await removeTreeWithoutFollowingLinksAsync(join(runtime, record.generation));
  return true;
}
