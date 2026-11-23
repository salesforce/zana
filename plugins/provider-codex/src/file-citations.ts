/**
 * Codex writes file references as a leaf directive,
 * `:codex-file-citation{path="/abs/report.pdf" purpose="output"}`, which only
 * Codex's own app renders. Zana renders Markdown links to local paths as
 * clickable side-panel previews, so completed assistant text rewrites each
 * citation to a Markdown link before it reaches the transcript.
 */
const CITATION_PATTERN = /:codex-file-citation\{([^}\n]*)\}/g;
const ATTRIBUTE_PATTERN = /([a-z_][a-z0-9_-]*)\s*=\s*"((?:[^"\\]|\\.)*)"/gi;

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    attributes.set(match[1]!.toLowerCase(), match[2]!.replace(/\\(.)/g, "$1"));
  }
  return attributes;
}

function linkDestination(path: string): string {
  // Angle-bracket destinations allow spaces and parentheses in paths.
  return /[\s()<>]/.test(path) ? `<${path.replace(/[<>]/g, encodeURIComponent)}>` : path;
}

function linkLabel(path: string, attributes: Map<string, string>): string {
  const base = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const page = attributes.get("page_number");
  const sheet = attributes.get("sheet");
  const range = attributes.get("range");
  const detail = [page ? `page ${page}` : null, sheet ?? null, range ?? null]
    .filter(Boolean)
    .join(", ");
  const label = detail ? `${base} (${detail})` : base;
  return label.replace(/([\\[\]])/g, "\\$1");
}

/** Rewrites Codex file citations in `text` to Markdown links; other text is unchanged. */
export function rewriteCodexFileCitations(text: string): string {
  if (!text.includes(":codex-file-citation{")) return text;
  return text.replace(CITATION_PATTERN, (whole, body: string) => {
    const attributes = parseAttributes(body);
    const path = attributes.get("path")?.trim();
    if (!path) return whole;
    return `[${linkLabel(path, attributes)}](${linkDestination(path)})`;
  });
}
