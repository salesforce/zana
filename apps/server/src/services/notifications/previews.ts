import type { PushNotificationKind } from '@zana-ai/zcc-domain';

/**
 * Readable phone-notification text (ported from BB's push-notifications
 * `notification-text.ts` / `sender.ts`). The text leaves the machine through
 * Expo's push service, so everything here is bounded, stripped of markdown and
 * control characters, and scrubbed of anything that looks like a credential.
 * Command arguments, file paths/contents, plan bodies and error detail are never
 * quoted; only the thread title and a short question/answer excerpt are.
 */

export const PUSH_TITLE_MAX_LENGTH = 80;
export const PUSH_BODY_MAX_LENGTH = 180;
/** Bound the work done on a long assistant message before extracting the paragraph. */
const PREVIEW_SOURCE_MAX_CHARS = 8_000;
const TOOL_NAME_MAX_LENGTH = 60;

export const FALLBACK_BODIES: Record<PushNotificationKind, string> = {
  'pending-interaction': 'Waiting for your input',
  'thread-error': 'The thread hit an error',
  'turn-finished': 'Finished and waiting for you'
};

const REDACTED = '[redacted]';
const CODE_FENCE_PATTERN = /^\s*(```|~~~)/u;
const BREAK_PATTERN = /^\s{0,3}(?:#{1,6}(?:\s|$)|([-*_])(?:\s*\1){2,}\s*$)/u;
const BLOCK_MARKER_PATTERN = /^\s{0,3}(?:>\s?|[-*+]\s+|\d+[.)]\s+)/u;

const ANSI_ESCAPE_PATTERN = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/gu;
// C0/C1 controls (tab and newline are folded into spaces first), zero-width and bidi overrides.
const INVISIBLE_PATTERN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/gu;

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/gu,
  /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/giu,
  // Also a quoted key, as in JSON: "api_key": "...".
  /[\w-]*(?:api[_-]?key|secret|token|passw(?:or)?d|authorization|cookie|credential|private[_-]?key)[\w-]*["']?\s*[:=]\s*["']?(?:(?:bearer|basic|token)\s+)?[^\s,;]+/giu,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/giu,
  // OpenAI/Anthropic style (sk-...) and Stripe style (sk_live_..., pk_test_..., rk_live_...).
  /\b(?:sk|pk|rk)[-_](?:live_|test_)?[A-Za-z0-9_-]{16,}/gu,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/gu,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/gu,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/gu,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/gu,
  /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{32,}\b/gu
];

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let cut = text.slice(0, Math.max(0, maxLength - 1));
  // Never end on half of a surrogate pair.
  if (/[\ud800-\udbff]$/u.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** One line of safe text: no control or invisible characters, secrets redacted. */
export function sanitizeInlineText(raw: string): string {
  let text = raw.replace(ANSI_ESCAPE_PATTERN, '').replace(/[\t\n\r]+/gu, ' ').replace(INVISIBLE_PATTERN, '');
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, scheme: unknown) =>
      typeof scheme === 'string' && scheme.endsWith('://') ? `${scheme}${REDACTED}@` : REDACTED
    );
  }
  return text.replace(/\s+/gu, ' ').trim();
}

function firstParagraph(markdown: string): string {
  const lines: string[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/u)) {
    if (CODE_FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      if (lines.length > 0) break;
      continue;
    }
    if (inFence) continue;
    if (BREAK_PATTERN.test(line)) {
      if (lines.length > 0) break;
      continue;
    }
    const text = line.replace(BLOCK_MARKER_PATTERN, '').trim();
    if (text.length === 0) {
      if (lines.length > 0) break;
      continue;
    }
    lines.push(text);
  }
  return lines.join(' ');
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<(https?:\/\/[^>\s]+)>/gu, '$1')
    .replace(/<\/?[a-z][^>]*>/giu, '')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/(\*\*|__)(.+?)\1/gu, '$2')
    .replace(/~~(.+?)~~/gu, '$1')
    .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?![*\w])/gu, '$1$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/gu, '$1');
}

/** First paragraph of a Markdown message, outside code fences, as safe plain text. */
export function notificationPreviewText(markdown: string): string {
  const bounded = markdown.length > PREVIEW_SOURCE_MAX_CHARS ? markdown.slice(0, PREVIEW_SOURCE_MAX_CHARS) : markdown;
  return sanitizeInlineText(stripInlineMarkdown(firstParagraph(bounded)));
}

export function threadDisplayTitle(thread: { id: string; title: string | null }): string {
  const title = thread.title?.trim();
  return title ? title : `Thread ${thread.id.slice(0, 8)}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return '';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Program name only: arguments and env assignments may carry secrets or paths. */
function commandProgram(command: string): string | null {
  const token = command.trim().split(/\s+/u)[0] ?? '';
  if (token.includes('=')) return null;
  const name = token.slice(token.lastIndexOf('/') + 1);
  return /^[A-Za-z0-9._+-]{1,40}$/u.test(name) ? name : null;
}

function describeApproval(subject: Record<string, unknown> | null): string | null {
  switch (subject?.kind) {
    case 'command': {
      const program = commandProgram(text(subject.command));
      return program ? `Approve command: ${program}` : 'Approve a command';
    }
    case 'file_change':
      return 'Approve file changes';
    case 'permission_grant': {
      const tool = sanitizeInlineText(text(subject.toolName));
      return tool ? `Grant permissions to ${truncate(tool, TOOL_NAME_MAX_LENGTH)}` : 'Grant additional permissions';
    }
    case 'plan':
      return 'Review the plan before the agent continues';
    case 'tool_use': {
      const tool = sanitizeInlineText(text(subject.tool));
      return tool ? `Approve tool: ${truncate(tool, TOOL_NAME_MAX_LENGTH)}` : null;
    }
    default:
      return null;
  }
}

/** Describe a stored pending-interaction payload (JSON) in one safe line. */
export function describePendingInteraction(payloadJson: string): string {
  let payload: Record<string, unknown> | null;
  try {
    payload = record(JSON.parse(payloadJson));
  } catch {
    payload = null;
  }
  let body: string | null = null;
  if (payload?.kind === 'user_question') {
    const questions = Array.isArray(payload.questions) ? payload.questions : [];
    const prompt = text(record(questions[0])?.prompt);
    body = sanitizeInlineText(stripInlineMarkdown(firstLine(prompt)));
  } else if (payload?.kind === 'approval') {
    body = describeApproval(record(payload.subject));
  } else if (payload && typeof payload.kind === 'string') {
    body = sanitizeInlineText(text(payload.title));
  }
  return body || FALLBACK_BODIES['pending-interaction'];
}

export interface PushPreviewSource {
  /** Stored pending-interaction payload JSON, for `pending-interaction`. */
  pendingPayload?: string | undefined;
  /** The thread's last assistant message (Markdown), for `turn-finished`. */
  lastReply?: string | undefined;
}

export function buildPushPreview(
  kind: PushNotificationKind,
  thread: { id: string; title: string | null },
  source: PushPreviewSource
): { title: string; body: string } {
  let body: string;
  if (kind === 'pending-interaction') {
    body = source.pendingPayload === undefined ? '' : describePendingInteraction(source.pendingPayload);
  } else if (kind === 'turn-finished') {
    body = source.lastReply === undefined ? '' : notificationPreviewText(source.lastReply);
  } else {
    // Error detail can hold paths, commands and stack traces: never quote it.
    body = '';
  }
  return {
    title: truncate(sanitizeInlineText(threadDisplayTitle(thread)), PUSH_TITLE_MAX_LENGTH),
    body: truncate(body || FALLBACK_BODIES[kind], PUSH_BODY_MAX_LENGTH)
  };
}
