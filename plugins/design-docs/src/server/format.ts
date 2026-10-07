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
  type DesignDocSummary,
  type DocActor
} from '../shared/contract.js';
import { formatBytes, relativeTime } from '../shared/display.js';

export { relativeTime };

/** Upper bound for one agent-facing bundle; larger docs are read per file. */
export const MAX_BUNDLE_CHARS = 120_000;

export function actorLabel(actor: DocActor): string {
  return actor.kind === 'agent' ? `agent "${actor.label}"` : actor.label;
}

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

export function commentLine(comment: DesignDocComment, now = Date.now()): string {
  const where = comment.path ? ` on ${comment.path}` : '';
  const quote = comment.quote ? ` › "${truncate(comment.quote, 120)}"` : '';
  const status = comment.status === 'resolved' ? ' [resolved]' : '';
  return `- [${comment.id}]${where}${quote}${status} ${actorLabel(comment.author)}, ${relativeTime(comment.createdAt, now)}: ${comment.body}`;
}

export function formatManifest(doc: DesignDocDetail, now = Date.now()): string {
  const lines = [
    `# ${doc.title}`,
    `id: ${doc.id} · slug: ${doc.slug} · status: ${doc.status} · doc revision ${doc.revision}`,
    `project: ${doc.projectId ?? 'global (all projects)'} · created by ${actorLabel(doc.createdBy)} · updated ${relativeTime(doc.updatedAt, now)} by ${actorLabel(doc.updatedBy)}`
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
    return `<file path="${file.path}" revision="${file.revision}" kind="${file.kind}" encoding="base64" size="${formatBytes(file.size)}">(binary image, not shown as text)</file>`;
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
  options: { maxChars?: number; now?: number } = {}
): string {
  const maxChars = options.maxChars ?? MAX_BUNDLE_CHARS;
  const ordered = [
    ...files.filter((file) => file.path === doc.entryPath),
    ...files.filter((file) => file.path !== doc.entryPath)
  ];
  const parts = [formatManifest(doc, options.now)];
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
