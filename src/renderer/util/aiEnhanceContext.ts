/**
 * Pure helper for the "Ask AI to enhance selected text" editor action
 * ({@link ../components/AiEnhanceSelection}). Trims a whole file's text down to
 * a bounded window around the selection so the `builtin:enhance-selection` LLM
 * micro-call gets useful surrounding context without ballooning the prompt on
 * a large file.
 */
export function buildSurroundingContext(
  fullText: string,
  selectionStart: number,
  selectionEnd: number,
  maxChars = 6_000
): string {
  if (fullText.length <= maxChars) return fullText;

  const half = Math.floor(maxChars / 2);
  const before = fullText.slice(Math.max(0, selectionStart - half), selectionStart);
  const after = fullText.slice(selectionEnd, selectionEnd + half);
  const prefix = selectionStart - half > 0 ? '…\n' : '';
  const suffix = selectionEnd + half < fullText.length ? '\n…' : '';
  return `${prefix}${before}[SELECTION]${after}${suffix}`;
}
