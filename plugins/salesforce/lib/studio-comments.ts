/**
 * Studio review comments. One kv document per project (`studio:comments:<projectId>`), capped, written through a
 * per-project mutex (read-modify-write is serialized), re-anchored by quote when the file moved under a comment.
 * RPC names come from STUDIO_RPC; failures are returned as { ok:false, code, error }, never thrown.
 */
import { randomUUID } from 'node:crypto';
import { readAgentFile } from './agent-files.js';
import { STUDIO_CHANGED_CHANNEL, STUDIO_LIMITS, STUDIO_RPC, type StudioComment } from './studio-contract.js';
import { rpcFailure, rpcString, type StudioServerContext } from './studio-server-context.js';

export const COMMENT_CAP = 500;
export const COMMENT_BODY_MAX = 4000;
export const COMMENT_NOTE_MAX = 2000;
export const COMMENT_PATH_MAX = 512;
const SOURCE_MAX = 180_000;

export const commentsKey = (projectId: string) => `studio:comments:${projectId}`;

export interface CommentKv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export type StudioCommentErrorCode = 'invalid' | 'not_found' | 'limit' | 'already_resolved';

export class StudioCommentError extends Error {
  constructor(readonly code: StudioCommentErrorCode, message: string) {
    super(message);
  }
}

export interface AddCommentInput {
  path: string;
  line: number;
  endLine?: number;
  body: string;
  quote?: string;
  /** Current text of the file; used to derive the quote when none is given. */
  source?: string;
}

export interface CommentActor { kind: 'user' | 'agent'; threadId?: string; name: string }

interface CommentDoc { v: 1; comments: StudioComment[] }

const isPos = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1;

function sliceQuote(lines: readonly string[], line: number, endLine: number): string {
  return lines.slice(line - 1, endLine).join('\n').slice(0, STUDIO_LIMITS.quote);
}

/**
 * Where does the comment's quote live in `lines` now? Unchanged position wins; otherwise the nearest exact
 * (whitespace-trimmed) match of the quoted block; otherwise null (the comment is orphaned and keeps its line).
 */
export function reanchorComment(comment: Pick<StudioComment, 'line' | 'endLine' | 'quote'>, lines: readonly string[]): { line: number; endLine: number } | null {
  const quote = comment.quote.split('\n').map(row => row.trim());
  while (quote.length > 0 && quote[quote.length - 1] === '') quote.pop();
  while (quote.length > 0 && quote[0] === '') quote.shift();
  if (quote.length === 0) return { line: comment.line, endLine: comment.endLine };
  const matchesAt = (start: number) => quote.every((row, offset) => (lines[start + offset] ?? '').trim() === row);
  if (matchesAt(comment.line - 1)) return { line: comment.line, endLine: comment.endLine };
  let best = -1;
  for (let i = 0; i + quote.length <= lines.length; i += 1) {
    if (!matchesAt(i)) continue;
    if (best < 0 || Math.abs(i + 1 - comment.line) < Math.abs(best + 1 - comment.line)) best = i;
  }
  return best < 0 ? null : { line: best + 1, endLine: best + quote.length };
}

export class StudioCommentStore {
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(
    private readonly kv: CommentKv,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = () => `cm_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  ) {}

  /** Serializes read-modify-write per project. A failed step never poisons the queue. */
  private locked<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const run = (this.tails.get(projectId) ?? Promise.resolve()).then(work, work);
    const tail = run.catch(() => undefined);
    this.tails.set(projectId, tail);
    void tail.then(() => { if (this.tails.get(projectId) === tail) this.tails.delete(projectId); });
    return run;
  }

  private async read(projectId: string): Promise<StudioComment[]> {
    const doc = await this.kv.get<CommentDoc>(commentsKey(projectId));
    return doc && Array.isArray(doc.comments) ? doc.comments : [];
  }

  private write(projectId: string, comments: StudioComment[]): Promise<void> {
    return this.kv.set(commentsKey(projectId), { v: 1, comments } satisfies CommentDoc);
  }

  /** Lists comments (sorted by path, line). With `source` and `path`, moved comments are re-anchored and persisted. */
  list(projectId: string, options: { path?: string; includeResolved?: boolean; source?: string } = {}): Promise<StudioComment[]> {
    return this.locked(projectId, async () => {
      let comments = await this.read(projectId);
      if (options.path && options.source !== undefined) {
        const lines = options.source.split('\n');
        let changed = false;
        comments = comments.map(comment => {
          if (comment.path !== options.path || comment.resolved) return comment;
          const anchor = reanchorComment(comment, lines);
          if (!anchor || (anchor.line === comment.line && anchor.endLine === comment.endLine)) return comment;
          changed = true;
          return { ...comment, line: anchor.line, endLine: anchor.endLine };
        });
        if (changed) await this.write(projectId, comments);
      }
      return comments
        .filter(comment => (!options.path || comment.path === options.path) && (options.includeResolved || !comment.resolved))
        .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.createdAt - b.createdAt);
    });
  }

  add(projectId: string, input: AddCommentInput, author: CommentActor): Promise<StudioComment> {
    const path = input.path.trim();
    const body = input.body.trim();
    const endLine = input.endLine ?? input.line;
    if (!path || path.length > COMMENT_PATH_MAX || path.includes('\0')) return Promise.reject(new StudioCommentError('invalid', 'Comment path is required (max 512 chars).'));
    if (!body || body.length > COMMENT_BODY_MAX) return Promise.reject(new StudioCommentError('invalid', `Comment body is required (max ${COMMENT_BODY_MAX} chars).`));
    if (!isPos(input.line) || !isPos(endLine) || endLine < input.line) return Promise.reject(new StudioCommentError('invalid', 'line and endLine must be positive integers with endLine >= line.'));
    const quote = (input.quote ?? (input.source !== undefined ? sliceQuote(input.source.split('\n'), input.line, endLine) : '')).slice(0, STUDIO_LIMITS.quote);
    return this.locked(projectId, async () => {
      let comments = await this.read(projectId);
      if (comments.length >= COMMENT_CAP) {
        const oldestResolved = comments.filter(row => row.resolved).sort((a, b) => a.resolved!.at - b.resolved!.at)[0];
        if (!oldestResolved) throw new StudioCommentError('limit', `This project has ${COMMENT_CAP} open comments. Resolve some before adding more.`);
        comments = comments.filter(row => row.id !== oldestResolved.id);
      }
      const comment: StudioComment = { id: this.newId(), path, line: input.line, endLine, quote, body, author: { ...author }, createdAt: this.now() };
      await this.write(projectId, [...comments, comment]);
      return comment;
    });
  }

  resolve(projectId: string, input: { id: string; note: string }, by: string): Promise<StudioComment> {
    const note = input.note.trim();
    if (!note || note.length > COMMENT_NOTE_MAX) return Promise.reject(new StudioCommentError('invalid', `Resolving a comment requires a note (max ${COMMENT_NOTE_MAX} chars).`));
    return this.locked(projectId, async () => {
      const comments = await this.read(projectId);
      const found = comments.find(row => row.id === input.id);
      if (!found) throw new StudioCommentError('not_found', 'Comment not found.');
      if (found.resolved) throw new StudioCommentError('already_resolved', 'Comment is already resolved.');
      const resolved: StudioComment = { ...found, resolved: { at: this.now(), note, by } };
      await this.write(projectId, comments.map(row => (row.id === found.id ? resolved : row)));
      return resolved;
    });
  }
}

/** studio.comments.list / add / resolve. */
export function registerStudioComments(studio: StudioServerContext): void {
  const store = new StudioCommentStore(studio.zcc.storage.kv);
  const projectOf = () => studio.contexts.current()?.projectId ?? '';

  const sourceFor = (args: unknown, path: string): string | undefined => {
    const content = (args as { content?: unknown } | null)?.content;
    if (typeof content === 'string') return content.length <= SOURCE_MAX ? content : undefined;
    const root = studio.contexts.current()?.settings.projectRoot;
    if (!root || !path) return undefined;
    try { return readAgentFile(root, path, studio.deps).content; } catch { return undefined; }
  };
  const guarded = (work: (projectId: string) => Promise<unknown>) => async () => {
    const projectId = projectOf();
    if (!projectId) return rpcFailure('project_required', 'Choose a registered project to use review comments.');
    try { return await work(projectId); }
    catch (error) {
      if (error instanceof StudioCommentError) return rpcFailure(error.code, error.message);
      throw error;
    }
  };
  const changed = (projectId: string, path?: string) => studio.zcc.realtime.publish(STUDIO_CHANGED_CHANNEL, { projectId, ...(path ? { path } : {}), kind: 'comments' });

  studio.registerRpc(STUDIO_RPC.comments, (args) => guarded(async projectId => {
    const path = rpcString(args, 'path');
    const includeResolved = (args as { includeResolved?: unknown } | null)?.includeResolved === true;
    const comments = await store.list(projectId, { path: path || undefined, includeResolved, source: path ? sourceFor(args, path) : undefined });
    return { ok: true, comments, openCount: comments.filter(row => !row.resolved).length };
  })());

  studio.registerRpc(STUDIO_RPC.commentAdd, (args) => guarded(async projectId => {
    const row = (args ?? {}) as Record<string, unknown>;
    const path = rpcString(args, 'path');
    const threadId = rpcString(args, 'threadId');
    const author: CommentActor = threadId ? { kind: 'agent', threadId, name: 'Agent' } : { kind: 'user', name: 'You' };
    const comment = await store.add(projectId, {
      path, line: Number(row.line), endLine: row.endLine === undefined ? undefined : Number(row.endLine),
      body: typeof row.body === 'string' ? row.body : '', quote: typeof row.quote === 'string' ? row.quote : undefined,
      source: sourceFor(args, path)
    }, author);
    changed(projectId, comment.path);
    return { ok: true, comment };
  })());

  studio.registerRpc(STUDIO_RPC.commentResolve, (args) => guarded(async projectId => {
    const threadId = rpcString(args, 'threadId');
    const comment = await store.resolve(projectId, { id: rpcString(args, 'id'), note: typeof (args as { note?: unknown } | null)?.note === 'string' ? String((args as { note: string }).note) : '' }, threadId ? `agent:${threadId}` : 'user');
    changed(projectId, comment.path);
    return { ok: true, comment };
  })());
}
