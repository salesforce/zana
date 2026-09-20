import { describe, expect, it, vi } from 'vitest';
import { AgentforceLab } from '../lib/agentforce-lab.js';
import { DEFAULT_LAB_MODEL, LAB_SCENARIOS, parseLabScenario, parseLabVerdict } from '../lib/agentforce-lab-contract.js';
import type { ResolvedOrg } from '../lib/types.js';
import type { SfapHost } from '../lib/agentforce-transport.js';

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
  it('compiles a snapshot, pins its org/host and never exposes credentials or enables actions', async () => {
    const { lab, request, args, connect } = setup();
    const session = await lab.start(args);
    expect(session).toMatchObject({ engine: 'preview', orgAlias: 'dev', turns: [{ role: 'agent', text: 'Welcome' }], model: DEFAULT_LAB_MODEL });
    expect(session.sourceHash).toHaveLength(64);
    expect(JSON.stringify(session)).not.toMatch(/PRIVATE|remote\/1/);
    expect(request.mock.calls[1][2]).toMatchObject({ enableSimulationMode: true, bypassUser: false, agentDefinition: { agentVersion: { developerName: 'v0' } } });
    const result = await lab.send({ id: session.id, text: 'Hello' });
    expect(result.turns.at(-1)).toMatchObject({ role: 'agent', text: 'I can help you find an order.', planId: 'plan1', latencyMs: 0 });
    expect(request.mock.calls.at(-1)).toEqual(['PRIVATE_JWT', expect.stringContaining('remote%2F1/messages'), expect.objectContaining({ message: { sequenceId: 1, type: 'Text', text: 'Hello' } }), 'test.api.salesforce.com', expect.any(AbortSignal)]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(lab.end({ id: session.id }).closed).toBe(true);
    await expect(lab.send({ id: session.id, text: 'Again' })).rejects.toThrow('fresh run');
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
    for (const invalid of [{}, { ...args, engine: 'live' }, { ...args, model: '../evil' }, { ...args, source: 'x'.repeat(180001) }, { ...args, scenario: { ...args.scenario, maxTurns: 90 } }]) await expect(lab.start(invalid)).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
    request.mockResolvedValueOnce({ host: 'api.salesforce.com', body: { status: 'failed' } });
    await expect(lab.start(args)).rejects.toThrow('compile');
    const s = await lab.start({ ...args, engine: 'rehearsal', scenario: undefined });
    request.mockResolvedValueOnce({ host: 'api.salesforce.com', body: {} });
    await expect(lab.send({ id: s.id, text: 'hello' })).rejects.toThrow('AI response');
  });
});
describe('scenario and verdict contracts', () => {
  it('rejects oversized/empty criteria, invalid turn limits and false green evidence', () => {
    for (const value of [null, [], { maxTurns: 0 }, { ...LAB_SCENARIOS[0].scenario, persona: '' }, { ...LAB_SCENARIOS[0].scenario, criteria: 'x'.repeat(4001) }]) expect(() => parseLabScenario(value)).toThrow();
    for (const value of ['{}', '{"outcome":"pass","reason":"Fine","evidence":[]}', '{"outcome":"maybe"}', '{"outcome":"pass","reason":"Fine","evidence":[3]}']) expect(() => parseLabVerdict(value)).toThrow();
    expect(parseLabVerdict('```json\n{"outcome":"fail","reason":"Out of scope","evidence":["Turn 2: unrelated response"]}\n```').outcome).toBe('fail');
  });
});
