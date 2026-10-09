import type { TraceStep, TurnTrace } from './studio-contract.js';
import type { AgentSourceLocations } from './agent-script-parse.js';

/** Hard limits: a planner trace can be enormous, the renderer only ever needs a readable digest. */
export const TRACE_LIMITS = { steps: 200, preview: 240, fields: 12, nested: 3, cachePerSession: 50 } as const;
export const REHEARSAL_TRACE_REASON = 'Approximation - no runtime trace. AI rehearsal does not run the Agentforce planner.';

type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Modeled on the vendored toolkit's shouldRedactPath (sf-agentic-tools trace-digest). */
export function shouldRedactPath(path: string): boolean {
  // camelCase names (accessToken, userEmail) count as separate words.
  return /(^|[._\-\[])(authorization|auth|cookie|email|password|passwd|phone|secret|session|token|apikey|api_key|ssn|credential)([._\-\]]|$)/i.test(path.replace(/([a-z0-9])([A-Z])/g, '$1_$2'));
}

const MASK = '••••';
function clip(text: string, max: number = TRACE_LIMITS.preview): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
/** Free text can still carry credentials the planner echoed; mask the obvious shapes before clipping. */
export function redactText(text: string): string {
  return text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASK}`)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, MASK)
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, MASK)
    .replace(/\b(sid|access_token|refresh_token|password)=([^\s&;]+)/gi, `$1=${MASK}`);
}
function textPreview(value: unknown, max: number = TRACE_LIMITS.preview): string | undefined {
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : safeJson(value);
  return text ? clip(redactText(text), max) : undefined;
}
function safeJson(value: unknown): string {
  try { return JSON.stringify(value) ?? ''; } catch { return ''; }
}

/** Flattens a value to `path: value` pairs, masking sensitive paths, bounded in fields, depth and array items. */
export function valuePreview(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const parts: string[] = [];
  let omitted = 0;
  const add = (path: string, raw: unknown) => {
    if (parts.length >= TRACE_LIMITS.fields) { omitted++; return; }
    const shown = shouldRedactPath(path) ? MASK : redactText(typeof raw === 'string' ? raw : safeJson(raw ?? null));
    parts.push(path ? `${path}: ${shown}` : shown);
  };
  const walk = (raw: unknown, path: string, depth: number) => {
    if (parts.length >= TRACE_LIMITS.fields) { omitted++; return; }
    if (raw === null || typeof raw !== 'object') { add(path, raw); return; }
    if (Array.isArray(raw)) {
      add(path, `[${raw.length} item${raw.length === 1 ? '' : 's'}]`);
      if (depth >= 2) return;
      raw.slice(0, TRACE_LIMITS.nested).forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      omitted += Math.max(0, raw.length - TRACE_LIMITS.nested);
      return;
    }
    const entries = Object.entries(raw);
    if (!entries.length) { add(path, '{}'); return; }
    if (depth >= 3) { add(path, `{${entries.length} fields}`); return; }
    for (const [key, child] of entries) walk(child, path ? `${path}.${key}` : key, depth + 1);
  };
  walk(value, '', 0);
  const joined = parts.join('; ') + (omitted ? ` (+${omitted} more)` : '');
  return clip(joined);
}

function epoch(value: unknown): number | undefined {
  const n = num(value);
  if (n !== undefined) return n;
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isNaN(t) ? undefined : t;
}
function latency(step: Row): number | undefined {
  const explicit = num(step.executionLatency) ?? num(rec(step.data).execution_latency);
  if (explicit !== undefined && explicit >= 0) return Math.round(explicit);
  const start = epoch(step.startExecutionTime);
  const end = epoch(step.endExecutionTime);
  return start !== undefined && end !== undefined && end >= start ? Math.round(end - start) : undefined;
}
const isInternal = (name: string | undefined) => !name || name.startsWith('__') || name.startsWith('AgentScriptInternal_');

export interface NormalizeTraceOptions {
  runId: string;
  turn: number;
  planId?: string;
  /** Source file the script was compiled from; steps only get a `source` when this is set. */
  path?: string;
  locations?: AgentSourceLocations;
}

function planSteps(raw: unknown): Row[] {
  const body = rec(raw);
  const candidates = [body.plan, body.steps, rec(body.trace).plan, rec(body.trace).steps, rec(body.data).plan, rec(body.data).steps];
  const found = candidates.find(Array.isArray);
  return Array.isArray(found) ? found.map(rec) : [];
}

/** Converts a raw Preview API plan into at most {@link TRACE_LIMITS.steps} render-ready, redacted steps. */
export function normalizeTrace(raw: unknown, opts: NormalizeTraceOptions): TurnTrace {
  const base = { runId: opts.runId, turn: opts.turn, ...(opts.planId ? { planId: opts.planId } : {}) };
  const rows = planSteps(raw);
  if (!rows.length) return { ...base, available: false, reason: 'The plan contains no steps.', steps: [] };
  const at = (kind: 'topics' | 'actions', name: string | undefined): TraceStep['source'] => {
    const line = name && opts.path ? opts.locations?.[kind][name] : undefined;
    return line && opts.path ? { path: opts.path, line } : undefined;
  };
  const steps: TraceStep[] = [];
  for (const row of rows) {
    if (steps.length >= TRACE_LIMITS.steps) break;
    const step = convert(row, at);
    if (step) steps.push({ ...step, ...(latency(row) !== undefined ? { latencyMs: latency(row) } : {}) });
  }
  return { ...base, available: true, ...(rows.length > steps.length ? { reason: `Showing ${steps.length} of ${rows.length} steps.` } : {}), steps };
}

function convert(step: Row, at: (kind: 'topics' | 'actions', name: string | undefined) => TraceStep['source']): TraceStep | null {
  const type = str(step.type) ?? 'UnknownStep';
  const data = rec(step.data);
  const withSource = (s: TraceStep, source: TraceStep['source']): TraceStep => (source ? { ...s, source } : s);
  switch (type) {
    case 'UserInputStep':
      return { kind: 'input', label: 'User message', outputPreview: textPreview(step.message) };
    case 'LLMStep':
    case 'LLMExecutionStep': {
      const name = str(data.prompt_name) ?? str(data.agent_name) ?? 'LLM call';
      const response = str(data.prompt_response);
      let tools: string[] = [];
      try {
        const parsed = rec(JSON.parse(response ?? 'null'));
        tools = (Array.isArray(parsed.tool_invocations) ? parsed.tool_invocations : []).map(t => str(rec(rec(t).function).name)).filter((n): n is string => Boolean(n));
      } catch { /* plain-text completion */ }
      return { kind: 'llm', label: name, inputPreview: textPreview(data.prompt_content, 120), outputPreview: tools.length ? clip(`calls ${tools.join(', ')}`) : textPreview(response) };
    }
    case 'EnabledToolsStep': {
      const tools = (Array.isArray(data.enabled_tools) ? data.enabled_tools : []).filter((t): t is string => typeof t === 'string');
      return { kind: 'tools', label: str(data.agent_name) ? `Tools - ${str(data.agent_name)}` : 'Tools enabled', outputPreview: tools.length ? clip(tools.join(', ')) : undefined };
    }
    case 'UpdateTopicStep': {
      const topic = str(step.topic) ?? 'topic';
      return withSource({ kind: 'topic', label: topic }, at('topics', topic));
    }
    case 'NodeEntryStateStep':
    case 'BeforeReasoningIterationStep':
    case 'BeforeReasoningStep':
    case 'AfterReasoningStep': {
      const name = str(data.agent_name);
      return name ? withSource({ kind: 'topic', label: name }, at('topics', name)) : null;
    }
    case 'FunctionStep':
    case 'FunctionCallStep': {
      const fn = rec(step.function);
      const name = str(fn.name) ?? 'action';
      return withSource({ kind: 'action', label: name, inputPreview: valuePreview(fn.input), outputPreview: valuePreview(fn.output) }, at('actions', name));
    }
    case 'VariableUpdateStep': {
      const updates = (Array.isArray(data.variable_updates) ? data.variable_updates : []).map(rec).filter(u => !isInternal(str(u.variable_name)));
      if (!updates.length) return null;
      const first = updates[0]!;
      const name = str(first.variable_name)!;
      const old = 'variable_old_value' in first ? first.variable_old_value : first.variable_past_value;
      const mask = shouldRedactPath(name);
      return {
        kind: 'variable', label: updates.length > 1 ? `${name} (+${updates.length - 1})` : name,
        inputPreview: mask ? MASK : textPreview(old, 80), outputPreview: mask ? MASK : textPreview(first.variable_new_value, 80)
      };
    }
    case 'TransitionStep': {
      const to = str(data.to_agent);
      return withSource({ kind: 'transition', label: `${str(data.from_agent) ?? '?'} → ${to ?? '?'}`, outputPreview: str(data.transition_type) }, at('topics', to));
    }
    case 'PlannerResponseStep':
      return { kind: 'response', label: 'Response', outputPreview: textPreview(step.message) };
    case 'RelatedAgentStep': {
      const nested = (Array.isArray(step.steps) ? step.steps : []).map(rec).find(s => s.type === 'PlannerResponseStep');
      return { kind: 'delegate', label: str(step.relatedAgentName) ?? str(step.relatedAgentApiName) ?? 'Related agent', outputPreview: textPreview(nested?.message) };
    }
    default:
      return { kind: 'unknown', label: type.replace(/Step$/, '') || 'Step', outputPreview: textPreview(data) };
  }
}

export function unavailableTrace(opts: { runId: string; turn?: number; planId?: string }, reason: string): TurnTrace {
  return { runId: opts.runId, turn: opts.turn ?? 0, ...(opts.planId ? { planId: opts.planId } : {}), available: false, reason: clip(reason, 300), steps: [] };
}

/** Insertion-ordered LRU: successful traces are immutable once the planner finished, so re-fetching is wasted quota. */
export class TraceCache {
  private rows = new Map<string, TurnTrace>();
  constructor(private readonly max: number = TRACE_LIMITS.cachePerSession) {}
  get(planId: string): TurnTrace | undefined {
    const hit = this.rows.get(planId);
    if (hit) { this.rows.delete(planId); this.rows.set(planId, hit); }
    return hit;
  }
  set(planId: string, trace: TurnTrace): void {
    this.rows.delete(planId);
    this.rows.set(planId, trace);
    while (this.rows.size > this.max) this.rows.delete(this.rows.keys().next().value as string);
  }
  get size(): number { return this.rows.size; }
}
