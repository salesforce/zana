import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { opendir } from 'node:fs/promises';
import type { ApiErrorProducer, ApiErrorSessionRef, HarnessInteractionEvent } from '@zcc/harness-sdk';
import { isRetryableApiErrorKind } from '@zcc/harness-sdk';
import { classifyApiError } from '../api-error-kind.js';
import { sanitizeApiErrorText } from '../api-error-text.js';
import { openConfined } from '../codex/rollout-reader.js';

/**
 * Pi retries a transient failure three times (2 s, 4 s, 8 s: about 14 s from the first failure to the final
 * error row). Output keeps arriving through the retries, so a quiet period past that window means the final
 * row has been written. With `MAX_RECHECKS` (12) a turn that stays silent is watched for about four minutes.
 */
export const PI_QUIET_MS = 20_000;

const TAIL_BYTES = 256 * 1024;
const MAX_LINES = 5000;
const MAX_LINE_BYTES = 256 * 1024;
const MAX_DIR_ENTRIES = 5000;
/** Ids Zana mints are UUIDs; anything else never reaches the filesystem. */
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

interface Marker {
  /** Session file size at turn start; null when the file did not exist yet. */
  readonly offset: number | null;
}

export interface Row { offset: number; value: Record<string, unknown> }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Where Pi writes sessions for this process: an explicit override, else `~/.pi/agent/sessions`. */
export function piSessionRoot(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const session = env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (session) return resolve(session);
  const agent = env.PI_CODING_AGENT_DIR?.trim();
  return agent ? join(resolve(agent), 'sessions') : join(home, '.pi', 'agent', 'sessions');
}

/** Find `<ts>_<id>.jsonl` in the root or one level below it (per-cwd directories). Bounded; null when absent. */
async function findSessionFile(root: string, id: string): Promise<string | null> {
  const suffix = `_${id}.jsonl`;
  let seen = 0;
  const scan = async (dir: string, depth: number): Promise<string | null> => {
    let handle;
    try { handle = await opendir(dir); } catch { return null; }
    const subdirs: string[] = [];
    try {
      for await (const entry of handle) {
        if (++seen > MAX_DIR_ENTRIES) break;
        if (entry.isFile() && entry.name.endsWith(suffix)) return join(dir, entry.name);
        if (entry.isDirectory() && depth === 0) subdirs.push(join(dir, entry.name));
      }
    } catch { return null; }
    for (const sub of subdirs) {
      const found = await scan(sub, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return scan(root, 0);
}

function parseRows(tail: Buffer, startOffset: number): Row[] {
  let pos = 0;
  if (startOffset > 0) {
    const nl = tail.indexOf(0x0a);
    if (nl === -1) return [];
    pos = nl + 1;
  }
  const bounds: Array<[number, number]> = [];
  while (pos < tail.length) {
    let end = tail.indexOf(0x0a, pos);
    if (end === -1) end = tail.length;
    bounds.push([pos, end]);
    pos = end + 1;
  }
  const rows: Row[] = [];
  for (const [from, to] of bounds.slice(-MAX_LINES)) {
    if (to - from > MAX_LINE_BYTES) continue;
    try {
      const value = record(JSON.parse(tail.subarray(from, to).toString('utf8')));
      if (value) rows.push({ offset: startOffset + from, value });
    } catch { /* partial or malformed line */ }
  }
  return rows;
}

/**
 * The turn from `from` onward ended on a final API error, or null. Only structure is trusted: the last
 * assistant message must carry `stopReason: "error"` and no later `context_edit` may tombstone it (Pi
 * tombstones every superseded retry attempt and context-overflow errors). User interrupts are `aborted`.
 */
export function failedTurnFromSession(rows: Row[], from: number): HarnessInteractionEvent | null {
  let lastAssistant: Row | undefined;
  const tombstoned = new Set<string>();
  for (const row of rows) {
    if (row.offset < from) continue;
    if (row.value.type === 'context_edit' && typeof row.value.targetId === 'string') tombstoned.add(row.value.targetId);
    const message = row.value.type === 'message' ? record(row.value.message) : null;
    if (message?.role === 'assistant') lastAssistant = row;
  }
  if (!lastAssistant) return null;
  const message = record(lastAssistant.value.message)!;
  if (message.stopReason !== 'error') return null;
  const id = lastAssistant.value.id;
  if (typeof id === 'string' && tombstoned.has(id)) return null;
  const text = sanitizeApiErrorText(message.errorMessage);
  const status = /^(\d{3}):/.exec(text)?.[1];
  const kind = classifyApiError({ status, text });
  return { kind: 'api-error-stop', error: kind, text, retryable: isRetryableApiErrorKind(kind) };
}

export interface PiApiErrorProducerDeps {
  /** Session root; read per call so a changed environment is honoured. */
  root?: () => string;
  quietMs?: number;
}

export function createPiApiErrorProducer(deps: PiApiErrorProducerDeps = {}): ApiErrorProducer {
  const rootOf = deps.root ?? (() => piSessionRoot());

  const locate = async (session: ApiErrorSessionRef): Promise<{ path: string; root: string; id: string } | null> => {
    if (session.remote) return null;
    const id = session.nativeConversationId;
    if (typeof id !== 'string' || !SAFE_ID.test(id)) return null;
    const root = rootOf();
    const path = await findSessionFile(root, id);
    return path ? { path, root, id } : null;
  };

  return {
    quietMs: deps.quietMs ?? PI_QUIET_MS,
    async markTurnStart(session): Promise<Marker> {
      const found = await locate(session);
      if (!found) return { offset: null };
      const opened = await openConfined(found.path, found.root);
      if (!opened) return { offset: null };
      try { return { offset: opened.size }; } finally { await opened.handle.close().catch(() => undefined); }
    },
    async check(session, marker): Promise<HarnessInteractionEvent | null> {
      const turn = marker as Marker | undefined;
      if (!turn) return null;
      const found = await locate(session);
      if (!found) return null;
      const opened = await openConfined(found.path, found.root);
      if (!opened) return null;
      const { handle, size } = opened;
      try {
        // The header must name the session we minted, never just a filename match.
        const head = Buffer.alloc(Math.min(size, 64 * 1024));
        const { bytesRead } = await handle.read(head, 0, head.length, 0);
        const nl = head.subarray(0, bytesRead).indexOf(0x0a);
        const header = record(JSON.parse(head.subarray(0, nl === -1 ? bytesRead : nl).toString('utf8')));
        if (header?.type !== 'session' || header.id !== found.id) return null;
        const length = Math.min(size, TAIL_BYTES);
        const start = size - length;
        const tail = Buffer.alloc(length);
        const read = await handle.read(tail, 0, length, start);
        // A file shorter than the marker was rewritten or rotated: the turn cannot be located.
        if (turn.offset !== null && turn.offset > size) return null;
        const from = turn.offset ?? 0;
        return failedTurnFromSession(parseRows(tail.subarray(0, read.bytesRead), start), from);
      } catch {
        return null;
      } finally {
        await handle.close().catch(() => undefined);
      }
    },
    release() { /* no per-session state */ }
  };
}
