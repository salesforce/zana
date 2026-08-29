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
