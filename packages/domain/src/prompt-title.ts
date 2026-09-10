/**
 * Derive a short, meaningful tab title from an agent's opening instruction.
 * Collapses whitespace and caps at 40 chars with an ellipsis, so a launched
 * session or thread reads the same wherever it was spawned from.
 */
export function titleFromPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '';
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine;
}

/** Bounded objective fallback that never exposes local absolute/relative paths. */
export function titleFromObjective(objective: string): string {
  // Boundary excludes ':' and '/' so a URL scheme ("https://…") is never
  // mistaken for a local path — the second '/' of "//" would otherwise look
  // like a fresh boundary — while still catching a path right after
  // punctuation/quotes ("Fix (/home/alice/file)", '"C:\Users\alice\secret"').
  const pathFree = objective.replace(/(^|[^\w:/])(?:~\/|\.{1,2}\/|\/|[a-zA-Z]:[\\/])\S+/g, '$1');
  return titleFromPrompt(pathFree);
}
