import type { StudioComment, StudioDiagnostic } from '../../lib/studio-contract.js';

/** Trailing-edge debounce. `cancel()` drops a pending call. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = ((...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  }) as ((...args: A) => void) & { cancel(): void };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped;
}

export const SNAPSHOT_DIAGNOSTICS_MAX = 200;

interface LspDiagnostic { line: number; column: number; endLine: number; endColumn: number; severity: string; message: string; code?: string | number }

/** LSP diagnostics (0-based) -> StudioDiagnostic (1-based), at most 200, message clipped to the contract bound. */
export function toStudioDiagnostics(rows: readonly LspDiagnostic[]): StudioDiagnostic[] {
  const severities = ['error', 'warning', 'info', 'hint'] as const;
  return rows.slice(0, SNAPSHOT_DIAGNOSTICS_MAX).map(row => ({
    line: Math.max(1, row.line + 1),
    column: Math.max(1, row.column + 1),
    endLine: Math.max(1, row.endLine + 1),
    endColumn: Math.max(1, row.endColumn + 1),
    severity: (severities as readonly string[]).includes(row.severity) ? (row.severity as StudioDiagnostic['severity']) : 'error',
    message: row.message.slice(0, 2000),
    ...(row.code !== undefined ? { code: String(row.code) } : {})
  }));
}

/** Name of the topic block (`topic name:` / `start_agent name:`) that contains `line` (1-based), or null. */
export function topicAtLine(lines: readonly string[], line: number): string | null {
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i -= 1) {
    const match = /^(?:topic|start_agent)\s+([A-Za-z0-9_.-]+)\s*:/.exec(lines[i]!);
    if (match) return match[1]!;
    // A new top-level block that is not a topic ends the search.
    if (/^[A-Za-z_]/.test(lines[i]!) && !/^(?:topic|start_agent)\b/.test(lines[i]!)) return null;
  }
  return null;
}

export interface SelectionChipAction { id: 'comment' | 'ask' | 'preview-topic'; label: string }

/** Chip buttons for the current selection. "Preview this topic" only appears inside a topic block. */
export function selectionChipActions(topic: string | null): SelectionChipAction[] {
  const actions: SelectionChipAction[] = [{ id: 'comment', label: 'Comment' }, { id: 'ask', label: 'Ask agent' }];
  if (topic) actions.push({ id: 'preview-topic', label: 'Preview this topic' });
  return actions;
}

export interface GlyphMark { line: number; className: string; message: string; ids: string[] }
export interface CommentZone { afterLine: number; comments: StudioComment[] }
export interface CommentMarks { glyphs: GlyphMark[]; zones: CommentZone[] }

const clampLine = (line: number, lineCount: number) => Math.min(Math.max(1, line), Math.max(1, lineCount));

/**
 * Glyph + view-zone placement for review comments and preview-hit dots. Resolved comments get a muted glyph and no
 * inline body. Several comments on one line share a glyph and a zone.
 */
export function commentMarks(comments: readonly StudioComment[], hits: readonly number[], lineCount: number, expanded: ReadonlySet<string>): CommentMarks {
  const byLine = new Map<number, StudioComment[]>();
  for (const comment of comments) {
    const line = clampLine(comment.line, lineCount);
    byLine.set(line, [...(byLine.get(line) ?? []), comment]);
  }
  const glyphs: GlyphMark[] = [];
  const zones: CommentZone[] = [];
  for (const [line, rows] of [...byLine].sort((a, b) => a[0] - b[0])) {
    const open = rows.filter(row => !row.resolved);
    glyphs.push({
      line,
      className: open.length > 0 ? 'sf-comment-glyph' : 'sf-comment-glyph is-resolved',
      message: rows.map(row => `${row.author.name}: ${row.body}`).join('\n').slice(0, 500),
      ids: rows.map(row => row.id)
    });
    const shown = open.filter(row => expanded.has(row.id));
    if (shown.length > 0) zones.push({ afterLine: clampLine(Math.max(...shown.map(row => row.endLine)), lineCount), comments: shown });
  }
  const commentLines = new Set(glyphs.map(glyph => glyph.line));
  for (const hit of [...new Set(hits)].sort((a, b) => a - b)) {
    const line = clampLine(hit, lineCount);
    if (commentLines.has(line)) continue;
    glyphs.push({ line, className: 'sf-hit-glyph', message: 'Reached in the last preview run', ids: [] });
  }
  return { glyphs, zones };
}

/** Clamps a selection to the contract's 2000 char bound. */
export function clipSelectionText(text: string, max = 2000): string {
  return text.length > max ? text.slice(0, max) : text;
}

/** Rough view-zone height (in lines) for inline comment bodies: one header row + wrapped body per comment. */
export function commentZoneHeight(comments: readonly StudioComment[], charsPerLine = 70): number {
  return Math.max(2, comments.reduce((sum, row) => sum + 1 + Math.max(1, Math.ceil(row.body.length / charsPerLine)), 0));
}
