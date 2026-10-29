import { describe, expect, it, vi } from 'vitest';
import { SimulationBatches, registerSimulations, type SimulationOptions, type SimulationStart } from '../lib/simulation-batches.js';
import {
  SIMULATION_LIMITS, SIMULATION_RPC, batchSummary, laneCalls, parseSimulationRequest, simulationCounts, simulationContext, simulationNext, type SimulationBatch,
} from '../lib/simulation-contract.js';
import { LAB_SCENARIOS } from '../lib/agentforce-lab-contract.js';
import { STUDIO_CHANGED_CHANNEL } from '../lib/studio-contract.js';
import type { StudioServerContext } from '../lib/studio-server-context.js';

const scenario = (name: string, maxTurns = 2) => ({ name, persona: 'p', goal: 'g', opening: `hi from ${name}`, criteria: 'c', maxTurns });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function kvFake() {
  const map = new Map<string, unknown>();
  return { map, kv: { get: async <T,>(key: string) => map.get(key) as T | undefined, set: async (key: string, value: unknown) => { map.set(key, value); } } };
}

type Verdicts = Record<string, 'pass' | 'fail' | 'inconclusive' | Error>;
function labFake(verdicts: Verdicts = {}, opts: { hold?: boolean } = {}) {
  let n = 0;
  let active = 0;
  let peak = 0;
  const sessions = new Map<string, { opening: string; turns: Array<{ role: 'user' | 'agent'; text: string }>; aborted?: () => void }>();
  const gates: Array<() => void> = [];
  const lab = {
    start: vi.fn(async (input: { scenario: { opening: string } }) => {
      const id = `s${++n}`;
      active++; peak = Math.max(peak, active);
      sessions.set(id, { opening: input.scenario.opening, turns: [] });
      return { id, turns: [] };
    }),
    send: vi.fn(async ({ id, text }: { id: string; text: string }) => {
      const s = sessions.get(id)!;
      if (opts.hold) await new Promise<void>((resolve, reject) => { gates.push(resolve); s.aborted = () => reject(Error('aborted')); });
      s.turns.push({ role: 'user', text }, { role: 'agent', text: `reply ${s.turns.length / 2 + 1}` });
      return { turns: [...s.turns] };
    }),
    next: vi.fn(async () => ({ text: 'customer follow-up' })),
    evaluate: vi.fn(async ({ id }: { id: string }) => {
      const verdict = verdicts[sessions.get(id)!.opening] ?? 'pass';
      if (verdict instanceof Error) throw verdict;
      return { verdict: { outcome: verdict, reason: `judged ${verdict}`, evidence: ['turn 1'] } };
    }),
    end: vi.fn(({ id }: { id: string }) => { active--; sessions.get(id)?.aborted?.(); }),
  };
  return { lab, peak: () => peak, release: () => { for (const gate of gates.splice(0)) gate(); } };
}

function start(overrides: Partial<SimulationStart> = {}, request = parseSimulationRequest({ scenarios: [scenario('A'), scenario('B')] })): SimulationStart {
  return { project: 'p1', agentPath: 'force-app/a.agent', source: 'agent', candidate: false, request, startedBy: 'studio', ...overrides };
}

function setup(verdicts?: Verdicts, opts?: { hold?: boolean }) {
  const fake = labFake(verdicts, opts);
  const store = kvFake();
  const changed = vi.fn();
  let id = 0;
  let time = 100;
  const batches = new SimulationBatches({ lab: fake.lab as never, kv: store.kv, now: () => ++time, id: () => `b${++id}`, changed });
  return { ...fake, ...store, changed, batches };
}

describe('parseSimulationRequest', () => {
  it('preserves detached scenario variables and validates each scenario', () => {
    const variables = [{ name: 'verified', type: 'Boolean', value: false }];
    const parsed = parseSimulationRequest({ scenarios: [{ ...scenario('A'), contextVariables: variables }] });
    variables[0].value = true;
    expect(parsed.scenarios[0].contextVariables).toEqual([{ name: 'verified', type: 'Boolean', value: false }]);
    expect(() => parseSimulationRequest({ scenarios: [{ ...scenario('A'), contextVariables: [{ name: 'x', type: 'Number', value: 'wrong' }] }] })).toThrow(/Scenario 1: x needs a Number/);
  });
  it('merges typed overrides by name and validates the combined limits', () => {
    expect(simulationContext([{ name: 'x', type: 'Text', value: 'default' }, { name: 'y', type: 'Number', value: 0 }], [{ name: 'x', type: 'Text', value: null }])).toEqual([{ name: 'x', type: 'Text', value: null }, { name: 'y', type: 'Number', value: 0 }]);
    const defaults = Array.from({ length: 100 }, (_, i) => ({ name: `v${i}`, type: 'Text' as const, value: '' }));
    expect(() => simulationContext(defaults, [{ name: 'extra', type: 'Boolean', value: false }])).toThrow(/at most 100/);
  });
  it('defaults to the lab presets, four at a time in Simulate', () => {
    const request = parseSimulationRequest({});
    expect(request.scenarios.map(row => row.name)).toEqual(LAB_SCENARIOS.map(row => row.name));
    expect(request).toMatchObject({ repeats: 1, parallel: 4, engine: 'preview' });
  });
  it('names unnamed scenarios and accepts rehearsal', () => {
    const { name: _name, ...unnamed } = scenario('x');
    const request = parseSimulationRequest({ scenarios: [unnamed], engine: 'rehearsal', repeats: 2, parallel: 1 });
    expect(request.scenarios[0]!.name).toBe('Scenario 1');
    expect(request).toMatchObject({ engine: 'rehearsal', repeats: 2, parallel: 1 });
  });
  it.each([
    [{ scenarios: [] }, /1 to 12 scenarios/],
    [{ scenarios: 'x' }, /1 to 12 scenarios/],
    [{ scenarios: [{ ...scenario('a'), maxTurns: 9 }] }, /Scenario 1: Choose 1–8 turns/],
    [{ scenarios: [{ ...scenario('a'), name: 'n'.repeat(81) }] }, /name must be at most 80/],
    [{ scenarios: [scenario('a')], repeats: 4 }, /repeats must be a whole number from 1 to 3/],
    [{ scenarios: [scenario('a')], parallel: 0 }, /parallel must be/],
    [{ scenarios: Array.from({ length: 5 }, (_, i) => scenario(`s${i}`)), repeats: 3 }, /at most 12 conversations/],
    [{ scenarios: [scenario('a')], engine: 'live' }, /engine must be preview/],
    [{ scenarios: Array.from({ length: 12 }, (_, i) => scenario(`s${i}`, 8)), engine: 'rehearsal' }, /plans 192 model calls; the limit is 120/],
  ])('refuses %j', (input, error) => {
    expect(() => parseSimulationRequest(input)).toThrow(error);
  });
  it('fits twelve full Simulate conversations in the budget', () => {
    expect(parseSimulationRequest({ scenarios: Array.from({ length: 12 }, (_, i) => scenario(`s${i}`, 8)) }).scenarios).toHaveLength(12);
  });
  it('counts the planned model calls per lane', () => {
    expect(laneCalls({ maxTurns: 1 }, 'preview')).toBe(1);
    expect(laneCalls({ maxTurns: 4 }, 'preview')).toBe(4);
    expect(laneCalls({ maxTurns: 4 }, 'rehearsal')).toBe(8);
  });
});

describe('simulationNext', () => {
  const batch = (status: SimulationBatch['status'], statuses: SimulationBatch['lanes'][number]['status'][]) => ({ id: 'b', status, counts: simulationCounts(statuses.map(s => ({ status: s }))) });
  it('waits while running, reports success, and asks for a fix on failures', () => {
    expect(simulationNext(batch('running', ['running', 'queued']))).toMatch(/1 running, 1 queued/);
    expect(simulationNext(batch('done', ['pass', 'pass']))).toMatch(/All 2 conversations pass/);
    expect(simulationNext(batch('done', ['pass', 'fail', 'error']))).toMatch(/2 of 3 .*editor\.proposeEdit.*Never deploy/);
  });
});

it('pins per-scenario starting variables independently for all repeats and saved results', async () => {
  const t = setup({}, { hold: true });
  const request = parseSimulationRequest({ scenarios: [
    { ...scenario('A', 1), contextVariables: [{ name: 'verified', type: 'Boolean', value: false }, { name: '$Context.AccountId', type: 'Text', value: null }] },
    scenario('B', 1),
  ], repeats: 2 });
  const defaults = [{ name: 'verified', type: 'Boolean' as const, value: true }, { name: 'count', type: 'Number' as const, value: 0 }];
  const batch = await t.batches.start(start({ contextVariables: defaults }, request));
  defaults[0].value = false;
  request.scenarios[0].contextVariables![0].value = true;
  const expectedA = [{ name: 'verified', type: 'Boolean', value: false }, { name: 'count', type: 'Number', value: 0 }, { name: '$Context.AccountId', type: 'Text', value: null }];
  expect(t.lab.start.mock.calls.map(([input]) => (input as any).contextVariables)).toEqual([expectedA, expectedA, [{ name: 'verified', type: 'Boolean', value: true }, { name: 'count', type: 'Number', value: 0 }], [{ name: 'verified', type: 'Boolean', value: true }, { name: 'count', type: 'Number', value: 0 }]]);
  expect(batch.lanes[0].contextVariables).toEqual(expectedA);
  expect(batch.lanes[0].scenario.contextVariables![0].value).toBe(false);
  t.release(); const done = await t.batches.get('p1', batch.id, 1000);
  expect(done.lanes[0].contextVariables).toEqual(expectedA);
});

describe('SimulationBatches', () => {
  it('frees the project after a simulation history write fails so the user can retry', async () => {
    const t = setup();
    const write = vi.spyOn(t.kv, 'set').mockRejectedValueOnce(Error('disk full'));
    await expect(t.batches.start(start())).rejects.toThrow('disk full');
    expect(t.lab.start).not.toHaveBeenCalled();
    write.mockRestore();
    await expect(t.batches.start(start())).resolves.toMatchObject({ id: 'b2' });
    expect((await t.batches.get('p1', 'b2', 1_000)).status).toBe('done');
    await expect(t.batches.get('p1', 'b1')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('runs every lane through start → turns → judge → end and stores the result', async () => {
    const t = setup({ 'hi from B': 'fail' });
    const started = await t.batches.start(start());
    expect(started).toMatchObject({ id: 'b1', status: 'running', counts: { total: 2 }, plannedCalls: 4, parallel: 2 });
    const done = await t.batches.get('p1', 'b1', 1_000);
    expect(done.status).toBe('done');
    expect(done.counts).toMatchObject({ pass: 1, fail: 1, running: 0 });
    const [a, b] = done.lanes;
    expect(a!.turns.map(turn => turn.text)).toEqual(['hi from A', 'reply 1', 'customer follow-up', 'reply 2']);
    expect(a!.verdict?.outcome).toBe('pass');
    expect(b!.verdict?.reason).toBe('judged fail');
    expect(a!.sessionId).toBeUndefined();
    expect(t.lab.end).toHaveBeenCalledTimes(2);
    expect(t.lab.next).toHaveBeenCalledTimes(2);
    expect(t.lab.start.mock.calls[0]![0]).toMatchObject({ engine: 'preview', path: 'force-app/a.agent', startedByUser: true });
    expect((t.map.get('studio:simulation:p1:b1') as SimulationBatch).status).toBe('done');
    expect(t.map.get('studio:simulations:p1')).toEqual(['b1']);
    expect(t.changed).toHaveBeenCalledWith('p1', 'b1');
  });

  it('passes model, context and thread to the lab and records lane errors', async () => {
    const t = setup({ 'hi from A': Error('judge down') });
    await t.batches.start(start({ model: 'm1', contextVariables: [{ name: 'x', type: 'Text', value: 'y' }], threadId: 'th', startedBy: 'thread' }, parseSimulationRequest({ scenarios: [scenario('A', 1)] })));
    const done = await t.batches.get('p1', 'b1', 1_000);
    expect(t.lab.start.mock.calls[0]![0]).toMatchObject({ model: 'm1', threadId: 'th', contextVariables: [{ name: 'x' }] });
    expect(t.lab.next).not.toHaveBeenCalled();
    expect(done.lanes[0]).toMatchObject({ status: 'error', error: 'judge down' });
  });

  it('never runs more lanes at once than parallel', async () => {
    const t = setup();
    await t.batches.start(start({}, parseSimulationRequest({ scenarios: Array.from({ length: 6 }, (_, i) => scenario(`s${i}`, 1)), parallel: 3 })));
    const done = await t.batches.get('p1', 'b1', 1_000);
    expect(done.counts.pass).toBe(6);
    expect(t.peak()).toBeLessThanOrEqual(3);
  });

  it('allows one running batch per project and stops it on request', async () => {
    const t = setup({}, { hold: true });
    await t.batches.start(start({}, parseSimulationRequest({ scenarios: [scenario('A'), scenario('B'), scenario('C')], parallel: 2 })));
    await expect(t.batches.start(start())).rejects.toMatchObject({ code: 'busy' });
    await flush();
    const running = await t.batches.get('p1', 'b1');
    expect(running.counts).toMatchObject({ running: 2, queued: 1 });
    const stopped = await t.batches.stop('p1', 'b1');
    expect(stopped.status).toBe('stopped');
    expect(stopped.counts).toMatchObject({ stopped: 3, running: 0 });
    // Another project is independent, and a finished batch frees the project.
    await expect(t.batches.start(start({ project: 'p2' }))).resolves.toMatchObject({ status: 'running' });
    t.release();
  });

  it('stops a lane that was still starting', async () => {
    const t = setup();
    let open!: () => void;
    t.lab.start.mockImplementationOnce(async () => { await new Promise<void>(resolve => { open = resolve; }); return { id: 'late', turns: [] }; });
    await t.batches.start(start({}, parseSimulationRequest({ scenarios: [scenario('A')] })));
    await flush();
    const stopping = t.batches.stop('p1', 'b1');
    open();
    const stopped = await stopping;
    expect(stopped.lanes[0]!.status).toBe('stopped');
    expect(t.lab.end).toHaveBeenCalledWith({ id: 'late' });
  });

  it('reads a batch cut off by a restart as interrupted', async () => {
    const t = setup();
    const lane = { id: '1', name: 'A', repeat: 1, scenario: scenario('A'), status: 'running', turns: [] };
    t.map.set('studio:simulations:p1', ['old']);
    t.map.set('studio:simulation:p1:old', { id: 'old', status: 'running', lanes: [lane, { ...lane, id: '2', status: 'pass' }], counts: {} });
    const batch = await t.batches.get('p1', 'old');
    expect(batch.status).toBe('interrupted');
    expect(batch.counts).toMatchObject({ stopped: 1, pass: 1 });
    expect(await t.batches.stop('p1', 'old')).toMatchObject({ status: 'interrupted' });
    await expect(t.batches.get('p1', 'missing')).rejects.toMatchObject({ code: 'not_found' });
    await expect(t.batches.get('p2', 'old')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('keeps the newest batches per project and lists them newest first without transcripts', async () => {
    const t = setup();
    for (let i = 0; i < SIMULATION_LIMITS.stored + 2; i++) {
      await t.batches.start(start({ agentPath: i % 2 ? 'b.agent' : 'a.agent' }, parseSimulationRequest({ scenarios: [scenario('A', 1)] })));
      await t.batches.get('p1', `b${i + 1}`, 1_000);
    }
    const ids = t.map.get('studio:simulations:p1') as string[];
    expect(ids).toHaveLength(SIMULATION_LIMITS.stored);
    expect(ids[0]).toBe('b3');
    expect(t.map.get('studio:simulation:p1:b1')).toBeNull();
    const listed = await t.batches.list('p1');
    expect(listed[0]!.id).toBe('b22');
    expect(listed[0]!.lanes[0]!.turns).toEqual([]);
    expect((await t.batches.list('p1', 'b.agent')).every(row => row.agentPath === 'b.agent')).toBe(true);
    expect(await t.batches.list('nobody')).toEqual([]);
  });

  it('trims long turns before storing them', async () => {
    const t = setup();
    t.lab.send.mockResolvedValueOnce({ turns: [{ role: 'user', text: 'u' }, { role: 'agent', text: 'x'.repeat(5_000) }] });
    await t.batches.start(start({}, parseSimulationRequest({ scenarios: [scenario('A', 1)] })));
    const done = await t.batches.get('p1', 'b1', 1_000);
    expect(done.lanes[0]!.turns[1]!.text).toHaveLength(SIMULATION_LIMITS.turnText);
  });

  it('tolerates a failing realtime publish and refuses work after dispose', async () => {
    const t = setup();
    t.changed.mockImplementation(() => { throw Error('offline'); });
    await t.batches.start(start({}, parseSimulationRequest({ scenarios: [scenario('A', 1)] })));
    expect((await t.batches.get('p1', 'b1', 1_000)).status).toBe('done');
    t.batches.dispose();
    await expect(t.batches.start(start())).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('marks queued lanes stopped when disposed mid-batch', async () => {
    const t = setup({}, { hold: true });
    await t.batches.start(start({}, parseSimulationRequest({ scenarios: [scenario('A'), scenario('B')], parallel: 1 })));
    await flush();
    t.batches.dispose();
    t.release();
    const done = await t.batches.get('p1', 'b1', 1_000);
    expect(done.status).toBe('stopped');
    expect(done.lanes.map(lane => lane.status)).toEqual(['stopped', 'stopped']);
  });

  it('times a wait out while lanes still run', async () => {
    const t = setup({}, { hold: true });
    await t.batches.start(start());
    const batch = await t.batches.get('p1', 'b1', 20);
    expect(batch.status).toBe('running');
    t.release();
  });
});

describe('registerSimulations', () => {
  function studioFake(options: Partial<SimulationOptions> = {}) {
    const rpcs = new Map<string, (args: unknown) => unknown>();
    const publish = vi.fn();
    const disposers: Array<() => void> = [];
    const fake = labFake();
    const store = kvFake();
    const authorize = vi.fn(async () => ({ orgAlias: 'dev' }));
    const agent = vi.fn(async (path: string) => path === 'missing.agent' ? { ok: false as const, code: 'not_found', error: 'Agentforce bundle not found' } : { apiName: 'Bot', source: 'saved source' });
    let n = 0;
    const studio = {
      zcc: { storage: { kv: store.kv }, realtime: { publish }, onDispose: (fn: () => void) => disposers.push(fn) },
      registerRpc: (name: string, handler: (args: unknown) => unknown) => rpcs.set(name, handler),
      contexts: { current: () => ({ projectId: 'p1' }) },
      lab: fake.lab,
      deps: { now: () => 1 },
    } as unknown as StudioServerContext;
    registerSimulations(studio, { agent, authorize, id: () => `b${++n}`, ...options });
    const call = (name: string, args: unknown) => rpcs.get(name)!(args) as Promise<Record<string, any>>;
    return { call, publish, authorize, agent, lab: fake.lab, disposers, store };
  }

  it('starts a batch on the saved file, approved once, and reads it back', async () => {
    const t = studioFake();
    const reply = await t.call(SIMULATION_RPC.start, { agentPath: 'a.agent', scenarios: [scenario('A', 1)], threadId: 'th' });
    expect(reply).toMatchObject({ ok: true, batch: { id: 'b1', orgAlias: 'dev', candidate: false, startedBy: 'thread', threadId: 'th' } });
    expect(reply.next).toMatch(/simulations\.result .*ui\.command simulations\.open/);
    expect(t.authorize).toHaveBeenCalledWith({ engine: 'preview', threadId: 'th', startedByUser: false });
    expect(t.lab.start.mock.calls[0]![0]).toMatchObject({ source: 'saved source' });
    const read = await t.call(SIMULATION_RPC.get, { batchId: 'b1', waitMs: 1_000 });
    expect(read).toMatchObject({ ok: true, batch: { status: 'done' }, next: expect.stringMatching(/All 1 conversations pass/) });
    expect(read.batch.lanes[0].turns.length).toBeGreaterThan(0);
    const compact = await t.call(SIMULATION_RPC.get, { batchId: 'b1', transcripts: false });
    expect(compact.batch.lanes[0].turns).toEqual([]);
    expect((await t.call(SIMULATION_RPC.list, {})).batches).toHaveLength(1);
    expect((await t.call(SIMULATION_RPC.stop, { batchId: 'b1' })).batch.status).toBe('done');
    expect(t.publish).toHaveBeenCalledWith(STUDIO_CHANGED_CHANNEL, { projectId: 'p1', kind: 'simulations', batchId: 'b1' });
    t.disposers.forEach(fn => fn());
  });

  it('runs a candidate source from a Studio click', async () => {
    const t = studioFake();
    const reply = await t.call(SIMULATION_RPC.start, { agentPath: 'a.agent', source: 'candidate', startedByUser: true, model: 'gpt_x', engine: 'rehearsal', scenarios: [scenario('A', 1)] });
    expect(reply.batch).toMatchObject({ candidate: true, startedBy: 'studio', engine: 'rehearsal', model: 'gpt_x' });
    expect(t.authorize).toHaveBeenCalledWith({ engine: 'rehearsal', threadId: '', startedByUser: true });
    expect(t.lab.start.mock.calls[0]![0]).toMatchObject({ source: 'candidate', model: 'gpt_x' });
  });
  it('refuses a merged context above limits before approval or starting any lane', async () => {
    const t = studioFake();
    const reply = await t.call(SIMULATION_RPC.start, { agentPath: 'a.agent', contextVariables: Array.from({ length: 100 }, (_, i) => ({ name: `v${i}`, type: 'Text', value: '' })), scenarios: [{ ...scenario('A'), contextVariables: [{ name: 'extra', type: 'Number', value: 0 }] }] });
    expect(reply).toMatchObject({ ok: false, code: 'invalid_input', error: expect.stringContaining('at most 100') });
    expect(t.authorize).not.toHaveBeenCalled(); expect(t.lab.start).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 'invalid_input', /agentPath/],
    [{ agentPath: 'a.agent', repeats: 9 }, 'invalid_input', /repeats/],
    [{ agentPath: 'a.agent', contextVariables: 'x' }, 'invalid_input', /./],
    [{ agentPath: 'a.agent', model: 'bad model' }, 'invalid_input', /model API name/],
    [{ agentPath: 'missing.agent' }, 'not_found', /not found/],
  ])('refuses %j', async (args, code, error) => {
    const t = studioFake();
    const reply = await t.call(SIMULATION_RPC.start, args);
    expect(reply).toMatchObject({ ok: false, code });
    expect(reply.error).toMatch(error);
    expect(t.authorize).not.toHaveBeenCalled();
  });

  it('reports a refused approval, an empty file and a bad batch id', async () => {
    const refused = studioFake({ authorize: async () => { throw Error('Operator declined the simulate run.'); } });
    expect(await refused.call(SIMULATION_RPC.start, { agentPath: 'a.agent' })).toMatchObject({ ok: false, code: 'failed', error: 'Operator declined the simulate run.' });
    const empty = studioFake({ agent: async () => ({ apiName: 'Bot', source: '  ' }) });
    expect(await empty.call(SIMULATION_RPC.start, { agentPath: 'a.agent' })).toMatchObject({ ok: false, error: 'The agent file is empty.' });
    expect(await empty.call(SIMULATION_RPC.get, { batchId: '../x' })).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(await empty.call(SIMULATION_RPC.stop, {})).toMatchObject({ ok: false, code: 'invalid_input' });
  });

  it('summarises a batch without transcripts', () => {
    const lane = { id: '1', name: 'A', repeat: 1, scenario: scenario('A'), status: 'pass' as const, turns: [{ role: 'user' as const, text: 'x' }] };
    expect(batchSummary({ lanes: [lane] } as SimulationBatch).lanes[0]!.turns).toEqual([]);
  });
});
