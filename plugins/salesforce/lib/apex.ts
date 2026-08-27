import { ANON_APEX_MAX_CHARS } from './types.js';

export type ApexAction = 'diagnose' | 'test.run' | 'logs.fetch' | 'anon.run';

export interface ApexInput {
  action?: string;
  className?: string;
  methodNames?: unknown;
  body?: string;
  path?: string;
  limit?: number;
  allow_mutation?: boolean;
}

export interface ApexPlan {
  action: ApexAction;
  className?: string;
  methodNames?: string[];
  body?: string;
  path?: string;
  limit: number;
  allowMutation: boolean;
  mutationLikely: boolean;
}

const ACTIONS: readonly ApexAction[] = ['diagnose', 'test.run', 'logs.fetch', 'anon.run'];

const MUTATION_RE =
  /\b(insert|update|upsert|delete|undelete|merge)\b|\bDatabase\s*\.|\bSystem\.enqueueJob\b|\bHttpRequest\b|\bcallout\b/i;

export function parseApexInput(input: unknown): { ok: true; plan: ApexPlan } | { ok: false; error: string } {
  const raw = input && typeof input === 'object' ? (input as ApexInput) : {};
  const action = typeof raw.action === 'string' ? raw.action.trim() : '';
  if (!ACTIONS.includes(action as ApexAction)) {
    return { ok: false, error: `Unknown sf_apex action. Use ${ACTIONS.join(', ')}.` };
  }
  const className = typeof raw.className === 'string' ? raw.className.trim() : '';
  const path = typeof raw.path === 'string' ? raw.path.trim() : '';
  const body = typeof raw.body === 'string' ? raw.body : '';
  const methodNames = Array.isArray(raw.methodNames)
    ? raw.methodNames.filter((name): name is string => typeof name === 'string' && name.trim().length > 0).map((name) => name.trim())
    : [];
  const limit = typeof raw.limit === 'number' && Number.isFinite(raw.limit) ? Math.min(20, Math.max(1, Math.floor(raw.limit))) : 5;

  if (action === 'test.run' && !className) {
    return { ok: false, error: 'test.run requires className. Org-wide tests are not offered.' };
  }
  if (action === 'diagnose' && !path && !className) {
    return { ok: false, error: 'diagnose requires path or className.' };
  }
  if (action === 'anon.run') {
    if (!body.trim()) return { ok: false, error: 'anon.run requires body.' };
    if (body.length > ANON_APEX_MAX_CHARS) {
      return { ok: false, error: `Anonymous Apex exceeds ${ANON_APEX_MAX_CHARS} characters.` };
    }
  }

  return {
    ok: true,
    plan: {
      action: action as ApexAction,
      className: className || undefined,
      methodNames: methodNames.length > 0 ? methodNames : undefined,
      body: body || undefined,
      path: path || undefined,
      limit,
      allowMutation: raw.allow_mutation === true,
      mutationLikely: action === 'anon.run' ? classifyAnonymousApex(body) : false
    }
  };
}

export function classifyAnonymousApex(body: string): boolean {
  return MUTATION_RE.test(body);
}

export function diagnoseApexSource(source: string, hintName?: string): { className: string | null; testMethods: string[]; lines: number } {
  const classMatch = source.match(/\b(?:public|private|global|virtual|abstract)?\s*(?:with\s+sharing|without\s+sharing|inherited\s+sharing)?\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/i);
  const testMethods = [...source.matchAll(/@isTest\b[\s\S]{0,200}?\b(?:static\s+)?(?:void|testmethod)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi)].map(
    (row) => row[1]
  );
  return {
    className: classMatch?.[1] ?? hintName ?? null,
    testMethods,
    lines: source.split(/\r?\n/).length
  };
}
