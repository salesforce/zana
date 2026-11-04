export interface DiscoveryNote {
  key: string;
  text: string;
}

const HARNESS_PREFIX = /^[^:]{1,40}: (?=Invalid frontmatter in )/;
const FRONTMATTER = /^Invalid frontmatter in (.+?) \(line \d+\): ([\s\S]*)$/;

/**
 * Collapse harness diagnostics into one entry per (file, reason). The same broken
 * file is reported once per harness, with a harness prefix and line number that differ.
 * Distinct paths are never merged; first-seen order is preserved.
 */
export function dedupeDiscoveryNotes(notes: string[]): DiscoveryNote[] {
  const seen = new Set<string>();
  const out: DiscoveryNote[] = [];
  for (const note of notes) {
    const text = note.replace(HARNESS_PREFIX, '');
    const match = FRONTMATTER.exec(text);
    const key = match ? `${match[1]}\0${match[2]}` : text;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, text });
  }
  return out;
}
