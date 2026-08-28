import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface ThreadReadMap {
  [threadId: string]: number;
}

function readsPath(dataDir: string): string {
  return join(dataDir, 'thread-reads.json');
}

function loadReads(dataDir: string): ThreadReadMap {
  try {
    const raw = readFileSync(readsPath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ThreadReadMap = {};
    for (const [id, seq] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof seq === 'number' && Number.isFinite(seq) && seq >= 0) out[id] = Math.floor(seq);
    }
    return out;
  } catch {
    return {};
  }
}

function saveReads(dataDir: string, map: ThreadReadMap): void {
  mkdirSync(dataDir, { recursive: true });
  const dest = readsPath(dataDir);
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(map), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, dest);
}

export function loadThreadReads(dataDir: string): ThreadReadMap {
  return loadReads(dataDir);
}

/** Absent records stay `null` so historical threads are not dumped as unread. */
export function peekThreadReadSeq(dataDir: string, threadId: string): number | null {
  const map = loadReads(dataDir);
  return Object.prototype.hasOwnProperty.call(map, threadId) ? map[threadId]! : null;
}

export function getThreadReadSeq(dataDir: string, threadId: string): number {
  return peekThreadReadSeq(dataDir, threadId) ?? 0;
}

export function markThreadRead(dataDir: string, threadId: string, lastReadSeq: number): number {
  const seq = Math.max(0, Math.floor(lastReadSeq));
  const map = loadReads(dataDir);
  map[threadId] = seq;
  saveReads(dataDir, map);
  return seq;
}
