import { describe, expect, it, vi } from 'vitest';
import { AgentforceLab } from '../lib/agentforce-lab.js';
import { DEFAULT_LAB_MODEL, LAB_SCENARIOS, parseLabScenario, parseLabVerdict } from '../lib/agentforce-lab-contract.js';
import type { ResolvedOrg } from '../lib/types.js';
import type { SfapHost } from '../lib/agentforce-transport.js';
import { AGENT_SOURCE_MAX } from '../lib/studio-contract.js';

function setup() {
  let scope = 'project-a'; let time = 100;
  const request = vi.fn(async (_token: string, path: string, _body?: unknown, _host?: SfapHost, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    let body: Record<string, unknown>;
    if (path.endsWith('/authoring/scripts')) body = { status: 'success', compiledArtifact: { globalConfiguration: {} } };
    else if (path.endsWith('/preview/sessions')) body = { sessionId: 'remote/1', messages: [{ message: 'Welcome' }] };
    else if (path.endsWith('/messages')) body = { messages: [{ message: 'I can help you find an order.', planId: 'plan1' }] };
    else body = { generationDetails: { generations: [{ content: 'I need help with my order.' }] } };
    return { host: 'test.api.salesforce.com' as SfapHost, body };
  });
  const bootstrap = vi.fn(async () => 'PRIVATE_JWT');
  const connect = vi.fn(async () => ({ alias: 'dev', orgId: 'org1', instanceUrl: 'https://fixture.my.salesforce.com', accessToken: 'PRIVATE_TOKEN' } as ResolvedOrg));
  const lab = new AgentforceLab({ connect, scope: () => scope, now: () => time, transport: { request, bootstrap } });
  const args = { engine: 'preview', source: 'config:\n  name: Helper', scenario: { ...LAB_SCENARIOS[0].scenario, maxTurns: 2 } };
  return { lab, request, bootstrap, connect, args, setScope: (v: string) => { scope = v; }, advance: () => { time += 31 * 60_000; } };
}
describe('Agentforce lab', () => {
  it('sends initial typed context once, pins a detached snapshot and rejects invalid values before connecting', async () => {
    const { lab, request, args, connect } = setup();
    await expect(lab.start({ ...args, contextVariables: [{ name: 'verified', type: 'Boolean', value: 'false' }] })).rejects.toThrow('Boolean');
    expect(connect).not.toHaveBeenCalled();
    const contextVariables = [{ name: '$Context.sessionId', type: 'Text', value: '' }, { name: 'verified', type: 'Boolean', value: false }, { name: 'retryCount', type: 'Number', value: 0 }];
    const run = await lab.start({ ...args, contextVariables });
    expect(request.mock.calls[1]![2]).toMatchObject({ variables: contextVariables, enableSimulationMode: true });
    contextVariables[0]!.value = 'changed';
    expect(run.contextVariables?.[0]!.value).toBe('');
    run.contextVariables![0]!.value = 'also changed';
    const reply = await lab.send({ id: run.id, text: 'hello' });
    expect(request.mock.calls.at(-1)![2]).toMatchObject({ variables: [] });
    expect(reply.contextVariables?.[0]!.value).toBe('');
    const rehearsal = await lab.start({ ...args, engine: 'rehearsal', contextVariables });
    await lab.send({ id: rehearsal.id, text: 'hello' });
    expect(JSON.stringify(request.mock.calls.at(-1)![2])).toContain('Initial context variables');
  });
  it('compiles a snapshot, pins its org/host and never exposes credentials or enables actions', async () => {
    const { lab, request, args, connect } = setup();
    const session = await lab.start(args);
    expect(session).toMatchObject({ engine: 'preview', orgAlias: 'dev', turns: [{ role: 'agent', text: 'Welcome' }], model: DEFAULT_LAB_MODEL });
    expect(session.sourceHash).toHaveLength(64);
    expect(JSON.stringify(session)).not.toMatch(/PRIVATE|remote\/1/);
    expect(request.mock.calls[1][2]).toMatchObject({ enableSimulationMode: true, bypassUser: false, agentDefinition: { agentVersion: { developerName: 'v0' } } });
    const result = await lab.send({ id: session.id, text: 'Hello' });
    expect(result.busy).toBe(false);
    expect(result.turns.at(-1)).toMatchObject({ role: 'agent', text: 'I can help you find an order.', planId: 'plan1', latencyMs: 0 });
    expect(request.mock.calls.at(-1)).toEqual(['PRIVATE_JWT', expect.stringContaining('remote%2F1/messages'), expect.objectContaining({ message: { sequenceId: 1, type: 'Text', text: 'Hello' } }), 'test.api.salesforce.com', expect.any(AbortSignal)]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(lab.end({ id: session.id }).closed).toBe(true);
    await expect(lab.send({ id: session.id, text: 'Again' })).rejects.toThrow('fresh run');
  });
  it('runs real actions only for an explicit live start', async () => {
    const { lab, request, args } = setup();
    await lab.start({ ...args, live: true });
    expect(request.mock.calls[1][2]).toMatchObject({ enableSimulationMode: false });
    await lab.start({ ...args, live: 'yes' });
    expect(request.mock.calls[3][2]).toMatchObject({ enableSimulationMode: true });
  });
  it('uses AI interpretation separately, reverses no roles and evaluates actual server evidence', async () => {
    const { lab, request, args } = setup();
    const s = await lab.start({ ...args, engine: 'rehearsal' });
    expect(request).not.toHaveBeenCalled();
    await lab.send({ id: s.id, text: 'Hello' });
    expect(request.mock.calls[0][2]).toMatchObject({ messages: [{ role: 'system', content: expect.stringContaining('approximation') }, { role: 'user', content: 'Hello' }] });
    await expect(lab.next({ id: s.id })).resolves.toEqual({ text: 'I need help with my order.' });
    request.mockResolvedValueOnce({ host: 'api.salesforce.com', body: { generationDetails: { generations: [{ content: JSON.stringify({ outcome: 'inconclusive', reason: 'No action evidence', evidence: ['The customer only said hello.'] }) }] } } });
    const evaluation = await lab.evaluate({ id: s.id, transcript: [{ text: 'FORGED' }] });
    expect(evaluation.session.busy).toBe(false);
    expect(evaluation.verdict.outcome).toBe('inconclusive');
    expect(JSON.stringify(request.mock.calls.at(-1)?.[2])).toContain('Hello');
    expect(JSON.stringify(request.mock.calls.at(-1)?.[2])).not.toContain('FORGED');
  });
  it('refuses wrong project, expired session, incomplete transcript and a missing scenario', async () => {
    const { lab, setScope, advance, args } = setup();
    const s = await lab.start(args);
    setScope('project-b');
    await expect(lab.send({ id: s.id, text: 'Hello' })).rejects.toThrow('another project');
    setScope('project-a');
    await expect(lab.evaluate({ id: s.id })).rejects.toThrow('complete conversation');
    const noScenario = await lab.start({ ...args, scenario: undefined });
    await expect(lab.next({ id: noScenario.id })).rejects.toThrow('Choose a scenario');
    advance();
    expect(() => lab.end({ id: s.id })).toThrow('expired');
  });
  it('fails closed on empty/Failure replies and malformed evaluator output', async () => {
    const { lab, request, args } = setup();
    const s = await lab.start(args);
    request.mockResolvedValueOnce({ host: 'test.api.salesforce.com', body: { messages: [] } });
    await expect(lab.send({ id: s.id, text: 'Hi' })).rejects.toThrow('no reply');
    await expect(lab.evaluate({ id: s.id })).rejects.toThrow('fresh run');
    expect(lab.end({ id: s.id }).failed).toBe(true);
    const another = await lab.start(args);
    request.mockResolvedValueOnce({ host: 'test.api.salesforce.com', body: { messages: [{ type: 'Failure', message: 'Oops' }] } });
    await expect(lab.send({ id: another.id, text: 'Hi' })).rejects.toThrow('failed agent response');
    const third = await lab.start(args);
    await lab.send({ id: third.id, text: 'Hi' });
    await expect(lab.evaluate({ id: third.id })).rejects.toThrow();
    expect(lab.end({ id: third.id }).failed).toBe(true);
  });
  it('enforces sequential calls, cancellation, session capacity and turn budgets', async () => {
    const { lab, request, args } = setup();
    const s = await lab.start({ ...args, scenario: { ...args.scenario, maxTurns: 1 } });
    await lab.send({ id: s.id, text: 'Hi' });
    await expect(lab.next({ id: s.id })).rejects.toThrow('budget');
    const two = await lab.start({ ...args, scenario: { ...args.scenario, maxTurns: 1 } });
    await lab.send({ id: two.id, text: 'Hi' });
    await expect(lab.send({ id: two.id, text: 'Again' })).rejects.toThrow('budget');
    const three = await lab.start(args);
    let resolve!: (value: { host: SfapHost; body: Record<string, unknown> }) => void;
    request.mockImplementationOnce((_token, _path, _body, _host, signal) => new Promise((r, reject) => { resolve = r; signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }); }));
    const pending = lab.send({ id: three.id, text: 'Hi' });
    await expect(lab.send({ id: three.id, text: 'Duplicate' })).rejects.toThrow('already running');
    lab.end({ id: three.id });
    await expect(pending).rejects.toThrow('Aborted');
    resolve({ host: 'api.salesforce.com', body: {} });
    for (let i = 0; i < 10; i++) await lab.start(args);
    await expect(lab.start(args)).rejects.toThrow('Too many');
    lab.dispose();
    await expect(lab.send({ id: two.id, text: 'Hi' })).rejects.toThrow('expired');
  });
  it('validates before connecting and releases a failed start slot', async () => {
    const { lab, request, args, connect } = setup();
    for (const invalid of [{}, { ...args, engine: 'live' }, { ...args, model: '../evil' }, { ...args, source: 'x'.repeat(AGENT_SOURCE_MAX + 1) }, { ...args, scenario: { ...args.scenario, maxTurns: 90 } }]) await expect(lab.start(invalid)).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
    request.mockResolvedValueOnce({ host: 'api.salesforce.com', body: { status: 'failed' } });
    await expect(lab.start(args)).rejects.toThrow('compile');
    const s = await lab.start({ ...args, engine: 'rehearsal', scenario: undefined });
    request.mockResolvedValueOnce({ host: 'api.salesforce.com', body: {} });
    await expect(lab.send({ id: s.id, text: 'hello' })).rejects.toThrow('AI response');
  });
  it('asks authorize about the connected org before any Salesforce call, and a refusal frees the slot', async () => {
    const { request, bootstrap, connect, args } = setup();
    const authorize = vi.fn(async () => { throw new Error('Operator cancelled the run.'); });
    const lab = new AgentforceLab({ connect, scope: () => 'project-a', authorize, transport: { request, bootstrap } });
    for (let i = 0; i < 13; i++) await expect(lab.start({ ...args, threadId: 't'.repeat(200) })).rejects.toThrow('Operator cancelled');
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ alias: 'dev' }), { engine: 'preview', threadId: 't'.repeat(128), startedByUser: false });
    expect(bootstrap).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    authorize.mockResolvedValue(undefined);
    await lab.start({ ...args, engine: 'rehearsal', threadId: 42, startedByUser: true });
    expect(authorize).toHaveBeenLastCalledWith(expect.anything(), { engine: 'rehearsal', threadId: '', startedByUser: true });
    expect(bootstrap).toHaveBeenCalledOnce();
  });
});
describe('scenario and verdict contracts', () => {
  it('rejects oversized/empty criteria, invalid turn limits and false green evidence', () => {
    for (const value of [null, [], { maxTurns: 0 }, { ...LAB_SCENARIOS[0].scenario, persona: '' }, { ...LAB_SCENARIOS[0].scenario, criteria: 'x'.repeat(4001) }]) expect(() => parseLabScenario(value)).toThrow();
    for (const value of ['{}', '{"outcome":"pass","reason":"Fine","evidence":[]}', '{"outcome":"maybe"}', '{"outcome":"pass","reason":"Fine","evidence":[3]}']) expect(() => parseLabVerdict(value)).toThrow();
    expect(parseLabVerdict('```json\n{"outcome":"fail","reason":"Out of scope","evidence":["Turn 2: unrelated response"]}\n```').outcome).toBe('fail');
  });
});

describe('retained lab runs and server-owned role-play', () => {
  it('lists bounded project/agent/org runs and reconnects original source, context and owner without credentials', async () => {
    const h = setup();
    const contextVariables = [{ name: 'verified', type: 'Boolean', value: false }];
    const first = await h.lab.start({ ...h.args, path: 'Bot.agent', threadId: 'original-thread', contextVariables, live: true });
    const otherAgent = await h.lab.start({ ...h.args, engine: 'rehearsal', path: 'Other.agent' });
    expect(h.lab.list({ path: 'Bot.agent', orgAlias: 'dev', engine: 'preview' })).toMatchObject([{ id: first.id, live: true, busy: false, threadId: 'original-thread' }]);
    expect(h.lab.list({ orgAlias: 'different' })).toEqual([]);
    expect(h.lab.list({ path: 'missing.agent' })).toEqual([]);
    expect(h.lab.list({ engine: 'rehearsal' }).map(s => s.id)).toEqual([otherAgent.id]);
    const reconnected = h.lab.get({ id: first.id, path: 'Bot.agent', orgAlias: 'dev', includeSource: true });
    expect(reconnected).toMatchObject({ source: h.args.source, scenario: h.args.scenario, contextVariables, createdAt: 100, updatedAt: 100 });
    expect(JSON.stringify(reconnected)).not.toMatch(/PRIVATE|remote\/1/);
    expect(h.lab.list({})[0]).not.toHaveProperty('source');
    reconnected.scenario!.goal = 'forged';
    reconnected.contextVariables![0]!.value = true;
    reconnected.turns[0]!.text = 'forged';
    expect(h.lab.get({ id: first.id })).toMatchObject({ scenario: h.args.scenario, contextVariables, turns: [{ text: 'Welcome' }] });
    await h.lab.send({ id: first.id, text: 'Hello' });
    const summary = h.lab.list({ path: 'Bot.agent', summaryOnly: true })[0]!;
    expect(summary).toMatchObject({ id: first.id, turns: [], turnCount: 1, threadId: 'original-thread', live: true });
    for (const field of ['source', 'scenario', 'contextVariables']) expect(summary).not.toHaveProperty(field);
    for (const input of [{ path: 'Other.agent' }, { orgAlias: 'different' }, { path: 3 }, { orgAlias: '' }]) {
      expect(() => h.lab.get({ id: first.id, ...input })).toThrow();
      await expect(h.lab.send({ id: first.id, text: 'hi', ...input })).rejects.toThrow();
      expect(() => h.lab.end({ id: first.id, ...input })).toThrow();
    }
    for (const input of [{ path: '' }, { orgAlias: 7 }, { engine: 'live' }, { path: 'x'.repeat(513) }]) expect(() => h.lab.list(input)).toThrow();
    h.setScope('another-project');
    expect(h.lab.list({})).toEqual([]);
    expect(() => h.lab.get({ id: first.id })).toThrow('another project');
    h.setScope('project-a');
    h.lab.end({ id: first.id });
    expect(h.lab.list({}).map(s => s.id)).toEqual([otherAgent.id]);
    expect(h.lab.list({ includeClosed: true })).toHaveLength(2);
    h.advance();
    expect(h.lab.list({ includeClosed: true })).toEqual([]);
  });

  it('continues autonomous turns after the start reply and exposes detached progress and final verdict on reconnect', async () => {
    const h = setup();
    const original = h.request.getMockImplementation()!;
    let releaseFirst!: () => void;
    const firstReply = new Promise<void>(resolve => { releaseFirst = resolve; });
    let messages = 0;
    h.request.mockImplementation(async (token, path, body, host, signal) => {
      if (path.endsWith('/messages') && ++messages === 1) await firstReply;
      if (path.includes('/chat-generations') && JSON.stringify(body).includes('Evaluate a test transcript')) return { host: 'test.api.salesforce.com', body: { generationDetails: { generations: [{ content: JSON.stringify({ outcome: 'pass', reason: 'Goal reached', evidence: ['The agent answered the customer.'] }) }] } } };
      return original(token, path, body, host, signal);
    });
    const started = await h.lab.run({ ...h.args, path: 'Bot.agent', threadId: 'original-thread' });
    expect(started).toMatchObject({ busy: true, execution: { phase: 'opening', completedTurns: 0, totalTurns: 2 } });
    expect(h.lab.get({ id: started.id })).toMatchObject({ busy: true, execution: { phase: 'agent' }, turns: [{ role: 'agent' }, { role: 'user', text: h.args.scenario.opening }] });
    await expect(h.lab.send({ id: started.id, text: 'interleave' })).rejects.toThrow('role-play is running');
    await expect(h.lab.next({ id: started.id })).rejects.toThrow('role-play is running');
    await expect(h.lab.evaluate({ id: started.id })).rejects.toThrow('role-play is running');
    h.advance(); // A server task is never expired merely because its UI has gone away.
    expect(h.lab.list({ path: 'Bot.agent' })).toHaveLength(1);
    releaseFirst();
    await vi.waitFor(() => expect(h.lab.get({ id: started.id }).execution?.phase).toBe('done'));
    const finished = h.lab.get({ id: started.id, includeSource: true });
    expect(finished).toMatchObject({ busy: false, closed: false, failed: false, source: h.args.source, execution: { completedTurns: 2, totalTurns: 2, verdict: { outcome: 'pass' } } });
    expect(finished.turns.filter(t => t.role === 'user')).toHaveLength(2);
    finished.execution!.verdict!.evidence[0] = 'forged';
    expect(h.lab.get({ id: started.id }).execution!.verdict!.evidence[0]).toBe('The agent answered the customer.');
    expect(h.connect).toHaveBeenCalledOnce();
    h.lab.dispose();
    expect(() => h.lab.get({ id: started.id })).toThrow('expired');
  });

  it('records background errors without unhandled rejection and rejects missing scenarios before connecting', async () => {
    const h = setup();
    await expect(h.lab.run({ ...h.args, scenario: undefined })).rejects.toThrow('Choose a scenario');
    expect(h.connect).not.toHaveBeenCalled();
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (token, path, body, host, signal) => {
      if (path.endsWith('/messages')) throw Error('Turn connection lost');
      return original(token, path, body, host, signal);
    });
    const started = await h.lab.run(h.args);
    await vi.waitFor(() => expect(h.lab.get({ id: started.id })).toMatchObject({ busy: false, failed: true, execution: { phase: 'error', error: 'Turn connection lost', completedTurns: 0 } }));
    expect(h.lab.list({})[0]?.execution?.phase).toBe('error');
  });

  it('stops only on explicit End or backend disposal and never sends another turn after cancellation', async () => {
    const h = setup();
    const original = h.request.getMockImplementation()!;
    let entered = false;
    h.request.mockImplementation(async (token, path, body, host, signal) => {
      if (path.endsWith('/messages')) {
        entered = true;
        return await new Promise((resolve, reject) => { signal?.addEventListener('abort', () => reject(Error('Stopped')), { once: true }); });
      }
      return original(token, path, body, host, signal);
    });
    const started = await h.lab.run(h.args);
    expect(entered).toBe(true);
    expect(h.lab.end({ id: started.id })).toMatchObject({ closed: true, execution: { phase: 'stopped' } });
    await vi.waitFor(() => expect(h.lab.get({ id: started.id })).toMatchObject({ busy: false, failed: false, execution: { phase: 'stopped', completedTurns: 0 } }));
    expect(h.request.mock.calls.filter(call => call[1].endsWith('/messages'))).toHaveLength(1);
    const next = await h.lab.run(h.args);
    h.lab.dispose();
    expect(() => h.lab.get({ id: next.id })).toThrow('expired');
  });
});

describe('Agentforce lab trace', () => {
  const plan = { plan: [{ type: 'UpdateTopicStep', topic: 'orders' }, { type: 'FunctionStep', function: { name: 'Find', input: { id: 1 }, output: { token: 'S' } } }, { type: 'PlannerResponseStep', message: 'ok' }] };
  async function ready(overrides?: (path: string) => Record<string, unknown> | Error) {
    const h = setup();
    const base = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (token, path, body, host, signal) => {
      if (path.includes('/plans/')) { const out = overrides?.(path) ?? plan; if (out instanceof Error) throw out; return { host: 'test.api.salesforce.com' as SfapHost, body: out }; }
      return base(token, path, body, host, signal);
    });
    const session = await h.lab.start(h.args);
    await h.lab.send({ id: session.id, text: 'Hello' });
    return { ...h, session };
  }
  it('GETs the plan on the pinned host, normalizes it, maps lines and caches per session', async () => {
    const { lab, request, session } = await ready();
    const trace = await lab.trace({ id: session.id, planId: 'plan1', path: 'Bot.agent' });
    expect(trace).toMatchObject({ runId: session.id, planId: 'plan1', available: true, turn: 1 });
    expect(trace.steps.map(s => s.kind)).toEqual(['topic', 'action', 'response']);
    expect(trace.steps[1]!.outputPreview).toBe('token: ••••');
    const call = request.mock.calls.at(-1)!;
    expect(call[1]).toBe('/einstein/ai-agent/v1.1/preview/sessions/remote%2F1/plans/plan1');
    expect(call[2]).toBeUndefined(); // GET
    expect(call[3]).toBe('test.api.salesforce.com');
    const before = request.mock.calls.length;
    expect(await lab.trace({ id: session.id, planId: 'plan1' })).toBe(trace);
    expect(request.mock.calls.length).toBe(before);
    expect(JSON.stringify(trace)).not.toMatch(/PRIVATE/);
  });
  it('defaults to the latest turn plan when planId is omitted', async () => {
    const { lab, session, request } = await ready();
    const trace = await lab.trace({ id: session.id });
    expect(trace).toMatchObject({ available: true, planId: 'plan1' });
    expect(request.mock.calls.at(-1)![1]).toContain('/plans/plan1');
  });
  it('degrades to available:false for rehearsal, unknown runs, 404, errors and exhausted budgets', async () => {
    const h = await ready(() => new Error('Salesforce Preview API returned HTTP 404. missing'));
    expect(await h.lab.trace({ id: h.session.id, planId: 'p' })).toMatchObject({ available: false, reason: expect.stringContaining('HTTP 404') });
    expect(await h.lab.trace({ id: 'nope', planId: 'p' })).toMatchObject({ available: false, reason: expect.stringContaining('expired') });
    expect(await h.lab.trace({})).toMatchObject({ available: false });
    const boom = await ready(() => new Error('network down'));
    expect(await boom.lab.trace({ id: boom.session.id, planId: 'p' })).toMatchObject({ available: false, reason: 'network down' });
    const empty = await ready(() => ({}));
    expect(await empty.lab.trace({ id: empty.session.id, planId: 'p' })).toMatchObject({ available: false, reason: expect.stringContaining('no steps') });
    const rehearsal = setup();
    const r = await rehearsal.lab.start({ ...rehearsal.args, engine: 'rehearsal' });
    await rehearsal.lab.send({ id: r.id, text: 'Hi' });
    const before = rehearsal.request.mock.calls.length;
    expect(await rehearsal.lab.trace({ id: r.id })).toMatchObject({ available: false, reason: expect.stringMatching(/^Approximation/) });
    expect(rehearsal.request.mock.calls.length).toBe(before);
    const noPlan = setup();
    const s = await noPlan.lab.start(noPlan.args);
    expect(await noPlan.lab.trace({ id: s.id })).toMatchObject({ available: false, reason: expect.stringContaining('no completed turn') });
    const budget = await ready(() => ({}));
    for (let i = 0; i < 200; i++) await budget.lab.trace({ id: budget.session.id, planId: `p${i}` });
    expect(await budget.lab.trace({ id: budget.session.id, planId: 'late' })).toMatchObject({ available: false, reason: expect.stringContaining('budget') });
  });
  it('reopens a run in its project with its path, and traces it with that path by default', async () => {
    const h = await ready();
    const { lab, setScope, args, request } = h;
    expect(lab.get({ id: h.session.id })).not.toHaveProperty('path');
    const named = await lab.start({ ...args, source: 'config:\n  name: Helper\ntopic orders:\n  description: Orders', path: '  force-app/Bot.agent ' });
    expect(named.path).toBe('force-app/Bot.agent');
    await lab.send({ id: named.id, text: 'Hello' });
    lab.end({ id: named.id });
    expect(lab.get({ id: named.id })).toMatchObject({ id: named.id, closed: true, path: 'force-app/Bot.agent', turns: [{ role: 'agent' }, { role: 'user', text: 'Hello' }, { role: 'agent' }] });
    const before = request.mock.calls.length;
    // No path in the request: the run's own path still maps the topic to its line.
    expect((await lab.trace({ id: named.id, planId: 'plan1' })).steps[0]).toMatchObject({ kind: 'topic', source: { path: 'force-app/Bot.agent', line: 3 } });
    expect(request.mock.calls.length).toBe(before + 1);
    for (const path of ['', 'x'.repeat(513), 7]) expect((await lab.start({ ...args, path })).path).toBeUndefined();
    setScope('project-b');
    expect(() => lab.get({ id: named.id })).toThrow('another project');
  });
  it('still serves traces after the run ended', async () => {
    const { lab, session } = await ready();
    lab.end({ id: session.id });
    expect((await lab.trace({ id: session.id, planId: 'plan1' })).available).toBe(true);
  });
});

it('grounds AI evaluation in server-owned, redacted action evidence', async () => {
  const { lab, request, args } = setup();
  const run = await lab.start(args);
  await lab.send({ id: run.id, text: 'Check credit, do not apply it' });
  const base = request.getMockImplementation()!;
  request.mockImplementation(async (...input) => input[1].includes('/plans/') ? { host: 'test.api.salesforce.com', body: { plan: [{ type: 'FunctionStep', function: { name: 'Credit', input: { action: 'CHECK', token: 'PRIVATE_CREDENTIAL' }, output: { applied: false, eligible: true } } }] } } : input[1].endsWith('/chat-generations') ? { host: 'test.api.salesforce.com', body: { generationDetails: { generations: [{ content: '{"outcome":"pass","reason":"Read-only CHECK","evidence":["applied false"]}' }] } } } : base(...input));
  await lab.evaluate({ id: run.id, runtimeEvidence: [{ label: 'FORGED' }] });
  const payload = JSON.stringify(request.mock.calls.at(-1)?.[2]);
  expect(payload).toContain('CHECK'); expect(payload).toContain('applied'); expect(payload).toContain('false');
  expect(payload).toContain('authoritative');
  expect(payload).not.toContain('PRIVATE_CREDENTIAL'); expect(payload).not.toContain('FORGED');
});

it('includes final state but marks evidence shortened to the judging budget incomplete', async () => {
  const { lab, request, args } = setup();
  const run = await lab.start(args);
  await lab.send({ id: run.id, text: 'Check my order' });
  vi.spyOn(lab, 'trace').mockResolvedValue({ runId: run.id, turn: 1, planId: 'plan1', available: true, steps: [
    { kind: 'response', label: 'Do not use response text as an action' },
    { kind: 'variable', label: 'orderExists', stateEvidence: { orderExists: false } },
    ...Array.from({ length: 80 }, (_, i) => ({ kind: 'action' as const, label: `Check${i}`, actionEvidence: { input: { detail: 'x'.repeat(200) } } }))
  ] });
  const base = request.getMockImplementation()!;
  request.mockImplementation(async (...input) => input[1].endsWith('/chat-generations') ? { host: 'test.api.salesforce.com', body: { generationDetails: { generations: [{ content: '{"outcome":"inconclusive","reason":"Trace shortened","evidence":["Incomplete action evidence"]}' }] } } } : base(...input));
  await lab.evaluate({ id: run.id });
  const payload = request.mock.calls.at(-1)![2] as { messages: Array<{ content: string }> };
  const evidence = JSON.parse(payload.messages[1]!.content).runtimeEvidence[0];
  expect(evidence).toMatchObject({ complete: false, reason: 'Runtime evidence shortened to the judging budget.' });
  expect(evidence.steps[0]).toMatchObject({ kind: 'variable', state: { orderExists: false } });
  expect(evidence.steps.length).toBeGreaterThan(1);
  expect(evidence.steps.length).toBeLessThan(80);
  expect(JSON.stringify(evidence.steps)).not.toContain('Do not use response text');
  expect(JSON.stringify(evidence.steps).length).toBeLessThan(6100);
});
