/**
 * Reads a Codex CLI session transcript (a "rollout" file) and extracts the same
 * display data as the Claude {@link ./transcript-reader.ts} — last assistant
 * prose, a role-tagged digest, and a {@link SessionStats} — but from Codex's own
 * on-disk JSONL schema, which is shaped very differently from Claude's.
 *
 * WHY A SEPARATE READER: Claude writes one flat object per line whose `type` is
 * `user`/`assistant` and whose tokens live on `message.usage` in Anthropic
 * buckets. Codex writes an ENVELOPE per line — `{timestamp, type, payload}` —
 * where `type` is `session_meta` / `response_item` / `event_msg` / `turn_context`
 * and the interesting shape is nested under `payload.type`. The two schemas share
 * no field names, so a single parser can't serve both without a tangle of
 * conditionals; instead each provider owns a reader that emits the SAME output
 * types (`SessionStats`, digest string, last-text string). The provider-dispatch
 * seam (see `transcript-source.ts`) picks the reader by capability.
 *
 * Codex rollout files live at
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<ISO-ts>-<UUID>.jsonl
 * and, unlike Claude, the `<UUID>` is MINTED BY CODEX (recorded in the opening
 * `session_meta` line), not forced by us at spawn. Resolving which rollout file
 * belongs to a given PTY session is the job of `codex-session-resolver.ts`; this
 * module only parses a file once its path is known.
 *
 * The schema was reverse-engineered from real rollout files written by
 * codex-cli 0.140.0 (see `__tests__/codex-transcript-reader.test.ts`, which runs
 * against a committed fixture). Every parser is defensive: unknown/missing fields
 * are skipped, never thrown on, so a truncated or newer-schema file yields a
 * partial-but-valid result rather than a crash — same contract as the Claude
 * reader.
 */

import { readFile } from 'node:fs/promises';
import type {
  SessionStats,
  SessionFileTouch,
  SessionQueueItem,
  SessionTokenBreakdown
} from '@shared/types';

/**
 * The minimal envelope shape we read from a Codex rollout line. Everything is
 * optional because we tolerate partial/older/newer schemas. `payload` is a
 * discriminated bag keyed by `payload.type`; we narrow on the specific shapes we
 * care about at each use site rather than modelling the whole union.
 */
interface CodexLine {
  type?: string;
  payload?: CodexPayload;
}

interface CodexPayload {
  type?: string;
  // session_meta
  id?: string;
  cwd?: string;
  // response_item -> message
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
  // event_msg -> user_message (the typed prompt)
  message?: string;
  // function_call / custom_tool_call
  name?: string;
  arguments?: string;
  input?: string;
  // event_msg -> token_count
  info?: {
    total_token_usage?: CodexTokenUsage;
    last_token_usage?: CodexTokenUsage;
    model_context_window?: number;
  };
  // turn_context
  model?: string;
}

interface CodexTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

/** Parse rollout JSONL text into envelopes, skipping blank/malformed lines. */
function parseCodexJsonl(raw: string): CodexLine[] {
  const out: CodexLine[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as CodexLine);
    } catch {
      // A live rollout is append-only; the final line can be a partial write, or
      // a tail slice can cut the first line mid-JSON. Skip rather than fail.
    }
  }
  return out;
}

/** True for an assistant `response_item` message line. */
function isAssistantMessage(line: CodexLine): boolean {
  return (
    line.type === 'response_item' &&
    line.payload?.type === 'message' &&
    line.payload?.role === 'assistant'
  );
}

/** Join the `output_text` blocks of an assistant message into one string. */
function assistantText(line: CodexLine): string {
  const blocks = line.payload?.content;
  if (!Array.isArray(blocks)) return '';
  const texts: string[] = [];
  for (const b of blocks) {
    // Assistant prose is `output_text`; a defensive fallback also accepts plain
    // `text` in case a future schema drops the `output_` prefix.
    if ((b?.type === 'output_text' || b?.type === 'text') && typeof b.text === 'string') {
      const t = b.text.trim();
      if (t) texts.push(t);
    }
  }
  return texts.join('\n');
}

/**
 * Extract the last assistant *text* from parsed Codex lines, capped to `maxChars`
 * (keeping the TAIL — recent words matter most). Returns '' when the session has
 * no assistant prose. Mirrors {@link extractLastAssistantText} (Claude). Pure.
 */
export function extractLastAssistantTextCodex(lines: CodexLine[], maxChars = 4_000): string {
  let last = '';
  for (const line of lines) {
    if (!isAssistantMessage(line)) continue;
    const t = assistantText(line);
    if (t) last = t;
  }
  return last.length > maxChars ? last.slice(last.length - maxChars) : last;
}

/** The typed user prompt from an `event_msg` `user_message` line, or ''. */
function userMessageText(line: CodexLine): string {
  if (line.type === 'event_msg' && line.payload?.type === 'user_message') {
    const m = line.payload.message;
    if (typeof m === 'string') return m.trim();
  }
  return '';
}

/** A human-facing tool label for a Codex function/custom tool-call line, or ''. */
function toolCallName(line: CodexLine): string {
  const p = line.payload;
  if (!p) return '';
  if (p.type === 'function_call' || p.type === 'custom_tool_call') {
    return typeof p.name === 'string' ? p.name : '';
  }
  return '';
}

/**
 * Build a readable, role-tagged DIGEST of a whole Codex session, mirroring
 * {@link buildSessionDigest} (Claude): the user's typed prompts, the assistant's
 * prose, and the tools it ran (deduped per adjacent run). Tool OUTPUT and
 * reasoning are dropped (they bloat the input). Capped to `maxChars` keeping the
 * TAIL. Pure; exported for tests.
 */
export function buildSessionDigestCodex(
  lines: CodexLine[],
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

  for (const line of lines) {
    const user = userMessageText(line);
    if (user) {
      flushTools();
      parts.push(`User: ${clamp(user)}`);
      continue;
    }
    if (isAssistantMessage(line)) {
      const t = assistantText(line);
      if (t) {
        flushTools();
        parts.push(`Assistant: ${clamp(t)}`);
      }
      continue;
    }
    const tool = toolCallName(line);
    if (tool && !pendingTools.includes(tool)) pendingTools.push(tool);
  }
  flushTools();

  const digest = parts.join('\n\n');
  return digest.length > maxChars ? digest.slice(digest.length - maxChars) : digest;
}

// Per-million-token USD rates for Codex/OpenAI models, keyed by a substring of
// the model id. APPROXIMATE GPT-5-family list prices (a rough in-UI guide, NOT
// billing truth — same disclaimer as the Claude reader's table). OpenAI bills
// cached input at a fraction of fresh input and folds reasoning tokens into the
// output count; there is no separate cache-WRITE charge (unlike Anthropic).
const CODEX_MODEL_RATES: Array<{ match: string; in: number; out: number }> = [
  { match: 'gpt-5', in: 1.25, out: 10 },
  { match: 'codex', in: 1.25, out: 10 },
  { match: 'o3', in: 2, out: 8 },
  { match: 'gpt-4', in: 2.5, out: 10 }
];

// OpenAI cached-input read multiplier on the base input rate (~10× cheaper).
const CODEX_CACHE_READ_MULT = 0.1;

function codexRateFor(model: string | undefined) {
  const m = (model ?? '').toLowerCase();
  return CODEX_MODEL_RATES.find((r) => m.includes(r.match));
}

/**
 * Which display op a Codex `apply_patch` hunk header maps to. Codex encodes file
 * ops in the patch text (`*** Add File:`, `*** Update File:`, `*** Delete File:`)
 * rather than as distinct tool names, so we scan the patch body. Add → C(reate),
 * Update → W(rite/modify), Delete → W (a modification of the tree). Returns an
 * array of {path, op} because one patch can touch several files.
 */
function fileTouchesFromPatch(patch: string | undefined): SessionFileTouch[] {
  if (typeof patch !== 'string' || !patch) return [];
  const out: SessionFileTouch[] = [];
  for (const line of patch.split('\n')) {
    const add = line.match(/^\*\*\* Add File: (.+)$/);
    if (add) {
      out.push({ path: add[1].trim(), op: 'C' });
      continue;
    }
    const upd = line.match(/^\*\*\* Update File: (.+)$/);
    if (upd) {
      out.push({ path: upd[1].trim(), op: 'W' });
      continue;
    }
    const del = line.match(/^\*\*\* Delete File: (.+)$/);
    if (del) {
      out.push({ path: del[1].trim(), op: 'W' });
    }
  }
  return out;
}

/**
 * Distill a {@link SessionStats} from parsed Codex lines. Unlike the Claude
 * reader (which SUMS per-turn usage), Codex records a CUMULATIVE
 * `total_token_usage` on every `token_count` event, so we take the LATEST one —
 * simpler and exact. Mapping to the provider-neutral {@link SessionTokenBreakdown}:
 *   - cacheRead ← cached_input_tokens
 *   - input    ← input_tokens − cached_input_tokens   (fresh, non-cached prompt)
 *   - output   ← output_tokens                        (reasoning is a subset)
 *   - cacheWrite ← 0                                   (no OpenAI cache-write bill)
 * contextTokens ← the latest turn's `last_token_usage.input_tokens` (how full the
 * window is now). model ← the latest `turn_context.model`. files ← every
 * apply_patch touch, deduped by path (last op wins). Codex has no TodoWrite
 * equivalent, so `queue` is always empty. Pure; exported for tests. Never throws.
 */
export function buildSessionStatsCodex(lines: CodexLine[]): SessionStats {
  let model: string | undefined;
  let contextTokens: number | undefined;
  let latestTotal: CodexTokenUsage | undefined;
  // Insertion-ordered path→op; re-touching refreshes op AND moves to the end so
  // we can emit most-recent-first by reversing (mirrors the Claude reader).
  const files = new Map<string, SessionFileTouch['op']>();

  for (const line of lines) {
    // Model comes from turn_context lines (one per turn); keep the latest.
    if (line.type === 'turn_context' && typeof line.payload?.model === 'string') {
      model = line.payload.model;
    }

    // Cumulative token accounting: keep the latest token_count event's totals.
    if (line.type === 'event_msg' && line.payload?.type === 'token_count') {
      const info = line.payload.info;
      if (info?.total_token_usage) latestTotal = info.total_token_usage;
      const last = info?.last_token_usage;
      if (last && typeof last.input_tokens === 'number') contextTokens = last.input_tokens;
    }

    // File ops from apply_patch custom-tool calls.
    if (line.payload?.type === 'custom_tool_call' && line.payload.name === 'apply_patch') {
      for (const touch of fileTouchesFromPatch(line.payload.input)) {
        files.delete(touch.path); // re-insert at the end for recency ordering
        files.set(touch.path, touch.op);
      }
    }
  }

  let tokens: SessionTokenBreakdown | undefined;
  let costUsd: number | undefined;
  if (latestTotal) {
    const totalInput = latestTotal.input_tokens ?? 0;
    const cacheRead = latestTotal.cached_input_tokens ?? 0;
    const freshInput = Math.max(0, totalInput - cacheRead);
    const output = latestTotal.output_tokens ?? 0;
    tokens = { input: freshInput, output, cacheRead, cacheWrite: 0 };

    const rate = codexRateFor(model);
    if (rate) {
      costUsd =
        (freshInput / 1e6) * rate.in +
        (cacheRead / 1e6) * rate.in * CODEX_CACHE_READ_MULT +
        (output / 1e6) * rate.out;
    }
  }

  const fileList: SessionFileTouch[] = [...files.entries()]
    .reverse()
    .map(([path, op]) => ({ path, op }));

  return {
    model,
    contextTokens,
    costUsd,
    tokens,
    files: fileList,
    queue: [] as SessionQueueItem[]
  };
}

/**
 * Read a Codex rollout file and return its last assistant prose, or '' when the
 * file is missing/unreadable/empty. Never throws. Bounds the read to `tailBytes`
 * from the end — rollouts grow large but only the tail holds the last turn.
 * Mirrors {@link readLastAssistantText}.
 */
export async function readLastAssistantTextCodex(
  path: string,
  opts: { tailBytes?: number; maxChars?: number } = {}
): Promise<string> {
  const tailBytes = opts.tailBytes ?? 256 * 1024;
  try {
    const raw = await readFile(path, 'utf8');
    const sliced = raw.length > tailBytes ? raw.slice(raw.length - tailBytes) : raw;
    return extractLastAssistantTextCodex(parseCodexJsonl(sliced), opts.maxChars);
  } catch {
    return '';
  }
}

/**
 * Read a Codex rollout file and return a role-tagged digest of the whole
 * conversation, or '' when missing/unreadable. Never throws. Uses a larger tail
 * window than {@link readLastAssistantTextCodex}. Mirrors {@link readSessionDigest}.
 */
export async function readSessionDigestCodex(
  path: string,
  opts: { tailBytes?: number; maxChars?: number; perBlockChars?: number } = {}
): Promise<string> {
  const tailBytes = opts.tailBytes ?? 2 * 1024 * 1024;
  try {
    const raw = await readFile(path, 'utf8');
    const sliced = raw.length > tailBytes ? raw.slice(raw.length - tailBytes) : raw;
    return buildSessionDigestCodex(parseCodexJsonl(sliced), {
      maxChars: opts.maxChars,
      perBlockChars: opts.perBlockChars
    });
  } catch {
    return '';
  }
}

/**
 * Read a Codex rollout file and distill a display-only {@link SessionStats}, or
 * null when missing/unreadable. Never throws. Needs the whole file (files-touched
 * + cumulative tokens span the session), capped at `maxBytes`. Mirrors
 * {@link readSessionStats}.
 */
export async function readSessionStatsCodex(
  path: string,
  opts: { maxBytes?: number } = {}
): Promise<SessionStats | null> {
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  try {
    const raw = await readFile(path, 'utf8');
    const sliced = raw.length > maxBytes ? raw.slice(raw.length - maxBytes) : raw;
    return buildSessionStatsCodex(parseCodexJsonl(sliced));
  } catch {
    return null;
  }
}

// Exported for the session resolver + tests: the parser is shared.
export { parseCodexJsonl };
export type { CodexLine };
