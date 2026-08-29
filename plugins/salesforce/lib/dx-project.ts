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

export function listFilesRecursive(
  root: string,
  deps: Pick<SalesforceDeps, 'stat' | 'readdir' | 'realpath'>,
  max = 4000
): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= max) return;
    let entries: string[] = [];
    try {
      entries = deps.readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git' || name === '.sf' || name === '.sfdx') continue;
      const full = join(dir, name);
      const confined = resolveUnderRoot(root, full, deps.realpath);
      if (!confined) continue;
      const kind = deps.stat(confined);
      if (kind === 'dir') walk(confined);
      else if (kind === 'file') out.push(confined);
    }
  };
  walk(root);
  return out;
}
