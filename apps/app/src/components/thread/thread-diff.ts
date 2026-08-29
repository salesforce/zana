export type DiffPanelPhase = 'loading' | 'error' | 'ready';
export type DiffChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type_changed';
export type DiffLoadMode = 'auto' | 'on_demand' | 'too_large';
export type DiffPatchStatus = 'idle' | 'loading' | 'ready' | 'error';
export type DiffCardBodyKind =
  | 'hidden'
  | 'binary'
  | 'too_large'
  | 'load_cta'
  | 'loading'
  | 'error'
  | 'patch'
  | 'empty';

/** Many-file diffs open collapsed, matching BB's git tab. */
export const DIFF_AUTO_COLLAPSE_FILE_THRESHOLD = 10;

export const DIFF_SELECTION_ALL = 'all';
export const DIFF_SELECTION_UNCOMMITTED = 'uncommitted';
export type DiffSelection = typeof DIFF_SELECTION_ALL | typeof DIFF_SELECTION_UNCOMMITTED;

export const DIFF_SELECTION_OPTIONS: ReadonlyArray<{ value: DiffSelection; label: string }> = [
  { value: DIFF_SELECTION_UNCOMMITTED, label: 'Uncommitted changes' },
  { value: DIFF_SELECTION_ALL, label: 'All changes' }
];

export function diffTargetForSelection(
  selection: DiffSelection
): { type: 'uncommitted' } | undefined {
  return selection === DIFF_SELECTION_UNCOMMITTED ? { type: 'uncommitted' } : undefined;
}

export function filterDiffFiles<T extends { path: string; previousPath?: string | null }>(
  files: readonly T[],
  query: string
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...files];
  return files.filter((file) =>
    file.path.toLowerCase().includes(needle)
    || (file.previousPath != null && file.previousPath.toLowerCase().includes(needle))
  );
}

export function diffPanelPhase(error: string | null, hasDiff: boolean): DiffPanelPhase {
  if (error) return 'error';
  if (hasDiff) return 'ready';
  return 'loading';
}

export function summarizeDiffFiles(
  files: readonly { additions: number; deletions: number }[]
): { filesCount: number; insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const file of files) {
    insertions += file.additions;
    deletions += file.deletions;
  }
  return { filesCount: files.length, insertions, deletions };
}

export function formatDiffFilesLabel(count: number, truncated = false): string {
  const noun = count === 1 ? 'file' : 'files';
  return truncated ? `${count}+ ${noun}` : `${count} ${noun}`;
}

export function isDiffCardInitiallyCollapsed(
  entry: { changeKind: DiffChangeKind },
  fileCount: number
): boolean {
  return fileCount > DIFF_AUTO_COLLAPSE_FILE_THRESHOLD || entry.changeKind === 'deleted';
}

export function resolveDiffCardCollapsed(
  stored: boolean | undefined,
  entry: { changeKind: DiffChangeKind },
  fileCount: number
): boolean {
  return stored ?? isDiffCardInitiallyCollapsed(entry, fileCount);
}

export function areAllDiffCardsCollapsed<T extends { path: string; changeKind: DiffChangeKind }>(
  files: readonly T[],
  collapsedByPath: Readonly<Record<string, boolean | undefined>>
): boolean {
  if (files.length === 0) return true;
  return files.every((file) => resolveDiffCardCollapsed(collapsedByPath[file.path], file, files.length));
}

export function collapseAllDiffCards<T extends { path: string }>(
  files: readonly T[],
  collapsed: boolean
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const file of files) next[file.path] = collapsed;
  return next;
}

export function formatDiffCardLabel(entry: {
  path: string;
  previousPath?: string | null;
  changeKind: DiffChangeKind;
}): string {
  if (
    (entry.changeKind === 'renamed' || entry.changeKind === 'copied') &&
    entry.previousPath &&
    entry.previousPath !== entry.path
  ) {
    return `${entry.previousPath} -> ${entry.path}`;
  }
  return entry.path;
}

export function diffCardHeaderStats(entry: {
  changeKind: DiffChangeKind;
  additions: number;
  deletions: number;
}): { insertions: number; deletions: number; hideZero: boolean } {
  const isAdded = entry.changeKind === 'added';
  const isDeleted = entry.changeKind === 'deleted';
  return {
    insertions: isDeleted ? 0 : entry.additions,
    deletions: isAdded ? 0 : entry.deletions,
    hideZero: isAdded || isDeleted
  };
}

export function resolveDiffCardBodyKind(args: {
  collapsed: boolean;
  binary: boolean;
  loadMode: DiffLoadMode;
  patchStatus: DiffPatchStatus;
  patchEmpty?: boolean;
}): DiffCardBodyKind {
  if (args.collapsed) return 'hidden';
  if (args.binary) return 'binary';
  if (args.loadMode === 'too_large') return 'too_large';
  if (args.patchStatus === 'error') return 'error';
  if (args.patchStatus === 'loading') return 'loading';
  if (args.loadMode === 'on_demand' && args.patchStatus === 'idle') return 'load_cta';
  if (args.patchStatus === 'ready') return args.patchEmpty ? 'empty' : 'patch';
  return 'loading';
}

export function shouldAutoLoadPatch(args: {
  collapsed: boolean;
  visible: boolean;
  binary: boolean;
  loadMode: DiffLoadMode;
  patchStatus: DiffPatchStatus;
}): boolean {
  return (
    !args.collapsed &&
    args.visible &&
    !args.binary &&
    args.loadMode === 'auto' &&
    args.patchStatus === 'idle'
  );
}

export type DiffLineKind = 'context' | 'add' | 'del';

export interface ParsedDiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface ParsedDiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: ParsedDiffLine[];
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedPatch(patch: string): ParsedDiffHunk[] {
  const hunks: ParsedDiffHunk[] = [];
  let current: ParsedDiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      current = {
        header: line,
        oldStart: Number(hunkMatch[1]),
        oldCount: hunkMatch[2] == null ? 1 : Number(hunkMatch[2]),
        newStart: Number(hunkMatch[3]),
        newCount: hunkMatch[4] == null ? 1 : Number(hunkMatch[4]),
        lines: []
      };
      hunks.push(current);
      oldNo = current.oldStart;
      newNo = current.newStart;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('\\')) continue;
    if (line.startsWith('+')) {
      current.lines.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo });
      newNo += 1;
      continue;
    }
    if (line.startsWith('-')) {
      current.lines.push({ kind: 'del', text: line.slice(1), oldNo, newNo: null });
      oldNo += 1;
      continue;
    }
    if (line.startsWith(' ') || line === '') {
      current.lines.push({
        kind: 'context',
        text: line.startsWith(' ') ? line.slice(1) : line,
        oldNo,
        newNo
      });
      oldNo += 1;
      newNo += 1;
    }
  }
  return hunks;
}

export function unmodifiedLineCountBefore(hunk: ParsedDiffHunk): number {
  return hunk.oldStart > 1 ? hunk.oldStart - 1 : 0;
}

export function unmodifiedLineCountBetween(previous: ParsedDiffHunk, next: ParsedDiffHunk): number {
  return Math.max(0, next.oldStart - (previous.oldStart + previous.oldCount));
}

export function pairSplitDiffRows(
  lines: readonly ParsedDiffLine[]
): Array<{ left: ParsedDiffLine | null; right: ParsedDiffLine | null }> {
  const rows: Array<{ left: ParsedDiffLine | null; right: ParsedDiffLine | null }> = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.kind === 'context') {
      rows.push({ left: line, right: line });
      index += 1;
      continue;
    }
    const deletions: ParsedDiffLine[] = [];
    const additions: ParsedDiffLine[] = [];
    while (index < lines.length && lines[index]!.kind === 'del') {
      deletions.push(lines[index]!);
      index += 1;
    }
    while (index < lines.length && lines[index]!.kind === 'add') {
      additions.push(lines[index]!);
      index += 1;
    }
    const count = Math.max(deletions.length, additions.length);
    for (let offset = 0; offset < count; offset += 1) {
      rows.push({
        left: deletions[offset] ?? null,
        right: additions[offset] ?? null
      });
    }
  }
  return rows;
}

export function hunkForPath(diff: string, path: string): { original: string; modified: string } {
  if (!path) return { original: '', modified: diff };
  const blocks = diff.split(/^diff --git /m);
  const match = blocks.find((block) => block.includes(path));
  const body = match
    ? (match.startsWith('a/') || match.startsWith('b/') ? `diff --git ${match}` : match)
    : diff;
  return { original: '', modified: body };
}

export function changeKindLetter(
  kind: DiffChangeKind
): string {
  switch (kind) {
    case 'added': return 'A';
    case 'modified': return 'M';
    case 'deleted': return 'D';
    case 'renamed': return 'R';
    case 'copied': return 'C';
    case 'type_changed': return 'T';
  }
}
