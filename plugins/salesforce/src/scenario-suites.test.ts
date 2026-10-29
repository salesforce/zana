import { describe, expect, it, vi } from 'vitest';
import { EVIDENCE_LIMITS, ScenarioSuites, SUITE_LIMITS, caseResult, confineSuitePath, judgeCase, loopNext, parseScenarioCases, registerStudioPreview, specPathForSuite, suitePathForAgent, type StudioPreviewOptions } from '../lib/scenario-suites.js';
import { sha256Hex } from '../lib/agent-files.js';
import { GENERATED_SPEC_MARKER } from '../lib/eval-spec.js';
import type { FixLoop } from '../lib/fix-loop.js';
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

function store(opts: { files?: Record<string, string>; links?: Record<string, string>; lab?: Record<string, unknown>; project?: () => string } = {}) {
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
    deps: fake.deps, lab: lab as never, root: () => ROOT, project: opts.project ?? (() => 'p1'), now: () => ++time, changed,
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
  it('confines eval specs to tests/<name>.eval.yaml', () => {
    const { deps } = fsFake();
    expect(specPathForSuite('tests/Bot.scenario.json')).toBe('tests/Bot.eval.yaml');
    expect(confineSuitePath(ROOT, 'tests/Bot.eval.yaml', deps, 'spec')).toBe(`${ROOT}/tests/Bot.eval.yaml`);
    expect(() => confineSuitePath(ROOT, 'tests/Bot.scenario.json', deps, 'spec')).toThrow(/Eval specs live at/);
    expect(() => confineSuitePath(ROOT, 'tests/Bot.eval.yaml', deps)).toThrow(/Scenario suites live at/);
  });
  it('refuses a tests folder or file that symlinks outside the project', () => {
    const outside = fsFake({ [`${ROOT}/tests/a.scenario.json`]: '{}' }, { [`${ROOT}/tests`]: '/elsewhere/tests' });
    expect(() => confineSuitePath(ROOT, 'tests/a.scenario.json', outside.deps)).toThrow(/inside the project/);
    const fileLink = fsFake({ [`${ROOT}/tests/a.scenario.json`]: '{}' }, { [`${ROOT}/tests/a.scenario.json`]: '/elsewhere/a.json' });
    expect(() => confineSuitePath(ROOT, 'tests/a.scenario.json', fileLink.deps)).toThrow(/outside/);
  });
});

describe('case parsing', () => {
  it('replays the saved context for each case and rejects invalid saved overrides', async () => {
    const { suites, lab } = store();
    const contextVariables = [{ name: 'verified', type: 'Boolean', value: false }];
    await suites.save({ path: 'tests/A.scenario.json', cases: [{ ...caseA, contextVariables }] });
    await suites.run({ path: 'tests/A.scenario.json', source: 'source', engine: 'preview' });
    expect(lab.start).toHaveBeenCalledWith(expect.objectContaining({ contextVariables }));
    expect(() => parseScenarioCases([{ ...caseA, contextVariables: [{ name: 'bad', type: 'Number', value: '0' }] }])).toThrow();
  });
  it('normalizes and bounds cases', () => {
    const [c] = parseScenarioCases([{ id: 'a b!', name: ' N ', utterances: ['hi', '', 5, ...Array(20).fill('x')], expect: { topic: 't', actions: ['A'], contains: ['c'], criteria: 'crit', junk: 1 } }]);
    expect(c).toMatchObject({ id: 'a_b_', name: 'N', expect: { topic: 't', actions: ['A'], contains: ['c'], criteria: 'crit' } });
    expect(c!.utterances).toHaveLength(SUITE_LIMITS.utterances);
    expect(parseScenarioCases([{ utterances: ['x'] }])[0]).toMatchObject({ id: 'case-1', name: 'Case 1' });
  });
  it('keeps a pinned run reference only when it is well formed', () => {
    const [pinned, noTime, noRun] = parseScenarioCases([
      { ...caseA, id: 'a', pinned: { runId: 'run-9', at: 12 } },
      { ...caseA, id: 'b', pinned: { runId: 'run-9', at: 'soon' } },
      { ...caseA, id: 'c', pinned: { at: 12 } }
    ]);
    expect(pinned!.pinned).toEqual({ runId: 'run-9', at: 12 });
    expect(noTime).not.toHaveProperty('pinned');
    expect(noRun).not.toHaveProperty('pinned');
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

  it('persists recorded conversations independently of preview sessions and bounds their size', () => {
    const base = { caseId: 'c', outcome: 'pass' as const, runId: 'r', at: 1, notes: [] };
    const turns = [{ role: 'user' as const, text: 'Find my order' }, { role: 'agent' as const, text: 'Your order number?' }];
    expect(caseResult({ ...base, turns })).toMatchObject({ conversation: [{ role: 'user', message: 'Find my order' }, { role: 'agent', message: 'Your order number?' }] });
    expect(caseResult({ ...base, turns }).conversationTruncated).toBeUndefined();
    const oversized = caseResult({ ...base, turns: Array.from({ length: 20 }, () => ({ role: 'agent' as const, text: 'x'.repeat(5000) })) });
    expect(oversized.conversationTruncated).toBe(true);
    expect(oversized.conversation!.reduce((size, turn) => size + turn.message.length, 0)).toBe(EVIDENCE_LIMITS.conversationChars);
    expect(oversized.conversation!.every(turn => turn.message.length <= EVIDENCE_LIMITS.message)).toBe(true);
    const many = caseResult({ ...base, turns: Array.from({ length: 20 }, () => ({ role: 'user' as const, text: 'x' })) });
    expect(many.conversation).toHaveLength(EVIDENCE_LIMITS.conversationTurns);
    expect(many.conversationTruncated).toBe(true);
  });
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
  it('saves bounded evidence with each result so a Fail still says why after a reload', async () => {
    const s = store({ files });
    s.lab.evaluate.mockResolvedValue({ verdict: { outcome: 'pass', reason: 'polite' } } as never);
    await s.suites.run(input);
    const saved = (await s.suites.list())[0]!.lastResults!;
    expect(saved.other).toMatchObject({ outcome: 'fail', notes: ['Missing text: "missing text"'], observed: { traced: true } });
    expect(saved.refund).toMatchObject({ outcome: 'pass', observed: { traced: true }, judge: 'pass' });
  });
  it('exposes live stages, turns and completed evidence through list without persisting progress', async () => {
    const s = store({ files });
    const snapshots: Array<NonNullable<Awaited<ReturnType<typeof s.suites.list>>[number]['progress']>> = [];
    const capture = async () => { snapshots.push((await s.suites.list())[0]!.progress!); };
    s.lab.start.mockImplementation((async () => { await capture(); return { id: 'r', turns: [] }; }) as never);
    s.lab.send.mockImplementation((async () => { await capture(); return { turns: [{ role: 'user', text: 'q' }, { role: 'agent', text: 'refund', planId: 'p' }] }; }) as never);
    s.lab.trace.mockImplementation(async () => { await capture(); return { runId: 'r', turn: 1, available: true, steps: [] }; });
    s.lab.evaluate.mockImplementation((async () => { await capture(); return { verdict: { outcome: 'pass', reason: 'ok' } }; }) as never);
    await s.suites.run(input);
    expect(snapshots.map(p => [p.currentCaseId, p.stage, p.turn])).toEqual([
      ['refund', 'starting', 0], ['refund', 'conversation', 1], ['refund', 'trace', 1], ['refund', 'judging', 1],
      ['other', 'starting', 0], ['other', 'conversation', 1], ['other', 'conversation', 2], ['other', 'trace', 2]
    ]);
    expect(snapshots[0]).toMatchObject({ mode: 'simulate', completed: 0, caseIds: ['refund', 'other'], totalTurns: 1 });
    expect(snapshots[4]).toMatchObject({ completed: 1, totalTurns: 2, results: { refund: { outcome: 'fail', reply: 'refund' } } });
    expect((await s.suites.list())[0]).not.toHaveProperty('progress');
    expect(JSON.stringify(s.kv.get('studio:suites:p1'))).not.toContain('stage');
    expect(s.changed.mock.calls.at(-1)).toEqual([{ path: input.path, kind: 'suite-progress' }]);
  });
  it('cleans progress and releases the lock after a storage failure', async () => {
    const s = store({ files });
    const original = s.kv.set.bind(s.kv);
    const fail = vi.spyOn(s.kv, 'set').mockImplementationOnce(() => { throw new Error('Storage failed'); });
    await expect(s.suites.run(input)).rejects.toThrow('Storage failed');
    expect((await s.suites.list())[0]).not.toHaveProperty('progress');
    fail.mockImplementation(original);
    await expect(s.suites.run(input)).resolves.toHaveProperty('results');
  });
  it('never exposes another project or suite progress', async () => {
    let project = 'p1';
    const s = store({ files: { ...files, [`${ROOT}/tests/Other.scenario.json`]: JSON.stringify({ cases: [caseA] }) }, project: () => project });
    let release!: () => void;
    s.lab.start.mockImplementationOnce((() => new Promise(resolve => { release = () => resolve({ id: 'r', turns: [] }); })) as never);
    const run = s.suites.run(input);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect((await s.suites.list()).find(suite => suite.id === 'Other')).not.toHaveProperty('progress');
    project = 'p2';
    expect((await s.suites.list()).every(suite => !suite.progress)).toBe(true);
    project = 'p1';
    expect((await s.suites.list()).find(suite => suite.id === 'Bot')).toHaveProperty('progress');
    release();
    await run;
  });
  it('limits selected progress to the actual cases and keeps proposal evidence ephemeral', async () => {
    const s = store({ files });
    let observed: unknown;
    s.lab.start.mockImplementation((async () => {
      observed = (await s.suites.list())[0]!.progress;
      return { id: 'r', turns: [] };
    }) as never);
    await s.suites.run({ ...input, caseIds: ['other'], store: false });
    expect(observed).toMatchObject({ mode: 'proposal', caseIds: ['other'], completed: 0 });
    expect((await s.suites.list())[0]).not.toHaveProperty('progress');
    expect(s.kv.size).toBe(0);
  });
  it('shows an indeterminate org eval and clears it on refusal and thrown failures', async () => {
    const s = store({ files });
    s.files.set(`${ROOT}/tests/Bot.scenario.json`, JSON.stringify({ cases: [caseA, { id: 'other', utterances: ['hello'], expect: {} }] }));
    const agent = { agentPath: 'Bot.agent', apiName: 'Bot' };
    const refused = await s.suites.evaluate(agent, async () => {
      expect((await s.suites.list())[0]!.progress).toMatchObject({ mode: 'org-eval', stage: 'org-eval', caseIds: ['refund', 'other'], completed: 0 });
      return { ok: false, code: 'refused', error: 'No access' };
    });
    expect(refused).toMatchObject({ ok: false, code: 'refused' });
    expect((await s.suites.list())[0]).not.toHaveProperty('progress');
    await expect(s.suites.evaluate(agent, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect((await s.suites.list())[0]).not.toHaveProperty('progress');
  });
  it('caps stored evidence', () => {
    const long = 'x'.repeat(1000);
    const row = caseResult({ caseId: 'c', outcome: 'fail', runId: 'r', at: 1, notes: Array(9).fill(long), turns: [{ role: 'agent', text: long }, { role: 'user', text: 'u' }], observed: { topics: Array(20).fill(long), actions: [], traced: true } });
    expect(row.notes).toHaveLength(EVIDENCE_LIMITS.notes);
    expect(row.notes![0]).toHaveLength(EVIDENCE_LIMITS.note);
    expect(row.reply).toHaveLength(EVIDENCE_LIMITS.reply);
    expect(row.observed!.topics).toHaveLength(EVIDENCE_LIMITS.names);
    expect(row.observed!.topics[0]).toHaveLength(EVIDENCE_LIMITS.name);
    expect(caseResult({ caseId: 'c', outcome: 'pass', runId: 'r', at: 1, notes: [], turns: [] })).toEqual({ outcome: 'pass', runId: 'r', at: 1 });
  });
  it('rerunning selected cases keeps other results; rehearse cannot check topics', async () => {
    const s = store({ files });
    await s.suites.run(input);
    const again = await s.suites.run({ ...input, engine: 'rehearsal', caseIds: ['refund'] });
    expect(again.details).toHaveLength(1);
    expect(again.results.refund!.outcome).toBe('inconclusive');
    expect(again.results.other!.outcome).toBe('fail');
    expect(s.lab.trace).toHaveBeenCalledTimes(2);
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
  it('keeps a candidate run out of the stored results', async () => {
    const s = store({ files });
    await s.suites.run({ ...input, caseIds: ['other'] });
    s.changed.mockClear();
    const candidate = await s.suites.run({ ...input, caseIds: ['refund'], store: false });
    expect(Object.keys(candidate.results)).toEqual(['refund']);
    expect(candidate.suite.lastResults).toEqual({ other: expect.objectContaining({ outcome: 'fail' }) });
    expect(s.kv.get('studio:suites:p1')).toEqual({ Bot: { other: expect.objectContaining({ outcome: 'fail' }) } });
    expect(s.changed.mock.calls.every(([payload]) => payload.kind === 'suite-progress')).toBe(true);
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

describe('ScenarioSuites specs and org evals', () => {
  const agentPath = 'force-app/Bot.agent';
  const suiteFile = `${ROOT}/tests/Bot.scenario.json`;
  const specFile = `${ROOT}/tests/Bot.eval.yaml`;
  const two = [caseA, { id: 'greet', name: 'Greet', utterances: ['Hi', 'Order?'], expect: { topic: 'Orders' } }];
  const withSuite = () => {
    const s = store({ files: { [suiteFile]: JSON.stringify({ cases: two }) } });
    const c = parseScenarioCases(two)[1]!;
    s.kv.set('studio:suites:p1', { Bot: { greet: { outcome: 'pass', runId: 'r', at: 1, sourceHash: sha256Hex('saved source'), caseHash: sha256Hex(JSON.stringify(c)), history: [{ role: 'user', message: 'Hi' }, { role: 'agent', message: 'Hello', topic: 'welcome' }] } } });
    return s;
  };

  it('imports a YAML spec into a new suite, then merges more cases with suffixed ids', async () => {
    const s = store();
    const first = await s.suites.importSpec({ agentPath, text: 'testCases:\n  - utterance: I want a refund\n    expectedTopic: Billing\n' });
    expect(first.imported).toBe(1);
    expect(first.suite.cases).toEqual([{ id: 'i-want-a-refund', name: 'I want a refund', utterances: ['I want a refund'], expect: { topic: 'Billing' } }]);
    const again = await s.suites.importSpec({ agentPath, text: JSON.stringify({ utterances: ['I want a refund', 'Bye'] }) });
    expect(again.suite.cases.map(c => c.id)).toEqual(['i-want-a-refund', 'case-1', 'case-2']);
    const third = await s.suites.importSpec({ agentPath, text: JSON.stringify([{ id: 'case-1', utterance: 'x' }]) });
    expect(third.suite.cases.map(c => c.id).at(-1)).toBe('case-1-2');
    expect(JSON.parse(s.files.get(suiteFile)!).cases).toHaveLength(4);
  });

  it('refuses an unreadable spec as invalid input', async () => {
    const s = store();
    await expect(s.suites.importSpec({ agentPath, text: '' })).rejects.toMatchObject({ code: 'invalid_input', message: 'The spec is empty.' });
    await expect(s.suites.importSpec({ agentPath, text: JSON.stringify([{ name: 'No words' }]) })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('writes the spec beside the suite, overwrites its own file and refuses anyone else\'s', async () => {
    const s = withSuite();
    const written = await s.suites.writeSpec({ agentPath, apiName: 'Bot_Api' });
    expect(written).toMatchObject({ specPath: 'tests/Bot.eval.yaml', absolute: specFile, multiTurn: ['greet'] });
    expect(s.files.get(specFile)).toBe(written.text);
    expect(written.text).toContain('subjectName: "Bot_Api"');
    await expect(s.suites.writeSpec({ agentPath, apiName: 'Bot_Api' })).resolves.toMatchObject({ specPath: 'tests/Bot.eval.yaml' });
    s.files.set(specFile, 'name: Hand written\n');
    await expect(s.suites.writeSpec({ agentPath, apiName: 'Bot_Api' })).rejects.toMatchObject({ code: 'path_refused', message: expect.stringContaining('was not written by the Studio') });
    expect(s.files.get(specFile)).toBe('name: Hand written\n');
    await expect(store().suites.writeSpec({ agentPath, apiName: 'Bot_Api' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('records per-case org eval outcomes and lists them with the suite', async () => {
    const s = withSuite();
    const runEval = vi.fn(async (spec: { absolute: string; text: string }) => {
      expect(spec.text.startsWith(GENERATED_SPEC_MARKER)).toBe(true);
      return { ok: true as const, summary: '1 of 2 passed', data: { passed: false, orgId: '00D1', orgAlias: 'dev', botVersionId: 'v-2', caseOutcomes: ['pass', 'fail'] as Array<'pass' | 'fail'> } };
    });
    const out = await s.suites.evaluate({ agentPath, apiName: 'Bot' }, runEval);
    expect(out).toMatchObject({ summary: '1 of 2 passed', lastEval: { org: 'dev', orgId: '00D1', passed: false, perCase: true, botVersionId: 'v-2', specPath: 'tests/Bot.eval.yaml', multiTurn: ['greet'], results: { refund: { outcome: 'pass' }, greet: { outcome: 'fail' } } } });
    expect(runEval).toHaveBeenCalledWith(expect.objectContaining({ absolute: specFile, specPath: 'tests/Bot.eval.yaml' }));
    expect(s.changed).toHaveBeenCalledWith({ path: 'tests/Bot.scenario.json', kind: 'suites' });
    expect((await s.suites.list(agentPath))[0]!.lastEval!.results.greet!.outcome).toBe('fail');
    // A saved suite keeps showing its last eval.
    const listed = (await s.suites.list(agentPath))[0]!;
    expect((await s.suites.save({ agentPath, cases: two, expectedSha256: listed.sha256 })).lastEval).toMatchObject({ orgId: '00D1' });
  });

  it('falls back to the run totals without a per-case list and passes failures through', async () => {
    const s = withSuite();
    const passed = await s.suites.evaluate({ agentPath, apiName: 'Bot' }, async () => ({ ok: true, data: { passed: true, orgId: '00D1' } }));
    expect(passed).toMatchObject({ lastEval: { org: '00D1', perCase: false, results: { refund: { outcome: 'pass' }, greet: { outcome: 'pass' } } } });
    expect(passed).not.toHaveProperty('summary');
    const failed = await s.suites.evaluate({ agentPath, apiName: 'Bot' }, async () => ({ ok: true, data: { passed: false, orgId: '00D1', caseOutcomes: null } }));
    expect(failed).toMatchObject({ lastEval: { results: { refund: { outcome: 'inconclusive' } } } });
    expect(await s.suites.evaluate({ agentPath, apiName: 'Bot' }, async () => ({ ok: false, code: 'refused', error: 'Production needs approval.' }))).toEqual({ ok: false, code: 'refused', error: 'Production needs approval.' });
    expect(await s.suites.evaluate({ agentPath, apiName: 'Bot' }, async () => ({ ok: false }))).toEqual({ ok: false, code: 'eval_failed', error: 'The org eval failed.' });
  });

  it('runs one org eval per project at a time and bounds stored evals', async () => {
    const s = withSuite();
    let release!: () => void;
    const first = s.suites.evaluate({ agentPath, apiName: 'Bot' }, () => new Promise(r => { release = () => r({ ok: true, data: { passed: true, orgId: '00D1' } }); }));
    await new Promise(r => setTimeout(r, 0));
    await expect(s.suites.evaluate({ agentPath, apiName: 'Bot' }, async () => ({ ok: false }))).rejects.toThrow(/already running/);
    release();
    await first;
    // The lock is released after a refusal too.
    await expect(store().suites.evaluate({ agentPath, apiName: 'Bot' }, async () => ({ ok: false }))).rejects.toMatchObject({ code: 'not_found' });
    for (let i = 0; i < SUITE_LIMITS.stored + 2; i++) {
      s.files.set(`${ROOT}/tests/S${i}.scenario.json`, JSON.stringify({ cases: [caseA] }));
      await s.suites.evaluate({ agentPath: `S${i}.agent`, apiName: 'Bot' }, async () => ({ ok: true, data: { passed: true, orgId: '00D1' } }));
    }
    expect(Object.keys(s.kv.get('studio:suite-evals:p1') as object)).toHaveLength(SUITE_LIMITS.stored);
  });
});

describe('registerStudioPreview', () => {
  function harness(options?: StudioPreviewOptions) {
    const fake = fsFake();
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const published: unknown[] = [];
    const kv = new Map<string, unknown>();
    const lab = { trace: vi.fn(async () => ({ runId: 'r', turn: 1, available: false, reason: 'Approximation', steps: [] })), start: vi.fn(), send: vi.fn(), evaluate: vi.fn(), end: vi.fn() };
    registerStudioPreview({
      zcc: { onDispose: vi.fn(), storage: { kv: { get: async (k: string) => kv.get(k), set: async (k: string, v: unknown) => { kv.set(k, v); } } }, realtime: { publish: (...a: unknown[]) => published.push(a) } },
      registerRpc: (name: string, h: (args: unknown) => unknown) => handlers.set(name, async a => h(a)),
      contexts: { current: () => ({ projectId: 'p1', settings: { projectRoot: ROOT } }) },
      deps: { ...fake.deps, now: () => 5 }, lab
    } as never, options);
    const call = (name: string, args: unknown = {}) => handlers.get(name)!(args) as Promise<Record<string, any>>;
    return { handlers, lab, published, files: fake.files, call };
  }
  it('registers trace, the suite, eval and fix-loop RPCs', async () => {
    const h = harness();
    expect([...h.handlers.keys()].sort()).toEqual([
      STUDIO_RPC.suiteRun, STUDIO_RPC.suiteStart, STUDIO_RPC.suiteResult, STUDIO_RPC.suiteStop, STUDIO_RPC.suiteSave, STUDIO_RPC.suites, STUDIO_RPC.trace, STUDIO_RPC.suiteImport, STUDIO_RPC.suiteSpec,
      STUDIO_RPC.suiteEval, STUDIO_RPC.suiteCompare, STUDIO_RPC.loopStart, STUDIO_RPC.loopGet, STUDIO_RPC.loopStop
    ].sort());
    expect(await h.handlers.get(STUDIO_RPC.trace)!({ id: 'r' })).toMatchObject({ ok: true, data: { available: false } });
    expect(await h.handlers.get(STUDIO_RPC.suites)!({})).toMatchObject({ ok: true, suites: [] });
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
    const out = await h.handlers.get(STUDIO_RPC.suiteRun)!({ agentPath: 'Bot.agent', source: 'config', engine: 'rehearsal', caseIds: ['refund'], threadId: 'owner', startedByUser: true }) as { ok: boolean; results: Record<string, { outcome: string }> };
    expect(out.ok).toBe(true);
    expect(out.results.refund!.outcome).toBe('pass');
    // The owning thread rides along so a production org can be approved there.
    // A click on Run is the approval for its own lab runs.
    expect(h.lab.start.mock.calls[0]![0]).toMatchObject({ engine: 'rehearsal', threadId: 'owner', startedByUser: true });
  });
  it('turns thrown errors into failures', async () => {
    const h = harness();
    h.lab.trace.mockRejectedValue(new Error('boom'));
    expect(await h.handlers.get(STUDIO_RPC.trace)!({})).toEqual({ ok: false, code: 'failed', error: 'boom' });
  });

  describe('with agent files and an org eval runner', () => {
    const agentPath = 'Bot.agent';
    const twoCases = [caseA, { id: 'late', name: 'Late', utterances: ['Where is it?'], expect: { contains: ['tracking'] } }];
    function wired(over: Partial<StudioPreviewOptions> = {}) {
      const agent = vi.fn(async (path: string) => path === agentPath ? { apiName: 'Bot_Api', source: 'config: disk' } : { ok: false as const, code: 'not_found', error: `No agent at ${path}` });
      const runEval = vi.fn(async () => ({ ok: true as const, data: { passed: false, orgId: '00D1', orgAlias: 'dev', caseOutcomes: ['pass', 'fail'] as Array<'pass' | 'fail'> } }));
      let n = 0;
      const h = harness({ agent, runEval, loopId: () => `loop-${++n}`, ...over });
      h.files.set(`${ROOT}/tests/Bot.scenario.json`, JSON.stringify({ cases: twoCases }));
      h.lab.start.mockImplementation((async () => ({ id: 'run-1', turns: [] })) as never);
      return { ...h, agent, runEval };
    }
    const reply = (h: ReturnType<typeof harness>, text: string) => h.lab.send.mockResolvedValue({ turns: [{ role: 'user', text: 'q' }, { role: 'agent', text }] } as never);

    it('confines comparison references, validates candidates and forces an unsaved Simulate comparison', async () => {
      const h = wired();
      expect(await h.call(STUDIO_RPC.suiteCompare, { agentPath: '../outside.agent', source: 'draft' })).toMatchObject({ ok: false, code: 'not_found' });
      for (const source of [undefined, '', ' ', 'x'.repeat(10 * 1024 * 1024 + 1)]) {
        expect(await h.call(STUDIO_RPC.suiteCompare, { agentPath, source })).toMatchObject({ ok: false, code: 'invalid_input' });
      }
      expect(h.lab.start).not.toHaveBeenCalled();
      reply(h, 'refund tracking');
      expect(await h.call(STUDIO_RPC.suiteCompare, { agentPath, source: 'draft', referenceSource: 'forged', engine: 'live', store: true })).toMatchObject({ ok: true, comparison: { referenceHash: sha256Hex('config: disk'), candidateHash: sha256Hex('draft') } });
      expect(h.lab.start.mock.calls.map(([args]) => args)).toEqual([
        expect.objectContaining({ engine: 'preview', source: 'config: disk' }), expect.objectContaining({ engine: 'preview', source: 'config: disk' }),
        expect.objectContaining({ engine: 'preview', source: 'draft' }), expect.objectContaining({ engine: 'preview', source: 'draft' }),
      ]);
      expect((await h.call(STUDIO_RPC.suites, { agentPath })).suites[0]).not.toHaveProperty('lastResults');
    });

    it('imports a spec, writes it and runs the org eval with the agent API name', async () => {
      const h = wired();
      expect(await h.call(STUDIO_RPC.suiteImport, { agentPath, text: 'testCases:\n  - utterance: Cancel my order\n' })).toMatchObject({ ok: true, imported: 1, suite: { cases: [{ id: 'refund' }, { id: 'late' }, { id: 'cancel-my-order' }] } });
      expect(await h.call(STUDIO_RPC.suiteImport, { agentPath })).toMatchObject({ ok: false, code: 'invalid_input' });
      const spec = await h.call(STUDIO_RPC.suiteSpec, { agentPath });
      expect(spec).toMatchObject({ ok: true, specPath: 'tests/Bot.eval.yaml', multiTurn: [] });
      expect(spec.text).toContain('subjectName: "Bot_Api"');
      const evaluated = await h.call(STUDIO_RPC.suiteEval, { agentPath });
      expect(evaluated).toMatchObject({ ok: true, lastEval: { org: 'dev', results: { refund: { outcome: 'pass' }, late: { outcome: 'fail' }, 'cancel-my-order': { outcome: 'inconclusive' } } } });
      expect(h.runEval).toHaveBeenCalledWith(expect.objectContaining({ apiName: 'Bot_Api', specPath: 'tests/Bot.eval.yaml', absolute: `${ROOT}/tests/Bot.eval.yaml` }));
      h.runEval.mockResolvedValueOnce({ ok: false, code: 'refused', error: 'Allow reads first.' } as never);
      expect(await h.call(STUDIO_RPC.suiteEval, { agentPath })).toEqual({ ok: false, code: 'refused', error: 'Allow reads first.' });
    });

    it('refuses evals and specs without a configured runner, an agent file or a known agent', async () => {
      const bare = harness();
      expect(await bare.call(STUDIO_RPC.suiteEval, { agentPath })).toMatchObject({ ok: false, code: 'not_configured' });
      expect(await bare.call(STUDIO_RPC.suiteSpec, { agentPath })).toMatchObject({ ok: false, code: 'not_configured' });
      const h = wired();
      expect(await h.call(STUDIO_RPC.suiteSpec, {})).toMatchObject({ ok: false, code: 'invalid_input', error: 'Pick an agent file first.' });
      expect(await h.call(STUDIO_RPC.suiteEval, { agentPath: 'Other.agent' })).toEqual({ ok: false, code: 'not_found', error: 'No agent at Other.agent' });
    });

    it('runs the saved file when a caller sends no source', async () => {
      const h = wired();
      reply(h, 'a refund is coming');
      expect(await h.call(STUDIO_RPC.suiteRun, { agentPath, caseIds: ['refund'] })).toMatchObject({ ok: true, results: { refund: { outcome: 'pass' } } });
      expect(h.lab.start.mock.calls[0]![0]).toMatchObject({ source: 'config: disk', engine: 'preview' });
      const bare = harness();
      expect(await bare.call(STUDIO_RPC.suiteRun, { agentPath, source: '  ' })).toMatchObject({ ok: false, code: 'invalid_input', error: 'run requires the agent source.' });
    });

    it('spends a fix loop on Simulate runs of its cases only, without storing them, until they pass', async () => {
      const h = wired();
      expect(await h.call(STUDIO_RPC.loopStart, { agentPath, caseIds: ['late', 'ghost', 7] })).toMatchObject({ ok: true, loop: { id: 'loop-1', caseIds: ['late'], budget: 3, status: 'running' } });
      expect(h.published.at(-1)).toEqual(['sf.studio.changed', { projectId: 'p1', path: agentPath, kind: 'loop', loopId: 'loop-1' }]);
      reply(h, 'Sorry, I cannot help');
      const miss = await h.call(STUDIO_RPC.suiteRun, { agentPath, source: 'candidate 1', loopId: 'loop-1', engine: 'rehearsal', caseIds: ['refund'], startedByUser: true });
      expect(miss).toMatchObject({ ok: true, results: { late: { outcome: 'fail' } }, loop: { attempts: [{ n: 1, pass: 0, failing: ['late'] }] }, next: '2 attempts left. Still failing: late.' });
      expect(h.lab.start.mock.calls[0]![0]).toMatchObject({ engine: 'preview', source: 'candidate 1' });
      // A fix loop's attempts are agent-driven: they never carry a click's approval.
      expect(h.lab.start.mock.calls[0]![0]).not.toHaveProperty('startedByUser');
      reply(h, 'Here is your tracking link');
      const hit = await h.call(STUDIO_RPC.suiteRun, { agentPath, source: 'candidate 2', loopId: 'loop-1' });
      expect(hit).toMatchObject({ loop: { status: 'passed' }, next: 'All 1 cases pass. Propose this source with ui.command editor.proposeEdit, then stop.' });
      expect(await h.call(STUDIO_RPC.suites, { agentPath })).toMatchObject({ suites: [{ id: 'Bot' }] });
      expect((await h.call(STUDIO_RPC.suites, { agentPath })).suites[0]).not.toHaveProperty('lastResults');
      expect(await h.call(STUDIO_RPC.suiteRun, { agentPath, source: 'candidate 3', loopId: 'loop-1' })).toMatchObject({ ok: false, code: 'loop_passed' });
      expect(await h.call(STUDIO_RPC.suiteRun, { agentPath: 'Other.agent', source: 'x', loopId: 'loop-1' })).toMatchObject({ ok: false, code: 'path_refused' });
      expect(await h.call(STUDIO_RPC.loopGet, { agentPath })).toMatchObject({ ok: true, loop: { id: 'loop-1', status: 'passed' }, next: expect.stringContaining('All 1 cases pass') });
    });

    it('reads, stops and refuses loops', async () => {
      const h = wired();
      expect(await h.call(STUDIO_RPC.loopGet, { agentPath })).toEqual({ ok: true, loop: null });
      expect(await h.call(STUDIO_RPC.loopStart, { agentPath, caseIds: ['ghost'] })).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(await h.call(STUDIO_RPC.loopStart, { agentPath: 'Other.agent', caseIds: ['late'] })).toMatchObject({ ok: false, code: 'not_found' });
      expect(await h.call(STUDIO_RPC.loopStart, { caseIds: ['late'] })).toMatchObject({ ok: false, code: 'not_found' });
      await h.call(STUDIO_RPC.loopStart, { agentPath, caseIds: ['late'], budget: 1 });
      expect(await h.call(STUDIO_RPC.loopGet, { loopId: 'loop-1' })).toMatchObject({ loop: { budget: 1 }, next: '1 attempt left. Still failing: late.' });
      expect(await h.call(STUDIO_RPC.loopStop, { loopId: 'loop-1' })).toMatchObject({ ok: true, loop: { status: 'stopped' } });
      expect(h.published.at(-1)).toEqual(['sf.studio.changed', { projectId: 'p1', path: agentPath, kind: 'loop', loopId: 'loop-1' }]);
      expect(await h.call(STUDIO_RPC.loopGet, { loopId: 'loop-1' })).toMatchObject({ next: 'This fix loop is stopped. Stop and report what you changed.' });
      expect(await h.call(STUDIO_RPC.loopStop, { loopId: 'nope' })).toMatchObject({ ok: false, code: 'not_found' });
      expect(await h.call(STUDIO_RPC.suiteRun, { agentPath, source: 'x', loopId: 'nope' })).toMatchObject({ ok: false, code: 'not_found' });
    });

    it('tells the agent to propose its best candidate when the budget runs out', async () => {
      const h = wired();
      await h.call(STUDIO_RPC.loopStart, { agentPath, caseIds: ['late'], budget: 1 });
      reply(h, 'no idea');
      expect(await h.call(STUDIO_RPC.suiteRun, { agentPath, source: 'x', loopId: 'loop-1' })).toMatchObject({ loop: { status: 'exhausted' }, next: expect.stringContaining('No attempts left (0 of 1 pass)') });
    });
  });
});

describe('loopNext', () => {
  const loop = (over: Partial<FixLoop>): FixLoop => ({ id: 'l', projectId: 'p', agentPath: 'a', suitePath: 's', caseIds: ['x'], budget: 2, attempts: [], status: 'running', startedAt: 0, updatedAt: 0, ...over });
  it('guides the agent from the loop state', () => {
    expect(loopNext(null)).toBe('This fix loop is gone. Stop and report what you changed.');
    expect(loopNext(loop({}))).toBe('2 attempts left. Still failing: x.');
    expect(loopNext(loop({ status: 'exhausted' }))).toContain('No attempts left (0 of 1 pass)');
    expect(loopNext(loop({ status: 'expired' }))).toBe('This fix loop is expired. Stop and report what you changed.');
  });
});

describe('comparison and faithful multi-turn evidence', () => {
  it('runs identical cases and context on both sources without replacing ordinary results', async () => {
    const s = store();
    const c = { ...caseA, contextVariables: [{ name: 'locale', type: 'Text', value: 'fr' }] };
    await s.suites.save({ agentPath: 'Bot.agent', cases: [c] });
    await s.suites.run({ path: 'tests/Bot.scenario.json', source: 'saved', engine: 'preview' });
    const before = structuredClone(s.kv.get('studio:suites:p1'));
    const compared = await s.suites.run({ path: 'tests/Bot.scenario.json', source: 'draft', referenceSource: 'saved', engine: 'preview', store: false });
    expect(compared.comparison).toMatchObject({ referenceHash: sha256Hex('saved'), candidateHash: sha256Hex('draft'), reference: { refund: { outcome: 'pass' } }, candidate: { refund: { outcome: 'pass' } } });
    expect(s.lab.start.mock.calls.slice(-2).map(([args]) => args)).toMatchObject([{ source: 'saved', contextVariables: c.contextVariables }, { source: 'draft', contextVariables: c.contextVariables }]);
    expect(s.kv.get('studio:suites:p1')).toEqual(before);
    expect(s.lab.end).toHaveBeenCalledTimes(3);
  });
  it('captures complete history, exports the final message and rejects stale source/cases', async () => {
    const s = store();
    const c = { id: 'two', name: 'Two turns', utterances: ['Hi', 'Order?'], expect: { topic: 'refunds' } };
    await s.suites.save({ agentPath: 'Bot.agent', cases: [c] });
    const turns: Array<{ role: 'user' | 'agent'; text: string; planId?: string; latencyMs?: number }> = [{ role: 'agent', text: 'Welcome' }];
    s.lab.send.mockImplementation((async ({ text }: { text: string }) => { turns.push({ role: 'user', text }, { role: 'agent', text: 'Hello', planId: `p${turns.length}`, latencyMs: 100 }); return { turns: [...turns] }; }) as never);
    const result = await s.suites.run({ path: 'tests/Bot.scenario.json', source: 'saved', engine: 'preview' });
    expect(result.results.two).toMatchObject({ latencyMs: 100, history: [{ role: 'user', message: 'Hi' }, { role: 'agent', message: 'Hello', topic: 'refunds' }] });
    const written = await s.suites.writeSpec({ agentPath: 'Bot.agent', apiName: 'Bot', source: 'saved' });
    expect(written.text).toContain('- utterance: "Order?"\n    conversationHistory:');
    await expect(s.suites.writeSpec({ agentPath: 'Bot.agent', apiName: 'Bot', source: 'new' })).rejects.toThrow(/Complete conversation history/);
    const suite = (await s.suites.list())[0]!;
    await s.suites.save({ agentPath: 'Bot.agent', cases: [{ ...c, utterances: ['Different', 'Order?'] }], expectedSha256: suite.sha256 });
    await expect(s.suites.writeSpec({ agentPath: 'Bot.agent', apiName: 'Bot', source: 'saved' })).rejects.toThrow(/Complete conversation history/);
  });
  it('grades assertion-only cases and saves the measured evidence', async () => {
    const s = store();
    s.lab.send.mockResolvedValue({ turns: [{ role: 'user', text: 'q' }, { role: 'agent', text: 'ok', latencyMs: 100, planId: 'p' }] } as never);
    await s.suites.save({ agentPath: 'Bot.agent', cases: [{ ...caseA, expect: { maxLatencyMs: 200 } }] });
    const run = await s.suites.run({ path: 'tests/Bot.scenario.json', source: 'saved', engine: 'preview' });
    expect(run.results.refund).toMatchObject({ outcome: 'pass', latencyMs: 100, assertions: [{ outcome: 'pass', actual: '100 ms maximum' }] });
    s.lab.send.mockResolvedValue({ turns: [{ role: 'user', text: 'q' }, { role: 'agent', text: 'ok', latencyMs: 500 }] } as never);
    expect((await s.suites.run({ path: 'tests/Bot.scenario.json', source: 'saved', engine: 'preview' })).results.refund?.outcome).toBe('fail');
  });
  it('rejects comparisons that would silently omit cases', async () => {
    const s = store();
    await s.suites.save({ agentPath: 'Bot.agent', cases: Array.from({ length: 21 }, (_, i) => ({ ...caseA, id: `c${i}` })) });
    await expect(s.suites.run({ path: 'tests/Bot.scenario.json', source: 'draft', referenceSource: 'saved', engine: 'preview' })).rejects.toThrow(/at most 20/);
    expect(s.lab.start).not.toHaveBeenCalled();
  });
});

it('separates missing setup from product failures and requires a prepared replay before org export', async () => {
  const { suites, lab } = store();
  const prepared = { ...caseA, prerequisites: ['Account context', 'Address form saved'] };
  await suites.save({ agentPath: 'A.agent', cases: [prepared] });
  const input = { path: 'tests/A.scenario.json', agentPath: 'A.agent', source: 'source', engine: 'preview' as const };
  const blocked = await suites.run(input);
  expect(blocked.results.refund).toMatchObject({ outcome: 'inconclusive', setupBlocked: true });
  expect(lab.start).not.toHaveBeenCalled();
  await expect(suites.writeSpec({ agentPath: 'A.agent', apiName: 'A', source: 'source' })).rejects.toThrow('Prepare');
  const run = await suites.run({ ...input, preparedCaseIds: ['refund'] });
  expect(run.results.refund).toMatchObject({ outcome: 'pass', deterministic: 'pass' });
  expect(lab.start).toHaveBeenCalledOnce();
  await expect(suites.writeSpec({ agentPath: 'A.agent', apiName: 'A', source: 'source' })).resolves.toHaveProperty('text');
  await expect(suites.writeSpec({ agentPath: 'A.agent', apiName: 'A', source: 'edited' })).rejects.toThrow('Prepare');
});

it('does not accept an AI pass as proof of an unobserved lookup, or partial traces as action absence', () => {
  const seen = { agentText: 'No master order exists', topics: [], actions: ['Revalidate_Site_Name'], traced: true, traceComplete: true };
  expect(judgeCase({ actions: ['LookupOrder'], criteria: 'Verify order state' }, seen, { outcome: 'pass', reason: 'Claimed no order' }).outcome).toBe('fail');
  expect(judgeCase({ forbiddenActions: ['SendSignature'] }, seen).outcome).toBe('pass');
  expect(judgeCase({ forbiddenActions: ['SendSignature'] }, { ...seen, traceComplete: false }).outcome).toBe('inconclusive');
  expect(judgeCase({ forbiddenActions: ['*'] }, { ...seen, traceComplete: false }).outcome).toBe('fail');
});

it('cancels the active session, saves completed cases and starts no remaining cases', async () => {
  const controller = new AbortController();
  let release!: () => void;
  const h = store({ lab: { send: vi.fn(async () => { await new Promise<void>(resolve => { release = resolve; }); return { turns: [] }; }) } });
  await h.suites.save({ agentPath: 'A.agent', cases: [caseA, { ...caseA, id: 'second' }] });
  const running = h.suites.run({ path: 'tests/A.scenario.json', source: 'source', engine: 'preview', signal: controller.signal });
  const failed = expect(running).rejects.toThrow();
  await vi.waitFor(() => expect(h.lab.send).toHaveBeenCalledOnce());
  controller.abort();
  expect(h.lab.end).toHaveBeenCalledWith({ id: expect.any(String) });
  release(); await failed;
  expect(h.lab.start).toHaveBeenCalledOnce();
  expect((await h.suites.list())[0]?.progress).toBeUndefined();
  expect((await h.suites.list())[0]?.lastResults?.refund).toMatchObject({ outcome: 'inconclusive', stopped: true });
  expect((await h.suites.list())[0]?.lastResults?.second).toBeUndefined();
});

it('retains completed messages when a later turn is stopped, without assigning a verdict', async () => {
  const controller = new AbortController();
  const h = store();
  h.lab.send.mockResolvedValueOnce({ turns: [{ role: 'user', text: 'First' }, { role: 'agent', text: 'Recorded reply' }] } as never);
  h.lab.send.mockImplementationOnce((async () => { controller.abort(); throw new Error('Stopped during second turn'); }) as never);
  await h.suites.save({ agentPath: 'A.agent', cases: [{ ...caseA, utterances: ['First', 'Second'] }] });
  await expect(h.suites.run({ path: 'tests/A.scenario.json', source: 'source', engine: 'preview', signal: controller.signal })).rejects.toThrow();
  expect((await h.suites.list())[0]?.lastResults?.refund).toMatchObject({ outcome: 'inconclusive', stopped: true, conversation: [{ role: 'user', message: 'First' }, { role: 'agent', message: 'Recorded reply' }] });
});
