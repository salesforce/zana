/**
 * Resume-after-API-error config contract (issue #421). Pure and renderer-safe:
 * no Node APIs, so main, server and the Settings UI all import the same rules.
 */

export type ApiErrorResumeMatchMode = 'contains' | 'regex';

export interface ApiErrorResumeRule {
  id: string;
  match: string;
  matchMode: ApiErrorResumeMatchMode;
  /** Regex rules only; `contains` rules always compare case-insensitively. */
  caseSensitive?: boolean;
  message: string;
  delaySeconds: number;
  enabled: boolean;
}

export interface ApiErrorResumeConfig {
  enabled: boolean;
  rules: ApiErrorResumeRule[];
  maxPerWindow: number;
  windowMinutes: number;
}

export const API_ERROR_RESUME_DEFAULTS = {
  message: 'continue',
  delaySeconds: 20,
  minDelaySeconds: 5,
  maxDelaySeconds: 600,
  maxPerWindow: 3,
  windowMinutes: 15,
  minPerWindow: 1,
  maxPerWindowLimit: 10,
  minWindowMinutes: 5,
  maxWindowMinutes: 120,
  maxRules: 20,
  minMatchChars: 4,
  maxMatchChars: 300,
  maxMessageChars: 200,
  maxMatchTextChars: 4096
} as const;

/** One-click starting points offered in Settings; never applied automatically. */
export const API_ERROR_RESUME_SUGGESTIONS: ReadonlyArray<Partial<ApiErrorResumeRule>> = [
  { match: 'Provider anthropic not found', matchMode: 'contains', message: 'continue', delaySeconds: 20 },
  { match: 'Connection lost mid-response', matchMode: 'contains', message: 'continue', delaySeconds: 30 }
];

const RULE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// C0 (incl. ESC), DEL and C1 control characters.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** The text typed into the terminal: one line, no control characters, capped. */
export function sanitizeResumeMessage(raw: unknown): string {
  if (typeof raw !== 'string') return API_ERROR_RESUME_DEFAULTS.message;
  const cleaned = raw
    .replace(/[\r\n\t]/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, API_ERROR_RESUME_DEFAULTS.maxMessageChars)
    .trim();
  return cleaned || API_ERROR_RESUME_DEFAULTS.message;
}

/** Compile-only check; the pattern is never executed here. */
export function isValidResumePattern(pattern: string): boolean {
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}

/**
 * Two rules with the same key are duplicates; the normaliser keeps only the
 * first. `contains` compares case-insensitively, `regex` exactly.
 */
export function apiErrorResumeRuleKey(rule: Pick<ApiErrorResumeRule, 'match' | 'matchMode'>): string {
  const match = rule.match.trim();
  return `${rule.matchMode}\u0000${rule.matchMode === 'contains' ? match.toLowerCase() : match}`;
}

function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function normalizeApiErrorResume(raw: unknown): ApiErrorResumeConfig | undefined {
  if (!isRecord(raw)) return undefined;
  const D = API_ERROR_RESUME_DEFAULTS;
  const rules: ApiErrorResumeRule[] = [];
  const ids = new Set<string>();
  const seen = new Set<string>();
  const input = Array.isArray(raw.rules) ? raw.rules : [];
  for (let index = 0; index < input.length && rules.length < D.maxRules; index++) {
    const r = input[index];
    if (!isRecord(r) || typeof r.match !== 'string') continue;
    const match = r.match.trim();
    if (match.length < D.minMatchChars || match.length > D.maxMatchChars) continue;
    const matchMode: ApiErrorResumeMatchMode = r.matchMode === 'regex' ? 'regex' : 'contains';
    if (matchMode === 'regex' && !isValidResumePattern(match)) continue;
    const dedupeKey = apiErrorResumeRuleKey({ match, matchMode });
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    let id = typeof r.id === 'string' && RULE_ID.test(r.id) && !ids.has(r.id) ? r.id : `r${index}-${shortHash(match)}`;
    while (ids.has(id)) id += '_';
    ids.add(id);
    const rule: ApiErrorResumeRule = {
      id,
      match,
      matchMode,
      message: sanitizeResumeMessage(r.message),
      delaySeconds: clampInt(r.delaySeconds, D.minDelaySeconds, D.maxDelaySeconds, D.delaySeconds),
      enabled: r.enabled !== false
    };
    if (matchMode === 'regex' && typeof r.caseSensitive === 'boolean') rule.caseSensitive = r.caseSensitive;
    rules.push(rule);
  }
  return {
    enabled: raw.enabled === true,
    rules,
    maxPerWindow: clampInt(raw.maxPerWindow, D.minPerWindow, D.maxPerWindowLimit, D.maxPerWindow),
    windowMinutes: clampInt(raw.windowMinutes, D.minWindowMinutes, D.maxWindowMinutes, D.windowMinutes)
  };
}

/** Text a rule is matched against: error and visible output, flattened and capped. */
export function buildApiErrorMatchText(error: string, text: string): string {
  return `${error} ${text}`.replace(/\s+/g, ' ').trim().slice(0, API_ERROR_RESUME_DEFAULTS.maxMatchTextChars);
}
