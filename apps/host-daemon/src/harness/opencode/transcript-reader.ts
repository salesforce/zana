/**
 * Reads an OpenCode CLI session and extracts the same display data as the
 * Claude {@link ./transcript-reader.ts} and Codex {@link ./codex-transcript-reader.ts}
 * readers — last assistant prose, a role-tagged digest, and a {@link SessionStats}
 * — but from OpenCode's own storage, which is neither a flat JSONL file nor a
 * rollout envelope: OpenCode persists every session to a SQLite database at
 *   ~/.local/share/opencode/opencode.db  (XDG_DATA_HOME override honored)
 * across three tables: `session` (one row per session, carrying lifetime
 * token/cost totals + the active model), `message` (one row per turn, `data`
 * a JSON blob keyed by role), and `part` (one row per content block within a
 * message — text / tool-call / step markers — `data` a JSON blob keyed by
 * `type`). This is a genuine 4th on-disk schema (Claude JSONL, Codex rollout
 * JSONL, OpenCode SQLite), so it gets its own reader, dispatched by the same
 * provider-dispatch seam (`transcript-source.ts`) that picks Claude vs Codex.
 *
 * WHY SQLITE DIRECTLY (not `opencode export <id>`, which shells out and dumps
 * the same data as JSON): a live session's export can run 100s of ms to
 * multiple seconds and tens of MB for a large session, and this reader is
 * polled every few seconds while an agent is live (see `AgentInsights.tsx`'s
 * `useSessionStats`). A read-only, bounded SQLite query over the same rows is
 * two orders of magnitude faster and trivially cappable (Rule 5). OpenCode
 * keeps its DB in WAL mode, so a read-only connection alongside the live
 * OpenCode process never blocks or corrupts anything.
 *
 * The schema was reverse-engineered from a real, populated `opencode.db`
 * (opencode-ai 1.18.4) — see `__tests__/opencode-transcript-reader.test.ts`,
 * which runs against a committed fixture DB. Every parser is defensive:
 * unknown/missing fields are skipped, never thrown on, so a truncated session
 * or a future schema tweak yields a partial-but-valid result — same
 * never-throw contract as the other two readers.
 */

import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import Database from 'better-sqlite3';
import type {
  SessionStats,
  SessionFileTouch,
  SessionQueueItem,
  SessionTokenBreakdown
} from '@zana-ai/zcc-domain/product';

/** Absolute path to OpenCode's session database, honoring its own XDG override. */
export function openCodeDbPath(home = homedir()): string {
  const dataHome = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
  return join(dataHome, 'opencode', 'opencode.db');
}

/** The `session` row fields this reader reads. */
interface OpenCodeSessionRow {
  model: string | null;
  version?: string | null;
  agent?: string | null;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
}

/** The `message`/`part` join row this reader scans, in creation order. */
interface OpenCodePartRow {
  mdata: string;
  pdata: string;
}

/** The bits of a `message.data` blob we read (role only — everything else lives on parts). */
interface OpenCodeMessageData {
  role?: string;
}

/** The bits of a `part.data` blob we read, across every part `type`. */
interface OpenCodePartData {
  type?: string;
  text?: string;
  tool?: string;
  state?: {
    input?: {
      filePath?: string;
      todos?: Array<{ content?: string; status?: string }>;
    };
    metadata?: {
      files?: Array<{ relativePath?: string; filePath?: string; type?: string }>;
    };
  };
}

/** Which display op an apply_patch `metadata.files[].type` maps to. */
function patchFileOp(type: string | undefined): SessionFileTouch['op'] {
  return type === 'add' ? 'C' : 'W';
}

/**
 * Extract the last assistant *text* from parsed OpenCode part rows, capped to
 * `maxChars` (keeping the TAIL). Returns '' when there's no assistant prose.
 * Mirrors {@link extractLastAssistantText} / {@link extractLastAssistantTextCodex}.
 * Pure; exported for tests.
 */
export function extractLastAssistantTextOpenCode(rows: OpenCodePartRow[], maxChars = 4_000): string {
  let last = '';
  for (const row of rows) {
    const msg = parseJson<OpenCodeMessageData>(row.mdata);
    if (msg?.role !== 'assistant') continue;
    const part = parseJson<OpenCodePartData>(row.pdata);
    if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      last = part.text.trim();
    }
  }
  return last.length > maxChars ? last.slice(last.length - maxChars) : last;
}

/**
 * Build a readable, role-tagged DIGEST of a whole OpenCode session, mirroring
 * {@link buildSessionDigest} / {@link buildSessionDigestCodex}: typed prompts,
 * assistant prose, and the tools it ran (deduped per adjacent run). Tool
 * output/metadata is dropped. Capped to `maxChars` keeping the TAIL. Pure;
 * exported for tests.
 */
export function buildSessionDigestOpenCode(
  rows: OpenCodePartRow[],
  opts: { maxChars?: number; perBlockChars?: number } = {}
): string {
  const maxChars = opts.maxChars ?? 12_000;
  const perBlockChars = opts.perBlockChars ?? 1_500;
  const clamp = (s: string) => (s.length > perBlockChars ? `${s.slice(0, perBlockChars)}…` : s);

  const parts: string[] = [];
  let pendingTools: string[] = [];
  const flushTools = () => {
    if (pendingTools.length) {
      parts.push(`Assistant ran: ${pendingTools.join(', ')}`);
      pendingTools = [];
    }
  };

  for (const row of rows) {
    const msg = parseJson<OpenCodeMessageData>(row.mdata);
    const part = parseJson<OpenCodePartData>(row.pdata);
    if (!msg || !part) continue;
    if (part.type !== 'text' && part.type !== 'tool') continue;

    if (msg.role === 'user' && part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      flushTools();
      parts.push(`User: ${clamp(part.text.trim())}`);
      continue;
    }
    if (msg.role === 'assistant' && part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      flushTools();
      parts.push(`Assistant: ${clamp(part.text.trim())}`);
      continue;
    }
    if (msg.role === 'assistant' && part.type === 'tool' && typeof part.tool === 'string' && part.tool) {
      if (!pendingTools.includes(part.tool)) pendingTools.push(part.tool);
    }
  }
  flushTools();

  const digest = parts.join('\n\n');
  return digest.length > maxChars ? digest.slice(digest.length - maxChars) : digest;
}

// Per-million-token USD rates, keyed by a substring of the model id. Same
// disclaimer as the other two readers' tables: a rough in-UI guide, not
// billing truth. OpenCode sessions in this codebase route through `aisuite`/
// `llmgw` proxies fronting a mix of OpenAI/Anthropic/Google models, so this
// table matches on the underlying model family regardless of provider prefix.
const OPENCODE_MODEL_RATES: Array<{ match: string; in: number; out: number }> = [
  { match: 'opus', in: 5, out: 25 },
  { match: 'sonnet', in: 3, out: 15 },
  { match: 'haiku', in: 1, out: 5 },
  { match: 'gpt-5', in: 1.25, out: 10 },
  { match: 'gemini', in: 1.25, out: 5 }
];

function openCodeRateFor(model: string | undefined) {
  const m = (model ?? '').toLowerCase();
  return OPENCODE_MODEL_RATES.find((r) => m.includes(r.match));
}

/** Parse a JSON blob column, returning null on any malformed/missing value. */
function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * The `session.model` column is itself a JSON blob (`{id, providerID, variant}`),
 * not a plain string — unlike Claude/Codex, where the model is a bare id. We
 * surface just the `id` (e.g. `gpt-5.6-sol`) as the display-neutral model
 * string every other reader emits.
 */
function modelIdFrom(raw: string | null): string | undefined {
  const parsed = parseJson<{ id?: string }>(raw);
  return typeof parsed?.id === 'string' && parsed.id ? parsed.id : undefined;
}

/**
 * Distill a {@link SessionStats} from an OpenCode session row + its ordered
 * message/part rows. Unlike Claude (sums per-turn usage) and Codex (takes the
 * latest cumulative event), OpenCode's `session` row itself already carries
 * lifetime token/cost totals — maintained by OpenCode, not recomputed here —
 * so tokens/cost/model come straight off that row. `contextTokens` has no
 * direct OpenCode analogue (no point-in-time "window occupancy" field is
 * exposed), so it's left undefined, same graceful-omission contract as an
 * absent field on the other readers. files ← every `apply_patch`
 * (`state.metadata.files`) and `read` (`state.input.filePath`) tool part,
 * deduped by path (last op wins, most-recent-first). queue ← the latest
 * `todowrite` tool part's todos. Pure; exported for tests. Never throws.
 */
export function buildSessionStatsOpenCode(
  session: OpenCodeSessionRow | undefined,
  rows: OpenCodePartRow[],
  cwd?: string
): SessionStats {
  const model = modelIdFrom(session?.model ?? null);

  let tokens: SessionTokenBreakdown | undefined;
  let costUsd: number | undefined;
  if (session) {
    const output = session.tokens_output + session.tokens_reasoning;
    tokens = {
      input: session.tokens_input,
      output,
      cacheRead: session.tokens_cache_read,
      cacheWrite: session.tokens_cache_write
    };
    if (session.cost > 0) {
      costUsd = session.cost;
    } else {
      const rate = openCodeRateFor(model);
      if (rate) {
        costUsd =
          (session.tokens_input / 1e6) * rate.in +
          (session.tokens_cache_read / 1e6) * rate.in * 0.1 +
          (output / 1e6) * rate.out;
      }
    }
  }

  // Insertion-ordered path→op; re-touching a path refreshes its op AND moves
  // it to the end, so we can emit most-recent-first by reversing (mirrors the
  // Claude/Codex readers).
  const files = new Map<string, SessionFileTouch['op']>();
  let queue: SessionQueueItem[] = [];

  for (const row of rows) {
    const part = parseJson<OpenCodePartData>(row.pdata);
    if (part?.type !== 'tool' || !part.tool) continue;

    if (part.tool === 'apply_patch') {
      const patchFiles = part.state?.metadata?.files;
      if (Array.isArray(patchFiles)) {
        for (const f of patchFiles) {
          const path = sessionFilePath(f.relativePath || f.filePath, cwd);
          if (typeof path === 'string' && path) {
            files.delete(path);
            files.set(path, patchFileOp(f.type));
          }
        }
      }
      continue;
    }

    if (part.tool === 'read') {
      const path = sessionFilePath(part.state?.input?.filePath, cwd);
      if (typeof path === 'string' && path) {
        files.delete(path);
        files.set(path, 'R');
      }
      continue;
    }

    if (part.tool === 'write') {
      const path = sessionFilePath(part.state?.input?.filePath, cwd);
      if (typeof path === 'string' && path) {
        files.delete(path);
        files.set(path, 'C');
      }
      continue;
    }

    if (part.tool === 'edit') {
      const path = sessionFilePath(part.state?.input?.filePath, cwd);
      if (typeof path === 'string' && path) {
        files.delete(path);
        files.set(path, 'W');
      }
      continue;
    }

    if (part.tool === 'todowrite') {
      const todos = part.state?.input?.todos;
      if (Array.isArray(todos)) {
        queue = todos
          .map((t) => ({
            text: (t.content ?? '').trim(),
            status: t.status === 'in_progress' || t.status === 'completed' ? t.status : ('pending' as const)
          }))
          .filter((t): t is SessionQueueItem => t.text.length > 0);
      }
    }
  }

  const fileList: SessionFileTouch[] = [...files.entries()].reverse().map(([path, op]) => ({ path, op }));

  return {
    model,
    ...(typeof session?.version === 'string' && session.version ? { harnessVersion: session.version } : {}),
    ...(typeof session?.agent === 'string' && session.agent ? { agent: session.agent } : {}),
    contextTokens: undefined,
    costUsd,
    tokens,
    files: fileList,
    queue
  };
}

/**
 * OpenCode records apply_patch targets relative to the session directory, while
 * its read/write/edit tools emit absolute file paths. Convert the former at the
 * trusted transcript boundary so every SessionStats consumer sees one path form.
 */
function sessionFilePath(path: string | undefined, cwd: string | undefined): string | undefined {
  if (typeof path !== 'string' || !path) return undefined;
  return cwd && !isAbsolute(path) ? resolve(cwd, path) : path;
}

/** Open OpenCode's DB read-only, or null if it's missing/unreadable. Never throws. */
function openReadonly(dbPath: string): InstanceType<typeof Database> | null {
  try {
    return new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

/** Fetch a session's lifetime totals row, or undefined if absent. */
function fetchSessionRow(db: InstanceType<typeof Database>, sessionId: string): OpenCodeSessionRow | undefined {
  return db
    .prepare(
      `SELECT model, version, agent, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write
       FROM session WHERE id = ?`
    )
    .get(sessionId) as OpenCodeSessionRow | undefined;
}

/** Fetch a session's newest message⋈part rows in chronological order. */
function fetchPartRows(db: InstanceType<typeof Database>, sessionId: string, limit: number): OpenCodePartRow[] {
  return db
    .prepare(
      `SELECT mdata, pdata FROM (
         SELECT p.time_created, p.id, m.data as mdata, p.data as pdata
         FROM part p JOIN message m ON p.message_id = m.id
         WHERE p.session_id = ?
         ORDER BY p.time_created DESC, p.id DESC
         LIMIT ?
       ) ORDER BY time_created ASC, id ASC`
    )
    .all(sessionId, limit) as OpenCodePartRow[];
}

// Bound the row scan (Rule 5): a very long-running session can accumulate
// tens of thousands of parts; the newest rows carry the current file/queue
// state, so once over the cap we keep the tail (most parts are read tool
// noise anyway — the recent ones are what the UI shows).
const MAX_PART_ROWS = 20_000;

/**
 * Read an OpenCode session's last assistant prose, or '' when the db/session/
 * row is missing or empty. Never throws. Mirrors {@link readLastAssistantText}
 * / {@link readLastAssistantTextCodex}.
 */
export async function readLastAssistantTextOpenCode(
  sessionId: string,
  opts: { dbPath?: string; maxChars?: number } = {}
): Promise<string> {
  const db = openReadonly(opts.dbPath ?? openCodeDbPath());
  if (!db) return '';
  try {
    const rows = fetchPartRows(db, sessionId, MAX_PART_ROWS);
    return extractLastAssistantTextOpenCode(rows, opts.maxChars);
  } catch {
    return '';
  } finally {
    db.close();
  }
}

/**
 * Read an OpenCode session and return a role-tagged digest of the whole
 * conversation, or '' when missing/unreadable. Never throws. Mirrors
 * {@link readSessionDigest} / {@link readSessionDigestCodex}.
 */
export async function readSessionDigestOpenCode(
  sessionId: string,
  opts: { dbPath?: string; maxChars?: number; perBlockChars?: number } = {}
): Promise<string> {
  const db = openReadonly(opts.dbPath ?? openCodeDbPath());
  if (!db) return '';
  try {
    const rows = fetchPartRows(db, sessionId, MAX_PART_ROWS);
    return buildSessionDigestOpenCode(rows, { maxChars: opts.maxChars, perBlockChars: opts.perBlockChars });
  } catch {
    return '';
  } finally {
    db.close();
  }
}

/**
 * Read an OpenCode session and distill a display-only {@link SessionStats}, or
 * null when the db/session is missing/unreadable. Never throws. Mirrors
 * {@link readSessionStats} / {@link readSessionStatsCodex}.
 */
export async function readSessionStatsOpenCode(
  sessionId: string,
  opts: { dbPath?: string; cwd?: string } = {}
): Promise<SessionStats | null> {
  const db = openReadonly(opts.dbPath ?? openCodeDbPath());
  if (!db) return null;
  try {
    const session = fetchSessionRow(db, sessionId);
    // A stale resolver match must not become an empty successful snapshot. Let
    // TranscriptSource retry its bounded directory+spawn-time fallback instead.
    if (!session) return null;
    const rows = fetchPartRows(db, sessionId, MAX_PART_ROWS);
    return buildSessionStatsOpenCode(session, rows, opts.cwd);
  } catch {
    return null;
  } finally {
    db.close();
  }
}

interface OpenCodeExport {
  info?: {
    model?: { id?: unknown };
    version?: unknown;
    agent?: unknown;
    cost?: unknown;
    tokens?: {
      input?: unknown;
      output?: unknown;
      reasoning?: unknown;
      cache?: { read?: unknown; write?: unknown };
    };
  };
  messages?: Array<{
    info?: { role?: unknown };
    parts?: unknown[];
  }>;
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Parse `opencode export <id>` into the same stats projection as the SQLite
 * reader. Export is the compatibility fallback when Electron cannot load the
 * native better-sqlite3 binary (for example after an Electron ABI upgrade). */
export function buildSessionStatsOpenCodeExport(value: unknown, cwd?: string): SessionStats | null {
  if (!value || typeof value !== 'object') return null;
  const exported = value as OpenCodeExport;
  const info = exported.info;
  if (!info) return null;
  const tokens = info.tokens;
  const row: OpenCodeSessionRow = {
    model: typeof info.model?.id === 'string'
      ? JSON.stringify({ id: info.model.id })
      : null,
    version: typeof info.version === 'string' ? info.version : null,
    agent: typeof info.agent === 'string' ? info.agent : null,
    cost: numeric(info.cost),
    tokens_input: numeric(tokens?.input),
    tokens_output: numeric(tokens?.output),
    tokens_reasoning: numeric(tokens?.reasoning),
    tokens_cache_read: numeric(tokens?.cache?.read),
    tokens_cache_write: numeric(tokens?.cache?.write)
  };
  const rows: OpenCodePartRow[] = [];
  const messages = Array.isArray(exported.messages) ? exported.messages : [];
  for (let messageIndex = messages.length - 1; messageIndex >= 0 && rows.length < MAX_PART_ROWS; messageIndex -= 1) {
    const message = messages[messageIndex];
    const role = typeof message.info?.role === 'string' ? message.info.role : '';
    const parts = Array.isArray(message.parts) ? message.parts : [];
    for (let partIndex = parts.length - 1; partIndex >= 0 && rows.length < MAX_PART_ROWS; partIndex -= 1) {
      const part = parts[partIndex];
      rows.push({ mdata: JSON.stringify({ role }), pdata: JSON.stringify(part) });
    }
  }
  return buildSessionStatsOpenCode(row, rows.reverse(), cwd);
}

const EXPORT_TIMEOUT_MS = 8_000;
const EXPORT_MAX_BUFFER = 16 * 1024 * 1024;

/** Read stats through OpenCode's own CLI. Slower than direct SQLite, so callers
 * use this only after the native reader fails. Never throws. */
export async function readSessionStatsOpenCodeExport(
  sessionId: string,
  opts: { binary?: string; cwd?: string } = {}
): Promise<SessionStats | null> {
  return new Promise((resolve) => {
    execFile(
      opts.binary ?? 'opencode',
      ['export', sessionId],
      { timeout: EXPORT_TIMEOUT_MS, maxBuffer: EXPORT_MAX_BUFFER },
      (error, stdout) => {
        if (error) return resolve(null);
        try {
          resolve(buildSessionStatsOpenCodeExport(JSON.parse(stdout), opts.cwd));
        } catch {
          resolve(null);
        }
      }
    );
  });
}
