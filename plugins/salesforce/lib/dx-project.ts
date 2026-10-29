import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import type { SalesforceDeps } from './types.js';

export function isDxProject(projectRoot: string | undefined, exists: (path: string) => boolean): boolean {
  const root = projectRoot?.trim();
  if (!root) return false;
  return exists(join(root, 'sfdx-project.json'));
}

export function parsePackageDirectories(sfdxProjectJson: string): string[] {
  try {
    const parsed = JSON.parse(sfdxProjectJson) as { packageDirectories?: Array<{ path?: string }> };
    const dirs = (parsed.packageDirectories ?? [])
      .map((row) => (typeof row.path === 'string' ? row.path.trim() : ''))
      .filter(Boolean);
    return dirs.length > 0 ? dirs : ['force-app'];
  } catch {
    return ['force-app'];
  }
}

export function resolveUnderRoot(
  root: string,
  candidate: string,
  realpath: (path: string) => string
): string | null {
  const trimmedRoot = root.trim();
  const trimmed = candidate.trim();
  if (!trimmedRoot || !trimmed || trimmed.includes('\0')) return null;
  try {
    const realRoot = realpath(trimmedRoot);
    const absolute = trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed)
      ? trimmed
      : resolve(realRoot, trimmed);
    const real = realpath(absolute);
    if (real === realRoot || real.startsWith(`${realRoot}${sep}`)) return real;
    return null;
  } catch {
    return null;
  }
}

export function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

export function readJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function compactError(status: number, json: unknown, text: string): string {
  if (Array.isArray(json) && json[0] && typeof json[0] === 'object') {
    const row = json[0] as { message?: unknown; errorCode?: unknown };
    const message = typeof row.message === 'string' ? row.message : '';
    const code = typeof row.errorCode === 'string' ? row.errorCode : '';
    if (message) return code ? `${code}: ${message}` : message;
  }
  if (json && typeof json === 'object' && 'message' in json && typeof json.message === 'string') {
    return json.message;
  }
  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 240);
  return snippet || `Salesforce API error (${status})`;
}

const SCAN_SKIP = new Set(['node_modules', '.git', '.sf', '.sfdx', '.pnpm-store', '.cache', '.next', 'coverage', 'out', 'out-dev', 'dist']);
const sourceRank = (name: string) => /^(force-app|agentforce-drafts|src|main|default|aiAuthoringBundles)$/.test(name) ? 0 : name.startsWith('.') ? 2 : 1;

/** Shared scan steps keep CLI and cooperative UI discovery on the same confinement and limits. */
export function runProjectScan<T>(steps: Generator<void, T>): T {
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

/** Do at most 32 filesystem/inspection steps before allowing RPCs and worker heartbeats to run. */
export async function runProjectScanAsync<T>(steps: Generator<void, T>, yieldTurn = () => new Promise<void>(resolve => setImmediate(resolve))): Promise<T> {
  let next = steps.next(), batch = 0;
  while (!next.done) {
    if (++batch === 32) { batch = 0; await yieldTurn(); }
    next = steps.next();
  }
  return next.value;
}

/** Strictly bounded traversal, with relevant source before generated trees. Symlink cycles are visited once. */
export function scanFilesRecursive(
  root: string,
  deps: Pick<SalesforceDeps, 'stat' | 'readdir' | 'realpath'>,
  max = 4000,
  matches: (path: string) => boolean = () => true
): { files: string[]; truncated: boolean } {
  return runProjectScan(scanFilesRecursiveSteps(root, deps, max, matches));
}

export function* scanFilesRecursiveSteps(
  root: string,
  deps: Pick<SalesforceDeps, 'stat' | 'readdir' | 'realpath'>,
  max = 4000,
  matches: (path: string) => boolean = () => true
): Generator<void, { files: string[]; truncated: boolean }> {
  const out: string[] = [];
  const visited = new Set<string>();
  let examined = 0;
  let truncated = false;
  function* walk(dir: string): Generator<void> {
    if (visited.has(dir)) return;
    if (visited.size >= 1000 || examined >= 20_000 || out.length >= max) { truncated = true; return; }
    visited.add(dir);
    let entries: string[] = [];
    try {
      entries = deps.readdir(dir).filter(name => !SCAN_SKIP.has(name)).sort((a, b) => sourceRank(a) - sourceRank(b) || a.localeCompare(b));
    } catch {
      return;
    }
    for (const name of entries) {
      yield;
      if (out.length >= max || examined >= 20_000) { truncated = true; break; }
      examined++;
      const full = join(dir, name);
      const confined = resolveUnderRoot(root, full, deps.realpath);
      if (!confined) continue;
      const kind = deps.stat(confined);
      if (kind === 'dir') yield* walk(confined);
      else if (kind === 'file' && matches(confined)) out.push(confined);
    }
  }
  yield* walk(root);
  return { files: out, truncated };
}

export function listFilesRecursive(root: string, deps: Pick<SalesforceDeps, 'stat' | 'readdir' | 'realpath'>, max = 4000): string[] {
  return scanFilesRecursive(root, deps, max).files;
}
