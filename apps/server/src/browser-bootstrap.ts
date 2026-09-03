import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrowserBootstrap, BrowserProjectSummary } from './static-host.js';

/**
 * Loaded by electron.vite.config via the Vite plugin, so this file cannot
 * import `@zana-ai/zcc-host-daemon`. Keep env precedence in lockstep with
 * `resolveZccDataDir` in host-daemon `host-config`.
 */
function dataDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.ZCC_DATA_DIR?.trim() || env.ZCC_CENTER_DIR?.trim();
  if (explicit) return explicit;
  return join(homedir(), '.zcc');
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Redact a project record for the browser landing surface. Never include
 * filesystem paths or credentials.
 */
export function toBrowserProjectSummaries(projects: unknown): BrowserProjectSummary[] {
  if (!Array.isArray(projects)) return [];
  const summaries: BrowserProjectSummary[] = [];
  for (const row of projects) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec.id !== 'string' || rec.id.length === 0) continue;
    if (typeof rec.name !== 'string' || rec.name.length === 0) continue;
    summaries.push({
      id: rec.id,
      name: rec.name,
      color: asOptionalString(rec.color),
      tag: asOptionalString(rec.tag),
      category: asOptionalString(rec.category)
    });
  }
  return summaries;
}

export function defaultProjectsFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(dataDirFromEnv(env), 'projects.json');
}

/**
 * Read the on-disk projects catalogue and project a browser-safe bootstrap
 * payload. Missing or malformed files yield an empty project list.
 */
export function readBrowserBootstrap(options?: {
  projectsFile?: string;
  appVersion?: string;
}): BrowserBootstrap {
  const projectsFile = options?.projectsFile ?? defaultProjectsFile();
  let projects: BrowserProjectSummary[] = [];
  try {
    const parsed = JSON.parse(readFileSync(projectsFile, 'utf8')) as { projects?: unknown };
    projects = toBrowserProjectSummaries(parsed.projects);
  } catch {
    projects = [];
  }
  return {
    appVersion: options?.appVersion ?? '',
    projects
  };
}

export function isLoopbackHttpHost(hostHeader: string | undefined): boolean {
  const host = hostHeader?.trim() ?? '';
  return (
    /^localhost(?::\d+)?$/i.test(host) ||
    /^127\.0\.0\.1(?::\d+)?$/.test(host) ||
    /^\[::1\](?::\d+)?$/.test(host)
  );
}
