import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type {
  CodexProjectSettings,
  CodexSettingsResult,
  OpenCodeProjectSettings,
  OpenCodeSettingsResult
} from '@zana-ai/zcc-domain/product';

const MAX_FILE_BYTES = 256 * 1024;
const MAX_STRING_LENGTH = 4_096;
const locks = new Map<string, Promise<void>>();

function hash(text: string) { return createHash('sha256').update(text).digest('hex'); }
function message(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return code ? `Unable to access harness settings (${code})` : 'Unable to access harness settings';
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function targetFor(root: string, relativePath: string): Promise<{ dir: string; target: string } | { state: 'io-error'; message: string }> {
  const target = join(root, relativePath);
  if (relative(root, target).startsWith('..')) return { state: 'io-error', message: 'Harness settings target is outside project' };
  const dir = dirname(target);
  try {
    const stat = await lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { state: 'io-error', message: 'Harness settings directory is not safe' };
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) return { state: 'io-error', message: message(error) };
  }
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) return { state: 'io-error', message: 'Harness settings file is not safe' };
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) return { state: 'io-error', message: message(error) };
  }
  return { dir, target };
}

async function readText(target: string): Promise<{ text: string } | { state: 'missing' | 'io-error'; message?: string }> {
  let file;
  try { file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { state: 'missing' };
    return { state: 'io-error', message: message(error) };
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return { state: 'io-error', message: 'Harness settings file is not a safe size' };
    return { text: await file.readFile({ encoding: 'utf-8' }) };
  } catch (error) { return { state: 'io-error', message: message(error) }; }
  finally { await file.close(); }
}

async function withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  locks.set(key, queued);
  await previous;
  try { return await operation(); }
  finally { release(); if (locks.get(key) === queued) locks.delete(key); }
}

async function writeAtomic(root: string, location: { dir: string; target: string }, text: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const tmp = `${location.target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await mkdir(location.dir, { recursive: true });
    const [realRoot, realDir] = await Promise.all([realpath(root), realpath(location.dir)]);
    if (realDir !== realRoot && !realDir.startsWith(`${realRoot}/`)) return { ok: false, message: 'Harness settings directory changed during write' };
    await writeFile(tmp, text, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
    await rename(tmp, location.target);
    return { ok: true };
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    return { ok: false, message: message(error) };
  }
}

const CODEX_KEYS = new Set(['model', 'approval_policy', 'sandbox_mode']);
function codexView(raw: Record<string, unknown>): CodexProjectSettings {
  const settings: CodexProjectSettings = {};
  if (typeof raw.model === 'string') settings.model = raw.model;
  if (raw.approval_policy === 'untrusted' || raw.approval_policy === 'on-request' || raw.approval_policy === 'never') settings.approvalPolicy = raw.approval_policy;
  if (raw.sandbox_mode === 'read-only' || raw.sandbox_mode === 'workspace-write' || raw.sandbox_mode === 'danger-full-access') settings.sandboxMode = raw.sandbox_mode;
  const unknown = Object.keys(raw).filter((key) => !CODEX_KEYS.has(key));
  if (unknown.length) settings._unknown = unknown;
  return settings;
}
function validCodexPatch(value: unknown): CodexProjectSettings | null {
  const patch = object(value); if (!patch) return null;
  const result: CodexProjectSettings = {};
  if ('model' in patch) { if (patch.model !== undefined && (typeof patch.model !== 'string' || patch.model.length > MAX_STRING_LENGTH)) return null; result.model = patch.model as string | undefined; }
  if ('approvalPolicy' in patch) { if (patch.approvalPolicy !== undefined && !['untrusted', 'on-request', 'never'].includes(String(patch.approvalPolicy))) return null; result.approvalPolicy = patch.approvalPolicy as CodexProjectSettings['approvalPolicy']; }
  if ('sandboxMode' in patch) { if (patch.sandboxMode !== undefined && !['read-only', 'workspace-write', 'danger-full-access'].includes(String(patch.sandboxMode))) return null; result.sandboxMode = patch.sandboxMode as CodexProjectSettings['sandboxMode']; }
  return result;
}

export async function readCodexProjectSettings(root: string): Promise<CodexSettingsResult> {
  const location = await targetFor(root, '.codex/config.toml'); if ('state' in location) return location;
  const input = await readText(location.target);
  if ('state' in input) return input.state === 'missing' ? { state: 'missing', settings: {}, hash: null } : { state: 'io-error', message: input.message! };
  try { const raw = object(parseToml(input.text)); return raw ? { state: 'valid', settings: codexView(raw), hash: hash(input.text) } : { state: 'invalid', message: 'Codex settings TOML must be a table' }; }
  catch { return { state: 'invalid', message: 'Codex settings contains invalid TOML' }; }
}

export async function writeCodexProjectSettings(root: string, input: unknown, expectedHash: string | null): Promise<CodexSettingsResult> {
  const patch = validCodexPatch(input); if (!patch) return { state: 'io-error', message: 'Invalid Codex settings update' };
  const location = await targetFor(root, '.codex/config.toml'); if ('state' in location) return location;
  return withLock(location.target, async () => {
    const current = await readCodexProjectSettings(root);
    if (current.state === 'invalid' || current.state === 'io-error') return current;
    if (current.hash !== expectedHash) return { state: 'io-error', message: 'Codex settings changed outside this editor. Reload before saving.' };
    const raw = current.state === 'valid' ? object(parseToml((await readText(location.target) as { text: string }).text))! : {};
    if ('model' in patch) patch.model ? raw.model = patch.model : delete raw.model;
    if ('approvalPolicy' in patch) patch.approvalPolicy ? raw.approval_policy = patch.approvalPolicy : delete raw.approval_policy;
    if ('sandboxMode' in patch) patch.sandboxMode ? raw.sandbox_mode = patch.sandboxMode : delete raw.sandbox_mode;
    const text = stringifyToml(raw);
    if (Buffer.byteLength(text, 'utf-8') > MAX_FILE_BYTES) return { state: 'io-error', message: 'Codex settings update is too large' };
    const result = await writeAtomic(root, location, text);
    return result.ok ? { state: 'valid', settings: codexView(raw), hash: hash(text) } : { state: 'io-error', message: result.message };
  });
}

const OPENCODE_KEYS = new Set(['model', 'small_model', 'default_agent']);
function openCodeView(raw: Record<string, unknown>): OpenCodeProjectSettings {
  const settings: OpenCodeProjectSettings = {};
  if (typeof raw.model === 'string') settings.model = raw.model;
  if (typeof raw.small_model === 'string') settings.smallModel = raw.small_model;
  if (typeof raw.default_agent === 'string') settings.defaultAgent = raw.default_agent;
  const unknown = Object.keys(raw).filter((key) => !OPENCODE_KEYS.has(key)); if (unknown.length) settings._unknown = unknown;
  return settings;
}
function validOpenCodePatch(value: unknown): OpenCodeProjectSettings | null {
  const patch = object(value); if (!patch) return null;
  const result: OpenCodeProjectSettings = {};
  for (const [incoming, output] of [['model', 'model'], ['smallModel', 'smallModel'], ['defaultAgent', 'defaultAgent']] as const) {
    if (incoming in patch) { if (patch[incoming] !== undefined && (typeof patch[incoming] !== 'string' || (patch[incoming] as string).length > MAX_STRING_LENGTH)) return null; result[output] = patch[incoming] as string | undefined; }
  }
  return result;
}

export async function readOpenCodeProjectSettings(root: string): Promise<OpenCodeSettingsResult> {
  const location = await targetFor(root, 'opencode.json'); if ('state' in location) return location;
  const input = await readText(location.target);
  if ('state' in input) return input.state === 'missing' ? { state: 'missing', settings: {}, hash: null } : { state: 'io-error', message: input.message! };
  try { const raw = object(JSON.parse(input.text)); return raw ? { state: 'valid', settings: openCodeView(raw), hash: hash(input.text) } : { state: 'invalid', message: 'OpenCode settings JSON must be an object' }; }
  catch { return { state: 'invalid', message: 'OpenCode settings contains invalid JSON' }; }
}

export async function writeOpenCodeProjectSettings(root: string, input: unknown, expectedHash: string | null): Promise<OpenCodeSettingsResult> {
  const patch = validOpenCodePatch(input); if (!patch) return { state: 'io-error', message: 'Invalid OpenCode settings update' };
  const location = await targetFor(root, 'opencode.json'); if ('state' in location) return location;
  return withLock(location.target, async () => {
    const current = await readOpenCodeProjectSettings(root);
    if (current.state === 'invalid' || current.state === 'io-error') return current;
    if (current.hash !== expectedHash) return { state: 'io-error', message: 'OpenCode settings changed outside this editor. Reload before saving.' };
    const raw = current.state === 'valid' ? object(JSON.parse((await readText(location.target) as { text: string }).text))! : {};
    if ('model' in patch) patch.model ? raw.model = patch.model : delete raw.model;
    if ('smallModel' in patch) patch.smallModel ? raw.small_model = patch.smallModel : delete raw.small_model;
    if ('defaultAgent' in patch) patch.defaultAgent ? raw.default_agent = patch.defaultAgent : delete raw.default_agent;
    const text = `${JSON.stringify(raw, null, 2)}\n`;
    if (Buffer.byteLength(text, 'utf-8') > MAX_FILE_BYTES) return { state: 'io-error', message: 'OpenCode settings update is too large' };
    const result = await writeAtomic(root, location, text);
    return result.ok ? { state: 'valid', settings: openCodeView(raw), hash: hash(text) } : { state: 'io-error', message: result.message };
  });
}
