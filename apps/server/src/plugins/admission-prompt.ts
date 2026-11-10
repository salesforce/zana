import type { DispatchAdmissionPrompt } from '@zana-ai/zcc-domain';

/** Upper bound, in UTF-8 bytes, of the redacted prompt text a plugin with `zcc.promptAccess` receives. */
export const DISPATCH_ADMISSION_PROMPT_MAX_BYTES = 32 * 1024;

/** What a caller knows of a dispatch's text before redaction and the byte cap. */
export interface RawAdmissionPrompt {
  text: string;
  /** Set when the caller already cut the text (main bounds what it sends). */
  truncated?: boolean;
  attachmentCount?: number;
}

/** Bound on the text redaction scans, so a huge prompt never costs unbounded regex time. */
const REDACTION_SCAN_MAX_CHARS = DISPATCH_ADMISSION_PROMPT_MAX_BYTES * 4;
const REDACTED = '[REDACTED]';

/**
 * Same sensitive-name rule the tool-policy input redaction applies to object
 * keys (`token|secret|password|key|credential`), applied to `name=value`,
 * `name: value`, and `"name": "value"` spans in free text.
 */
const SECRET_ASSIGNMENT =
  /(["']?[\w.-]{0,32}(?:token|secret|password|passwd|key|credential)[\w.-]{0,32}["']?[ \t]{0,4}[:=][ \t]{0,4})("[^"\n]*"?|'[^'\n]*'?|[^\s,;"'}]+)/gi;
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const KNOWN_TOKEN =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;

/** Redact secret-shaped spans from prompt text. Pure; never throws. */
export function redactPromptText(text: string): string {
  return text
    .replace(PRIVATE_KEY_BLOCK, REDACTED)
    .replace(SECRET_ASSIGNMENT, (_match, name: string) => `${name}${REDACTED}`)
    .replace(BEARER, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(KNOWN_TOKEN, REDACTED);
}

/** Cut to at most `maxBytes` UTF-8 bytes without splitting a code point. */
export function capUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return { text, truncated: false };
  // Back off UTF-8 continuation bytes (10xxxxxx) so the cut lands on a code-point boundary.
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return { text: bytes.subarray(0, end).toString('utf8'), truncated: true };
}

/** Redact, then cap: the only shape of prompt content a plugin ever receives. */
export function buildAdmissionPrompt(raw: RawAdmissionPrompt): DispatchAdmissionPrompt {
  const scanned = raw.text.length > REDACTION_SCAN_MAX_CHARS;
  const redacted = redactPromptText(scanned ? raw.text.slice(0, REDACTION_SCAN_MAX_CHARS) : raw.text);
  const capped = capUtf8(redacted, DISPATCH_ADMISSION_PROMPT_MAX_BYTES);
  return {
    text: capped.text,
    truncated: capped.truncated || scanned || raw.truncated === true,
    attachmentCount: Math.max(0, Math.floor(raw.attachmentCount ?? 0))
  };
}

const ATTACHMENT_PART_TYPE = /^(?:local)?(?:image|file)$|attachment/i;

/**
 * Text and attachment count of a turn input (a string, or an array of strings
 * and typed parts), as the callers receive it before normalization.
 */
export function admissionPromptFromInput(input: unknown): RawAdmissionPrompt {
  const parts: string[] = [];
  let attachmentCount = 0;
  const visit = (part: unknown): void => {
    if (typeof part === 'string') {
      if (part.length > 0) parts.push(part);
      return;
    }
    if (!part || typeof part !== 'object') return;
    const record = part as { type?: unknown; text?: unknown };
    if (record.type === 'text') {
      if (typeof record.text === 'string' && record.text.length > 0) parts.push(record.text);
    } else if (typeof record.type === 'string' && ATTACHMENT_PART_TYPE.test(record.type)) {
      attachmentCount += 1;
    }
  };
  if (Array.isArray(input)) input.forEach(visit);
  else visit(input);
  return { text: parts.join('\n'), attachmentCount };
}
