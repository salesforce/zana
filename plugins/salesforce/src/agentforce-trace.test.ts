import { describe, expect, it } from 'vitest';
import { REHEARSAL_TRACE_REASON, TRACE_LIMITS, TraceCache, normalizeTrace, redactText, shouldRedactPath, unavailableTrace, valuePreview } from '../lib/agentforce-trace.js';
import { sourceLocations } from '../lib/agent-script-parse.js';

const locations = { topics: { refunds: 12, billing: 30 }, actions: { LookupOrder: 20 } };
const opts = { runId: 'run1', turn: 2, planId: 'plan1', path: 'force-app/Bot.agent', locations };

describe('normalizeTrace', () => {
  it('maps each step type to a TraceStep with latency and source lines', () => {
    const trace = normalizeTrace({ plan: [
      { type: 'UserInputStep', message: 'I want a refund' },
      { type: 'LLMExecutionStep', startExecutionTime: 1000, endExecutionTime: 1450, data: { prompt_name: 'router', prompt_content: 'x'.repeat(500), prompt_response: JSON.stringify({ tool_invocations: [{ function: { name: 'go_refunds' } }] }) } },
      { type: 'LLMStep', data: { agent_name: 'refunds', prompt_response: 'plain completion' }, executionLatency: 12.4 },
      { type: 'EnabledToolsStep', data: { agent_name: 'refunds', enabled_tools: ['LookupOrder', 'Escalate'] } },
      { type: 'UpdateTopicStep', topic: 'refunds' },
      { type: 'NodeEntryStateStep', data: { agent_name: 'billing' } },
      { type: 'FunctionStep', executionLatency: 220, function: { name: 'LookupOrder', input: { orderId: '801', auth: { token: 'SECRET' } }, output: { status: 'Shipped', items: [1, 2, 3, 4, 5] } } },
      { type: 'VariableUpdateStep', data: { variable_updates: [{ variable_name: 'orderId', variable_old_value: null, variable_new_value: '801' }, { variable_name: 'more', variable_new_value: 1 }] } },
      { type: 'VariableUpdateStep', data: { variable_updates: [{ variable_name: '__internal', variable_new_value: 1 }] } },
      { type: 'VariableUpdateStep', data: { variable_updates: [{ variable_name: 'userToken', variable_new_value: 'abc' }] } },
      { type: 'TransitionStep', data: { from_agent: 'router', to_agent: 'billing', transition_type: 'handoff' } },
      { type: 'RelatedAgentStep', relatedAgentName: 'Helper', steps: [{ type: 'PlannerResponseStep', message: 'nested reply' }] },
      { type: 'PlannerResponseStep', message: 'Your order shipped.' },
      { type: 'BrandNewStep', data: { a: 1 } },
      { type: 'BeforeReasoningStep', data: {} }
    ] }, opts);
    expect(trace).toMatchObject({ runId: 'run1', turn: 2, planId: 'plan1', available: true });
    const by = (kind: string) => trace.steps.filter(s => s.kind === kind);
    expect(by('input')[0]).toMatchObject({ label: 'User message', outputPreview: 'I want a refund' });
    expect(by('llm')[0]).toMatchObject({ label: 'router', latencyMs: 450, outputPreview: 'calls go_refunds' });
    expect(by('llm')[0]!.inputPreview!.length).toBeLessThanOrEqual(120);
    expect(by('llm')[1]).toMatchObject({ label: 'refunds', latencyMs: 12, outputPreview: 'plain completion' });
    expect(by('tools')[0]).toMatchObject({ label: 'Tools - refunds', outputPreview: 'LookupOrder, Escalate' });
    expect(by('topic').map(s => [s.label, s.source?.line])).toEqual([['refunds', 12], ['billing', 30]]);
    expect(by('topic')[0]!.source).toEqual({ path: 'force-app/Bot.agent', line: 12 });
    const action = by('action')[0]!;
    expect(action).toMatchObject({ label: 'LookupOrder', latencyMs: 220, source: { line: 20 } });
    expect(action.inputPreview).toContain('orderId: 801');
    expect(action.inputPreview).toContain('auth.token: ••••');
    expect(action.inputPreview).not.toContain('SECRET');
    expect(action.outputPreview).toContain('items: [5 items]');
    expect(action.outputPreview).toContain('(+');
    expect(by('variable').map(s => s.label)).toEqual(['orderId (+1)', 'userToken']);
    expect(by('variable')[1]).toMatchObject({ inputPreview: '••••', outputPreview: '••••' });
    expect(by('transition')[0]).toMatchObject({ label: 'router → billing', outputPreview: 'handoff', source: { line: 30 } });
    expect(by('delegate')[0]).toMatchObject({ label: 'Helper', outputPreview: 'nested reply' });
    expect(by('response')[0]).toMatchObject({ outputPreview: 'Your order shipped.' });
    expect(by('unknown')[0]).toMatchObject({ label: 'BrandNew' });
  });

  it('accepts alternate plan containers and ISO timestamps, and reports empty plans', () => {
    const iso = normalizeTrace({ trace: { steps: [{ type: 'PlannerResponseStep', message: 'x', startExecutionTime: '2026-01-01T00:00:00.000Z', endExecutionTime: '2026-01-01T00:00:01.500Z' }] } }, { runId: 'r', turn: 1 });
    expect(iso.steps[0]).toMatchObject({ latencyMs: 1500 });
    expect(iso.planId).toBeUndefined();
    expect(normalizeTrace({}, opts)).toMatchObject({ available: false, steps: [], reason: expect.stringContaining('no steps') });
    expect(normalizeTrace(null, opts).available).toBe(false);
    expect(normalizeTrace({ steps: [{ type: 'FunctionStep' }] }, { runId: 'r', turn: 1 }).steps[0]).toMatchObject({ kind: 'action', label: 'action' });
  });

  it('omits source when no path is known', () => {
    const t = normalizeTrace({ plan: [{ type: 'UpdateTopicStep', topic: 'refunds' }] }, { runId: 'r', turn: 1, locations });
    expect(t.steps[0]!.source).toBeUndefined();
  });

  it('caps steps at 200 and previews at 240 chars', () => {
    const plan = Array.from({ length: 450 }, (_, i) => ({ type: 'PlannerResponseStep', message: `m${i}${'y'.repeat(1000)}` }));
    const trace = normalizeTrace({ plan }, opts);
    expect(trace.steps).toHaveLength(TRACE_LIMITS.steps);
    expect(trace.reason).toBe('Showing 200 of 450 steps.');
    expect(trace.steps.every(s => (s.outputPreview?.length ?? 0) <= TRACE_LIMITS.preview)).toBe(true);
    expect(trace.steps[0]!.outputPreview!.endsWith('…')).toBe(true);
  });
});

describe('redaction', () => {
  it('flags sensitive paths like the toolkit does', () => {
    for (const p of ['token', 'user.email', 'auth', 'session', 'a.password', 'api_key', 'x[0].cookie', 'accessToken']) expect(shouldRedactPath(p), p).toBe(true);
    for (const p of ['orderId', 'tokenizer', 'status', 'authority']) expect(shouldRedactPath(p), p).toBe(false);
  });
  it('masks credentials echoed in free text', () => {
    const text = redactText('Authorization: Bearer abcdef123456789 mail me@example.com sid=00Dxx!AQ jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.sigsigsig');
    expect(text).not.toMatch(/abcdef123456789|me@example\.com|00Dxx|eyJhbGciOiJIUzI1/);
    expect(text).toContain('••••');
  });
  it('bounds structured previews and tolerates cycles and scalars', () => {
    const wide = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]));
    expect(valuePreview(wide)).toContain('(+28 more)');
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => valuePreview(cyclic)).not.toThrow();
    expect(valuePreview('hello')).toBe('hello');
    expect(valuePreview({})).toBe('{}');
    expect(valuePreview(null)).toBeUndefined();
    expect(valuePreview({ a: { b: { c: { d: 1 } } } })).toContain('{1 fields}');
    expect(valuePreview([[1, [2]]])).toContain('[1 item]');
  });
});

describe('helpers', () => {
  it('builds unavailable traces with a clipped reason', () => {
    expect(unavailableTrace({ runId: 'r' }, 'x'.repeat(400)).reason!.length).toBeLessThanOrEqual(300);
    expect(unavailableTrace({ runId: 'r', turn: 3, planId: 'p' }, REHEARSAL_TRACE_REASON)).toMatchObject({ turn: 3, planId: 'p', available: false });
    expect(REHEARSAL_TRACE_REASON).toMatch(/^Approximation/);
  });
  it('evicts least recently used traces', () => {
    const cache = new TraceCache(2);
    const t = (id: string) => unavailableTrace({ runId: id }, id);
    cache.set('a', t('a')); cache.set('b', t('b')); cache.get('a'); cache.set('c', t('c'));
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.size).toBe(2);
  });
});

describe('sourceLocations', () => {
  const src = `config:
  agent_name: "Bot"

start_agent router:
  description: "route"
  actions:
    Classify:
      target: "flow://Classify"

topic refunds:
  description: "refunds"
  actions:
    LookupOrder:
      target: "apex://Lookup"
      inputs:
        orderId: string
    Escalate:
      target: "flow://Escalate"
  reasoning:
    instructions: ->
      | hello

# topic ignored:
subagent billing:
  description: "x"
`;
  it('maps topics, start_agent and action declarations to 1-based lines', () => {
    const loc = sourceLocations(src);
    expect(loc.topics).toMatchObject({ router: 4, refunds: 10, billing: 24 });
    expect(loc.actions).toMatchObject({ Classify: 7, LookupOrder: 13, Escalate: 17 });
    expect(loc.actions.orderId).toBeUndefined();
    expect(loc.topics.ignored).toBeUndefined();
  });
  it('does not throw on malformed or empty source', () => {
    expect(sourceLocations('')).toEqual({ topics: {}, actions: {} });
    expect(() => sourceLocations('topic ???:\n  actions:\n    x\n')).not.toThrow();
    expect(sourceLocations('start_agent:\n').topics).toEqual({ start_agent: 1 });
  });
});
