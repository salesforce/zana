const MAX_TRANSCRIPT_BYTES = 6 * 1024;
const REDACTED = '[redacted]';
const TRUNCATED = '\n[truncated]';

const SECRET_PATTERNS = [
  /\b(?:sk|AIza)[-_A-Za-z0-9]{16,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\b(?:ghp|github_pat|xox[baprs])[-_A-Za-z0-9]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g,
  /\bBearer\s+[-._~+/=A-Za-z0-9]{12,}\b/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:api[_-]?key|token|password|secret|cookie)\s*[:=]\s*(?:'[^']*'|"[^"]*"|[^\s'"`]+)/gi,
  /([?&](?:api[_-]?key|token|password|secret)=)[^&#\s]+/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/gi
];

function utf8Prefix(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end) + TRUNCATED, 'utf8') > maxBytes) end--;
  return text.slice(0, end) + TRUNCATED;
}

/**
 * Bound monitor transcript prose before it reaches an HTTP model provider. The
 * monitor never sends tool payloads, environment, project config, or raw logs.
 */
export function serializeMonitorTranscript(transcript: string): string {
  let redacted = transcript;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (...args: unknown[]) => {
      // Preserve the query-string key so redacted URLs remain understandable.
      const queryKey = typeof args[1] === 'string' ? args[1] : undefined;
      return queryKey?.startsWith('?') || queryKey?.startsWith('&') ? `${queryKey}${REDACTED}` : REDACTED;
    });
  }
  return utf8Prefix(redacted, MAX_TRANSCRIPT_BYTES);
}
