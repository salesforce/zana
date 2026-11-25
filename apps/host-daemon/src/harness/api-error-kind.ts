import { sanitizeApiErrorText } from './api-error-text.js';

/**
 * Classify a harness-reported API failure into the shared kinds. Retry behaviour comes only from
 * `isRetryableApiErrorKind(kind)`; this function never decides it separately. Anything unclassifiable is
 * `unknown`, which is retryable by that rule.
 *
 * Non-retryable kinds: `authentication_failed`, `quota_exceeded`, `invalid_request`.
 */
export function classifyApiError(input: { status?: number | string; text?: string }): string {
  const status = typeof input.status === 'string' && /^\d{3}$/.test(input.status.trim())
    ? Number(input.status.trim())
    : typeof input.status === 'number' ? input.status : undefined;
  const text = sanitizeApiErrorText(input.text ?? '').toLowerCase();

  if (status === 401 || status === 403) return 'authentication_failed';
  if (status === 429) return /quota|billing|insufficient[_ ]funds|credit/.test(text) ? 'quota_exceeded' : 'rate_limit';
  if (status === 529) return 'overloaded';
  if (status === 400 || status === 404 || status === 413 || status === 422) return 'invalid_request';
  if (status !== undefined && status >= 500 && status <= 599) return 'server_error';

  if (/unauthori[sz]ed|authentication|invalid api key|forbidden|permission denied/.test(text)) return 'authentication_failed';
  if (/exceeded your (current )?quota|insufficient[_ ]quota|billing|out of credits|credit balance/.test(text)) return 'quota_exceeded';
  if (/rate[ _-]?limit|too many requests|\b429\b/.test(text)) return 'rate_limit';
  if (/overloaded|\b529\b|capacity/.test(text)) return 'overloaded';
  if (/context (length|window)|maximum context|invalid[_ ]request|bad request/.test(text)) return 'invalid_request';
  if (/service ?unavailable|internal server error|bad gateway|gateway time-?out|\b50[0-4]\b/.test(text)) return 'server_error';
  return 'unknown';
}
