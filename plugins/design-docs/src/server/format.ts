/**
 * Plain-text renderings of design docs for agents and the CLI. File bodies are
 * wrapped in `<file …>` tags rather than markdown fences so a doc that itself
 * contains fences round-trips without ambiguity.
 */
import {
  STATUS_LABELS,
  designDocDirective,
  type DesignDocComment,
  type DesignDocDetail,
  type DesignDocFile,
  type DesignDocFileMeta,
  type DesignDocRevision,
  type DesignDocSummary
} from '../shared/contract.js';
import { actorLabel, formatBytes, relativeTime } from '../shared/display.js';
import type { PageProblem } from '../shared/frame-protocol.js';
import type { PageBundle } from '../shared/page.js';
import type { RenderReport } from './render-reports.js';

export { actorLabel, relativeTime };

/** Upper bound for one agent-facing bundle; larger docs are read per file. */
export const MAX_BUNDLE_CHARS = 120_000;

export function summaryLine(doc: DesignDocSummary, now = Date.now()): string {
  const parts = [
    STATUS_LABELS[doc.status],
    `${doc.fileCount} file${doc.fileCount === 1 ? '' : 's'}`,
    doc.openComments ? `${doc.openComments} open comment${doc.openComments === 1 ? '' : 's'}` : null,
    `updated ${relativeTime(doc.updatedAt, now)}`
  ].filter(Boolean);
  const summary = doc.summary ? ` — ${truncate(doc.summary, 140)}` : '';
  return `- ${doc.id} "${doc.title}" (${parts.join(' · ')})${summary}`;
}

export function formatList(docs: DesignDocSummary[], now = Date.now()): string {
  if (docs.length === 0) return 'No design docs match.';
  return docs.map((doc) => summaryLine(doc, now)).join('\n');
}

function fileLine(file: DesignDocFileMeta, entryPath: string, now: number): string {
  const entry = file.path === entryPath ? ' [entry]' : '';
  return `- ${file.path}${entry} — ${file.kind}, ${formatBytes(file.size)}, rev ${file.revision}, ${actorLabel(file.updatedBy)} ${relativeTime(file.updatedAt, now)}`;
}

/** A comment and its replies, indented underneath. */
export function commentLine(comment: DesignDocComment, now = Date.now()): string {
  const where = comment.path ? ` on ${comment.path}` : '';
  const quote = comment.quote ? ` › "${truncate(comment.quote, 120)}"` : '';
  const status = comment.status === 'resolved' ? ' [resolved]' : '';
  return [
    `- [${comment.id}]${where}${quote}${status} ${actorLabel(comment.author)}, ${relativeTime(comment.createdAt, now)}: ${comment.body}`,
    ...comment.replies.map(
      (reply) => `  ↳ reply ${actorLabel(reply.author)}, ${relativeTime(reply.createdAt, now)}: ${reply.body.replace(/\n/g, '\n    ')}`
    )
  ].join('\n');
}

export interface ManifestOptions {
  now?: number;
  /** The doc's project name, when known; agents otherwise see its id. */
  projectName?: string | null;
}

export function formatManifest(doc: DesignDocDetail, options: ManifestOptions = {}): string {
  const now = options.now ?? Date.now();
  const project = doc.projectId ? (options.projectName ?? doc.projectId) : 'global (all projects)';
  const lines = [
    `# ${doc.title}`,
    `id: ${doc.id} · slug: ${doc.slug} · status: ${doc.status} · doc revision ${doc.revision}`,
    `project: ${project} · created by ${actorLabel(doc.createdBy)} · updated ${relativeTime(doc.updatedAt, now)} by ${actorLabel(doc.updatedBy)}`
  ];
  if (doc.summary) lines.push(`summary: ${doc.summary}`);
  if (doc.tags.length) lines.push(`tags: ${doc.tags.join(', ')}`);
  lines.push('', `## Files (${doc.files.length})`, ...doc.files.map((file) => fileLine(file, doc.entryPath, now)));
  const open = doc.comments.filter((comment) => comment.status === 'open');
  if (open.length) {
    lines.push('', `## Open comments (${open.length})`, ...open.map((comment) => commentLine(comment, now)));
  }
  return lines.join('\n');
}

export function formatFile(file: DesignDocFile): string {
  if (file.encoding === 'base64') {
    return `<file path="${file.path}" revision="${file.revision}" kind="${file.kind}" encoding="base64" size="${formatBytes(file.size)}">(binary ${file.kind}, not shown as text)</file>`;
  }
  return `<file path="${file.path}" revision="${file.revision}" kind="${file.kind}">\n${file.content}\n</file>`;
}

/**
 * Manifest plus file bodies, in tree order with the entry file first, up to
 * `maxChars`. Files that do not fit are listed so the agent can read them one
 * at a time.
 */
export function formatBundle(
  doc: DesignDocDetail,
  files: DesignDocFile[],
  options: ManifestOptions & { maxChars?: number } = {}
): string {
  const maxChars = options.maxChars ?? MAX_BUNDLE_CHARS;
  const ordered = [
    ...files.filter((file) => file.path === doc.entryPath),
    ...files.filter((file) => file.path !== doc.entryPath)
  ];
  const parts = [formatManifest(doc, options)];
  let used = parts[0]!.length;
  const omitted: string[] = [];
  for (const file of ordered) {
    const block = formatFile(file);
    if (used + block.length > maxChars) {
      omitted.push(file.path);
      continue;
    }
    parts.push(block);
    used += block.length;
  }
  if (omitted.length) {
    parts.push(`(${omitted.length} file(s) omitted to stay within size limits — read them by path: ${omitted.join(', ')})`);
  }
  return parts.join('\n\n');
}

const PROBLEM_LABELS: Record<PageProblem['kind'], string> = { error: 'Error', missing: 'Missing', blocked: 'Blocked' };

function problemLine(problem: PageProblem): string {
  const where = problem.source ? ` (${problem.source}${problem.line ? `:${problem.line}` : ''})` : '';
  return `- ${PROBLEM_LABELS[problem.kind]}: ${truncate(problem.message, 300)}${where}`;
}

/** What rendering a page found: files it uses that the doc lacks, and what previews block. */
export function formatPageCheck(page: Pick<PageBundle, 'missing' | 'warnings'> & { path: string }): string | null {
  if (!page.missing.length && !page.warnings.length) return null;
  return [
    `Page check for ${page.path}:`,
    ...page.missing.map((path) => `- Missing: the page uses ${path}, which is not a file in this doc.`),
    ...page.warnings.map((warning) => `- Blocked: ${warning}`)
  ].join('\n');
}

/** The problems a panel run found, and the open comments whose quote the page did not show. */
export function renderReportIssues(report: RenderReport, comments: readonly DesignDocComment[]): string[] {
  const unanchored = new Set(report.unanchored);
  const lost = comments.filter((comment) => comment.status === 'open' && comment.path === report.path && comment.quote && unanchored.has(comment.quote));
  return [
    ...report.problems.map(problemLine),
    ...lost.map((comment) => `- Comment ${comment.id} quotes "${truncate(comment.quote!, 120)}", which the page does not show.`)
  ];
}

/** What the panel saw when it last ran a page. */
export function formatRenderReport(report: RenderReport, comments: readonly DesignDocComment[], now = Date.now()): string {
  const head = `The Design Docs panel ran ${report.path} (rev ${report.revision}) ${relativeTime(report.at, now)}`;
  const issues = renderReportIssues(report, comments);
  return issues.length ? [`${head}:`, ...issues].join('\n') : `${head} without problems.`;
}

export function formatHistory(revisions: DesignDocRevision[], now = Date.now()): string {
  if (revisions.length === 0) return 'No history.';
  return revisions
    .map((revision) => {
      const from = revision.renamedFrom ? ` (from ${revision.renamedFrom})` : '';
      const note = revision.note ? ` — ${revision.note}` : '';
      return `- #${revision.id} ${revision.op} ${revision.path}${from} → rev ${revision.revision}, ${formatBytes(revision.size)}, ${actorLabel(revision.actor)} ${relativeTime(revision.createdAt, now)}${note}`;
    })
    .join('\n');
}

export function showHint(doc: Pick<DesignDocSummary, 'id'>, path?: string | null): string {
  return `To show it to the user, put this on its own line in your reply: ${designDocDirective(doc.id, path)}`;
}

export function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
