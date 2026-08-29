import { execFile } from 'node:child_process';
import type { OpenCodeSessionSummary } from '@zana-ai/zcc-domain/product';

const LIST_LIMIT = 50;
const TIMEOUT_MS = 5_000;

interface OpenCodeSessionListRow {
  id?: unknown;
  title?: unknown;
  updated?: unknown;
  created?: unknown;
  directory?: unknown;
}

interface ListDeps {
  binary?: string;
  limit?: number;
  run?: (cwd: string, limit: number) => Promise<OpenCodeSessionListRow[] | null>;
}

async function defaultRun(binary: string, cwd: string, limit: number): Promise<OpenCodeSessionListRow[] | null> {
  return new Promise((resolve) => {
    execFile(
      binary,
      ['session', 'list', '--format', 'json', '-n', String(limit)],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const parsed = JSON.parse(stdout);
          resolve(Array.isArray(parsed) ? (parsed as OpenCodeSessionListRow[]) : null);
        } catch {
          resolve(null);
        }
      }
    );
  });
}

/**
 * Read the newest root OpenCode sessions scoped by the CLI to `projectPath`.
 * The renderer only supplies a registered project path; main runs the configured
 * binary and returns a display-safe projection rather than exposing its database.
 */
export async function listOpenCodeSessions(
  projectPath: string,
  deps: ListDeps = {}
): Promise<OpenCodeSessionSummary[]> {
  const run = deps.run ?? ((cwd, limit) => defaultRun(deps.binary ?? 'opencode', cwd, limit));
  const limit = Math.max(1, Math.min(LIST_LIMIT, deps.limit ?? LIST_LIMIT));
  const rows = await run(projectPath, limit);
  if (!rows) return [];

  return rows.flatMap((row) => {
    if (
      typeof row.id !== 'string' ||
      typeof row.title !== 'string' ||
      typeof row.updated !== 'number' ||
      typeof row.created !== 'number' ||
      typeof row.directory !== 'string' ||
      row.directory !== projectPath
    ) {
      return [];
    }
    return [{ id: row.id, title: row.title, startedAt: row.created, lastActiveAt: row.updated }];
  });
}
