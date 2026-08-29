/** Safe structured access to fixed Claude project settings files. */

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ClaudeProjectFileId, ClaudeProjectSettings, ClaudeSettingsResult, ClaudeSettingsScope } from '@zana-ai/zcc-domain/product';

const KNOWN_TOP_LEVEL = new Set(['permissions', 'model']);
const KNOWN_PERMISSIONS = new Set(['allow', 'deny', 'defaultMode', 'additionalDirectories']);
const VALID_DEFAULT_MODES = new Set(['default', 'acceptEdits', 'plan', 'bypassPermissions']);
const locks = new Map<string, Promise<void>>();
const MAX_STRING_LENGTH = 4_096;
const MAX_ARRAY_ITEMS = 200;
const MAX_FILE_BYTES = 256 * 1024;

function isScope(scope: unknown): scope is ClaudeSettingsScope {
  return scope === 'shared' || scope === 'local';
}

function fileNameForScope(scope: ClaudeSettingsScope): string {
  return scope === 'shared' ? 'settings.json' : 'settings.local.json';
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length <= MAX_ARRAY_ITEMS && value.every((item) => typeof item === 'string' && item.length <= MAX_STRING_LENGTH)
    ? value as string[]
    : undefined;
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function safeMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return code ? `Unable to access Claude settings (${code})` : 'Unable to access Claude settings';
}

/** Split parsed settings into typed fields plus read-only unknown fields. */
function projectSettingsFromRaw(raw: Record<string, unknown>): ClaudeProjectSettings {
  const out: ClaudeProjectSettings = {};
  const unknownTop: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_TOP_LEVEL.has(key)) {
      unknownTop[key] = value;
    } else if (key === 'model') {
      if (typeof value === 'string') out.model = value;
      else unknownTop[key] = value;
    } else if (key === 'permissions') {
      const permissions = asObject(value);
      if (!permissions) {
        unknownTop[key] = value;
        continue;
      }
      const view: NonNullable<ClaudeProjectSettings['permissions']> = {};
      const unknownPermissions: Record<string, unknown> = {};
      for (const [permissionKey, permissionValue] of Object.entries(permissions)) {
        if (!KNOWN_PERMISSIONS.has(permissionKey)) {
          unknownPermissions[permissionKey] = permissionValue;
        } else if (permissionKey === 'defaultMode' && typeof permissionValue === 'string' && VALID_DEFAULT_MODES.has(permissionValue)) {
          view.defaultMode = permissionValue as NonNullable<typeof view.defaultMode>;
        } else if (permissionKey !== 'defaultMode') {
          const values = asStringArray(permissionValue);
          if (values) view[permissionKey as 'allow' | 'deny' | 'additionalDirectories'] = values;
          else unknownPermissions[permissionKey] = permissionValue;
        } else {
          unknownPermissions[permissionKey] = permissionValue;
        }
      }
      out.permissions = view;
      if (Object.keys(unknownPermissions).length) out._unknownPermissions = Object.keys(unknownPermissions);
    }
  }
  if (Object.keys(unknownTop).length) out._unknown = Object.keys(unknownTop);
  return out;
}

function validatedPatch(patch: unknown): ClaudeProjectSettings | null {
  const value = asObject(patch);
  if (!value) return null;
  const out: ClaudeProjectSettings = {};
  if ('model' in value) {
    if (value.model !== undefined && (typeof value.model !== 'string' || value.model.length > MAX_STRING_LENGTH)) return null;
    out.model = value.model as string | undefined;
  }
  if ('permissions' in value) {
    if (value.permissions === undefined) out.permissions = undefined;
    else {
      const permissions = asObject(value.permissions);
      if (!permissions) return null;
      const next: NonNullable<ClaudeProjectSettings['permissions']> = {};
      for (const key of ['allow', 'deny', 'additionalDirectories'] as const) {
        if (key in permissions) {
          if (permissions[key] !== undefined && !asStringArray(permissions[key])) return null;
          next[key] = permissions[key] as string[] | undefined;
        }
      }
      if ('defaultMode' in permissions) {
        if (permissions.defaultMode !== undefined && (typeof permissions.defaultMode !== 'string' || !VALID_DEFAULT_MODES.has(permissions.defaultMode))) return null;
        next.defaultMode = permissions.defaultMode as NonNullable<typeof next.defaultMode> | undefined;
      }
      out.permissions = next;
    }
  }
  return out;
}

async function targetFor(root: string, scope: unknown): Promise<{ dir: string; target: string } | ClaudeSettingsResult> {
  if (!isScope(scope)) return { state: 'io-error', message: 'Unsupported Claude settings scope' };
  const dir = join(root, '.claude');
  const target = join(dir, fileNameForScope(scope));
  if (relative(root, target).startsWith('..')) return { state: 'io-error', message: 'Claude settings target is outside project' };
  try {
    const dirStat = await lstat(dir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      return { state: 'io-error', message: 'Claude settings directory is not a safe directory' };
    }
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      return { state: 'io-error', message: safeMessage(error) };
    }
  }
  try {
    const targetStat = await lstat(target);
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
      return { state: 'io-error', message: 'Claude settings file is not a safe file' };
    }
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      return { state: 'io-error', message: safeMessage(error) };
    }
  }
  return { dir, target };
}

async function readBounded(target: string): Promise<{ text: string } | ClaudeSettingsResult> {
  let file;
  try {
    file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { state: 'missing', settings: {}, hash: null };
    }
    return { state: 'io-error', message: safeMessage(error) };
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_FILE_BYTES) {
      return { state: 'io-error', message: 'Claude settings file is not a safe size' };
    }
    return { text: await file.readFile({ encoding: 'utf-8' }) };
  } catch (error) {
    return { state: 'io-error', message: safeMessage(error) };
  } finally {
    await file.close();
  }
}

async function sameSafeDirectory(root: string, dir: string): Promise<boolean> {
  try {
    const [realRoot, realDir] = await Promise.all([realpath(root), realpath(dir)]);
    return realDir === join(realRoot, '.claude');
  } catch {
    return false;
  }
}

async function readTarget(target: string): Promise<ClaudeSettingsResult> {
  const bounded = await readBounded(target);
  if ('state' in bounded) return bounded;
  const { text } = bounded;
  try {
    const raw = asObject(JSON.parse(text));
    if (!raw) return { state: 'invalid', message: 'Claude settings JSON must be an object' };
    return { state: 'valid', settings: projectSettingsFromRaw(raw), hash: hash(text) };
  } catch {
    return { state: 'invalid', message: 'Claude settings contains invalid JSON' };
  }
}

async function readWritableTarget(target: string): Promise<
  | { state: 'missing'; hash: null; raw: Record<string, unknown> }
  | { state: 'valid'; hash: string; raw: Record<string, unknown>; settings: ClaudeProjectSettings }
  | { state: 'invalid'; message: string }
  | { state: 'io-error'; message: string }
> {
  const bounded = await readBounded(target);
  if ('state' in bounded) {
    if (bounded.state === 'missing') return { state: 'missing', hash: null, raw: {} };
    if (bounded.state === 'invalid' || bounded.state === 'io-error') return bounded;
    return { state: 'io-error', message: 'Claude settings read failed' };
  }
  const { text } = bounded;
  try {
    const raw = asObject(JSON.parse(text));
    if (!raw) return { state: 'invalid', message: 'Claude settings JSON must be an object' };
    return { state: 'valid', raw, settings: projectSettingsFromRaw(raw), hash: hash(text) };
  } catch {
    return { state: 'invalid', message: 'Claude settings contains invalid JSON' };
  }
}

async function withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  locks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}

function mergeRaw(current: Record<string, unknown>, patch: ClaudeProjectSettings): Record<string, unknown> {
  const next = { ...current };
  if ('model' in patch) {
    if (patch.model) next.model = patch.model;
    else delete next.model;
  }
  if ('permissions' in patch) {
    const currentPermissions = asObject(current.permissions) ?? {};
    const permissions = { ...currentPermissions };
    for (const key of ['allow', 'deny', 'additionalDirectories'] as const) {
      if (key in (patch.permissions ?? {})) {
        const value = patch.permissions?.[key];
        if (value?.length) permissions[key] = value;
        else delete permissions[key];
      }
    }
    if ('defaultMode' in (patch.permissions ?? {})) {
      if (patch.permissions?.defaultMode) permissions.defaultMode = patch.permissions.defaultMode;
      else delete permissions.defaultMode;
    }
    if (Object.keys(permissions).length) next.permissions = permissions;
    else delete next.permissions;
  }
  return next;
}

export async function readClaudeProjectSettings(root: string, scope: unknown): Promise<ClaudeSettingsResult> {
  const location = await targetFor(root, scope);
  return 'state' in location ? location : readTarget(location.target);
}

export async function writeClaudeProjectSettings(
  root: string,
  scope: unknown,
  patchInput: unknown,
  expectedHash: string | null
): Promise<ClaudeSettingsResult> {
  const patch = validatedPatch(patchInput);
  if (!patch) return { state: 'io-error', message: 'Invalid Claude settings update' };
  const location = await targetFor(root, scope);
  if ('state' in location) return location;
  return withLock(location.target, async () => {
    // Re-check after acquiring the lock: another local process can replace this
    // directory with a symlink after initial request validation.
    const lockedLocation = await targetFor(root, scope);
    if ('state' in lockedLocation) return lockedLocation;
    const current = await readWritableTarget(location.target);
    if (current.state === 'invalid' || current.state === 'io-error') return current;
    if (current.hash !== expectedHash) return { state: 'io-error', message: 'Claude settings changed outside this editor. Reload before saving.' };
    const next = mergeRaw(current.raw, patch);
    const text = `${JSON.stringify(next, null, 2)}\n`;
    if (Buffer.byteLength(text, 'utf-8') > MAX_FILE_BYTES) {
      return { state: 'io-error', message: 'Claude settings update is too large' };
    }
    const tmp = `${location.target}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await mkdir(location.dir, { recursive: true });
      if (!await sameSafeDirectory(root, location.dir)) {
        return { state: 'io-error', message: 'Claude settings directory changed during write' };
      }
      await writeFile(tmp, text, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
      if (!await sameSafeDirectory(root, location.dir)) {
        return { state: 'io-error', message: 'Claude settings directory changed during write' };
      }
      await rename(tmp, location.target);
      return { state: 'valid', settings: projectSettingsFromRaw(next), hash: hash(text) };
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      return { state: 'io-error', message: safeMessage(error) };
    }
  });
}

export async function claudeSettingsPath(root: string, scope: unknown): Promise<string | null> {
  const location = await targetFor(root, scope);
  return 'state' in location ? null : location.target;
}

/** Resolve one of Claude's fixed, renderer-non-authoritative project file IDs. */
export async function claudeProjectFilePath(root: string, fileId: unknown): Promise<string | null> {
  const settingsScope = fileId === 'shared-settings' ? 'shared' : fileId === 'local-settings' ? 'local' : null;
  if (!settingsScope && fileId !== 'instructions' && fileId !== 'mcp') return null;
  const location = settingsScope ? await targetFor(root, settingsScope) : null;
  if (location && 'state' in location) return null;
  const target = location && !('state' in location)
    ? location.target
    : join(root, fileId === 'instructions' ? 'CLAUDE.md' : '.mcp.json');
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) return null;
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) return null;
    try {
      if (location && !('state' in location)) await mkdir(location.dir, { recursive: true });
      await writeFile(target, fileId === 'instructions' ? '# Project instructions\n' : '{}\n', { flag: 'wx', mode: 0o600 });
    } catch {
      return null;
    }
  }
  return target;
}
