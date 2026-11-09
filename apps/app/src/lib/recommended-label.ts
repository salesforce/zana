/** Recognize explicit recommendation suffixes without guessing from option order. */
export function splitRecommendedLabel(label: string): { label: string; recommended: boolean } {
  const stripped = label.replace(/\s*(?:[-–—]\s*recommended|[([]\s*recommended\s*[)\]])\s*$/i, '').trim();
  if (stripped === label.trim() || !stripped) return { label, recommended: false };
  return { label: stripped, recommended: true };
}
