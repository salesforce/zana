export type DiffPanelPhase = 'loading' | 'error' | 'ready';

export function diffPanelPhase(error: string | null, hasDiff: boolean): DiffPanelPhase {
  if (error) return 'error';
  if (hasDiff) return 'ready';
  return 'loading';
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
