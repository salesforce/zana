export function readTrimmedSelection(): string | null {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return null;
  const text = window.getSelection()?.toString().trim() ?? '';
  return text.length > 0 ? text : null;
}
