import { redactUserinfoUrls } from './redact-userinfo-url.js';

const REDACTED = '[redacted]';

/**
 * Secret patterns stripped from agent-transcript prose before it is embedded
 * into a monitor micro-call prompt (idle-triage / catch-up). These prompts feed
 * raw terminal/transcript text to a coding harness, so any credential the agent
 * printed (a `Bearer` header, an `api_key=` assignment, a cloud/SCM token, a
 * JWT, a private key, a URL with embedded creds) would otherwise reach the
 * provider verbatim. Ported from the former monitor-semantic-input redactor.
 */
const SECRET_PATTERNS: RegExp[] = [
  // OpenAI / Google-style bearer keys: sk-..., AIza...
  /\b(?:sk|AIza)[-_A-Za-z0-9]{16,}\b/g,
  // AWS access key ids.
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  // GitHub / GitLab / Slack tokens.
  /\b(?:ghp|github_pat|xox[baprs])[-_A-Za-z0-9]{16,}\b/g,
  // JWTs (header.payload.signature).
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g,
  // Authorization: Bearer <token>.
  /\bBearer\s+[-._~+/=A-Za-z0-9]{12,}\b/gi,
  // key=value / key: value secret assignments (api_key, token, password, secret, cookie).
  /\b(?:api[_-]?key|token|password|passwd|secret|cookie)\s*[:=]\s*(?:'[^']*'|"[^"]*"|[^\s'"`]+)/gi,
  // Secret-bearing query-string params (keeps the key, redacts the value).
  /([?&](?:api[_-]?key|token|password|secret)=)[^&#\s]+/gi
];

const PEM_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const PEM_END = /-----END [A-Z ]*PRIVATE KEY-----/g;

/**
 * Replace PEM private key blocks. Same result as the lazy
 * `BEGIN…[\s\S]*?…END` regex it replaces, but linear: the regex rescanned to
 * the end of the input for every unterminated BEGIN. Here the scan only moves
 * forward past each replaced block, and stops at the first BEGIN with no END
 * after it, since no later BEGIN can have one either.
 */
export function redactPemBlocks(text: string, replacement: string): string {
  const begin = new RegExp(PEM_BEGIN);
  const end = new RegExp(PEM_END);
  let out = '';
  let cursor = 0;
  for (let found = begin.exec(text); found; found = begin.exec(text)) {
    end.lastIndex = found.index + found[0].length;
    const closing = end.exec(text);
    if (closing === null) break;
    out += text.slice(cursor, found.index) + replacement;
    cursor = closing.index + closing[0].length;
    begin.lastIndex = cursor;
  }
  return out + text.slice(cursor);
}

/**
 * Strip obvious secrets from agent transcript prose before it is interpolated
 * into a monitor prompt (idle-triage / catch-up-summary) and sent to a provider.
 *
 * Pure and defensive: it only removes credential-shaped substrings, never throws,
 * and returns the input unchanged when nothing matches. Applied unconditionally
 * at the dispatch site regardless of which provider is configured, so a
 * credential the observed agent printed can never reach a coding harness
 * (or any HTTP provider) verbatim.
 *
 * For a secret-bearing query-string param the key is preserved (`?token=[redacted]`)
 * so the redacted URL still reads sensibly; every other match becomes `[redacted]`.
 */
export function redactTranscript(transcript: string): string {
  let redacted = redactPemBlocks(transcript, REDACTED);
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (...args: unknown[]) => {
      // First capture group, when present, is the preserved `?key=`/`&key=` prefix.
      const queryKey = typeof args[1] === 'string' ? args[1] : undefined;
      return queryKey && (queryKey.startsWith('?') || queryKey.startsWith('&'))
        ? `${queryKey}${REDACTED}`
        : REDACTED;
    });
  }
  // URLs with embedded userinfo credentials (scheme://user:pass@host).
  return redactUserinfoUrls(redacted, REDACTED);
}
