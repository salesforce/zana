import {
  ARTIFACT_PREVIEW_ROWS,
  QUERY_HARD_CAP,
  QUERY_RUN_MAX_LIMIT,
  QUERY_SAMPLE_LIMIT,
  type EnvelopeKind
} from './types.js';

export type SoqlAction = 'schema.search' | 'schema.describe' | 'query.validate' | 'query.sample' | 'query.run' | 'query.export';

export interface SoqlInput {
  action?: string;
  query?: string;
  sobject?: string;
  term?: string;
  limit?: number;
}

export interface SoqlPlan {
  action: SoqlAction;
  query?: string;
  sobject?: string;
  term?: string;
  limit: number;
  allRows: boolean;
  unbounded: boolean;
  envelope?: EnvelopeKind;
}

const ACTIONS: readonly SoqlAction[] = [
  'schema.search',
  'schema.describe',
  'query.validate',
  'query.sample',
  'query.run',
  'query.export'
];

export function parseSoqlInput(input: unknown): { ok: true; plan: SoqlPlan } | { ok: false; error: string } {
  const raw = input && typeof input === 'object' ? (input as SoqlInput) : {};
  const action = typeof raw.action === 'string' ? raw.action.trim() : '';
  if (!ACTIONS.includes(action as SoqlAction)) {
    return { ok: false, error: `Unknown sf_soql action. Use ${ACTIONS.join(', ')}.` };
  }
  const query = typeof raw.query === 'string' ? raw.query.trim() : '';
  const sobject = typeof raw.sobject === 'string' ? raw.sobject.trim() : '';
  const term = typeof raw.term === 'string' ? raw.term.trim() : '';
  const requestedLimit = typeof raw.limit === 'number' && Number.isFinite(raw.limit) ? Math.floor(raw.limit) : undefined;

  if (action === 'schema.search' && !term) return { ok: false, error: 'schema.search requires term.' };
  if (action === 'schema.describe' && !sobject) return { ok: false, error: 'schema.describe requires sobject.' };
  if (action.startsWith('query.') && !query) return { ok: false, error: `${action} requires query.` };

  if (query) {
    const inspection = inspectSoql(query);
    if (!inspection.ok) return inspection;
    const defaultLimit = action === 'query.sample' ? QUERY_SAMPLE_LIMIT : QUERY_RUN_MAX_LIMIT;
    const limit = clampLimit(requestedLimit ?? inspection.limit ?? defaultLimit, action);
    const unbounded =
      action === 'query.export'
      || inspection.allRows
      || (action !== 'query.sample'
        && (inspection.limit === null || (inspection.limit ?? 0) > QUERY_RUN_MAX_LIMIT))
      || (requestedLimit !== undefined && requestedLimit > QUERY_RUN_MAX_LIMIT);
    const envelope: EnvelopeKind | undefined =
      action === 'query.export'
        ? 'soql.export'
        : unbounded || inspection.allRows
          ? 'soql.unbounded'
          : undefined;
    return {
      ok: true,
      plan: {
        action: action as SoqlAction,
        query: inspection.normalized,
        sobject,
        term,
        limit,
        allRows: inspection.allRows,
        unbounded: Boolean(envelope),
        envelope
      }
    };
  }

  return {
    ok: true,
    plan: {
      action: action as SoqlAction,
      sobject,
      term,
      limit: QUERY_SAMPLE_LIMIT,
      allRows: false,
      unbounded: false
    }
  };
}

function clampLimit(limit: number, action: string): number {
  const cap = action === 'query.sample' ? QUERY_SAMPLE_LIMIT : QUERY_HARD_CAP;
  if (limit < 1) return 1;
  return Math.min(limit, cap);
}

export function inspectSoql(query: string): { ok: true; normalized: string; limit: number | null; allRows: boolean } | { ok: false; error: string } {
  const withoutComments = query
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withoutComments) return { ok: false, error: 'Query is empty.' };
  const head = withoutComments.slice(0, 12).toUpperCase();
  if (!head.startsWith('SELECT') && !head.startsWith('FIND')) {
    return { ok: false, error: 'Only SELECT / FIND queries are allowed.' };
  }
  if (/\b(INSERT|UPDATE|DELETE|UNDELETE|UPSERT|MERGE)\b/i.test(withoutComments)) {
    return { ok: false, error: 'DML is not allowed in sf_soql.' };
  }
  const allRows = /\bALL ROWS\b/i.test(withoutComments);
  const limitMatch = withoutComments.match(/\bLIMIT\s+(\d+)\b/i);
  const limit = limitMatch ? Number(limitMatch[1]) : null;
  return { ok: true, normalized: withoutComments, limit, allRows };
}

export function applyLimit(query: string, limit: number): string {
  const stripped = query.replace(/\s*;\s*$/, '');
  if (/\bLIMIT\s+\d+\b/i.test(stripped)) {
    return stripped.replace(/\bLIMIT\s+\d+\b/i, `LIMIT ${limit}`);
  }
  return `${stripped} LIMIT ${limit}`;
}

export function previewRecords(records: unknown): unknown[] {
  if (!Array.isArray(records)) return [];
  return records.slice(0, ARTIFACT_PREVIEW_ROWS).map((row) => {
    if (!row || typeof row !== 'object') return row;
    const copy = { ...(row as Record<string, unknown>) };
    delete copy.attributes;
    return copy;
  });
}
