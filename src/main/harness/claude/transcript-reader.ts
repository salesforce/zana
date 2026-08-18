/**
 * Reads a Claude Code session transcript and extracts the last thing the agent
 * said in plain prose — the input the idle-triage micro-call classifies.
 *
 * Why the transcript and not the PTY scrollback: the scrollback is a TTY stream
 * full of spinner frames, OSC titles and box-drawing redraws (Claude's own TUI),
 * so classifying it would mean stripping all that noise first. The transcript is
 * the same conversation as clean, structured JSONL — one JSON object per line —
 * so the "last assistant turn" is a single field, no ANSI to strip.
 *
 * Claude writes transcripts to
 *   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 * where `<encoded-cwd>` is the session's absolute cwd with every character
 * outside [A-Za-z0-9] replaced by `-` (so `/`, `.`, `_` all collapse to `-`),
 * and `<sessionId>` is the `claudeSessionId` we forced at spawn with
 * `--session-id`. Both inputs are already on {@link TerminalSession}, so the path
 * is a pure derivation — no directory search.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type {
  SessionStats,
  SessionFileTouch,
  SessionQueueItem,
  SessionTokenBreakdown
} from '@shared/types';
// Relative import (not the `@shared` alias): that alias is configured only for
// the RENDERER build in electron.vite.config.ts. A `import type` from @shared is
// erased before Rollup, but this is a VALUE import — the main build must resolve
// it, so it uses the main-side relative convention.
import { encodeProjectCwd } from '../../../shared/path-encoding.js';

export type { SessionStats, SessionFileTouch, SessionQueueItem, SessionTokenBreakdown };

/**
 * Re-exported for backward compatibility. Use {@link encodeProjectCwd} directly
 * from `@shared/path-encoding` in new code.
 * @deprecated Use `encodeProjectCwd` from `@shared/path-encoding` instead.
 */
export function encodeProjectDir(cwd: string): string {
  return encodeProjectCwd(cwd);
}

/** Absolute path to a session's transcript JSONL, or null if we lack the ids. */
export function transcriptPath(cwd: string, claudeSessionId: string | undefined): string | null {
  if (!claudeSessionId) return null;
  return join(homedir(), '.claude', 'projects', encodeProjectCwd(cwd), `${claudeSessionId}.jsonl`);
}

/**
 * The minimal shape we care about in a transcript line. Everything else on the
 * line (cwd, gitBranch, uuid, …) is ignored. A `message.content` block is either
 * a text block (`{type:'text', text}`) or a tool block (`{type:'tool_use', …}`)
 * we skip.
 */
interface TranscriptLine {
  type?: string;
  message?: {
    /** The model that produced an assistant line, e.g. `claude-sonnet-4-5-…`. */
    model?: string;
    /** Per-turn token accounting on an assistant line (absent on user lines). */
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      // Breakdown of cache_creation_input_tokens by TTL. 5-min writes bill at
      // 1.25× base input, 1-hour writes at 2× — different multipliers, so the
      // split matters for an accurate cost. Absent on older transcripts.
      cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
      };
    };
    // A user line's content is a plain string (a typed prompt) OR an array of
    // tool_result blocks; an assistant line's content is always an array of
    // text / thinking / tool_use blocks. We read `text`, tool_use `name`, and
    // — for file ops + the todo queue — the tool_use `input`; everything else is
    // ignored.
    content?:
      | string
      | Array<{ type?: string; text?: string; name?: string; input?: ToolUseInput }>;
  };
}

/** The tool_use `input` fields we read (file path + TodoWrite todos). */
interface ToolUseInput {
  file_path?: string;
  path?: string;
  notebook_path?: string;
  todos?: Array<{ content?: string; activeForm?: string; status?: string }>;
}

/**
 * Extract the last assistant *text* from parsed transcript lines, capped to
 * `maxChars` (keeping the TAIL — the most recent words matter most for "what is
 * it waiting on / did it finish"). Returns '' when the last assistant turn was a
 * tool call with no surrounding prose, or there's no assistant text at all.
 *
 * We scan once and keep the most recent text block across all assistant lines —
 * not merely the final line — so an agent whose very last line is a `tool_use`
 * still yields the prose it spoke just before. Pure; exported for tests.
 */
export function extractLastAssistantText(lines: TranscriptLine[], maxChars = 4_000): string {
  let last = '';
  for (const line of lines) {
    if (line.type !== 'assistant') continue;
    const blocks = line.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        last = block.text.trim();
      }
    }
  }
  // Keep the tail: the closing question / completion line is what classifies.
  return last.length > maxChars ? last.slice(last.length - maxChars) : last;
}

/**
 * Build a readable, role-tagged DIGEST of a whole session for an on-demand
 * "summarize this agent" call (the modal's "Summarize to inbox" button). Unlike
 * {@link extractLastAssistantText} — which keeps only the agent's final prose —
 * this preserves the SHAPE of the work: what the user asked, what the agent
 * said back, and which tools it ran. A one-line handoff note needs only the last
 * turn; a real summary needs the arc.
 *
 * Per line we emit:
 *   - user prose  → `User: <text>`               (the typed instructions)
 *   - assistant prose → `Assistant: <text>`       (text blocks, joined)
 *   - assistant tool_use → `Assistant ran: a, b`  (tool names, deduped per turn)
 * Tool *results* (large file dumps, command output) and `thinking` blocks are
 * dropped — they bloat the input without telling the model what happened. Each
 * block's text is clamped so one giant message can't crowd out the rest, then
 * the whole digest is capped to `maxChars` keeping the TAIL (recent turns carry
 * the current state). Pure; exported for tests.
 */
export function buildSessionDigest(
  lines: TranscriptLine[],
  opts: { maxChars?: number; perBlockChars?: number } = {}
): string {
  const maxChars = opts.maxChars ?? 12_000;
  const perBlockChars = opts.perBlockChars ?? 1_500;
  const clamp = (s: string) =>
    s.length > perBlockChars ? `${s.slice(0, perBlockChars)}…` : s;

  const parts: string[] = [];
  for (const line of lines) {
    const content = line.message?.content;
    if (line.type === 'user') {
      // A typed prompt is a plain string; an array is tool_result echoes we skip.
      if (typeof content === 'string' && content.trim()) {
        parts.push(`User: ${clamp(content.trim())}`);
      }
      continue;
    }
    if (line.type !== 'assistant' || !Array.isArray(content)) continue;
    const texts: string[] = [];
    const tools: string[] = [];
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        texts.push(block.text.trim());
      } else if (block?.type === 'tool_use' && typeof block.name === 'string' && block.name) {
        if (!tools.includes(block.name)) tools.push(block.name);
      }
    }
    if (texts.length) parts.push(`Assistant: ${clamp(texts.join('\n'))}`);
    if (tools.length) parts.push(`Assistant ran: ${tools.join(', ')}`);
  }

  const digest = parts.join('\n\n');
  // Keep the tail — the closing turns describe where the session actually ended.
  return digest.length > maxChars ? digest.slice(digest.length - maxChars) : digest;
}

// Per-million-token USD rates, keyed by a substring of the model id. These are
// current Anthropic list prices (Opus 4.x $5/$25, Sonnet $3/$15, Haiku 4.5
// $1/$5) — the number is a rough guide in the UI, not billing truth.
//
// Cache economics are derived from `in`, not stored separately:
//   - cache READ  = 0.1 × in  (reused context is ~10× cheaper)
//   - cache WRITE = 1.25 × in (5-min TTL) or 2 × in (1-hour TTL)
// so a rate table only needs the base input/output prices.
const MODEL_RATES: Array<{ match: string; in: number; out: number }> = [
  { match: 'opus', in: 5, out: 25 },
  { match: 'sonnet', in: 3, out: 15 },
  { match: 'haiku', in: 1, out: 5 }
];

// Prompt-caching multipliers on the base input rate (see MODEL_RATES).
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_5M_MULT = 1.25;
const CACHE_WRITE_1H_MULT = 2;

function rateFor(model: string | undefined) {
  const m = (model ?? '').toLowerCase();
  return MODEL_RATES.find((r) => m.includes(r.match));
}

/**
 * Which display op a tool name maps to, or null if it doesn't touch a file.
 * Read → R; Write (new file) → C; Edit/MultiEdit/NotebookEdit (modify) → W.
 */
function fileOpOf(name: string | undefined): SessionFileTouch['op'] | null {
  switch (name) {
    case 'Read':
      return 'R';
    case 'Write':
      return 'C';
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'W';
    default:
      return null;
  }
}

/**
 * Distill a {@link SessionStats} from parsed transcript lines. Single pass:
 *  - model / contextTokens ← the LAST assistant turn that carried each,
 *  - costUsd ← summed over every assistant turn's usage × the model's rate,
 *  - tokens ← lifetime totals per billing bucket, summed over every turn,
 *  - files ← every Read/Write/Edit tool_use, deduped by path (last op wins),
 *  - queue ← the MOST RECENT TodoWrite's todos,
 *  - promptCount ← typed user turns (string content, not tool_result echoes),
 *  - toolCalls / mcpCalls ← every tool_use block, MCP being names `mcp__…`.
 * Pure; exported for tests. Never throws on odd shapes — missing fields are
 * skipped, so a partial/truncated transcript yields a partial-but-valid stat.
 */
export function buildSessionStats(lines: TranscriptLine[]): SessionStats {
  let model: string | undefined;
  let contextTokens: number | undefined;
  let costUsd = 0;
  let sawCost = false;
  // Activity counters (Rule-1-safe scalars — no content). A typed prompt is a
  // user line whose `content` is a plain string; a user line whose content is an
  // array is a tool_result echo, which we do NOT count as a human prompt.
  let promptCount = 0;
  let toolCalls = 0;
  let mcpCalls = 0;
  // Lifetime token totals per billing bucket (summed over every turn), and a
  // flag for whether ANY turn carried usage accounting — so a transcript with
  // no usage lines yields `tokens: undefined` rather than a bogus all-zero.
  const tokenTotals: SessionTokenBreakdown = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let sawTokens = false;
  // Insertion-ordered map path→op; re-touching a path refreshes its op AND
  // moves it to the end, so we can emit most-recent-first by reversing.
  const files = new Map<string, SessionFileTouch['op']>();
  let queue: SessionQueueItem[] = [];

  for (const line of lines) {
    // Count a typed human prompt: a user line whose content is a plain string.
    // (An array is a tool_result echo the harness injects — not a human turn.)
    if (line.type === 'user' && typeof line.message?.content === 'string' && line.message.content.trim()) {
      promptCount++;
    }
    if (line.type !== 'assistant') continue;
    const msg = line.message;
    if (!msg) continue;
    if (typeof msg.model === 'string' && msg.model) model = msg.model;

    const u = msg.usage;
    if (u) {
      const freshInput = u.input_tokens ?? 0;
      const cacheCreate = u.cache_creation_input_tokens ?? 0;
      const cacheRead = u.cache_read_input_tokens ?? 0;
      const output = u.output_tokens ?? 0;
      // Split cache creation by TTL — 5-min writes bill at 1.25× base, 1-hour at
      // 2× — falling back to treating the whole lump as 5-min when the breakdown
      // is absent (older transcripts) so we never lose the write cost entirely.
      const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
      const write5m = u.cache_creation?.ephemeral_5m_input_tokens ?? cacheCreate - write1h;
      // Context = how full the window is NOW → the latest turn's total input.
      contextTokens = freshInput + cacheCreate + cacheRead;
      // Lifetime token totals per bucket, independent of whether a rate matched
      // (an unknown model still spent tokens, even if we can't price them).
      tokenTotals.input += freshInput;
      tokenTotals.output += output;
      tokenTotals.cacheRead += cacheRead;
      tokenTotals.cacheWrite += cacheCreate;
      sawTokens = true;
      const rate = rateFor(msg.model ?? model);
      if (rate) {
        costUsd +=
          (freshInput / 1e6) * rate.in +
          (write5m / 1e6) * rate.in * CACHE_WRITE_5M_MULT +
          (write1h / 1e6) * rate.in * CACHE_WRITE_1H_MULT +
          (cacheRead / 1e6) * rate.in * CACHE_READ_MULT +
          (output / 1e6) * rate.out;
        sawCost = true;
      }
    }

    const blocks = msg.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block?.type !== 'tool_use') continue;
      toolCalls++;
      if (typeof block.name === 'string' && block.name.startsWith('mcp__')) mcpCalls++;
      const op = fileOpOf(block.name);
      if (op) {
        const p = block.input?.file_path ?? block.input?.path ?? block.input?.notebook_path;
        if (typeof p === 'string' && p) {
          files.delete(p); // re-insert at the end so recency ordering holds
          files.set(p, op);
        }
      } else if (block.name === 'TodoWrite') {
        const todos = block.input?.todos;
        if (Array.isArray(todos)) {
          queue = todos
            .map((t) => ({
              text: (t.content ?? t.activeForm ?? '').trim(),
              status:
                t.status === 'in_progress' || t.status === 'completed' ? t.status : 'pending'
            }))
            .filter((t): t is SessionQueueItem => t.text.length > 0);
        }
      }
    }
  }

  const fileList: SessionFileTouch[] = [...files.entries()]
    .reverse()
    .map(([path, op]) => ({ path, op }));

  return {
    model,
    contextTokens,
    costUsd: sawCost ? costUsd : undefined,
    tokens: sawTokens ? tokenTotals : undefined,
    promptCount: promptCount > 0 ? promptCount : undefined,
    toolCalls: toolCalls > 0 ? toolCalls : undefined,
    mcpCalls: mcpCalls > 0 ? mcpCalls : undefined,
    files: fileList,
    queue
  };
}

/** Parse JSONL text into lines, skipping blanks and malformed lines silently. */
function parseJsonl(raw: string): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as TranscriptLine);
    } catch {
      // A partially-flushed final line (the session is live, append-only) can be
      // truncated mid-write — skip it rather than fail the whole read.
    }
  }
  return out;
}

/**
 * Read a session's transcript and return its last assistant prose, or '' when
 * the file is missing/unreadable/empty or the last turn carried no text. Never
 * throws — a triage that can't read its input simply produces no classification.
 *
 * Bounds the read: transcripts grow to multiple MB, but only the tail holds the
 * last turn. We read at most `tailBytes` from the end of the file.
 */
export async function readLastAssistantText(
  path: string,
  opts: { tailBytes?: number; maxChars?: number } = {}
): Promise<string> {
  const tailBytes = opts.tailBytes ?? 256 * 1024;
  try {
    // Read the whole file then keep the tail. Node has no cheap "read last N
    // bytes" without an fd dance; transcripts are local and the tail cap below
    // bounds what we PARSE, which is the expensive part. For very large files we
    // still slice the string tail before parsing so we never JSON.parse MBs.
    const raw = await readFile(path, 'utf8');
    const sliced = raw.length > tailBytes ? raw.slice(raw.length - tailBytes) : raw;
    // A tail slice may cut the first line mid-JSON; parseJsonl drops it safely.
    return extractLastAssistantText(parseJsonl(sliced), opts.maxChars);
  } catch {
    return '';
  }
}

/**
 * Read a session's transcript and return a role-tagged DIGEST of the whole
 * conversation (see {@link buildSessionDigest}) for an on-demand summary, or ''
 * when the file is missing/unreadable/empty. Never throws.
 *
 * Uses a larger tail window than {@link readLastAssistantText}: a real summary
 * wants the arc of the session, not just the last turn, so we read more of the
 * end of the file before digesting it.
 */
export async function readSessionDigest(
  path: string,
  opts: { tailBytes?: number; maxChars?: number; perBlockChars?: number } = {}
): Promise<string> {
  const tailBytes = opts.tailBytes ?? 2 * 1024 * 1024;
  try {
    const raw = await readFile(path, 'utf8');
    const sliced = raw.length > tailBytes ? raw.slice(raw.length - tailBytes) : raw;
    return buildSessionDigest(parseJsonl(sliced), {
      maxChars: opts.maxChars,
      perBlockChars: opts.perBlockChars
    });
  } catch {
    return '';
  }
}

/**
 * Read a session's transcript and distill a display-only {@link SessionStats}
 * (model, context tokens, cost, files touched, todo queue). Returns null when
 * the file is missing/unreadable — the caller shows nothing rather than zeros.
 * Never throws.
 *
 * Needs the WHOLE file, not just the tail: files touched + cumulative cost span
 * the entire session, and a tail slice would undercount both. Transcripts are
 * local and parsed once per refresh (the renderer throttles), so the full read
 * is acceptable; we still cap at `maxBytes` so a runaway transcript can't stall
 * the read.
 */
export async function readSessionStats(
  path: string,
  opts: { maxBytes?: number } = {}
): Promise<SessionStats | null> {
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  try {
    const raw = await readFile(path, 'utf8');
    // If the file exceeds the cap, keep the TAIL: recent turns hold the current
    // model/context/queue, and file-op history is best-effort for huge sessions.
    const sliced = raw.length > maxBytes ? raw.slice(raw.length - maxBytes) : raw;
    return buildSessionStats(parseJsonl(sliced));
  } catch {
    return null;
  }
}
