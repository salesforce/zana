/**
 * The agent-facing verbs, shared by the native tools and the `zcc design-docs`
 * CLI so both surfaces behave identically. Each takes loosely-typed input
 * (tool JSON or parsed argv), validates it, and returns agent-readable text.
 */
import { DOC_STATUSES, isDocStatus, type DesignDocDetail, type DocActor, type DocStatus, type TextEdit } from '../shared/contract.js';
import { pageText } from '../shared/html-scan.js';
import { AGENT_INSTRUCTIONS_PATH, fileKindOf, imageMediaTypeOf, relativeDocPath, renameClashingPaths, resolveDocLink } from '../shared/paths.js';
import { renderTemplateFiles } from '../shared/templates.js';
import {
  commentLine,
  formatBundle,
  formatFile,
  formatHistory,
  formatList,
  formatManifest,
  formatPageCheck,
  formatRenderReport,
  renderReportIssues,
  showHint
} from './format.js';
import { NO_KIT, renderPage, type KitReader } from './pages.js';
import type { RenderReports } from './render-reports.js';
import { resolveNamedProject, type ProjectLister } from './project-guard.js';
import { DesignDocError, type DesignDocStore } from './store.js';

export interface OperationContext {
  store: DesignDocStore;
  /** Called with the doc id after every successful mutation. */
  changed(docId: string): void;
  /** The calling thread's project, when there is one. */
  projectId?: string | null;
  /** Registered projects, for verifying a named projectId. Without it a named project is refused. */
  listProjects?: ProjectLister;
  /** A project's display name, when known. */
  projectName?(projectId: string | null): string | null;
  /** The plugin's site kit, which pages load from `zcc-kit/`. */
  kit?: KitReader;
  /** What the panel saw when it last ran each page. */
  reports?: RenderReports;
}

function manifestOptions(ctx: OperationContext, doc: { projectId: string | null }) {
  return { projectName: ctx.projectName?.(doc.projectId) ?? null };
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

/**
 * The doc a verb targets. A slug is usually typed from a title, so one that
 * names another project's doc is likely a guess at this project's: insist on
 * the id there. Ids reach any doc.
 */
export function docRef(ctx: OperationContext, ref: string): string {
  const doc = ctx.store.find(ref);
  if (!doc) return ref;
  const viaSlug = doc.id !== ref.trim();
  if (viaSlug && ctx.projectId && doc.projectId && doc.projectId !== ctx.projectId) {
    const project = ctx.projectName?.(doc.projectId) ?? doc.projectId;
    throw new DesignDocError(
      'invalid',
      `"${ref.trim()}" is a design doc in project ${project} (${doc.id}), not this one. Pass its id to use it from here, or call design_doc_list to find this project's doc.`
    );
  }
  return doc.id;
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

/** Pages the manifest reports problems for, beyond the entry page. */
const MAX_REPORTED_PAGES = 5;

/** What an agent cannot see by reading an HTML page: files it lacks, what previews block, what its scripts did. */
function pageNotes(ctx: OperationContext, doc: DesignDocDetail, path: string): string[] {
  if (fileKindOf(path) !== 'html') return [];
  const notes: string[] = [];
  try {
    const check = formatPageCheck(renderPage(ctx.store, ctx.kit ?? NO_KIT, { doc: doc.id, path }));
    if (check) notes.push(check);
  } catch {
    // Advisory: a page that cannot render says why when the panel opens it.
  }
  const report = ctx.reports?.current(doc.id, doc.files).find((entry) => entry.path === path);
  if (report) notes.push(formatRenderReport(report, doc.comments));
  return notes;
}

/** Other pages the panel ran into problems on. */
function reportedPages(ctx: OperationContext, doc: DesignDocDetail): string | null {
  const reports = (ctx.reports?.current(doc.id, doc.files) ?? []).filter(
    (report) => report.path !== doc.entryPath && renderReportIssues(report, doc.comments).length
  );
  if (!reports.length) return null;
  const shown = reports.slice(0, MAX_REPORTED_PAGES).map((report) => formatRenderReport(report, doc.comments));
  const more = reports.length - shown.length;
  return [`## Page problems`, ...shown, more ? `(${more} more page(s) had problems; read them by path.)` : ''].filter(Boolean).join('\n\n');
}

/** Image types a model accepts inline; others (icons) stay text-only. */
const MODEL_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function readDoc(ctx: OperationContext, raw: unknown): string | ImageToolResult {
  const input = asInput(raw);
  const ref = docRef(ctx, requiredString(input, 'doc'));
  const path = optionalString(input, 'path');
  const detail = ctx.store.get(ref);
  if (path) {
    const file = ctx.store.readFile(detail.id, path);
    const text = `${formatFile(file)}\n\nTo change it, call design_doc_write with doc="${detail.id}", path="${file.path}", baseRevision=${file.revision}, baseFileId=${JSON.stringify(file.fileId)}.`;
    const mimeType = file.encoding === 'base64' ? imageMediaTypeOf(file.path) : null;
    if (mimeType && MODEL_IMAGE_TYPES.has(mimeType)) {
      return { content: [{ type: 'text', text }, { type: 'image', data: file.content, mimeType }] };
    }
    return [text, ...pageNotes(ctx, detail, file.path)].join('\n\n');
  }
  if (input.includeAll === true || input.includeAll === 'true') {
    return `${formatBundle(detail, ctx.store.readAllFiles(detail.id), manifestOptions(ctx, detail))}\n\nMetadata CAS: expectedHead=${JSON.stringify(detail.head)}\n\n${showHint(detail)}`;
  }
  const hasEntry = detail.files.some((file) => file.path === detail.entryPath);
  const entry = hasEntry ? formatFile(ctx.store.readFile(detail.id, detail.entryPath)) : '';
  const hasInstructions = detail.files.some((file) => file.path === AGENT_INSTRUCTIONS_PATH);
  const instructions = hasInstructions ? formatFile(ctx.store.readFile(detail.id, AGENT_INSTRUCTIONS_PATH)) : '';
  return [
    formatManifest(detail, manifestOptions(ctx, detail)),
    `Metadata CAS: expectedHead=${JSON.stringify(detail.head)} (required when paired; re-read before updating).`,
    instructions ? `## Agent instructions (follow these)\n${instructions}` : '',
    entry ? `## Entry file\n${entry}` : '',
    ...(hasEntry ? pageNotes(ctx, detail, detail.entryPath) : []),
    reportedPages(ctx, detail) ?? '',
    `Read other files with design_doc_read path="…", or everything at once with includeAll=true.`,
    showHint(detail)
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function createDoc(ctx: OperationContext, raw: unknown, actor: DocActor): Promise<string> {
  const input = asInput(raw);
  // Origin is trusted callsite state, never agent/renderer-controlled JSON.
  if (input.origin !== undefined) throw new DesignDocError('invalid', 'origin is not an authoring parameter');
  const template = optionalString(input, 'template');
  if (template && !ctx.store.templateByKey(template)) {
    throw new DesignDocError(
      'invalid',
      `unknown template ${JSON.stringify(template)}`
    );
  }
  const files = input.files;
  if (files !== undefined && !Array.isArray(files)) throw new DesignDocError('invalid', 'files must be an array');
  const named = await resolveNamedProject(ctx.listProjects, input);
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
      entryPath: optionalString(input, 'entryPath'),
      projectId: named === undefined ? (ctx.projectId ?? null) : named
    },
    actor
  );
  ctx.changed(detail.id);
  return `Created design doc ${detail.id} ("${detail.title}").\n\n${formatManifest(detail, manifestOptions(ctx, detail))}\n\n${showHint(detail)}`;
}

export function writeDoc(ctx: OperationContext, raw: unknown, actor: DocActor): string {
  const input = asInput(raw);
  const ref = docRef(ctx, requiredString(input, 'doc'));
  const path = requiredString(input, 'path');
  const baseRevision = optionalInteger(input, 'baseRevision');
  const baseFileId = input.baseFileId === null ? null : optionalString(input, 'baseFileId');
  const note = optionalString(input, 'note');
  const content = optionalString(input, 'content');
  const renameTo = optionalString(input, 'renameTo');
  const remove = input.delete === true || input.delete === 'true';
  // Some models send every field, unused ones as null.
  const edits = input.edits ?? undefined;
  const modes = [content !== undefined, edits !== undefined, remove, renameTo !== undefined].filter(Boolean).length;
  if (modes !== 1) {
    throw new DesignDocError('invalid', 'pass exactly one of content, edits, delete or renameTo');
  }
  const doc = ctx.store.summary(ref);

  if (remove) {
    ctx.store.deleteFile(doc.id, path, actor, { baseRevision, baseFileId, note });
    ctx.changed(doc.id);
    return `Deleted ${path} from ${doc.id}. It stays in history and can be restored from the Design Docs panel.`;
  }
  if (renameTo !== undefined) {
    const result = ctx.store.renameFile(doc.id, path, renameTo, actor, { baseRevision, baseFileId, note });
    ctx.changed(result.docId);
    return `Renamed ${path} to ${result.path} (rev ${result.revision}).`;
  }
  let result;
  if (edits !== undefined) {
    if (!Array.isArray(edits)) throw new DesignDocError('invalid', 'edits must be an array');
    result = ctx.store.editFile(doc.id, { path, edits: edits as TextEdit[], baseRevision, baseFileId, note }, actor);
  } else {
    const encoding = input.encoding === 'base64' ? ('base64' as const) : undefined;
    result = ctx.store.writeFile(doc.id, { path, content: content!, encoding, baseRevision, baseFileId, note }, actor);
  }
  ctx.changed(result.docId);
  const verb = result.created ? 'Created' : 'Updated';
  const done = `${verb} ${result.path} in ${result.docId} → revision ${result.revision}. Use baseRevision=${result.revision}, baseFileId=${JSON.stringify(result.fileId)} for your next change to this file. The user sees updates live in the Design Docs panel.`;
  return [done, ...writtenPageNotes(ctx, result.docId, result.path)].join('\n\n');
}

/** After an HTML page is saved: what rendering it found, and where its script errors will show. */
function writtenPageNotes(ctx: OperationContext, docId: string, path: string): string[] {
  if (fileKindOf(path) !== 'html') return [];
  const notes: string[] = [];
  try {
    const check = formatPageCheck(renderPage(ctx.store, ctx.kit ?? NO_KIT, { doc: docId, path }));
    if (check) notes.push(check);
    if (pageText(ctx.store.readFile(docId, path).content).scripted) {
      notes.push('Its scripts run when the page is open in the Design Docs panel; read the page again after that to see any script errors.');
    }
  } catch {
    // Advisory, like pageNotes.
  }
  return notes;
}

export async function updateDoc(ctx: OperationContext, raw: unknown, actor: DocActor): Promise<string> {
  const input = asInput(raw);
  const ref = docRef(ctx, requiredString(input, 'doc'));
  const moveTo = await resolveNamedProject(ctx.listProjects, input);
  const alternativeTo = optionalString(input, 'alternativeTo');
  const summary = ctx.store.update(
    ref,
    {
      title: optionalString(input, 'title'),
      summary: optionalString(input, 'summary'),
      status: optionalStatus(input, 'status'),
      tags: optionalStringArray(input, 'tags'),
      entryPath: optionalString(input, 'entryPath'),
      alternativeTo: alternativeTo === undefined ? undefined : alternativeTo.trim() ? docRef(ctx, alternativeTo) : null,
      expectedHead: input.expectedHead === null ? null : optionalString(input, 'expectedHead'),
      projectId: moveTo
    },
    actor
  );
  ctx.changed(summary.id);
  const alternative = summary.alternativeTo ? ` · alternative to ${summary.alternativeTo}` : '';
  return `Updated ${summary.id}: "${summary.title}" · ${summary.status} · tags: ${summary.tags.join(', ') || 'none'} · entry: ${summary.entryPath}${alternative}`;
}

/**
 * New comment, reply (`replyTo`), or status change (`resolve` / `reopen`, with
 * `body` posted as a reply in the same step). The three targets are exclusive.
 */
export function commentDoc(ctx: OperationContext, raw: unknown, actor: DocActor): string {
  const input = asInput(raw);
  const ref = docRef(ctx, requiredString(input, 'doc'));
  const targets = { resolve: optionalString(input, 'resolve'), reopen: optionalString(input, 'reopen'), replyTo: optionalString(input, 'replyTo') };
  const given = Object.entries(targets).filter(([, value]) => value?.trim());
  if (given.length > 1) {
    throw new DesignDocError('invalid', `pass only one of resolve, reopen or replyTo (got ${given.map(([key]) => key).join(' and ')})`);
  }
  const [mode, commentId] = given[0] ?? [];
  if (mode && (input.path !== undefined || input.quote !== undefined)) {
    throw new DesignDocError('invalid', `path and quote anchor a new comment; ${mode} keeps the comment's own anchor`);
  }
  if (mode === 'replyTo') {
    const comment = ctx.store.addReply(ref, commentId, requiredString(input, 'body'), actor);
    ctx.changed(comment.docId);
    return `Replied to comment ${comment.id}.\n${commentLine(comment)}`;
  }
  if (mode) {
    const note = optionalString(input, 'body');
    const comment = ctx.store.setCommentStatus(ref, commentId, mode === 'resolve' ? 'resolved' : 'open', actor, note);
    ctx.changed(comment.docId);
    return `${mode === 'resolve' ? 'Resolved' : 'Reopened'} comment ${comment.id}${note?.trim() ? ' and added your reply' : ''}.\n${commentLine(comment)}`;
  }
  const comment = ctx.store.addComment(
    ref,
    { body: requiredString(input, 'body'), path: optionalString(input, 'path'), quote: optionalString(input, 'quote') },
    actor
  );
  ctx.changed(comment.docId);
  const warning = comment.quote ? quoteWarning(ctx.store, comment) : null;
  return `Added comment ${comment.id}.\n${commentLine(comment)}${warning ? `\n\n${warning}` : ''}`;
}

/** Flatten markdown inline syntax and whitespace so a quote matches what the panel renders. */
function plainText(value: string): string {
  return value
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Why the panel will not be able to highlight this comment's quote, if it won't. */
function quoteWarning(store: DesignDocStore, comment: { docId: string; path: string | null; quote: string | null }): string | null {
  if (!comment.path) {
    return 'Note: the quote has no path, so the panel cannot highlight it. Pass path with quote next time.';
  }
  const file = store.readFile(comment.docId, comment.path);
  if (file.encoding !== 'utf8') return null;
  const quote = plainText(comment.quote!);
  if (file.kind === 'html') {
    // Readers select what the page shows, which is not its markup.
    const page = pageText(file.content);
    if (plainText(page.text).includes(quote)) return null;
    return page.scripted
      ? `Note: the quote is not in the HTML of ${comment.path}. The panel highlights it if the page's scripts show that text; otherwise quote the text as the page shows it.`
      : `Note: the quote does not appear on ${comment.path}, so the panel cannot highlight it. Quote the text as the page shows it, not its HTML.`;
  }
  if (plainText(file.content).includes(quote)) return null;
  return `Note: the quote does not appear in ${comment.path}, so the panel cannot highlight it. Quote the passage exactly as written.`;
}

export function docHistory(ctx: OperationContext, raw: unknown): string {
  const input = asInput(raw);
  const ref = docRef(ctx, requiredString(input, 'doc'));
  return formatHistory(
    ctx.store.history(ref, { path: optionalString(input, 'path'), limit: optionalInteger(input, 'limit') })
  );
}

// ── Templates ───────────────────────────────────────────────────────────

export interface TemplateReadResult {
  key: string;
  files: Array<{ path: string; content: string; encoding: 'utf8' | 'base64' }>;
}

/** A template's files exactly as stored: placeholders and AI-instruction comments intact. */
export function readTemplate(ctx: OperationContext, raw: unknown): TemplateReadResult {
  const key = requiredString(asInput(raw), 'key');
  const template = ctx.store.templateByKey(key);
  if (!template) throw new DesignDocError('not_found', `unknown template ${JSON.stringify(key)}; call design_doc_templates_list for valid keys`);
  return {
    key: template.id,
    files: template.files.map((file) => ({ path: file.path, content: file.content, encoding: file.encoding === 'base64' ? 'base64' : 'utf8' }))
  };
}

/** Markdown `](target` or html `="target"` / `='target'`; the target must end at the delimiter, so prefixes never match. */
const LINK_TARGET = /\]\(([^)\s]*)(?=[)\s])|=(["'])([^"']*)\2/g;

/**
 * Writes a template's files into an existing doc as one atomic change. Never
 * overwrites: a path the doc already has (any letter case) fails the whole call,
 * unless `renameOnConflict` is true, which numbers the clashing files (`a-2.md`).
 * Size and count limits are the store's, as for any other write.
 */

export function addFromTemplate(ctx: OperationContext, raw: unknown, actor: DocActor): { added: string[]; renamed: Array<{ from: string; to: string }> } {
  const input = asInput(raw);
  const renameOnConflict = input.renameOnConflict === true;
  const ref = docRef(ctx, requiredString(input, 'docId'));
  const templateKey = requiredString(input, 'templateKey');
  const template = ctx.store.templateByKey(templateKey);
  if (!template) throw new DesignDocError('not_found', `unknown template ${JSON.stringify(templateKey)}; call design_doc_templates_list for valid keys`);
  const doc = ctx.store.get(ref);
  const title = optionalString(input, 'title') ?? doc.title;
  const summary = optionalString(input, 'summary') ?? doc.summary;
  const renderedAll = renderTemplateFiles(template, { title, summary });
  // A doc has one AGENTS.md: a template's instructions join it instead of clashing or becoming a stray AGENTS-2.md.
  const incomingRules = doc.files.some((file) => file.path === AGENT_INSTRUCTIONS_PATH)
    ? renderedAll.find((file) => file.path === AGENT_INSTRUCTIONS_PATH && file.encoding !== 'base64')
    : undefined;
  const rendered = incomingRules ? renderedAll.filter((file) => file !== incomingRules) : renderedAll;
  const existing = new Set(doc.files.map((file) => file.path.toLowerCase()));
  const clashes = rendered.filter((file) => existing.has(file.path.toLowerCase()));
  if (clashes.length && !renameOnConflict) {
    throw new DesignDocError('conflict', `${clashes[0]!.path} already exists in ${doc.id}; add_from_template never overwrites. Rename or delete it first.`);
  }
  const renames = renameClashingPaths(rendered.map((file) => file.path), doc.files.map((file) => file.path));
  const files = rendered.map((file) => {
    const path = renames.get(file.path) ?? file.path;
    if (!renames.size || file.encoding === 'base64' || typeof file.content !== 'string') return { ...file, path };
    // Keep links between the added files pointing at each other, not at the doc's older copies.
    const content = file.content.replace(LINK_TARGET, (match, mdTarget: string | undefined, quote: string | undefined, attrTarget: string | undefined) => {
      const target = mdTarget ?? attrTarget ?? '';
      const cut = target.search(/[?#]/);
      const bare = cut < 0 ? target : target.slice(0, cut);
      const suffix = cut < 0 ? '' : target.slice(cut);
      const resolved = resolveDocLink(file.path, bare);
      const renamed = resolved === null ? undefined : renames.get(resolved);
      if (renamed === undefined) return match;
      const next = relativeDocPath(path, renamed) + suffix;
      return mdTarget !== undefined ? `](${next}` : `=${quote}${next}${quote}`;
    });
    return { ...file, path, content };
  });
  const results = ctx.store.writeFiles(
    doc.id,
    files.map((file) => ({ ...file, baseRevision: 0, baseFileId: null, note: `Added from template ${template.id}` })),
    actor
  );
  const merged: string[] = [];
  if (incomingRules && typeof incomingRules.content === 'string') {
    const current = ctx.store.readFile(doc.id, AGENT_INSTRUCTIONS_PATH);
    if (current.encoding === 'utf8' && !current.content.includes(incomingRules.content.trim())) {
      ctx.store.writeFile(
        doc.id,
        { path: AGENT_INSTRUCTIONS_PATH, content: `${current.content.trimEnd()}\n\n---\n\n${incomingRules.content}`, baseRevision: current.revision, baseFileId: current.fileId, note: `Added instructions from template ${template.id}` },
        actor
      );
      merged.push(AGENT_INSTRUCTIONS_PATH);
    }
  }
  ctx.changed(doc.id);
  return { added: [...results.map((result) => result.path), ...merged], renamed: [...renames].map(([from, to]) => ({ from, to })) };
}
