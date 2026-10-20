/** Shared by the renderer, preview RPCs and CLI adapter. Unset variables are omitted. */
export const CONTEXT_TYPES = ['Text', 'Boolean', 'Number', 'Date', 'DateTime', 'Json', 'List', 'Object', 'Money', 'Ref'] as const;
export type ContextType = typeof CONTEXT_TYPES[number];
export interface PreviewContextVariable { name: string; type: ContextType; value: unknown }
export interface PreviewContextField {
  name: string;
  type: ContextType;
  label: string;
  description?: string;
  source?: string;
  defaultValue?: unknown;
}
export const CONTEXT_LIMITS = { count: 100, bytes: 64_000 } as const;
const NAME = /^(?:\$Context\.)?[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** Returns a detached JSON snapshot. Validation is repeated at the trusted RPC boundary. */
function parseStrictPreviewContext(value: unknown): PreviewContextVariable[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > CONTEXT_LIMITS.count) throw Error('Context must be an array of at most 100 variables.');
  const seen = new Set<string>();
  const rows = value.map((entry): PreviewContextVariable => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw Error('Each context variable needs name, type and value.');
    const row = entry as Record<string, unknown>;
    if (typeof row.name !== 'string' || !NAME.test(row.name)) throw Error('Use a variable name such as locale or $Context.sessionId.');
    if (seen.has(row.name)) throw Error(`Duplicate context variable: ${row.name}.`);
    seen.add(row.name);
    if (!CONTEXT_TYPES.includes(row.type as ContextType)) throw Error(`Choose a supported type for ${row.name}.`);
    const v = row.value, type = row.type as ContextType;
    const valid = v === null || (type === 'Boolean' ? typeof v === 'boolean'
      : type === 'Number' ? typeof v === 'number' && Number.isFinite(v)
      : type === 'Json' ? v === null || typeof v === 'object' && !Array.isArray(v)
      : type === 'List' || type === 'Object' ? Array.isArray(v)
      : typeof v === 'string' && (type !== 'Date' || /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v)
        && (type !== 'DateTime' || /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))));
    if (!valid) throw Error(`${row.name} needs a ${type} value.`);
    return { name: row.name, type, value: v };
  });
  let json: string;
  try { json = JSON.stringify(rows); } catch { throw Error('Context values must be JSON.'); }
  if (new TextEncoder().encode(json).length > CONTEXT_LIMITS.bytes) throw Error('Context values must fit within 64 KB.');
  // JSON cannot represent undefined, functions, NaN, cycles or bigint nested inside complex values.
  const plain = JSON.parse(json) as PreviewContextVariable[];
  const check = (v: unknown, depth = 0): void => {
    if (depth > 20) throw Error('Context values may be nested at most 20 levels.');
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v !== 'object') throw Error('Context values must be JSON.');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw Error('Context values must be plain JSON.');
    for (const item of Object.values(v)) check(item, depth + 1);
  };
  for (const row of rows) check(row.value);
  return plain;
}

export interface ContextValidation {
  values: PreviewContextVariable[];
  fieldErrors: Record<string, string>;
  errors: string[];
}

/** All field issues at once; never return a partial payload that could start a different run. */
export function validatePreviewContext(value: unknown): ContextValidation {
  const fieldErrors: Record<string, string> = Object.create(null);
  const errors: string[] = [];
  if (Array.isArray(value) && value.length <= CONTEXT_LIMITS.count) {
    const seen = new Set<string>();
    for (const row of value) {
      const name = row && typeof row === 'object' ? (row as Record<string, unknown>).name : undefined;
      try {
        parseStrictPreviewContext([row]);
        if (seen.has(name as string)) fieldErrors[name as string] = `Duplicate context variable: ${name}.`;
        seen.add(name as string);
      } catch (error) {
        const message = (error as Error).message;
        if (typeof name === 'string' && NAME.test(name)) fieldErrors[name] = message;
        else errors.push(message);
      }
    }
  }
  if (errors.length || Object.keys(fieldErrors).length) return { values: [], fieldErrors, errors };
  try { return { values: parseStrictPreviewContext(value), fieldErrors, errors }; }
  catch (error) { return { values: [], fieldErrors, errors: [(error as Error).message] }; }
}

/** Strict adapter used by RPCs, saved scenarios and the CLI. */
export function parsePreviewContext(value: unknown): PreviewContextVariable[] {
  const result = validatePreviewContext(value);
  const error = result.errors[0] || Object.values(result.fieldErrors)[0];
  if (error) throw Error(error);
  return result.values;
}

export type ContextEntry = { type: ContextType; text: string; isNull?: boolean };

/** Keep incomplete input in the renderer, and decode independently before shared validation. */
export function validateContextEntries(entries: Record<string, ContextEntry>): ContextValidation {
  const decoded: PreviewContextVariable[] = [];
  const fieldErrors: Record<string, string> = Object.create(null);
  for (const [name, entry] of Object.entries(entries)) {
    try {
      const value = entry.isNull ? null : entry.type === 'Boolean' ? entry.text === 'true' ? true : entry.text === 'false' ? false : entry.text
        : entry.type === 'Number' ? entry.text.trim() ? Number(entry.text) : NaN
        : ['Json', 'List', 'Object'].includes(entry.type) ? JSON.parse(entry.text) : entry.text;
      decoded.push({ name, type: entry.type, value });
    } catch { fieldErrors[name] = 'Enter valid JSON.'; }
  }
  const result = validatePreviewContext(decoded);
  Object.assign(fieldErrors, result.fieldErrors);
  for (const [name, entry] of Object.entries(entries)) {
    if (fieldErrors[name] && entry.type === 'Number') fieldErrors[name] = 'Enter a number, such as 0 or 3.';
  }
  return { values: Object.keys(fieldErrors).length ? [] : result.values, fieldErrors, errors: result.errors };
}
