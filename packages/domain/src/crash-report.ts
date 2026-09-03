import { REPORT_BUG_URL } from './about-credits.js';

export const CRASH_REPORT_FIELD_MAX = 32 * 1024;
export const CRASH_REPORT_MARKDOWN_MAX = 128 * 1024;
export const CRASH_ISSUE_TITLE_MAX = 80;
/** Stay under typical GitHub/Chromium URL practical limits. */
export const CRASH_ISSUE_URL_MAX = 7000;

export type RendererCrashPayload = {
  message: string;
  stack?: string;
  componentStack?: string;
};

export type CrashIssueContext = RendererCrashPayload & {
  version?: string;
  osLabel?: string;
  fileName?: string;
};

export type SaveCrashReportResult =
  | { ok: true; version: string; osLabel: string; fileName: string }
  | { ok: false };

export function boundCrashText(value: unknown, max: number): string {
  if (typeof value !== 'string' || max <= 0) return '';
  return value.length <= max ? value : value.slice(0, max);
}

export function crashIssueTitle(message: string): string {
  const firstLine = boundCrashText(message, CRASH_ISSUE_TITLE_MAX).split('\n')[0]?.trim()
    || 'unexpected error';
  const title = `Renderer crash: ${firstLine}`;
  return title.length <= CRASH_ISSUE_TITLE_MAX + 20
    ? title
    : title.slice(0, CRASH_ISSUE_TITLE_MAX + 20);
}

function fence(label: string, body: string): string {
  const text = body.trim() ? body : '(none)';
  return `### ${label}\n\n\`\`\`\n${text}\n\`\`\``;
}

export function crashIssueMarkdown(ctx: CrashIssueContext): string {
  const message = boundCrashText(ctx.message, CRASH_REPORT_FIELD_MAX);
  const stack = boundCrashText(ctx.stack, CRASH_REPORT_FIELD_MAX);
  const componentStack = boundCrashText(ctx.componentStack, CRASH_REPORT_FIELD_MAX);
  const version = boundCrashText(ctx.version, 64) || 'unknown';
  const osLabel = boundCrashText(ctx.osLabel, 256) || 'unknown';
  const fileName = boundCrashText(ctx.fileName, 128);
  const saved = fileName
    ? `\nCrash report saved as \`${fileName}\` under \`~/.zcc/crashes\` (or \`$ZCC_DATA_DIR/crashes\`).\n`
    : '';
  const markdown = [
    '## What happened?',
    '',
    'The renderer recovered to the crash screen.',
    '',
    fence('Error', message),
    '',
    fence('Stack', stack),
    '',
    fence('Component stack', componentStack),
    '',
    '## How to reproduce',
    '',
    'Unknown — crash recovered to the safe screen.',
    '',
    '## Zana version and OS',
    '',
    `${version} / ${osLabel}`,
    saved
  ].join('\n');
  return boundCrashText(markdown, CRASH_REPORT_MARKDOWN_MAX);
}

export function crashIssueUrl(title: string, baseUrl = REPORT_BUG_URL): string {
  const encoded = encodeURIComponent(title);
  const url = `${baseUrl}&title=${encoded}`;
  if (url.length <= CRASH_ISSUE_URL_MAX) return url;
  return `${baseUrl}&title=${encodeURIComponent('Renderer crash')}`;
}
