import { constants } from 'node:fs';
import { mkdir, open, opendir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConversationTranscript } from '@zana-ai/zcc-domain/product';

export interface NativeHistoryFormat {
  id: string;
  root: string;
  globalScan?: boolean;
  directories(cwd: string, originalPath: string): string[];
  descend?(name: string, depth: number): boolean;
  metadata(rows: Record<string, any>[], path: string): { id: string; cwd: string } | undefined;
  title?(rows: Record<string, any>[]): string | undefined;
  parse(text: string): ConversationTranscript;
}
interface Entry {
  source: string;
  id: string;
  cwd: string;
  path: string;
  title: string;
  lastActiveAt: number;
  size: number;
}
export const NATIVE_HISTORY_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_FILES = 10_000;
const HEAD_BYTES = 256 * 1024;
const TRANSCRIPT_BYTES = 4 * 1024 * 1024;

export function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
}

/** Read fixed-size windows, never a growing multi-megabyte rollout in one allocation. */
export async function windowText(path: string, bytes: number, tail = false): Promise<{ text: string; size: number }> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('Not a transcript file');
    const start = tail ? Math.max(0, info.size - bytes) : 0;
    const buffer = Buffer.alloc(Math.min(info.size, bytes));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    if (!tail && info.size > bytes) text = text.slice(0, text.lastIndexOf('\n'));
    return { text, size: info.size };
  } finally { await file.close(); }
}

export function jsonLines(text: string): Record<string, any>[] {
  return text.split('\n').flatMap((line) => {
    try { const value = JSON.parse(line); return value && typeof value === 'object' ? [value] : []; }
    catch { return []; }
  });
}

export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part && ['text', 'input_text', 'output_text'].includes(part.type))
    .map((part) => typeof part.text === 'string' ? part.text : '').join('\n');
}

export function boundedTranscript(messages: Iterable<{ role: 'user' | 'assistant'; text: string }>): ConversationTranscript {
  const result: ConversationTranscript = { messages: [], truncated: false };
  let total = 0;
  for (const message of messages) {
    const body = message.text.trim();
    if (!body) continue;
    if (result.messages.length >= 500 || total + body.length > 1_000_000) { result.truncated = true; break; }
    result.messages.push({ role: message.role, text: body.slice(0, 64_000) });
    total += body.length;
    result.truncated ||= body.length > 64_000;
  }
  return result;
}

/** Metadata-only index. Native transcripts remain the source of truth after app restarts. */
export class NativeConversationIndex {
  private entries: Entry[] = [];
  private loaded?: Promise<void>;
  private scans = new Map<string, Promise<void>>();
  private scannedAt = new Map<string, number>();
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly format: NativeHistoryFormat, private readonly indexPath: string) {}

  private load(): Promise<void> {
    return this.loaded ??= (async () => {
      try {
        if ((await stat(this.indexPath)).size > 12 * 1024 * 1024) return;
        const data: unknown = JSON.parse(await readFile(this.indexPath, 'utf8'));
        if (Array.isArray(data)) this.entries = data.slice(0, MAX_FILES).filter((e): e is Entry =>
          e && e.source === this.format.id && typeof e.id === 'string' && NATIVE_HISTORY_ID.test(e.id)
          && typeof e.cwd === 'string' && typeof e.path === 'string' && typeof e.title === 'string'
          && Number.isFinite(e.lastActiveAt) && Number.isFinite(e.size));
      } catch { /* Missing/corrupt metadata is rebuilt from native stores. */ }
    })();
  }

  private persist(): Promise<void> {
    this.writes = this.writes.catch(() => {}).then(async () => {
      const tmp = `${this.indexPath}.${randomUUID()}.tmp`;
      try {
        await mkdir(dirname(this.indexPath), { recursive: true });
        await writeFile(tmp, JSON.stringify(this.entries), { mode: 0o600 });
        await rename(tmp, this.indexPath);
      } finally { await rm(tmp, { force: true }); }
    });
    return this.writes;
  }

  async list(projectPath: string, limit: number, signal?: AbortSignal): Promise<Entry[]> {
    await this.load();
    const cwd = await realpath(projectPath);
    const key = this.format.globalScan ? this.format.id : cwd;
    if (Date.now() - (this.scannedAt.get(key) ?? 0) > 30_000) {
      let scan = this.scans.get(key);
      if (!scan) {
        scan = this.scan(cwd, projectPath, signal).then(() => { if (!signal?.aborted) { this.scannedAt.set(key, Date.now()); if (this.scannedAt.size > 128) this.scannedAt.delete(this.scannedAt.keys().next().value!); } }).finally(() => this.scans.delete(key));
        this.scans.set(key, scan);
      }
      await scan;
    }
    return this.entries.filter((e) => e.cwd === cwd).slice(0, Math.max(0, Math.min(limit, MAX_FILES)));
  }

  private async scan(cwd: string, projectPath: string, signal?: AbortSignal): Promise<void> {
    const root = this.format.root;
    const files: string[] = [];
    let visited = 0;
    const walk = async (dir: string, depth: number): Promise<void> => {
      let directory;
      try {
        // A symlinked native root is allowed, but no nested escape is.
        if (!within(await realpath(root), await realpath(dir))) return;
        directory = await opendir(dir);
      } catch { return; }
      for await (const item of directory) {
        if (signal?.aborted || ++visited > MAX_FILES * 2 || files.length >= MAX_FILES) break;
        if (item.isFile() && item.name.endsWith('.jsonl')) files.push(join(dir, item.name));
        else if (item.isDirectory() && this.format.descend?.(item.name, depth)) await walk(join(dir, item.name), depth + 1);
      }
    };
    for (const base of new Set(this.format.directories(cwd, projectPath))) await walk(base, 0);
    const previous = new Map(this.entries.map((e) => [e.path, e]));
    const discovered: Entry[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < files.length && !signal?.aborted) {
        const path = files[next++];
        try {
          const info = await stat(path);
          const cached = previous.get(path);
          if (cached && cached.lastActiveAt === info.mtimeMs && cached.size === info.size) { discovered.push(cached); continue; }
          const head = await windowText(path, HEAD_BYTES);
          const rows = jsonLines(head.text);
          const meta = this.format.metadata(rows, path);
          if (!meta || !NATIVE_HISTORY_ID.test(meta.id)) continue;
          const { id } = meta;
          const canonicalCwd = await realpath(meta.cwd);
          if (!this.format.globalScan && canonicalCwd !== cwd) continue;
          const tail = info.size > HEAD_BYTES ? jsonLines((await windowText(path, HEAD_BYTES, true)).text) : rows;
          const namedTitle = this.format.title?.(tail);
          const first = this.format.parse(head.text).messages.find((m) => m.role === 'user')?.text;
          const title = (namedTitle || first || 'Untitled conversation').replace(/\s+/g, ' ').slice(0, 200);
          discovered.push({ source: this.format.id, id, cwd: canonicalCwd, path, title, lastActiveAt: info.mtimeMs, size: info.size });
        } catch { /* One unreadable transcript must not hide other conversations. */ }
      }
    }));
    if (signal?.aborted) return;
    this.entries = [...this.entries.filter((e) => !this.format.globalScan && e.cwd !== cwd), ...discovered]
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt || a.id.localeCompare(b.id)).slice(0, MAX_FILES);
    await this.persist();
  }

  private async validatedPath(projectPath: string, id: string): Promise<string> {
    await this.load();
    const cwd = await realpath(projectPath);
    const entry = this.entries.find((e) => e.cwd === cwd && e.id === id);
    if (!entry) throw new Error('Missing transcript');
    const root = await realpath(this.format.root);
    const path = await realpath(entry.path);
    if (!within(root, path)) throw new Error('Transcript escaped its native store');
    const head = await windowText(path, HEAD_BYTES);
    const meta = this.format.metadata(jsonLines(head.text), path);
    if (!meta || meta.id !== id || await realpath(meta.cwd) !== cwd) throw new Error('Transcript identity changed');
    return path;
  }

  async validate(projectPath: string, id: string): Promise<boolean> {
    try { await this.validatedPath(projectPath, id); return true; } catch { return false; }
  }

  async transcript(projectPath: string, id: string): Promise<ConversationTranscript> {
    try {
      const path = await this.validatedPath(projectPath, id);
      const body = await windowText(path, TRANSCRIPT_BYTES);
      const result = this.format.parse(body.text);
      return { ...result, truncated: result.truncated || body.size > TRANSCRIPT_BYTES };
    } catch {
      return { messages: [], truncated: false, unavailableReason: 'The saved transcript is missing or no longer belongs to this project.' };
    }
  }
}
