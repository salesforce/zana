/** Shared bounds and sanitiser for API-error text a harness reports to the host. */

export const MAX_API_ERROR_TEXT = 4096;

// C0 (except tab and newline, which collapse below), DEL, C1 and ANSI CSI/OSC sequences.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Strip escapes and control characters, collapse whitespace, cap on a UTF-16 code point boundary. */
export function sanitizeApiErrorText(value: unknown, max: number = MAX_API_ERROR_TEXT): string {
  if (typeof value !== 'string') return '';
  const clean = value.replace(ANSI, ' ').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  let end = max;
  const last = clean.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // do not split a surrogate pair
  return clean.slice(0, end);
}
