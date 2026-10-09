/** Guardrail previews stay valid JSON under the limit by eliding long arrays, so the card can still render them. */

export const GUARDRAIL_PREVIEW_CHARS = 8_000;

const MORE = /^… \+(\d+) more$/;

export function jsonPreview(value: unknown, limit = GUARDRAIL_PREVIEW_CHARS): string {
  const full = JSON.stringify(value) ?? '';
  if (full.length <= limit) return full;
  for (const keep of [20, 10, 5, 1]) {
    const text = JSON.stringify(elide(value, keep));
    if (text.length <= limit) return text;
  }
  return full.slice(0, limit);
}

/** Splits an elided array back into its items and the number of hidden ones. */
export function splitElided(items: string[]): { items: string[]; more: number } {
  const last = items.at(-1)?.match(MORE);
  return last ? { items: items.slice(0, -1), more: Number(last[1]) } : { items, more: 0 };
}

function elide(value: unknown, keep: number): unknown {
  if (Array.isArray(value)) {
    const head = value.slice(0, keep).map(item => elide(item, keep));
    return value.length > keep ? [...head, `… +${value.length - keep} more`] : head;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, elide(item, keep)]));
  }
  return value;
}
