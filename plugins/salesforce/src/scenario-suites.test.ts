import { describe, expect, it, vi } from 'vitest';
import { ScenarioSuites, SUITE_LIMITS, confineSuitePath, judgeCase, parseScenarioCases, registerStudioPreview, suitePathForAgent } from '../lib/scenario-suites.js';
import { sha256Hex } from '../lib/agent-files.js';
import { STUDIO_RPC } from '../lib/studio-contract.js';
import type { TurnTrace } from '../lib/studio-contract.js';

const ROOT = '/proj';
function fsFake(initial: Record<string, string> = {}, links: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const deps = {
    realpath: (p: string) => links[p] ?? p,
    stat: (p: string): 'file' | 'dir' | 'missing' => files.has(p) ? 'file' : p === ROOT || [...files.keys()].some(k => k.startsWith(`${p}/`)) ? 'dir' : 'missing',
    readFile: (p: string) => files.get(p) ?? null,
    readdir: (p: string) => [...new Set([...files.keys()].filter(k => k.startsWith(`${p}/`)).map(k => k.slice(p.length + 1).split('/')[0]!))],
    writeFile: (p: string, c: string) => { files.set(p, c); }
  };
  return { files, deps };
}
const caseA = { id: 'refund', name: 'Refund', utterances: ['I want a refund'], expect: { contains: ['refund'] } };

function store(opts: { files?: Record<string, string>; links?: Record<string, string>; lab?: Record<string, unknown> } = {}) {
  const fake = fsFake(opts.files, opts.links);
  const kv = new Map<string, unknown>();
  const changed = vi.fn();
  let time = 1000;
  const lab = {
    start: vi.fn(async () => ({ id: `run-${++time}`, turns: [] as Array<{ role: 'user' | 'agent'; text: string; planId?: string }> })),
    send: vi.fn(async () => ({ turns: [{ role: 'user' as const, text: 'q' }, { role: 'agent' as const, text: 'We can refund you', planId: 'p1' }] })),
    trace: vi.fn(async (): Promise<TurnTrace> => ({ runId: 'r', turn: 1, available: true, steps: [{ kind: 'topic', label: 'refunds' }, { kind: 'action', label: 'LookupOrder' }] })),
    evaluate: vi.fn(async () => ({ verdict: { outcome: 'pass' as const, reason: 'fine', evidence: ['e'] } })),
    end: vi.fn(),
    ...opts.lab
  };
  const suites = new ScenarioSuites({
    deps: fake.deps, lab: lab as never, root: () => ROOT, project: () => 'p1', now: () => ++time, changed,
    kv: { get: async <T,>(k: string) => kv.get(k) as T | undefined, set: async (k, v) => { kv.set(k, v); } }
  });
  return { ...fake, kv, changed, lab, suites };
}

describe('suite paths', () => {
  it('derives tests/<Agent>.scenario.json', () => {
    expect(suitePathForAgent('force-app/bots/Order Bot.agent')).toBe('tests/Order_Bot.scenario.json');
    expect(() => suitePathForAgent('.agent')).toThrow();
  });
  it('refuses anything but a flat tests/<name>.scenario.json inside the root', () => {
    const { deps } = fsFake({ [`${ROOT}/tests/a.scenario.json`]: '{}' });
    expect(confineSuitePath(ROOT, 'tests/a.scenario.json', deps)).toBe(`${ROOT}/tests/a.scenario.json`);
    for (const bad of ['../x.scenario.json', 'tests/../a.scenario.json', 'tests/sub/a.scenario.json', 'tests/a.json', '/etc/passwd', 'a.scenario.json', 'tests/.hidden.scenario.json']) {
      expect(() => confineSuitePath(ROOT, bad, deps), bad).toThrow(/Scenario|live at/);
    }
  });
  it('refuses a tests folder or file that symlinks outside the project', () => {
    const outside = fsFake({ [`${ROOT}/tests/a.scenario.json`]: '{}' }, { [`${ROOT}/tests`]: '/elsewhere/tests' });
    expect(() => confineSuitePath(ROOT, 'tests/a.scenario.json', outside.deps)).toThrow(/inside the project/);
    const fileLink = fsFake({ [`${ROOT}/tests/a.scenario.json`]: '{}' }, { [`${ROOT}/tests/a.scenario.json`]: '/elsewhere/a.json' });
    expect(() => confineSuitePath(ROOT, 'tests/a.scenario.json', fileLink.deps)).toThrow(/outside/);
  });
});

describe('case parsing', () => {
  it('normalizes and bounds cases', () => {
    const [c] = parseScenarioCases([{ id: 'a b!', name: ' N ', utterances: ['hi', '', 5, ...Array(20).fill('x')], expect: { topic: 't', actions: ['A'], contains: ['c'], criteria: 'crit', junk: 1 } }]);
    expect(c).toMatchObject({ id: 'a_b_', name: 'N', expect: { topic: 't', actions: ['A'], contains: ['c'], criteria: 'crit' } });
    expect(c!.utterances).toHaveLength(SUITE_LIMITS.utterances);
    expect(parseScenarioCases([{ utterances: ['x'] }])[0]).toMatchObject({ id: 'case-1', name: 'Case 1' });
  });
  it('rejects empty, oversized, duplicate and utterance-less suites', () => {
    expect(() => parseScenarioCases([])).toThrow();
    expect(() => parseScenarioCases('x')).toThrow();
    expect(() => parseScenarioCases(Array(51).fill(caseA))).toThrow();
    expect(() => parseScenarioCases([caseA, caseA])).toThrow(/unique/);
    expect(() => parseScenarioCases([{ id: 'x', utterances: [] }])).toThrow(/utterance/);
  });
});

describe('judgeCase', () => {
  const seen = { agentText: 'We can Refund you', topics: ['refunds'], actions: ['LookupOrder'], traced: true };
  it('passes when every expectation holds', () => {
    expect(judgeCase({ contains: ['refund'], topic: 'refunds', actions: ['LookupOrder'] }, seen).outcome).toBe('pass');
  });
  it('fails on missing text, topic or action and explains', () => {
    const r = judgeCase({ contains: ['nope'], topic: 'billing', actions: ['Ship'] }, seen);
    expect(r.outcome).toBe('fail');
    expect(r.notes).toHaveLength(3);
  });
  it('is inconclusive without a trace, without expectations, or without an AI verdict', () => {
    expect(judgeCase({ topic: 'refunds' }, { ...seen, traced: false })).toMatchObject({ outcome: 'inconclusive' });
    expect(judgeCase({}, seen)).toMatchObject({ outcome: 'inconclusive' });
    expect(judgeCase({ criteria: 'c' }, seen).outcome).toBe('inconclusive');
    expect(judgeCase({ criteria: 'c' }, seen, { outcome: 'pass', reason: 'ok' }).outcome).toBe('pass');
    expect(judgeCase({ criteria: 'c' }, seen, { outcome: 'fail', reason: 'bad' }).outcome).toBe('fail');
    expect(judgeCase({ contains: ['zzz'], topic: 'x' }, { ...seen, traced: false }).outcome).toBe('fail');
  });
});

describe('ScenarioSuites storage', () => {
  it('saves a new suite file, then lists it with its sha', async () => {
    const s = store();
    const saved = await s.suites.save({ agentPath: 'force-app/Bot.agent', cases: [caseA] });
    expect(saved.path).toBe('tests/Bot.scenario.json');
    const written = s.files.get(`${ROOT}/tests/Bot.scenario.json`)!;
    expect(JSON.parse(written)).toMatchObject({ version: 1, agent: 'force-app/Bot.agent', cases: [{ id: 'refund' }] });
    expect(saved.sha256).toBe(sha256Hex(written));
    expect(s.changed).toHaveBeenCalledWith({ path: 'tests/Bot.scenario.json', kind: 'suites' });
    const list = await s.suites.list('force-app/Bot.agent');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'Bot', sha256: saved.sha256 });
    expect(await s.suites.list('Other.agent')).toEqual([]);
  });
  it('requires the current sha to overwrite and serializes concurrent saves', async () => {
    const s = store();
    const first = await s.suites.save({ path: 'tests/Bot.scenario.json', cases: [caseA] });
    await expect(s.suites.save({ path: 'tests/Bot.scenario.json', cases: [caseA] })).rejects.toMatchObject({ code: 'sha_mismatch' });
    await expect(s.suites.save({ path: 'tests/Bot.scenario.json', cases: [caseA], expectedSha256: 'stale' })).rejects.toMatchObject({ code: 'sha_mismatch' });
    await expect(s.suites.save({ path: 'tests/New.scenario.json', cases: [caseA], expectedSha256: 'abc' })).rejects.toMatchObject({ code: 'sha_mismatch' });
    const [a, b] = await Promise.allSettled([
      s.suites.save({ path: 'tests/Bot.scenario.json', cases: [{ ...caseA, id: 'a' }], expectedSha256: first.sha256 }),
      s.suites.save({ path: 'tests/Bot.scenario.json', cases: [{ ...caseA, id: 'b' }], expectedSha256: first.sha256 })
    ]);
    expect([a!.status, b!.status].sort()).toEqual(['fulfilled', 'rejected']);
    await expect(s.suites.save({ cases: [caseA] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(s.suites.save({ path: 'tests/x.json', cases: [caseA] })).rejects.toMatchObject({ code: 'path_refused' });
    await expect(s.suites.save({ path: 'tests/Big.scenario.json', cases: Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, name: 'n', utterances: Array(8).fill('x'.repeat(4000)), expect: { contains: ['y'.repeat(500)] } })) })).rejects.toThrow(/too large/);
  });
  it('skips unreadable or invalid suite files', async () => {
    const s = store({ files: { [`${ROOT}/tests/bad.scenario.json`]: '{nope', [`${ROOT}/tests/empty.scenario.json`]: '{"cases":[]}', [`${ROOT}/tests/readme.md`]: 'x', [`${ROOT}/tests/ok.scenario.json`]: JSON.stringify({ cases: [caseA] }) } });
    expect((await s.suites.list()).map(x => x.id)).toEqual(['ok']);
    expect(await store().suites.list()).toEqual([]);
  });
});

describe('ScenarioSuites.run', () => {
  const files = { [`${ROOT}/tests/Bot.scenario.json`]: JSON.stringify({ cases: [
    { id: 'refund', name: 'Refund', utterances: ['I want a refund'], expect: { contains: ['refund'], topic: 'refunds', actions: ['LookupOrder'], criteria: 'polite' } },
    { id: 'other', name: 'Other', utterances: ['hello', 'bye'], expect: { contains: ['missing text'] } }
  ] }) };
  const input = { path: 'tests/Bot.scenario.json', source: 'config: x', engine: 'preview' as const, agentPath: 'Bot.agent' };

  it('runs cases sequentially, ends every session, traces for topic/action and persists bounded results', async () => {
    const s = store({ files });
    const order: string[] = [];
    s.lab.start.mockImplementation((async () => { order.push('start'); return { id: `run-${order.length}`, turns: [] }; }) as never);
    s.lab.end.mockImplementation((() => { order.push('end'); }) as never);
    const run = await s.suites.run(input);
    expect(order).toEqual(['start', 'end', 'start', 'end']);
    expect(run.results.refund!.outcome).toBe('pass');
    expect(run.results.other!.outcome).toBe('fail');
    expect(run.details[1]!.notes[0]).toContain('missing text');
    expect(s.lab.trace).toHaveBeenCalledWith({ id: 'run-1', planId: 'p1', path: 'Bot.agent' });
    expect(s.lab.send).toHaveBeenCalledTimes(3);
    expect(s.lab.start.mock.calls[0]![0]).toMatchObject({ engine: 'preview', scenario: { maxTurns: 1, opening: 'I want a refund', criteria: 'polite' } });
    expect(s.kv.get('studio:suites:p1')).toMatchObject({ Bot: { refund: { outcome: 'pass' } } });
    const listed = await s.suites.list();
    expect(listed[0]!.lastResults!.other!.outcome).toBe('fail');
    expect(s.changed).toHaveBeenCalledWith({ path: 'tests/Bot.scenario.json', kind: 'suites' });
  });
  it('rerunning selected cases keeps other results; rehearse cannot check topics', async () => {
    const s = store({ files });
    await s.suites.run(input);
    const again = await s.suites.run({ ...input, engine: 'rehearsal', caseIds: ['refund'] });
    expect(again.details).toHaveLength(1);
    expect(again.results.refund!.outcome).toBe('inconclusive');
    expect(again.results.other!.outcome).toBe('fail');
    expect(s.lab.trace).toHaveBeenCalledTimes(1);
  });
  it('records errors per case, tolerates end/evaluate failures and refuses overlapping or empty runs', async () => {
    const s = store({ files });
    s.lab.send.mockRejectedValue(new Error('budget'));
    s.lab.end.mockImplementation((() => { throw new Error('expired'); }) as never);
    const run = await s.suites.run(input);
    expect(run.details.every(d => d.outcome === 'inconclusive' && d.notes[0] === 'budget')).toBe(true);
    const t = store({ files });
    t.lab.evaluate.mockRejectedValue(new Error('no model'));
    t.lab.trace.mockResolvedValue({ runId: 'r', turn: 1, available: false, reason: 'x', steps: [] });
    expect((await t.suites.run({ ...input, caseIds: ['refund'] })).results.refund!.outcome).toBe('inconclusive');
    await expect(t.suites.run({ ...input, path: 'tests/Missing.scenario.json' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(t.suites.run({ ...input, caseIds: ['zzz'] })).rejects.toMatchObject({ code: 'invalid_input' });
    const slow = store({ files });
    let release!: () => void;
    slow.lab.start.mockImplementation((() => new Promise(r => { release = () => r({ id: 'x', turns: [] }); })) as never);
    const first = slow.suites.run(input);
    await new Promise(r => setTimeout(r, 0));
    await expect(slow.suites.run(input)).rejects.toThrow(/already running/);
    release();
    slow.lab.start.mockResolvedValue({ id: 'y', turns: [] } as never);
    await first;
  });
  it('bounds stored suite results', async () => {
    const s = store({ files });
    for (let i = 0; i < SUITE_LIMITS.stored + 3; i++) {
      s.files.set(`${ROOT}/tests/S${i}.scenario.json`, JSON.stringify({ cases: [caseA] }));
      await s.suites.run({ ...input, path: `tests/S${i}.scenario.json` });
    }
    expect(Object.keys(s.kv.get('studio:suites:p1') as object)).toHaveLength(SUITE_LIMITS.stored);
  });
});

describe('registerStudioPreview', () => {
  function harness() {
    const fake = fsFake();
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const published: unknown[] = [];
    const lab = { trace: vi.fn(async () => ({ runId: 'r', turn: 1, available: false, reason: 'Approximation', steps: [] })), start: vi.fn(), send: vi.fn(), evaluate: vi.fn(), end: vi.fn() };
    registerStudioPreview({
      zcc: { storage: { kv: { get: async () => undefined, set: async () => undefined } }, realtime: { publish: (...a: unknown[]) => published.push(a) } },
      registerRpc: (name: string, h: (args: unknown) => unknown) => handlers.set(name, async a => h(a)),
      contexts: { current: () => ({ projectId: 'p1', settings: { projectRoot: ROOT } }) },
      deps: { ...fake.deps, now: () => 5 }, lab
    } as never);
    return { handlers, lab, published, files: fake.files };
  }
  it('registers trace and the three suite RPCs', async () => {
    const h = harness();
    expect([...h.handlers.keys()].sort()).toEqual([STUDIO_RPC.suiteRun, STUDIO_RPC.suiteSave, STUDIO_RPC.suites, STUDIO_RPC.trace].sort());
    expect(await h.handlers.get(STUDIO_RPC.trace)!({ id: 'r' })).toMatchObject({ ok: true, data: { available: false } });
    expect(await h.handlers.get(STUDIO_RPC.suites)!({})).toEqual({ ok: true, suites: [] });
    const saved = await h.handlers.get(STUDIO_RPC.suiteSave)!({ agentPath: 'Bot.agent', cases: [caseA] }) as { ok: boolean; suite: { sha256: string; path: string } };
    expect(saved).toMatchObject({ ok: true, suite: { path: 'tests/Bot.scenario.json' } });
    expect(h.published).toEqual([[ 'sf.studio.changed', { projectId: 'p1', path: 'tests/Bot.scenario.json', kind: 'suites' } ]]);
    expect(await h.handlers.get(STUDIO_RPC.suiteSave)!({ agentPath: 'Bot.agent', cases: [caseA] })).toMatchObject({ ok: false, code: 'sha_mismatch' });
    expect(await h.handlers.get(STUDIO_RPC.suiteSave)!({ cases: [caseA] })).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(await h.handlers.get(STUDIO_RPC.suiteRun)!({ agentPath: 'Bot.agent' })).toMatchObject({ ok: false, code: 'invalid_input' });
  });
  it('runs a suite end to end through the lab', async () => {
    const h = harness();
    h.files.set(`${ROOT}/tests/Bot.scenario.json`, JSON.stringify({ cases: [caseA] }));
    h.lab.start.mockResolvedValue({ id: 'run-1', turns: [] } as never);
    h.lab.send.mockResolvedValue({ turns: [{ role: 'user', text: 'q' }, { role: 'agent', text: 'a refund is coming' }] } as never);
    const out = await h.handlers.get(STUDIO_RPC.suiteRun)!({ agentPath: 'Bot.agent', source: 'config', engine: 'rehearsal', caseIds: ['refund'] }) as { ok: boolean; results: Record<string, { outcome: string }> };
    expect(out.ok).toBe(true);
    expect(out.results.refund!.outcome).toBe('pass');
    expect(h.lab.start.mock.calls[0]![0]).toMatchObject({ engine: 'rehearsal' });
  });
  it('turns thrown errors into failures', async () => {
    const h = harness();
    h.lab.trace.mockRejectedValue(new Error('boom'));
    expect(await h.handlers.get(STUDIO_RPC.trace)!({})).toEqual({ ok: false, code: 'failed', error: 'boom' });
  });
});
