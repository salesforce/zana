import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { opendir, type FileHandle } from 'node:fs/promises';
import type { ApiErrorProducer, ApiErrorSessionRef, HarnessInteractionEvent } from '@zcc/harness-sdk';
import { isRetryableApiErrorKind } from '@zcc/harness-sdk';
import { classifyApiError } from '../api-error-kind.js';
import { sanitizeApiErrorText } from '../api-error-text.js';
import { openConfined, record } from '../shared-io.js';

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

/** Where Pi writes sessions for this process: an explicit override, else `~/.pi/agent/sessions`. */
export function piSessionRoot(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const session = env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (session) return resolve(session);
  const agent = env.PI_CODING_AGENT_DIR?.trim();
  return agent ? join(resolve(agent), 'sessions') : join(home, '.pi', 'agent', 'sessions');
}

/** Pi's per-cwd directory name, as `pi/history.ts` derives it: `--<cwd with separators as dashes>--`. */
function cwdDirName(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

/** `<ts>_<id>.jsonl` directly inside `dir`, counting at most `budget` entries; `scanned` tells if the bound cut it short. */
async function scanDir(dir: string, suffix: string, budget: number): Promise<{ path: string | null; subdirs: string[]; used: number; cut: boolean }> {
  const out = { path: null as string | null, subdirs: [] as string[], used: 0, cut: false };
  let handle;
  try { handle = await opendir(dir); } catch { return out; }
  try {
    for await (const entry of handle) {
      if (out.used >= budget) { out.cut = true; break; }
      out.used++;
      if (entry.isFile() && entry.name.endsWith(suffix)) { out.path = join(dir, entry.name); break; }
      if (entry.isDirectory()) out.subdirs.push(join(dir, entry.name));
    }
  } catch { /* unreadable directory: treat as absent */ }
  return out;
}

/**
 * Find the session file. The cwd-named directory is tried first (the normal place), then a bounded scan of the
 * root and one level below it. `cut` is true when the bound stopped the scan, so "not found" is not proof.
 */
async function findSessionFile(root: string, id: string, cwd: string): Promise<{ path: string | null; cut: boolean }> {
  const suffix = `_${id}.jsonl`;
  const direct = await scanDir(join(root, cwdDirName(cwd)), suffix, MAX_DIR_ENTRIES);
  if (direct.path) return { path: direct.path, cut: false };
  const top = await scanDir(root, suffix, MAX_DIR_ENTRIES);
  if (top.path) return { path: top.path, cut: false };
  let used = top.used;
  let cut = top.cut;
  for (const sub of top.subdirs) {
    if (used >= MAX_DIR_ENTRIES) { cut = true; break; }
    const found = await scanDir(sub, suffix, MAX_DIR_ENTRIES - used);
    if (found.path) return { path: found.path, cut: false };
    used += found.used;
    cut = cut || found.cut;
  }
  return { path: null, cut };
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
  log?: (message: string) => void;
}

interface Located { path: string; root: string; id: string }

/** The turn's failure from an opened session file, or null. The header must name the session we minted. */
async function readFailedTurn(found: Located, handle: FileHandle, size: number, offset: number | null): Promise<HarnessInteractionEvent | null> {
  const head = Buffer.alloc(Math.min(size, 64 * 1024));
  const { bytesRead } = await handle.read(head, 0, head.length, 0);
  const nl = head.subarray(0, bytesRead).indexOf(0x0a);
  const header = record(JSON.parse(head.subarray(0, nl === -1 ? bytesRead : nl).toString('utf8')));
  if (header?.type !== 'session' || header.id !== found.id) return null;
  // A file shorter than the marker was rewritten or rotated: the turn cannot be located.
  if (offset !== null && offset > size) return null;
  const length = Math.min(size, TAIL_BYTES);
  const start = size - length;
  const tail = Buffer.alloc(length);
  const read = await handle.read(tail, 0, length, start);
  return failedTurnFromSession(parseRows(tail.subarray(0, read.bytesRead), start), offset ?? 0);
}

export function createPiApiErrorProducer(deps: PiApiErrorProducerDeps = {}): ApiErrorProducer {
  const rootOf = deps.root ?? (() => piSessionRoot());
  /** Resolved session files by Zana session id, so a recheck does not walk the session tree again. */
  const located = new Map<string, Located>();
  const logged = new Set<string>();
  const logOnce = (sessionId: string, message: string) => {
    if (logged.has(sessionId)) return;
    logged.add(sessionId);
    deps.log?.(`[pi-api-error] ${message}`);
  };

  const locate = async (session: ApiErrorSessionRef): Promise<Located | null> => {
    if (session.remote) return null;
    const id = session.nativeConversationId;
    if (typeof id !== 'string' || !SAFE_ID.test(id)) return null;
    const cached = located.get(session.id);
    if (cached && cached.id === id) return cached;
    const root = rootOf();
    const { path, cut } = await findSessionFile(root, id, session.cwd);
    if (!path) {
      if (cut) logOnce(session.id, `session file not found within the ${MAX_DIR_ENTRIES}-entry scan bound; resume is off for this tab`);
      return null;
    }
    const found = { path, root, id };
    located.set(session.id, found);
    return found;
  };

  /** Open the session file; a cached path that no longer opens is dropped so the next call looks again. */
  const openSession = async (session: ApiErrorSessionRef) => {
    const found = await locate(session);
    if (!found) return null;
    const opened = await openConfined(found.path, found.root);
    if (!opened) { located.delete(session.id); return null; }
    return { found, ...opened };
  };

  return {
    quietMs: deps.quietMs ?? PI_QUIET_MS,
    async markTurnStart(session): Promise<Marker> {
      const opened = await openSession(session);
      if (!opened) return { offset: null };
      try { return { offset: opened.size }; } finally { await opened.handle.close().catch(() => undefined); }
    },
    async check(session, marker): Promise<HarnessInteractionEvent | null> {
      const turn = marker as Marker | undefined;
      if (!turn) return null;
      const opened = await openSession(session);
      if (!opened) return null;
      try {
        return await readFailedTurn(opened.found, opened.handle, opened.size, turn.offset);
      } catch (error) {
        logOnce(session.id, `read failed: ${(error as Error).message}`);
        return null;
      } finally {
        await opened.handle.close().catch(() => undefined);
      }
    },
    release(sessionId) {
      located.delete(sessionId);
      logged.delete(sessionId);
    }
  };
}
