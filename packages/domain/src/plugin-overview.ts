export const MARKETPLACE_OVERVIEW_MAX_CHARS = 4000;

const OVERVIEW_HTML_OR_IMAGE_PATTERN = /<[A-Za-z!/?]|!\[/u;

export function normalizePluginOverviewText(text: string): string {
  return `${text
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .replace(/^\n+/u, '')
    .replace(/\n+$/u, '')}\n`;
}

export function parsePluginOverviewMarkdown(
  text: string
): { ok: true; overview: string } | { ok: false; reason: 'empty' | 'too-long' | 'unsafe' } {
  const overview = normalizePluginOverviewText(text);
  const length = [...overview.replace(/\n$/u, '')].length;
  if (length === 0) return { ok: false, reason: 'empty' };
  if (length > MARKETPLACE_OVERVIEW_MAX_CHARS) return { ok: false, reason: 'too-long' };
  const prose = overview.replace(/```[\s\S]*?```/gu, '').replace(/`[^`\n]*`/gu, '');
  if (OVERVIEW_HTML_OR_IMAGE_PATTERN.test(prose)) return { ok: false, reason: 'unsafe' };
  return { ok: true, overview };
}
