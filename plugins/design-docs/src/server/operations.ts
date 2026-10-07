/**
 * The agent-facing verbs, shared by the native tools and the `zcc design-docs`
 * CLI so both surfaces behave identically. Each takes loosely-typed input
 * (tool JSON or parsed argv), validates it, and returns agent-readable text.
 */
import { DOC_STATUSES, isDocStatus, type DocActor, type DocStatus, type TextEdit } from '../shared/contract.js';
import { imageMediaTypeOf } from '../shared/paths.js';
import { DESIGN_DOC_TEMPLATES } from '../shared/templates.js';
import {
  commentLine,
  formatBundle,
  formatFile,
  formatHistory,
  formatList,
  formatManifest,
  showHint
} from './format.js';
import { DesignDocError, type DesignDocStore } from './store.js';

export interface OperationContext {
  store: DesignDocStore;
  /** Called with the doc id after every successful mutation. */
  changed(docId: string): void;
  /** The calling thread's project, when there is one. */
  projectId?: string | null;
}

export type ImageToolResult = {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
};

type Input = Record<string, unknown>;

export function asInput(value: unknown): Input {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Input) : {};
}

export function requiredString(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) throw new DesignDocError('invalid', `${key} is required`);
  return value;
}

export function optionalString(input: Input, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new DesignDocError('invalid', `${key} must be a string`);
  return value;
}

function optionalInteger(input: Input, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number)) {
    throw new DesignDocError('invalid', `${key} must be an integer`);
  }
  return number;
}

function optionalStringArray(input: Input, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new DesignDocError('invalid', `${key} must be an array of strings`);
  }
  return value as string[];
}

function optionalStatus(input: Input, key: string): DocStatus | undefined {
  const value = optionalString(input, key);
  if (value === undefined) return undefined;
  if (!isDocStatus(value)) {
    throw new DesignDocError('invalid', `${key} must be one of ${DOC_STATUSES.join(', ')}`);
  }
  return value;
}

// ── Verbs ───────────────────────────────────────────────────────────────

export function listDocs(ctx: OperationContext, raw: unknown): string {
  const input = asInput(raw);
  const scope = optionalString(input, 'scope') ?? 'project';
  if (scope !== 'project' && scope !== 'all') throw new DesignDocError('invalid', 'scope must be project or all');
  const status = optionalString(input, 'status') ?? 'active';
  if (status !== 'active' && status !== 'all' && !isDocStatus(status)) {
    throw new DesignDocError('invalid', `status must be active, all, or one of ${DOC_STATUSES.join(', ')}`);
  }
  const docs = ctx.store.list({
    projectId: scope === 'project' && ctx.projectId ? ctx.projectId : undefined,
    query: optionalString(input, 'query'),
    status: status as DocStatus | 'active' | 'all',
    limit: optionalInteger(input, 'limit')
  });
  const header =
    scope === 'project' && ctx.projectId
      ? `Design docs for this project (plus global docs), newest first:`
      : 'Design docs across all projects, newest first:';
  return `${header}\n${formatList(docs)}`;
}

export function readDoc(ctx: OperationContext, raw: unknown): string | ImageToolResult {
  const input = asInput(raw);
  const ref = requiredString(input, 'doc');
  const path = optionalString(input, 'path');
  const detail = ctx.store.get(ref);
  if (path) {
    const file = ctx.store.readFile(detail.id, path);
    const text = `${formatFile(file)}\n\nTo change it, call design_doc_write with doc="${detail.id}", path="${file.path}", baseRevision=${file.revision}.`;
    const mimeType = file.encoding === 'base64' ? imageMediaTypeOf(file.path) : null;
    if (mimeType) {
      return { content: [{ type: 'text', text }, { type: 'image', data: file.content, mimeType }] };
    }
    return text;
  }
  if (input.includeAll === true || input.includeAll === 'true') {
    return `${formatBundle(detail, ctx.store.readAllFiles(detail.id))}\n\n${showHint(detail)}`;
  }
  const entry = detail.files.some((file) => file.path === detail.entryPath)
    ? formatFile(ctx.store.readFile(detail.id, detail.entryPath))
    : '';
  return [
    formatManifest(detail),
    entry ? `## Entry file\n${entry}` : '',
    `Read other files with design_doc_read path="…", or everything at once with includeAll=true.`,
    showHint(detail)
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function createDoc(ctx: OperationContext, raw: unknown, actor: DocActor): string {
  const input = asInput(raw);
  const template = optionalString(input, 'template');
  if (template && !DESIGN_DOC_TEMPLATES.some((entry) => entry.id === template)) {
    throw new DesignDocError(
      'invalid',
      `template must be one of ${DESIGN_DOC_TEMPLATES.map((entry) => entry.id).join(', ')}`
    );
  }
  const files = input.files;
  if (files !== undefined && !Array.isArray(files)) throw new DesignDocError('invalid', 'files must be an array');
  const global = input.global === true || input.global === 'true';
  const detail = ctx.store.create(
    {
      title: requiredString(input, 'title'),
      summary: optionalString(input, 'summary'),
      tags: optionalStringArray(input, 'tags'),
      status: optionalStatus(input, 'status'),
      template,
      files: (files as unknown[] | undefined)?.map((file, index) => {
        const entry = asInput(file);
        if (typeof entry.path !== 'string' || typeof entry.content !== 'string') {
          throw new DesignDocError('invalid', `files[${index}] needs string path and content`);
        }
        const encoding = entry.encoding === 'base64' ? ('base64' as const) : undefined;
        return { path: entry.path, content: entry.content, encoding };
      }),
      projectId: global ? null : (ctx.projectId ?? null)
    },
    actor
  );
  ctx.changed(detail.id);
  return `Created design doc ${detail.id} ("${detail.title}").\n\n${formatManifest(detail)}\n\n${showHint(detail)}`;
}

export function writeDoc(ctx: OperationContext, raw: unknown, actor: DocActor): string {
  const input = asInput(raw);
  const ref = requiredString(input, 'doc');
  const path = requiredString(input, 'path');
  const baseRevision = optionalInteger(input, 'baseRevision');
  const note = optionalString(input, 'note');
  const content = optionalString(input, 'content');
  const renameTo = optionalString(input, 'renameTo');
  const remove = input.delete === true || input.delete === 'true';
  const edits = input.edits;
  const modes = [content !== undefined, edits !== undefined, remove, renameTo !== undefined].filter(Boolean).length;
  if (modes !== 1) {
    throw new DesignDocError('invalid', 'pass exactly one of content, edits, delete or renameTo');
  }
  const doc = ctx.store.summary(ref);

  if (remove) {
    ctx.store.deleteFile(doc.id, path, actor, { baseRevision, note });
    ctx.changed(doc.id);
    return `Deleted ${path} from ${doc.id}. It stays in history and can be restored from the Design Docs panel.`;
  }
  if (renameTo !== undefined) {
    const result = ctx.store.renameFile(doc.id, path, renameTo, actor, { baseRevision, note });
    ctx.changed(result.docId);
    return `Renamed ${path} to ${result.path} (rev ${result.revision}).`;
  }
  let result;
  if (edits !== undefined) {
    if (!Array.isArray(edits)) throw new DesignDocError('invalid', 'edits must be an array');
    result = ctx.store.editFile(doc.id, { path, edits: edits as TextEdit[], baseRevision, note }, actor);
  } else {
    const encoding = input.encoding === 'base64' ? ('base64' as const) : undefined;
    result = ctx.store.writeFile(doc.id, { path, content: content!, encoding, baseRevision, note }, actor);
  }
  ctx.changed(result.docId);
  const verb = result.created ? 'Created' : 'Updated';
  return `${verb} ${result.path} in ${result.docId} → revision ${result.revision}. Use baseRevision=${result.revision} for your next change to this file. The user sees updates live in the Design Docs panel.`;
}

export function updateDoc(ctx: OperationContext, raw: unknown, actor: DocActor): string {
  const input = asInput(raw);
  const ref = requiredString(input, 'doc');
  const summary = ctx.store.update(
    ref,
    {
      title: optionalString(input, 'title'),
      summary: optionalString(input, 'summary'),
      status: optionalStatus(input, 'status'),
      tags: optionalStringArray(input, 'tags'),
      entryPath: optionalString(input, 'entryPath')
    },
    actor
  );
  ctx.changed(summary.id);
  return `Updated ${summary.id}: "${summary.title}" · ${summary.status} · tags: ${summary.tags.join(', ') || 'none'} · entry: ${summary.entryPath}`;
}

export function commentDoc(ctx: OperationContext, raw: unknown, actor: DocActor): string {
  const input = asInput(raw);
  const ref = requiredString(input, 'doc');
  const resolve = optionalString(input, 'resolve');
  const reopen = optionalString(input, 'reopen');
  if (resolve || reopen) {
    const comment = ctx.store.setCommentStatus(ref, resolve ?? reopen, resolve ? 'resolved' : 'open', actor);
    ctx.changed(comment.docId);
    const reply = optionalString(input, 'body');
    if (reply?.trim()) {
      ctx.store.addComment(ref, { body: reply, path: comment.path, quote: comment.quote }, actor);
    }
    return `${resolve ? 'Resolved' : 'Reopened'} comment ${comment.id}.${reply?.trim() ? ' Added your reply as a new comment.' : ''}`;
  }
  const comment = ctx.store.addComment(
    ref,
    { body: requiredString(input, 'body'), path: optionalString(input, 'path'), quote: optionalString(input, 'quote') },
    actor
  );
  ctx.changed(comment.docId);
  return `Added comment ${comment.id}.\n${commentLine(comment)}`;
}

export function docHistory(ctx: OperationContext, raw: unknown): string {
  const input = asInput(raw);
  const ref = requiredString(input, 'doc');
  return formatHistory(
    ctx.store.history(ref, { path: optionalString(input, 'path'), limit: optionalInteger(input, 'limit') })
  );
}
