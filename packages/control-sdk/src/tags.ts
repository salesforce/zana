import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIVE_TAG_PREFIX } from './types.js';

export interface LiveRunJournal {
  runId: string;
  createdAt: number;
  threadIds: string[];
  cliAgentIds: string[];
  environmentIds: string[];
  projectId?: string;
}

export function createRunId(explicit?: string): string {
  return explicit ?? randomUUID().slice(0, 8);
}

export function liveTitle(runId: string, title?: string): string {
  const prefix = `[${LIVE_TAG_PREFIX}:${runId}]`;
  const rest = title?.trim();
  return rest ? `${prefix} ${rest}` : prefix;
}

export function titleMatchesRun(title: string | null | undefined, runId: string): boolean {
  if (!title) return false;
  return title.includes(`[${LIVE_TAG_PREFIX}:${runId}]`);
}

export function journalDir(dataDir: string): string {
  return join(dataDir, 'live-runs');
}

export function readJournal(dataDir: string, runId: string): LiveRunJournal | null {
  try {
    const raw = readFileSync(join(journalDir(dataDir), `${runId}.json`), 'utf8');
    return JSON.parse(raw) as LiveRunJournal;
  } catch {
    return null;
  }
}

export function writeJournal(dataDir: string, journal: LiveRunJournal): void {
  const dir = journalDir(dataDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, `${journal.runId}.json`), JSON.stringify(journal, null, 2), { mode: 0o600 });
}

export function listJournals(dataDir: string): LiveRunJournal[] {
  try {
    return readdirSync(journalDir(dataDir))
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        try {
          return JSON.parse(readFileSync(join(journalDir(dataDir), name), 'utf8')) as LiveRunJournal;
        } catch {
          return null;
        }
      })
      .filter((row): row is LiveRunJournal => row !== null);
  } catch {
    return [];
  }
}

export function deleteJournal(dataDir: string, runId: string): void {
  try {
    rmSync(join(journalDir(dataDir), `${runId}.json`), { force: true });
  } catch {
    /* best-effort */
  }
}

export function appendJournalIds(
  dataDir: string,
  runId: string,
  patch: Partial<Pick<LiveRunJournal, 'threadIds' | 'cliAgentIds' | 'environmentIds' | 'projectId'>>
): LiveRunJournal {
  const existing = readJournal(dataDir, runId) ?? {
    runId,
    createdAt: Date.now(),
    threadIds: [],
    cliAgentIds: [],
    environmentIds: []
  };
  const next: LiveRunJournal = {
    ...existing,
    projectId: patch.projectId ?? existing.projectId,
    threadIds: [...new Set([...existing.threadIds, ...(patch.threadIds ?? [])])],
    cliAgentIds: [...new Set([...existing.cliAgentIds, ...(patch.cliAgentIds ?? [])])],
    environmentIds: [...new Set([...existing.environmentIds ?? [], ...(patch.environmentIds ?? [])])]
  };
  writeJournal(dataDir, next);
  return next;
}
