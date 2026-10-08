/**
 * Typed wrapper over the plugin's RPC methods (see `src/server/rpc.ts`).
 * Every call goes through the host's `useRpc()` client, so the server still
 * validates and attributes every mutation.
 */
import { useMemo } from 'react';
import { useRpc } from '@zana-ai/zcc-plugin-sdk/app';
import type {
  CommentStatus,
  DesignDocComment,
  DesignDocDetail,
  DesignDocFile,
  DesignDocFileMeta,
  DesignDocRevision,
  DesignDocSummary,
  DocStatus,
  TextEdit
} from '../shared/contract.js';
import type { PageFile } from '../shared/frame-protocol.js';
import type { PageRenderReport, RenderedPage } from '../shared/page.js';

export interface TemplateInfo {
  id: string;
  label: string;
  description: string;
  files: string[];
}

export interface ProjectInfo {
  id: string;
  name: string;
}

export interface WriteResult extends DesignDocFileMeta {
  docId: string;
  created: boolean;
}

export type RevisionContent = DesignDocRevision & { content: string; encoding: 'utf8' | 'base64' };

export interface ListArgs {
  projectId?: string;
  query?: string;
  status?: DocStatus | 'active' | 'all';
}

export interface CreateArgs {
  title: string;
  summary?: string;
  template?: string;
  tags?: string[];
  projectId?: string | null;
}

export interface UpdateArgs {
  title?: string;
  summary?: string;
  status?: DocStatus;
  tags?: string[];
  entryPath?: string;
  projectId?: string | null;
}

export interface DesignDocsApi {
  templates(): Promise<TemplateInfo[]>;
  projects(): Promise<ProjectInfo[]>;
  list(args?: ListArgs): Promise<DesignDocSummary[]>;
  get(doc: string): Promise<DesignDocDetail>;
  create(args: CreateArgs): Promise<DesignDocDetail>;
  update(doc: string, patch: UpdateArgs): Promise<DesignDocSummary>;
  remove(doc: string): Promise<void>;
  readFile(doc: string, path: string): Promise<DesignDocFile>;
  /** An HTML page bundled for the preview frame; `draft` renders unsaved HTML in place of the file. */
  renderPage(doc: string, args: { path: string; draft?: string }): Promise<RenderedPage>;
  /** A file a rendered page fetches, or null when the doc has none at that path. */
  readPageFile(doc: string, path: string): Promise<PageFile | null>;
  /** The page served standalone, for the system browser. */
  pageLink(doc: string, path: string): Promise<{ url: string }>;
  reportRender(doc: string, report: PageRenderReport): Promise<void>;
  writeFile(doc: string, args: { path: string; content: string; encoding?: 'base64'; baseRevision?: number; note?: string }): Promise<WriteResult>;
  editFile(doc: string, args: { path: string; edits: TextEdit[]; baseRevision?: number }): Promise<WriteResult>;
  deleteFile(doc: string, path: string): Promise<void>;
  renameFile(doc: string, from: string, to: string): Promise<WriteResult>;
  history(doc: string, args?: { path?: string; limit?: number }): Promise<DesignDocRevision[]>;
  revision(doc: string, id: number): Promise<RevisionContent>;
  /** `baseRevision` is the file's current revision as shown, 0 when it is gone. */
  restore(doc: string, id: number, baseRevision?: number): Promise<WriteResult>;
  addComment(doc: string, args: { body: string; path?: string; quote?: string }): Promise<DesignDocComment>;
  replyToComment(doc: string, id: string, body: string): Promise<DesignDocComment>;
  setCommentStatus(doc: string, id: string, status: CommentStatus): Promise<DesignDocComment>;
  deleteComment(doc: string, id: string): Promise<void>;
  unlinkThread(doc: string, threadId: string): Promise<void>;
  askAgent(doc: string, args: { action?: string; prompt?: string; path?: string | null; projectId?: string }): Promise<{ threadId: string; projectId: string }>;
}

type Call = (method: string, args?: unknown) => Promise<unknown>;

/** Drop `undefined` keys: RPC arguments must be plain JSON. */
function json<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function createApi(call: Call): DesignDocsApi {
  const typed = <T>(method: string, args?: object) => call(method, args === undefined ? undefined : json(args)) as Promise<T>;
  const done = async (promise: Promise<unknown>) => {
    await promise;
  };
  return {
    templates: () => typed('templates'),
    projects: () => typed('projects'),
    list: (args = {}) => typed('list', args),
    get: (doc) => typed('get', { doc }),
    create: (args) => typed('create', args),
    update: (doc, patch) => typed('update', { doc, ...patch }),
    remove: (doc) => done(typed('remove', { doc })),
    readFile: (doc, path) => typed('readFile', { doc, path }),
    renderPage: (doc, args) => typed('renderPage', { doc, ...args }),
    readPageFile: (doc, path) => typed('readPageFile', { doc, path }),
    pageLink: (doc, path) => typed('pageLink', { doc, path }),
    reportRender: (doc, report) => done(typed('reportRender', { doc, ...report })),
    writeFile: (doc, args) => typed('writeFile', { doc, ...args }),
    editFile: (doc, args) => typed('editFile', { doc, ...args }),
    deleteFile: (doc, path) => done(typed('deleteFile', { doc, path })),
    renameFile: (doc, from, to) => typed('renameFile', { doc, from, to }),
    history: (doc, args = {}) => typed('history', { doc, ...args }),
    revision: (doc, id) => typed('revision', { doc, id }),
    restore: (doc, id, baseRevision) => typed('restore', { doc, id, baseRevision }),
    addComment: (doc, args) => typed('addComment', { doc, ...args }),
    replyToComment: (doc, id, body) => typed('replyToComment', { doc, id, body }),
    setCommentStatus: (doc, id, status) => typed('setCommentStatus', { doc, id, status }),
    deleteComment: (doc, id) => done(typed('deleteComment', { doc, id })),
    unlinkThread: (doc, threadId) => done(typed('unlinkThread', { doc, threadId })),
    askAgent: (doc, args) => typed('askAgent', { doc, ...args, path: args.path ?? undefined })
  };
}

export function useApi(): DesignDocsApi {
  const rpc = useRpc();
  return useMemo(() => createApi((method, args) => rpc.call(method, args)), [rpc]);
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // The rpc bridge prefixes transport details; keep the human sentence.
  return message.replace(/^(Error invoking remote method '[^']+': )?(Error: )?/, '');
}

export function isConflict(error: unknown): boolean {
  return /changed since revision/i.test(errorMessage(error));
}

/** The doc itself is gone (deleted), as opposed to a failed request. */
export function isMissingDoc(message: string): boolean {
  return /^design doc .* not found/i.test(message);
}

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: { toast?: (message: string, kind?: 'info' | 'error') => void } })
    .__ZCC_PLUGIN_RUNTIME__;
  runtime?.toast?.(message, kind);
}
