import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SelfHealingRuns, registerSelfHealing } from '../lib/self-healing.js';
import { SELF_HEALING_LIMITS, SELF_HEALING_RPC, selfHealingNext, selfHealingPrompt } from '../lib/self-healing-contract.js';
import { simulationCounts, type SimulationBatch, type SimulationLane } from '../lib/simulation-contract.js';
import { AGENT_SCRIPT_EXAMPLES } from '../lib/agent-script-model.js';
import type { StudioServerContext } from '../lib/studio-server-context.js';

const source = AGENT_SCRIPT_EXAMPLES[0]!.source;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const candidate = (n = 1) => `${source}\n# candidate ${n}\n`;
function batch(id = 'baseline', statuses: SimulationLane['status'][] = ['pass', 'fail']): SimulationBatch {
  const lanes = statuses.map((status, i) => ({ id: String(i + 1), name: `Case ${i + 1}`, repeat: 1, scenario: { persona: 'Customer', goal: 'Get help', opening: 'Hello', criteria: 'Help the customer', maxTurns: 2 }, status, turns: [] }));
  return { id, agentPath: 'force-app/Help.agent', sourceHash: hash(source), candidate: false, engine: 'preview', parallel: 4, plannedCalls: 4, orgAlias: 'dev', status: 'done', startedAt: 1, startedBy: 'studio', counts: simulationCounts(lanes), lanes };
}
function setup(baseline = batch()) {
  let now = 1000, id = 0;
  const data = new Map([[baseline.id, baseline]]);
  const agent = vi.fn(async () => ({ apiName: 'Help', source }));
  const authorize = vi.fn(async () => ({ orgAlias: 'dev' }));
  const batches = {
    get: vi.fn(async (_project: string, id: string, _wait?: number) => { if (!data.has(id)) throw Error('missing batch'); return structuredClone(data.get(id)!); }),
    start: vi.fn(async (input: any) => { const next = batch(`candidate-${++id}`); Object.assign(next, { sourceHash: hash(input.source), status: 'running', counts: simulationCounts(next.lanes.map(l => ({ status: 'running' as const }))) }); data.set(next.id, next); return next; }),
    stop: vi.fn(async (_project: string, id: string) => data.get(id)!),
  };
  const options = { batches, agent, authorize, now: () => now, id: () => `run-${++id}`, changed: vi.fn() };
  const runs = new SelfHealingRuns(options);
  const complete = (id: string, statuses: SimulationLane['status'][], status: SimulationBatch['status'] = 'done') => {
    const prior = data.get(id)!; const next = batch(id, statuses); Object.assign(next, { sourceHash: prior.sourceHash, status }); data.set(id, next);
  };
  return { runs, options, data, batches, agent, authorize, complete, advance: () => { now += SELF_HEALING_LIMITS.idleMs; } };
}

describe('SelfHealingRuns', () => {
  it('pins scenarios, repeats, context, model and org, then retains an improved source for review', async () => {
    const baseline = batch(); baseline.contextVariables = [{ name: 'locale', type: 'Text', value: 'en_US' }]; baseline.model = 'Model';
    baseline.lanes[0].scenario.contextVariables = [{ name: 'locale', type: 'Text', value: 'fr' }];
    baseline.lanes[1].scenario.contextVariables = [{ name: 'verified', type: 'Boolean', value: false }];
    const t = setup(baseline);
    const run = await t.runs.start('p1', { batchId: baseline.id, maxAttempts: 2 });
    const testing = await t.runs.evaluate('p1', { runId: run.id, source: candidate(), engine: 'live', scenarios: [], threadId: 't1' });
    expect(testing.status).toBe('testing');
    expect(t.batches.start.mock.calls[0]![0]).toMatchObject({ project: 'p1', agentPath: baseline.agentPath, source: candidate(), model: 'Model', contextVariables: baseline.contextVariables, request: { scenarios: baseline.lanes.map(l => ({ name: l.name, ...l.scenario })), repeats: 1, parallel: 4, engine: 'preview' } });
    expect((await t.runs.status('p1', { runId: run.id, waitMs: 99_999 })).run?.status).toBe('testing');
    expect(t.batches.get.mock.calls.at(-1)?.[2]).toBe(30_000);
    t.complete(testing.attempts[0]!.batchId!, ['pass', 'pass']);
    const result = await t.runs.status('p1', { agentPath: baseline.agentPath, includeSource: true });
    expect(result).toMatchObject({ source: candidate(), run: { status: 'passed', baselinePass: 1, bestPass: 2, bestHash: hash(candidate()), attempts: [{ outcome: 'improved', pass: 2 }] } });
    expect((await t.runs.status('p1', { runId: run.id })).source).toBeUndefined();
    await expect(t.runs.evaluate('p1', { runId: run.id, source: candidate(2) })).rejects.toMatchObject({ code: 'not_ready' });
  });
  it('rejects regressions even when the pass count increases, preserves new passing lanes, and stops at the budget', async () => {
    const t = setup(batch('baseline', ['pass', 'pass', 'fail', 'fail']));
    const run = await t.runs.start('p1', { batchId: 'baseline', maxAttempts: 3 });
    const attempt = async (n: number, states: SimulationLane['status'][]) => {
      const testing = await t.runs.evaluate('p1', { runId: run.id, source: candidate(n) });
      t.complete(testing.attempts.at(-1)!.batchId!, states);
      return t.runs.status('p1', { runId: run.id, includeSource: true });
    };
    expect(await attempt(1, ['fail', 'pass', 'pass', 'pass'])).toMatchObject({ source, run: { bestPass: 2, attempts: [{ outcome: 'regression', regressions: ['Case 1'] }] } });
    expect(await attempt(2, ['pass', 'pass', 'pass', 'fail'])).toMatchObject({ source: candidate(2), run: { bestPass: 3, status: 'awaiting_candidate' } });
    const last = await attempt(3, ['pass', 'pass', 'fail', 'pass']);
    expect(last).toMatchObject({ source: candidate(2), run: { bestPass: 3, status: 'exhausted' } });
    expect(last.run!.attempts[2]).toMatchObject({ outcome: 'regression', regressions: ['Case 3'] });
  });
  it('does not promote incomplete or unchanged candidates', async () => {
    const t = setup(); const run = await t.runs.start('p', { batchId: 'baseline', maxAttempts: 3 });
    for (const [index, states] of [['pass', 'error'], ['pass', 'fail'], ['pass', 'stopped']].entries()) {
      const started = await t.runs.evaluate('p', { runId: run.id, source: candidate(index) });
      t.complete(started.attempts.at(-1)!.batchId!, states as SimulationLane['status'][]);
      await t.runs.status('p', { runId: run.id });
    }
    const result = await t.runs.status('p', { runId: run.id });
    expect(result.run?.attempts.map(a => a.outcome)).toEqual(['incomplete', 'unchanged', 'incomplete']);
    expect(result.run?.bestHash).toBe(hash(source));
  });
  it.each([0, 6, 1.2, NaN, '3'])('rejects invalid budget %s', async maxAttempts => {
    await expect(setup().runs.start('p', { batchId: 'baseline', maxAttempts })).rejects.toMatchObject({ code: 'invalid_input' });
  });
  it.each([{ status: 'running' }, { engine: 'rehearsal' }, { counts: { error: 1 } }, { counts: { stopped: 1 } }])('refuses an incomplete baseline %j', async patch => {
    await expect(setup({ ...batch(), ...patch } as SimulationBatch).runs.start('p', { batchId: 'baseline' })).rejects.toMatchObject({ code: 'invalid_baseline' });
  });
  it('refuses a fully passing baseline, mismatched snapshot, missing agent, or second active loop', async () => {
    await expect(setup(batch('baseline', ['pass'])).runs.start('p', { batchId: 'baseline' })).rejects.toMatchObject({ code: 'already_passed' });
    const t = setup();
    await expect(t.runs.start('p', { batchId: 'baseline', source: 'changed' })).rejects.toMatchObject({ code: 'source_changed' });
    t.agent.mockResolvedValueOnce({ ok: false, code: 'path_refused', error: 'Outside project' } as never);
    await expect(t.runs.start('p', { batchId: 'baseline' })).rejects.toMatchObject({ code: 'path_refused' });
    await t.runs.start('p', { batchId: 'baseline' });
    await expect(t.runs.start('p', { batchId: 'baseline' })).rejects.toMatchObject({ code: 'busy' });
  });
  it('refuses invalid, duplicate, concurrently claimed, stale and wrong-org candidates before spending attempts', async () => {
    const t = setup(); const run = await t.runs.start('p', { batchId: 'baseline' });
    for (const text of ['', undefined, 'x'.repeat(10 * 1024 * 1024 + 1)]) await expect(t.runs.evaluate('p', { runId: run.id, source: text })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.runs.evaluate('p', { runId: run.id, source })).rejects.toMatchObject({ code: 'duplicate_candidate' });
    await expect(t.runs.evaluate('p', { runId: run.id, source: 'topic ???:\n' })).rejects.toMatchObject({ code: 'invalid_source' });
    t.agent.mockResolvedValueOnce({ apiName: 'Help', source: 'changed' });
    await expect(t.runs.evaluate('p', { runId: run.id, source: candidate() })).rejects.toMatchObject({ code: 'source_changed' });
    t.authorize.mockResolvedValueOnce({ orgAlias: 'other' });
    await expect(t.runs.evaluate('p', { runId: run.id, source: candidate() })).rejects.toMatchObject({ code: 'org_changed' });
    let release!: () => void;
    t.authorize.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ orgAlias: 'dev' }); }));
    const pending = t.runs.evaluate('p', { runId: run.id, source: candidate() });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await expect(t.runs.evaluate('p', { runId: run.id, source: candidate(2) })).rejects.toMatchObject({ code: 'not_ready' });
    release(); await pending;
    expect(t.batches.start).toHaveBeenCalledTimes(1);
  });
  it('stops running conversations, prevents late starts, isolates projects and expires idle runs', async () => {
    const t = setup(); const run = await t.runs.start('p', { batchId: 'baseline' });
    expect(await t.runs.status('other', { agentPath: run.agentPath })).toEqual({ run: null });
    await expect(t.runs.status('other', { runId: run.id })).rejects.toMatchObject({ code: 'not_found' });
    await t.runs.evaluate('p', { runId: run.id, source: candidate() });
    expect((await t.runs.stop('p', run.id)).status).toBe('stopped');
    expect(t.batches.stop).toHaveBeenCalledTimes(1);
    await t.runs.stop('p', run.id);
    const next = await t.runs.start('p', { batchId: 'baseline' });
    t.advance(); expect((await t.runs.status('p', { runId: next.id })).run?.status).toBe('expired');
    const newer = await t.runs.start('p', { batchId: 'baseline' });
    await t.runs.evaluate('p', { runId: newer.id, source: candidate(3) });
    t.advance(); await t.runs.status('p', { runId: newer.id });
    expect(t.batches.stop).toHaveBeenCalledTimes(2);
    t.runs.dispose();
    await expect(t.runs.start('p', { batchId: 'baseline' })).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('does not launch or retain a candidate after stop races with authorization or batch startup', async () => {
    const t = setup(); const run = await t.runs.start('p', { batchId: 'baseline' });
    let release!: () => void;
    t.authorize.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ orgAlias: 'dev' }); }));
    const pending = t.runs.evaluate('p', { runId: run.id, source: candidate() });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await t.runs.stop('p', run.id); release();
    await expect(pending).rejects.toMatchObject({ code: 'not_ready' });
    expect(t.batches.start).not.toHaveBeenCalled();
    const next = await t.runs.start('p', { batchId: 'baseline' });
    t.batches.start.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(batch('late')); }));
    release = undefined as never;
    const late = t.runs.evaluate('p', { runId: next.id, source: candidate(2) });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await t.runs.stop('p', next.id); release();
    await expect(late).rejects.toMatchObject({ code: 'not_ready' });
    expect(t.batches.stop).toHaveBeenCalledWith('p', 'late');
  });
  it('bounds retention without evicting active work', async () => {
    const t = setup(); const ids = [];
    for (let n = 0; n < SELF_HEALING_LIMITS.stored; n++) ids.push((await t.runs.start(`p${n}`, { batchId: 'baseline' })).id);
    await expect(t.runs.start('overflow', { batchId: 'baseline' })).rejects.toMatchObject({ code: 'busy' });
    await t.runs.stop('p0', ids[0]!);
    await t.runs.start('overflow', { batchId: 'baseline' });
    await expect(t.runs.status('p0', { runId: ids[0] })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('provides explicit next steps and registers bounded RPC failures', async () => {
    const t = setup(); const run = await t.runs.start('p', { batchId: 'baseline' });
    expect(selfHealingPrompt(run)).toMatch(/Continue autonomously.*Never write/s);
    for (const status of ['awaiting_candidate', 'testing', 'passed', 'exhausted', 'stopped', 'expired'] as const) expect(selfHealingNext({ ...run, status }).length).toBeGreaterThan(20);
    const rpc = new Map<string, (args: unknown) => Promise<any>>(); const dispose = vi.fn();
    registerSelfHealing({ contexts: { current: () => ({ projectId: 'p' }) }, registerRpc: (name: string, fn: any) => rpc.set(name, fn), zcc: { onDispose: dispose, realtime: { publish: vi.fn() } } } as never as StudioServerContext, t.options);
    const started = await rpc.get(SELF_HEALING_RPC.start)!({ batchId: 'baseline' });
    expect(started).toMatchObject({ ok: true, run: { status: 'awaiting_candidate' }, next: expect.any(String) });
    expect(await rpc.get(SELF_HEALING_RPC.evaluate)!({ runId: started.run.id, source: candidate() })).toMatchObject({ ok: true });
    expect(await rpc.get(SELF_HEALING_RPC.status)!({ runId: started.run.id })).toMatchObject({ ok: true, run: { status: 'testing' } });
    expect(await rpc.get(SELF_HEALING_RPC.stop)!({ runId: started.run.id })).toMatchObject({ ok: true });
    expect(await rpc.get(SELF_HEALING_RPC.status)!({ runId: 'missing' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await rpc.get(SELF_HEALING_RPC.start)!({ batchId: 'missing' })).toMatchObject({ ok: false, code: 'failed', error: 'missing batch' });
    dispose.mock.calls[0]![0]();
  });
});
