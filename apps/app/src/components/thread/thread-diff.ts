export function hunkForPath(diff: string, path: string): { original: string; modified: string } {
  if (!path) return { original: '', modified: diff };
  const blocks = diff.split(/^diff --git /m);
  const match = blocks.find((block) => block.includes(path));
  const body = match
    ? (match.startsWith('a/') || match.startsWith('b/') ? `diff --git ${match}` : match)
    : diff;
  return { original: '', modified: body };
}
