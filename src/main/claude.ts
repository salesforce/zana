import { app } from 'electron';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClaudeSessionSummary } from '../shared/types.js';
import { encodeProjectCwd } from '../shared/path-encoding.js';

function projectsDir(): string {
  return join(app.getPath('home'), '.claude', 'projects');
}

interface JsonlLine {
  type?: string;
  timestamp?: string;
  message?: { role?: string; content?: unknown };
  // Title-bearing line types Claude Code writes into the transcript:
  //   {"type":"custom-title","customTitle":"…"}  ← the user's /rename
  //   {"type":"ai-title","aiTitle":"…"}          ← Claude's auto title
  customTitle?: string;
  aiTitle?: string;
}

/**
 * The session's display name from the transcript. A user `/rename`
 * (`custom-title`) wins over Claude's auto-generated `ai-title`; both are
 * emitted as their own line types, and the latest of each kind is authoritative
 * (Claude appends a new line on each rename). Returns null when neither exists.
 */
export function extractTitle(lines: string[]): string | null {
  let custom: string | null = null;
  let ai: string | null = null;
  for (const raw of lines) {
    if (!raw) continue;
    // Cheap pre-filter: skip the parse unless the line is a title type.
    if (raw.indexOf('-title"') === -1) continue;
    try {
      const obj = JSON.parse(raw) as JsonlLine;
      if (obj.type === 'custom-title' && typeof obj.customTitle === 'string' && obj.customTitle.trim()) {
        custom = obj.customTitle.trim();
      } else if (obj.type === 'ai-title' && typeof obj.aiTitle === 'string' && obj.aiTitle.trim()) {
        ai = obj.aiTitle.trim();
      }
    } catch {
      /* ignore malformed lines */
    }
  }
  return custom ?? ai;
}

function extractFirstUserPrompt(lines: string[]): string | null {
  for (const raw of lines) {
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw) as JsonlLine;
      if (obj?.message?.role === 'user') {
        const c = obj.message.content;
        if (typeof c === 'string') return truncate(c);
        if (Array.isArray(c)) {
          const text = c
            .map((b) => (b && typeof b === 'object' && 'text' in b ? (b as { text: string }).text : ''))
            .filter(Boolean)
            .join(' ');
          if (text) return truncate(text);
        }
      }
    } catch {
      /* ignore malformed lines */
    }
  }
  return null;
}

function truncate(s: string, n = 120): string {
  const single = s.replace(/\s+/g, ' ').trim();
  return single.length > n ? single.slice(0, n - 1) + '…' : single;
}

/**
 * How many of the newest transcripts to fully read + parse. The pickers only
 * ever render `.slice(0, 8)`, so reading the whole project's transcript dir was
 * pure waste — and a killer one, because a transcript can be multiple MB and
 * this used to run synchronously on the main event loop (`readFileSync` +
 * `split` + JSON parse of EVERY file), freezing the renderer until it finished
 * (the "launcher textarea frozen until the Agents list loads" bug). We now (a)
 * do all I/O async so the event loop is never blocked, and (b) only read the
 * newest {@link SESSION_READ_CAP} files — the rest are cheaply `stat`-ordered
 * and returned as lightweight rows (id + timestamps), which is all the picker
 * needs beyond the visible head. This is the Rule-5 "bound unbounded reads" fix.
 */
const SESSION_READ_CAP = 12;
const SESSION_DIRECTORY_ENTRY_CAP = 64;
const SESSION_STAT_CONCURRENCY = 4;

async function boundedMap<T, R>(items: readonly T[], worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SESSION_STAT_CONCURRENCY, items.length) }, run));
  return out;
}

/**
 * Summaries for a project's Claude transcripts, newest first. Async + bounded:
 * every file is `stat`ed (cheap), but only the newest {@link SESSION_READ_CAP}
 * are opened and parsed for their title / first prompt / message count. Older
 * ones get a lightweight summary (no body read) so the list stays complete
 * without the multi-MB read storm that blocked the main process.
 */
export async function listClaudeSessions(projectPath: string, maxSessions?: number): Promise<ClaudeSessionSummary[]> {
  const dir = join(projectsDir(), encodeProjectCwd(projectPath));
  if (!existsSync(dir)) return [];

  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl')).slice(0, SESSION_DIRECTORY_ENTRY_CAP);
  } catch {
    return [];
  }

  // Stat every file first (cheap) so we can sort by recency and only fully read
  // the newest few. A failed stat drops the entry.
  const statted = await boundedMap(files, async (file) => {
      try {
        const st = await stat(join(dir, file));
        return { file, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs || st.mtimeMs };
      } catch {
        return null;
      }
  });
  const ordered = statted
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const summaries = await boundedMap(ordered, async (e, i) => {
      const base: ClaudeSessionSummary = {
        id: e.file.replace(/\.jsonl$/, ''),
        projectPath,
        startedAt: e.birthtimeMs,
        lastActiveAt: e.mtimeMs,
        messageCount: 0,
        firstUserPrompt: null,
        title: null
      };
      // Only the newest N are worth the full read — the picker renders 8.
      if (i >= SESSION_READ_CAP) return base;
      let raw = '';
      try {
        raw = await readFile(join(dir, e.file), 'utf8');
      } catch {
        return base;
      }
      const lines = raw.split('\n');
      return {
        ...base,
        messageCount: lines.filter((l) => l.trim().length > 0).length,
        firstUserPrompt: extractFirstUserPrompt(lines),
        title: extractTitle(lines)
      };
  });

  // Already ordered by mtime desc via `ordered`.
  return maxSessions === undefined ? summaries : summaries.slice(0, maxSessions);
}
