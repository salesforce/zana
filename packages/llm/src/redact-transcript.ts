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
  // PEM private key blocks.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // key=value / key: value secret assignments (api_key, token, password, secret, cookie).
  /\b(?:api[_-]?key|token|password|passwd|secret|cookie)\s*[:=]\s*(?:'[^']*'|"[^"]*"|[^\s'"`]+)/gi,
  // Secret-bearing query-string params (keeps the key, redacts the value).
  /([?&](?:api[_-]?key|token|password|secret)=)[^&#\s]+/gi,
  // URLs with embedded userinfo credentials (scheme://user:pass@host).
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/gi
];

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
  let redacted = transcript;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (...args: unknown[]) => {
      // First capture group, when present, is the preserved `?key=`/`&key=` prefix.
      const queryKey = typeof args[1] === 'string' ? args[1] : undefined;
      return queryKey && (queryKey.startsWith('?') || queryKey.startsWith('&'))
        ? `${queryKey}${REDACTED}`
        : REDACTED;
    });
  }
  return redacted;
}
