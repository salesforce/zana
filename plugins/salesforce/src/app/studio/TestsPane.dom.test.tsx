/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { starterScenarios } from '../../../lib/scenario-library-contract.js';
import { TestsPane, expectLines, fixLoopPrompt, relativeTime, runSummary, type TestsPaneProps } from './TestsPane.js';
import type { ScenarioCase, ScenarioSuite } from '../../../lib/studio-contract.js';
import type { FixLoop } from '../../../lib/fix-loop.js';
import { clearStudioRunWorkspaces } from './run-workspaces.js';

const PATH = 'force-app/main/default/aiAuthoringBundles/MyBot/MyBot.agent';
let realtime: ((payload: unknown) => void) | null = null;
beforeEach(() => {
  clearStudioRunWorkspaces();
  realtime = null;
  (globalThis as Record<string, unknown>).__ZCC_PLUGIN_RUNTIME__ = { useRealtime: (_c: string, h: (p: unknown) => void) => { realtime = h; } };
});
afterEach(() => {
  cleanup();
  delete (globalThis as Record<string, unknown>).__ZCC_PLUGIN_RUNTIME__;
});

const suite = (extra: Partial<ScenarioSuite> = {}): ScenarioSuite & { sha256: string } => ({
  id: 'MyBot', path: 'tests/MyBot.scenario.json', sha256: 'sha-1',
  cases: [
    { id: 'refund', name: 'Refund', utterances: ['I want a refund'], expect: { topic: 'Billing', contains: ['refund'] }, pinned: { runId: 'run-7', at: 1 } },
    { id: 'late', name: 'Late order', utterances: ['Where is it?', 'Order 42'], expect: { actions: ['Lookup'], criteria: 'Gives a date.' } }
  ],
  ...extra
});
const loop = (extra: Partial<FixLoop> = {}): FixLoop => ({
  id: 'loop-1', projectId: 'p1', agentPath: PATH, suitePath: 'tests/MyBot.scenario.json', caseIds: ['late'], budget: 3, attempts: [], status: 'running', startedAt: 1, updatedAt: 1, ...extra
});

type Call = NonNullable<TestsPaneProps['call']>;
type Approve = NonNullable<TestsPaneProps['requestApproval']>;
type Handler = (args: Record<string, unknown>) => unknown;

function setup(overrides: Partial<TestsPaneProps> = {}, handlers: Record<string, Handler> = {}) {
  const table: Record<string, Handler> = {
    'studio.suites.list': () => ({ ok: true, suites: [suite()] }),
    'studio.scenarios.list': () => ({ ok: true, scenarios: starterScenarios() }),
    'studio.loop.get': () => ({ ok: true, loop: null }),
    'agentPreview.presets.list': () => ({ ok: true, presets: [{ id: 'customer', name: 'Customer', revision: 1, values: [{ name: 'verified', type: 'Boolean', value: false }], fields: [] }] }),
    'agentPreview.context': () => ({ ok: true, fields: [] }),
    ...handlers
  };
  const jobs = new Map<string, Promise<unknown>>();
  const call = vi.fn<Call>(async (_plugin, method, args) => {
    const row = args as Record<string, unknown>;
    if (method === 'studio.suites.start') {
      const handler = table[row.compare ? 'studio.suites.compare' : 'studio.suites.run'];
      const jobId = `j-${jobs.size}`;
      jobs.set(jobId, Promise.resolve(handler?.(row) ?? { ok: false }));
      return { ok: true, jobId };
    }
    if (method === 'studio.suites.result') return { ok: true, status: 'completed', result: await jobs.get(String(row.jobId)) };

    const handler = table[method];
    return handler ? handler(args as Record<string, unknown>) : { ok: false, error: `unexpected ${method}` };
  });
  const requestApproval = vi.fn<Approve>(async () => ({ approved: true, token: 'tok-1', expiresAt: 1 }));
  const props: TestsPaneProps = {
    pluginId: 'salesforce', projectId: 'p1', threadId: 't1', path: PATH, source: 'config: editor', visible: true, dirty: false,
    roleplay: <div data-testid="roleplay">Role-play lab</div>, onAskAgent: vi.fn(), call, requestApproval, ...overrides
  };
  const view = render(<TestsPane {...props} />);
  return { call, requestApproval, props, view, table };
}
const button = (name: RegExp | string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const calls = (call: ReturnType<typeof setup>['call'], method: string) => call.mock.calls.filter(([, m, args]) => method === 'studio.suites.run' ? m === 'studio.suites.start' && !(args as Record<string, unknown>).compare : method === 'studio.suites.compare' ? m === 'studio.suites.start' && (args as Record<string, unknown>).compare === true : m === method).map(([, , args]) => args as Record<string, unknown>);

it('saves a reused preset on one case with the suite revision and preserves all other case data', async () => {
  const { call } = setup({}, { 'studio.suites.save': args => ({ ok: true, suite: suite({ cases: args.cases as ScenarioCase[], sha256: 'sha-2' } as any) }) });
  await screen.findByTestId('tests-row-refund'); fireEvent.click(button('Details for Refund'));
  fireEvent.click(screen.getByRole('tab', { name: 'Variables' }));
  await screen.findByRole('option', { name: 'Customer · revision 1' });
  fireEvent.change(screen.getByLabelText('Variable preset'), { target: { value: 'customer' } });
  fireEvent.click(button('Save case variables')); await screen.findByText(/Starting variables saved/);
  expect(calls(call, 'studio.suites.save')).toEqual([{ projectId: 'p1', agentPath: PATH, expectedSha256: 'sha-1', cases: [
    { ...suite().cases[0], contextVariables: [{ name: 'verified', type: 'Boolean', value: false }] }, suite().cases[1],
  ] }]);
  expect(button('Save case variables').disabled).toBe(true);
  fireEvent.click(button('Details for Late order')); fireEvent.click(screen.getByRole('tab', { name: 'Variables' }));
  expect(screen.queryByLabelText('verified value')).toBeNull();
});

it.each(['conflict', 'missing-response', 'missing-revision'])('keeps case variable drafts on %s and reports the save failure', async failure => {
  const { call } = setup({}, {
    'studio.suites.list': () => ({ ok: true, suites: [{ ...suite(), ...(failure === 'missing-revision' ? { sha256: undefined } : {}) }] }),
    'studio.suites.save': () => failure === 'conflict' ? { ok: false, error: 'Suite changed on disk' } : { ok: true },
  });
  await screen.findByTestId('tests-row-refund'); fireEvent.click(button('Details for Refund'));
  fireEvent.click(screen.getByRole('tab', { name: 'Variables' })); await screen.findByRole('option', { name: 'Customer · revision 1' });
  fireEvent.change(screen.getByLabelText('Variable preset'), { target: { value: 'customer' } }); fireEvent.click(button('Save case variables'));
  await screen.findByText(failure === 'conflict' ? 'Suite changed on disk' : failure === 'missing-revision' ? 'Reload test cases before saving variable changes.' : 'The case variables could not be saved.');
  expect((screen.getByLabelText('verified value') as HTMLSelectElement).value).toBe('false');
  expect(calls(call, 'studio.suites.save')).toHaveLength(failure === 'missing-revision' ? 0 : 1);
});

it('describes expectations and the fix-loop prompt', () => {
  expect(expectLines({ topic: 'T', actions: ['A', 'B'], contains: ['x'], criteria: 'Be kind.' })).toEqual(['Topic T', 'Calls A, B', 'Mentions "x"', 'Be kind.']);
  expect(expectLines({})).toEqual([]);
  const prompt = fixLoopPrompt(loop({ caseIds: ['late', 'ghost'] }), PATH, suite().cases);
  expect(prompt).toContain('"Late order" (late), ghost');
  expect(prompt).toContain('fix loop loop-1. You have 3 Simulate runs and may only change force-app/');
  expect(prompt).toContain('"loopId": "loop-1"');
  expect(prompt).toContain('Do not save, publish or activate anything.');
});

it('asks for a file, and keeps the role-play view without one', () => {
  const { call } = setup({ path: null });
  const views = within(screen.getByRole('group', { name: 'Tests view' })).getAllByRole('button');
  expect(views.map(view => view.textContent)).toEqual(['Scenarios', 'Test cases', 'Batch simulations', 'Role-play']);
  expect(views.map(view => view.title)).toEqual([
    'Create reusable customer setups and starting variables.',
    'Replay saved scenarios and check expected outcomes for this agent.',
    'Run multiple AI customer conversations across scenarios and repeats.',
    'Explore one AI customer conversation with its setup, chat and traces.'
  ]);
  expect(screen.getByText('Open an agent file to test it.')).toBeTruthy();
  expect(call).not.toHaveBeenCalled();
  fireEvent.click(button('Role-play'));
  expect(screen.getByTestId('roleplay')).toBeTruthy();
});

it('selects Batch simulations and returns to Test cases before opening an agent', async () => {
  setup({ path: null });
  fireEvent.click(button('Batch simulations'));
  expect(await screen.findByText('Open an agent file to simulate conversations with it.')).toBeTruthy();
  expect(button('Batch simulations').getAttribute('aria-pressed')).toBe('true');
  expect(button('Test cases').getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(button('Test cases'));
  expect(screen.getByText('Open an agent file to test it.')).toBeTruthy();
  expect(button('Test cases').getAttribute('aria-pressed')).toBe('true');
  expect(button('Batch simulations').getAttribute('aria-pressed')).toBe('false');
});

it('keeps embedded local suites focused on cases without duplicate view navigation', async () => {
  setup({ casesOnly: true });
  expect(await screen.findByText(/tests\/MyBot\.scenario\.json/)).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Tests view' })).toBeNull();
  expect(button('Run all in Simulate')).toBeTruthy();
});

it('lists concise cases and opens a separate inspector with real run actions', async () => {
  const { call } = setup();
  await screen.findByTestId('tests-cases-workbench');
  expect(calls(call, 'studio.suites.list')[0]).toEqual({ projectId: 'p1', agentPath: PATH });
  expect(within(screen.getByTestId('tests-row-refund')).getByText('Pinned').title).toContain('run-7');
  expect(within(screen.getByTestId('tests-row-late')).getByText('2 turns')).toBeTruthy();
  fireEvent.click(button('Details for Late order'));
  const detail = screen.getByRole('region', { name: 'Case details' });
  expect(within(detail).getByText('This case has not run yet')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Expectations' }));
  expect(screen.getByText('Order 42')).toBeTruthy();
  expect(screen.queryByTestId('tests-summary')).toBeNull();
  expect(button(/Make these pass/).disabled).toBe(true);
});

it('shows an empty suite, a load failure and a thrown error', async () => {
  setup({}, { 'studio.suites.list': () => ({ ok: true, suites: [] }) });
  expect(await screen.findByText(/No cases yet/)).toBeTruthy();
  cleanup();
  setup({}, { 'studio.suites.list': () => ({ ok: false, error: 'Disk is gone' }) });
  expect(await screen.findByText('Disk is gone')).toBeTruthy();
  cleanup();
  setup({}, { 'studio.suites.list': () => { throw new Error('rpc down'); } });
  expect(await screen.findByText('rpc down')).toBeTruthy();
});

it('runs all cases in Simulate, then one, and explains a failing row', async () => {
  const ran = suite({ lastResults: { refund: { outcome: 'pass', runId: 'r1', at: 2 }, late: { outcome: 'fail', runId: 'r2', at: 2 } } });
  const { call, props } = setup({}, {
    'studio.suites.run': () => ({ ok: true, suite: { ...ran, sha256: undefined }, details: [{ caseId: 'late', outcome: 'fail', notes: ['Action "Lookup" not called.'], turns: [{ role: 'user', text: 'Where is it?' }, { role: 'agent', text: 'I cannot tell.' }] }] })
  });
  await screen.findByTestId('tests-cases-workbench');
  fireEvent.click(button('Run all in Simulate'));
  await waitFor(() => expect(within(screen.getByTestId('tests-row-late')).getByText('Failed')).toBeTruthy());
  expect(calls(call, 'studio.suites.run')[0]).toMatchObject({ projectId: 'p1', agentPath: PATH, path: 'tests/MyBot.scenario.json', source: 'config: editor', engine: 'preview', startedByUser: true, threadId: 't1' });
  expect(screen.getByTestId('tests-summary').textContent).toContain('1/2');
  fireEvent.click(screen.getByTestId('tests-row-late'));
  expect(screen.getByText('Action "Lookup" not called.')).toBeTruthy();
  expect(screen.getByText('Not called')).toBeTruthy();
  expect(screen.getByText('I cannot tell.')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Expectations' }));
  expect(screen.getByText('Gives a date.')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Result' }));
  fireEvent.click(button('Fix this case'));
  expect(props.onAskAgent).toHaveBeenCalledWith(expect.stringContaining('Observed: Action "Lookup" not called.'));
  fireEvent.click(button('Run case again'));
  await waitFor(() => expect(calls(call, 'studio.suites.run')).toHaveLength(2));
  expect(calls(call, 'studio.suites.run')[1]).toMatchObject({ caseIds: ['late'] });
  expect(calls(call, 'studio.suites.run')).toHaveLength(2);
});

it('reports a failed run', async () => {
  setup({}, { 'studio.suites.run': () => ({ ok: false, error: 'A suite is already running for this project.' }) });
  await screen.findByTestId('tests-cases-workbench');
  fireEvent.click(button('Run all in Simulate'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'A suite is already running for this project.');
});

it('recovers a running suite, updates rows live and filters progress events by project and suite', async () => {
  let active = suite({ lastResults: { refund: { outcome: 'fail', runId: 'old', at: 1 } }, progress: {
    id: 'run', mode: 'simulate', startedAt: Date.now(), caseIds: ['refund', 'late'], completed: 0,
    currentCaseId: 'refund', stage: 'conversation', turn: 1, totalTurns: 1, results: {}
  } });
  const { call, table } = setup({}, { 'studio.suites.list': () => ({ ok: true, suites: [active] }) });
  await screen.findByTestId('tests-run-progress');
  expect(screen.getByRole('status').textContent).toContain('Refund');
  expect(within(screen.getByTestId('tests-row-refund')).getByText('Running…')).toBeTruthy();
  expect(within(screen.getByTestId('tests-row-late')).getByText('Queued')).toBeTruthy();
  expect(button('Run all in Simulate').disabled).toBe(true);
  expect(screen.getByText('Previous Simulate results')).toBeTruthy();
  fireEvent.click(button('Failing 1'));
  expect(screen.getByTestId('tests-row-late')).toBeTruthy();
  const count = calls(call, 'studio.suites.list').length;
  await act(async () => {
    realtime?.({ kind: 'suite-progress', projectId: 'other', path: active.path });
    realtime?.({ kind: 'suite-progress', projectId: 'p1', path: 'tests/Other.scenario.json' });
  });
  expect(calls(call, 'studio.suites.list')).toHaveLength(count);
  active = { ...active, progress: { ...active.progress!, currentCaseId: 'late', stage: 'judging', completed: 1, results: { refund: { outcome: 'pass', runId: 'new', at: 2, reply: 'Live reply' } } } };
  await act(async () => { realtime?.({ kind: 'suite-progress', projectId: 'p1', path: active.path }); });
  expect(screen.getByRole('status').textContent).toContain('1 of 2 cases complete');
  expect(within(screen.getByTestId('tests-row-refund')).getByText('Passed')).toBeTruthy();
  fireEvent.click(screen.getByTestId('tests-row-refund'));
  expect(screen.getByText('Live reply')).toBeTruthy();
  active = suite({ lastResults: { refund: { outcome: 'pass', runId: 'new', at: 2 } } });
  table['studio.suites.list'] = () => ({ ok: true, suites: [active] });
  await act(async () => { realtime?.({ kind: 'suite-progress', projectId: 'p1', path: active.path }); });
  expect(screen.queryByTestId('tests-run-progress')).toBeNull();
  expect(button('Run all in Simulate').disabled).toBe(false);
});

it('polls active progress after missed realtime messages and stops polling when hidden', async () => {
  const active = suite({ progress: { id: 'r', mode: 'proposal', startedAt: Date.now(), caseIds: ['late'], completed: 1, stage: 'saving', results: { late: { outcome: 'pass', runId: 'r', at: 2 } } } });
  const { call, props, view } = setup({ proposalSource: 'candidate' }, { 'studio.suites.list': () => ({ ok: true, suites: [active] }) });
  await screen.findByTestId('tests-run-progress');
  expect(within(screen.getByTestId('tests-row-late')).getByText('Proposal: Passed')).toBeTruthy();
  vi.useFakeTimers();
  try {
    const count = calls(call, 'studio.suites.list').length;
    await act(async () => { vi.advanceTimersByTime(2000); });
    // The interval was installed before fake timers; re-render hidden then visible to install it under the fake clock.
    view.rerender(<TestsPane {...props} visible={false} />);
    view.rerender(<TestsPane {...props} visible />);
    await act(async () => {});
    const before = calls(call, 'studio.suites.list').length;
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(calls(call, 'studio.suites.list').length).toBeGreaterThan(before);
    expect(before).toBeGreaterThanOrEqual(count);
    view.rerender(<TestsPane {...props} visible={false} />);
    const hidden = calls(call, 'studio.suites.list').length;
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(calls(call, 'studio.suites.list')).toHaveLength(hidden);
  } finally { vi.useRealTimers(); }
});

it('runs the org eval and shows per-case and totals-only results', async () => {
  const evaluated = suite({ lastEval: { at: 3, org: 'dev', orgId: '00D1', passed: false, specPath: 'tests/MyBot.eval.yaml', perCase: true, historyReplay: true, results: { refund: { outcome: 'pass' }, late: { outcome: 'fail' } }, multiTurn: ['late'] } });
  const { call } = setup({}, { 'studio.suites.eval': () => ({ ok: true, summary: 'Eval failed (1 failure(s)) for v-1', suite: evaluated }) });
  await screen.findByTestId('tests-cases-workbench');
  fireEvent.click(button('Run org eval'));
  expect(await screen.findByText('Eval failed (1 failure(s)) for v-1')).toBeTruthy();
  expect(calls(call, 'studio.suites.eval')[0]).toEqual({ projectId: 'p1', agentPath: PATH });
  fireEvent.click(screen.getByTestId('tests-row-late'));
  expect(screen.getByText('Failed · dev')).toBeTruthy();
  expect(screen.getByText(/Final-turn replay with recorded history/)).toBeTruthy();
  cleanup();
  setup({}, { 'studio.suites.list': () => ({ ok: true, suites: [suite({ lastEval: { ...evaluated.lastEval!, perCase: false } })] }) });
  expect(await screen.findByText('Org eval (totals)')).toBeTruthy();
});

it('asks for read approval on a production org, then reruns the eval', async () => {
  let evals = 0;
  const { call, requestApproval } = setup({}, {
    'studio.suites.eval': () => (++evals === 1 ? { ok: false, code: 'refused', error: 'Operator headless eval.run.' } : { ok: true, summary: 'Eval passed (2/2) for v-1', suite: suite() }),
    'release.prepare': () => ({ ok: true, data: { request: { binding: { action: 'org.read', target: '00D1', targetLabel: 'prod (production)', subject: 'MyBot' }, title: 'Allow reads' } } }),
    'release.run': () => ({ ok: true, summary: 'Reading prod allowed' })
  });
  await screen.findByTestId('tests-cases-workbench');
  fireEvent.click(button('Run org eval'));
  expect(await screen.findByText(/needs your approval/)).toBeTruthy();
  fireEvent.click(button('Allow reads…'));
  expect(await screen.findByText('Eval passed (2/2) for v-1')).toBeTruthy();
  expect(calls(call, 'release.prepare')[0]).toMatchObject({ path: PATH, action: 'org.read' });
  expect(requestApproval).toHaveBeenCalledWith('salesforce', expect.objectContaining({ title: 'Allow reads' }));
  expect(calls(call, 'release.run')[0]).toMatchObject({ action: 'org.read', token: 'tok-1' });
});

it('handles declined, refused and unneeded read approvals', async () => {
  const refused = { ok: false, code: 'refused' };
  let evalReply: unknown = refused;
  let prepare: unknown = { ok: true, data: { request: { binding: { action: 'org.read', target: '00D1', targetLabel: 'prod', subject: 'MyBot' }, title: 'Allow reads' } } };
  const { call, requestApproval } = setup({}, {
    'studio.suites.eval': () => evalReply,
    'release.prepare': () => prepare,
    'release.run': () => ({ ok: false, error: 'This approval expired.' })
  });
  await screen.findByTestId('tests-cases-workbench');
  const refuse = async () => { evalReply = refused; fireEvent.click(button('Run org eval')); await screen.findByText(/needs your approval/); };
  await refuse();
  requestApproval.mockResolvedValueOnce({ approved: false, reason: 'cancelled' });
  fireEvent.click(button('Allow reads…'));
  expect(await screen.findByText('Cancelled. Nothing changed.')).toBeTruthy();
  await refuse();
  fireEvent.click(button('Allow reads…'));
  expect(await screen.findByText('This approval expired.')).toBeTruthy();
  await refuse();
  prepare = { ok: false, code: 'not_needed', error: 'dev is a sandbox org' };
  evalReply = { ok: false, error: 'The org eval failed hard.' };
  fireEvent.click(button('Allow reads…'));
  expect(await screen.findByText('The org eval failed hard.')).toBeTruthy();
  await refuse();
  prepare = { ok: false, error: 'No agent' };
  fireEvent.click(button('Allow reads…'));
  expect(await screen.findByText('No agent')).toBeTruthy();
  expect(calls(call, 'release.run')).toHaveLength(1);
});

it('runs an open proposal without storing it', async () => {
  const { call, view, props } = setup({ proposalSource: 'config: proposed' }, {
    'studio.suites.run': () => ({ ok: true, results: { refund: { outcome: 'pass' }, late: { outcome: 'inconclusive' } } })
  });
  await screen.findByTestId('tests-cases-workbench');
  expect(screen.getAllByText('Proposal').length).toBeGreaterThan(0);
  fireEvent.click(button('Run with proposal'));
  expect(await screen.findByText(/Its results are not saved/)).toBeTruthy();
  expect(calls(call, 'studio.suites.run')[0]).toMatchObject({ source: 'config: proposed', store: false, engine: 'preview', startedByUser: true });
  expect(within(screen.getByTestId('tests-row-late')).getByText('Proposal: Needs review')).toBeTruthy();
  view.rerender(<TestsPane {...props} proposalSource={null} />);
  expect(screen.queryByText('Proposal')).toBeNull();
});

it('reports a failed proposal run', async () => {
  setup({ proposalSource: 'x' }, { 'studio.suites.run': () => ({ ok: false }) });
  await screen.findByTestId('tests-cases-workbench');
  fireEvent.click(button('Run with proposal'));
  expect(await screen.findByText('The proposal could not run.')).toBeTruthy();
});

it('adds a case, validates the form and removes a case', async () => {
  const { call } = setup({}, { 'studio.suites.save': args => ({ ok: true, suite: suite({ cases: args.cases as never, sha256: 'sha-2' } as never) }) });
  await screen.findByTestId('tests-cases-workbench');
  fireEvent.click(button('+ Case'));
  const form = screen.getByRole('form', { name: 'New test case' });
  fireEvent.submit(form);
  expect(await screen.findByText('A case needs a name and at least one utterance.')).toBeTruthy();
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Refund' } });
  fireEvent.change(within(form).getByLabelText('Utterances, one per line'), { target: { value: 'Money back\n\nNow' } });
  fireEvent.change(within(form).getByLabelText('Expected topic'), { target: { value: 'Billing' } });
  fireEvent.change(within(form).getByLabelText('Expected actions, comma separated'), { target: { value: 'Refund, Log ,' } });
  fireEvent.change(within(form).getByLabelText('Reply mentions, comma separated'), { target: { value: 'refund' } });
  fireEvent.change(within(form).getByLabelText('Criteria for the AI judge'), { target: { value: 'Polite' } });
  fireEvent.submit(form);
  await waitFor(() => expect(screen.queryByRole('form', { name: 'New test case' })).toBeNull());
  const saved = calls(call, 'studio.suites.save')[0]!;
  expect(saved.expectedSha256).toBe('sha-1');
  expect((saved.cases as unknown[]).at(-1)).toEqual({ id: 'refund-2', name: 'Refund', utterances: ['Money back', 'Now'], expect: { topic: 'Billing', actions: ['Refund', 'Log'], contains: ['refund'], criteria: 'Polite' } });
  fireEvent.click(screen.getByTestId('tests-row-refund'));
  fireEvent.click(screen.getByText('Case options'));
  fireEvent.click(button('Remove case'));
  await waitFor(() => expect(calls(call, 'studio.suites.save')).toHaveLength(2));
  expect((calls(call, 'studio.suites.save')[1]!.cases as Array<{ id: string }>).map(c => c.id)).toEqual(['late', 'refund-2']);
  expect(calls(call, 'studio.suites.save')[1]!.expectedSha256).toBe('sha-2');
});

it('adds the first case without a sha, cancels the form and reports a failed save', async () => {
  const { call } = setup({}, { 'studio.suites.list': () => ({ ok: true, suites: [] }), 'studio.suites.save': () => ({ ok: false, code: 'sha_mismatch', error: 'The scenario file changed on disk.' }) });
  await screen.findByText(/No cases yet/);
  fireEvent.click(button('+ Case'));
  fireEvent.click(button('Cancel'));
  expect(screen.queryByRole('form')).toBeNull();
  fireEvent.click(button('+ Case'));
  const form = screen.getByRole('form', { name: 'New test case' });
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: '!!!' } });
  fireEvent.change(within(form).getByLabelText('Utterances, one per line'), { target: { value: 'Hi' } });
  fireEvent.submit(form);
  expect(await screen.findByText('The scenario file changed on disk.')).toBeTruthy();
  expect(calls(call, 'studio.suites.save')[0]).toEqual({ projectId: 'p1', agentPath: PATH, cases: [{ id: 'case', name: '!!!', utterances: ['Hi'], expect: {} }] });
  expect(screen.getByRole('form', { name: 'New test case' })).toBeTruthy();
});

it('imports a spec file and refuses an oversized one', async () => {
  const { call } = setup({}, {
    'studio.suites.import': args => (String(args.text).includes('bad') ? { ok: false, error: 'Unreadable YAML at line 2.' } : { ok: true, imported: 1, suite: suite() })
  });
  await screen.findByTestId('tests-cases-workbench');
  const input = screen.getByTestId('tests-import-input') as HTMLInputElement;
  const click = vi.spyOn(input, 'click');
  fireEvent.click(button('Import YAML / JSON'));
  expect(click).toHaveBeenCalled();
  fireEvent.change(input, { target: { files: [new File(['testCases:\n  - utterance: Hi'], 'spec.yaml')] } });
  expect(await screen.findByText('Imported 1 case from spec.yaml.')).toBeTruthy();
  expect(calls(call, 'studio.suites.import')[0]).toMatchObject({ agentPath: PATH, text: 'testCases:\n  - utterance: Hi' });
  fireEvent.change(input, { target: { files: [new File(['bad'], 'bad.yaml')] } });
  expect(await screen.findByText('Unreadable YAML at line 2.')).toBeTruthy();
  fireEvent.change(input, { target: { files: [new File(['x'.repeat(256_001)], 'big.json')] } });
  expect(await screen.findByText('The spec is larger than 256 KB.')).toBeTruthy();
  fireEvent.change(input, { target: { files: [] } });
  expect(calls(call, 'studio.suites.import')).toHaveLength(2);
});

it('writes the eval spec and names multi-turn cases', async () => {
  let reply: unknown = { ok: true, specPath: 'tests/MyBot.eval.yaml', multiTurn: ['late'] };
  setup({}, { 'studio.suites.spec': () => reply });
  await screen.findByTestId('tests-cases-workbench');
  fireEvent.click(button('Write eval spec'));
  expect(await screen.findByText('Wrote tests/MyBot.eval.yaml. 1 multi-turn case replays its final turn with recorded history; earlier replies are fixed context.')).toBeTruthy();
  reply = { ok: true, specPath: 'tests/MyBot.eval.yaml', multiTurn: [] };
  fireEvent.click(button('Write eval spec'));
  expect(await screen.findByText('Wrote tests/MyBot.eval.yaml.')).toBeTruthy();
  reply = { ok: false, error: 'tests/MyBot.eval.yaml was not written by the Studio.' };
  fireEvent.click(button('Write eval spec'));
  expect(await screen.findByText(/was not written by the Studio/)).toBeTruthy();
});

it('starts a fix loop for the failing cases, follows it and stops it', async () => {
  const failed = suite({ lastResults: { refund: { outcome: 'pass', runId: 'r', at: 2 }, late: { outcome: 'fail', runId: 'r', at: 2 } } });
  const { call, props } = setup({}, {
    'studio.suites.list': () => ({ ok: true, suites: [failed] }),
    'studio.loop.start': () => ({ ok: true, loop: loop() }),
    'studio.scenarios.list': () => ({ ok: true, scenarios: starterScenarios() }),
    'studio.loop.get': args => ({ ok: true, loop: args.loopId ? loop({ attempts: [{ n: 1, pass: 0, total: 1, at: 2, failing: ['late'] }] }) : null }),
    'studio.loop.stop': () => ({ ok: true, loop: loop({ status: 'stopped' }) })
  });
  await screen.findByTestId('tests-cases-workbench');
  fireEvent.click(button('Make this pass'));
  expect(await screen.findByTestId('tests-loop')).toBeTruthy();
  expect(calls(call, 'studio.loop.start')[0]).toMatchObject({ caseIds: ['late'], budget: 3 });
  expect(props.onAskAgent).toHaveBeenCalledWith(expect.stringContaining('fix loop loop-1'));
  expect(screen.getByText("Waiting for the agent's first run.")).toBeTruthy();
  expect(button('Make this pass').disabled).toBe(true);
  await act(async () => { realtime?.({ projectId: 'p1', kind: 'loop', path: PATH, loopId: 'loop-1' }); });
  expect(await screen.findByText('0 of 1 pass · still failing late')).toBeTruthy();
  // Other projects, files and kinds are ignored.
  await act(async () => { realtime?.({ projectId: 'p2', kind: 'loop', path: PATH, loopId: 'loop-1' }); realtime?.({ kind: 'loop', path: 'other.agent', loopId: 'x' }); realtime?.(null); });
  expect(calls(call, 'studio.loop.get').filter(args => args.loopId)).toHaveLength(1);
  fireEvent.click(button('Stop'));
  expect(await screen.findByText(/stopped · 0 of 3 attempts/)).toBeTruthy();
  expect(calls(call, 'studio.loop.stop')[0]).toMatchObject({ loopId: 'loop-1' });
});

it('blocks the fix loop while the file is unsaved and reports start or stop failures', async () => {
  const failed = suite({ lastResults: { refund: { outcome: 'fail', runId: 'r', at: 2 }, late: { outcome: 'fail', runId: 'r', at: 2 } } });
  const { view, props } = setup({ dirty: true }, {
    'studio.suites.list': () => ({ ok: true, suites: [failed] }),
    'studio.scenarios.list': () => ({ ok: true, scenarios: starterScenarios() }),
    'studio.loop.get': () => ({ ok: true, loop: loop() }),
    'studio.loop.start': () => ({ ok: false, error: 'Pick at least one failing case.' }),
    'studio.loop.stop': () => ({ ok: false })
  });
  await screen.findByTestId('tests-loop');
  expect(button('Make these pass').title).toContain('Save first');
  expect(screen.getByText(/including unsaved changes/)).toBeTruthy();
  fireEvent.click(button('Stop'));
  expect(await screen.findByText('The fix loop could not stop.')).toBeTruthy();
  view.rerender(<TestsPane {...props} dirty={false} />);
  await act(async () => { realtime?.({ projectId: 'p1', kind: 'loop', path: PATH }); });
});

it('reports a fix loop that could not start', async () => {
  const failed = suite({ lastResults: { late: { outcome: 'fail', runId: 'r', at: 2 } } });
  const { props } = setup({}, { 'studio.suites.list': () => ({ ok: true, suites: [failed] }), 'studio.loop.start': () => ({ ok: false }) });
  await screen.findByTestId('tests-cases-workbench');
  fireEvent.click(button('Make this pass'));
  expect(await screen.findByText('The fix loop could not start.')).toBeTruthy();
  expect(props.onAskAgent).not.toHaveBeenCalled();
});

it('reloads on suite changes while visible and switches to role-play', async () => {
  const { call, view, props } = setup();
  await screen.findByTestId('tests-cases-workbench');
  await act(async () => { realtime?.({ projectId: 'p1', kind: 'suites' }); });
  await waitFor(() => expect(calls(call, 'studio.suites.list')).toHaveLength(2));
  view.rerender(<TestsPane {...props} visible={false} />);
  await act(async () => { realtime?.({ projectId: 'p1', kind: 'suites' }); });
  expect(calls(call, 'studio.suites.list')).toHaveLength(2);
  view.rerender(<TestsPane {...props} visible />);
  fireEvent.click(button('Role-play'));
  expect(screen.getByTestId('roleplay')).toBeTruthy();
  expect(screen.getByTestId('tests-cases-workbench').closest<HTMLElement>('.sf-tp-cases-view')!.hidden).toBe(true);
  fireEvent.click(button('Test cases'));
  expect(screen.getByTestId('roleplay').parentElement!.hidden).toBe(true);
  view.rerender(<TestsPane {...props} path="force-app/Other.agent" />);
  await waitFor(() => expect(calls(call, 'studio.suites.list').at(-1)).toMatchObject({ agentPath: 'force-app/Other.agent' }));
});

it('treats a missing reply as an error', async () => {
  const call = vi.fn<Call>(async () => null);
  render(<TestsPane pluginId="salesforce" path={PATH} source="x" visible dirty={false} roleplay={null} call={call} />);
  expect(await screen.findByText('No response.')).toBeTruthy();
  expect(call.mock.calls[0]![2]).toEqual({ agentPath: PATH });
  expect(screen.queryByText(/Make these pass/)).toBeNull();
});

it('switches to the Org tests view', async () => {
  const { call } = setup({}, {
    'studio.orgTests.list': () => ({ ok: true, org: { alias: 'dev' }, definitions: [{ name: 'RefundTests' }], at: 1 }),
    'studio.orgTests.details': () => ({ ok: true, definitions: [{ name: 'RefundTests', subjectName: 'MyBot', caseCount: 3 }], missing: [] }),
    'studio.orgTests.runs': () => ({ ok: true, runs: [] })
  });
  await screen.findByTestId('tests-cases-workbench');
  fireEvent.click(button('Browse tests'));
  expect(await screen.findByTestId('org-def-RefundTests')).toBeTruthy();
  expect(screen.getByTestId('tests-cases-workbench').closest<HTMLElement>('.sf-tp-cases-view')!.hidden).toBe(true);
  expect(calls(call, 'studio.orgTests.list')).toHaveLength(1);
});

it('keeps edited simulation scenarios and the selected result when returning from another test view', async () => {
  const batch = {
    id: 'retained-batch', agentPath: PATH, sourceHash: 'old-source', candidate: true, engine: 'preview', parallel: 1,
    plannedCalls: 1, status: 'done', startedAt: 1, startedBy: 'studio',
    counts: { total: 1, pass: 0, fail: 1, inconclusive: 0, error: 0, stopped: 0, running: 0, queued: 0 },
    lanes: [{ id: 'lane-1', name: 'Recorded refund', repeat: 1, status: 'fail',
      scenario: { persona: 'Customer', goal: 'Refund', opening: 'Help', criteria: 'Offers help', maxTurns: 1 },
      turns: [{ role: 'user', text: 'Help with my refund' }, { role: 'agent', text: 'Recorded answer' }],
      verdict: { outcome: 'fail', reason: 'Refund not offered', evidence: ['Recorded answer'] } }]
  };
  const { call } = setup({}, {
    'studio.simulations.list': () => ({ ok: true, batches: [batch] }),
    'studio.simulations.get': () => ({ ok: true, batch }),
    'agentPreview.presets.list': () => ({ ok: true, presets: [] }),
    'studio.selfHealing.status': () => ({ ok: true, run: null })
  });
  await screen.findByTestId('tests-cases-workbench');
  expect(calls(call, 'studio.simulations.list')).toHaveLength(0);
  fireEvent.click(button('Batch simulations'));
  await screen.findByText('Recorded refund');
  fireEvent.click(button(/^Batch setup/));
  fireEvent.click(screen.getByText('Adjust for this batch'));
  fireEvent.click(button('Add scenario'));
  fireEvent.change(screen.getByLabelText('Scenario 4 name'), { target: { value: 'My unsaved scenario' } });
  fireEvent.change(screen.getByLabelText('Scenario 4 goal'), { target: { value: 'Keep this customer goal' } });
  fireEvent.click(button(/^Results/));
  fireEvent.click(button(/Recorded refund/));
  const selected = screen.getByRole('region', { name: 'Conversation Recorded refund' });
  fireEvent.click(button('Test cases'));
  expect(selected.closest<HTMLElement>('.sf-tp-subview')!.hidden).toBe(true);
  fireEvent.click(button('Batch simulations'));
  expect(screen.getByRole('region', { name: 'Conversation Recorded refund' })).toBe(selected);
  fireEvent.click(button(/^Batch setup/));
  expect(screen.getByLabelText('Scenario 4 name')).toHaveProperty('value', 'My unsaved scenario');
  expect(screen.getByLabelText('Scenario 4 goal')).toHaveProperty('value', 'Keep this customer goal');
});

it('retains the Test catalogue filter on tab switches and clears it for another target', async () => {
  const { props, view } = setup({}, {
    'studio.orgTests.list': () => ({ ok: true, org: { alias: 'dev' }, definitions: [], at: 1 }),
    'studio.orgTests.runs': () => ({ ok: true, runs: [] })
  });
  await screen.findByTestId('tests-cases-workbench');
  fireEvent.click(button('Browse tests'));
  const filter = await screen.findByLabelText('Filter tests');
  fireEvent.change(filter, { target: { value: 'Refund' } });
  fireEvent.click(button('Test cases'));
  expect(filter.closest<HTMLElement>('.sf-tp-subview')!.hidden).toBe(true);
  fireEvent.click(button('Browse tests'));
  expect(screen.getByLabelText('Filter tests')).toBe(filter);
  expect(filter).toHaveProperty('value', 'Refund');
  view.rerender(<TestsPane {...props} path="force-app/Other.agent" />);
  expect(await screen.findByLabelText('Filter tests')).toHaveProperty('value', '');
});

it('opens the simulations command lazily even before an agent file is selected', async () => {
  const onSimulationsFocusHandled = vi.fn();
  const { props, view } = setup({ path: null, onSimulationsFocusHandled });
  expect(screen.queryByText('Open an agent file to simulate conversations with it.')).toBeNull();
  view.rerender(<TestsPane {...props} simulationsFocus={{ seq: 7 }} />);
  expect(await screen.findByText('Open an agent file to simulate conversations with it.')).toBeTruthy();
  expect(button('Batch simulations').getAttribute('aria-pressed')).toBe('true');
  expect(onSimulationsFocusHandled).toHaveBeenCalledWith(7);
});

it('explains a saved Fail after a reload, filters by outcome and opens the case path on the graph', async () => {
  const long = 'Gives a delivery date for the order and apologises for the delay, without promising a refund, a discount or any other compensation that the agent cannot give.';
  const saved = suite({
    cases: [...suite().cases.map(c => c.id === 'late' ? { ...c, expect: { ...c.expect, criteria: long } } : c), { id: 'odd', name: 'Odd', utterances: ['?'], expect: { topic: 'Billing' } }],
    lastResults: {
      refund: { outcome: 'pass', runId: 'r', at: Date.now() - 5 * 60_000, observed: { topics: ['Billing'], actions: [], traced: true } },
      late: { outcome: 'fail', runId: 'r', at: Date.now() - 60_000, notes: ['Action "Lookup" not called.', 'AI: no date given'], observed: { topics: [], actions: [], traced: true }, judge: 'fail', reply: 'Let me check.' },
      odd: { outcome: 'inconclusive', runId: 'r', at: 1, notes: ['Topic/action checks need a Simulate runtime trace.'], observed: { topics: [], actions: [], traced: false } }
    }
  });
  const onShowPath = vi.fn();
  const { props } = setup({ onShowPath }, { 'studio.suites.list': () => ({ ok: true, suites: [saved] }) });
  await screen.findByTestId('tests-cases-workbench');
  expect(screen.getByTestId('tests-summary').textContent).toContain('1/3');
  const late = screen.getByTestId('tests-row-late');
  expect(within(late).queryByText(long)).toBeNull();
  fireEvent.click(late);
  expect(screen.getByText('Action "Lookup" not called. Judge: no date given')).toBeTruthy();
  expect(screen.getByText('Let me check.')).toBeTruthy();
  fireEvent.click(button('Fix this case'));
  expect(props.onAskAgent).toHaveBeenCalledWith(expect.stringContaining('Observed: Action "Lookup" not called.; AI: no date given'));
  fireEvent.click(button('Show path on graph'));
  expect(onShowPath).toHaveBeenCalledWith('late');
  fireEvent.click(screen.getByTestId('tests-row-odd'));
  expect(screen.getByText('Topic/action checks need a Simulate runtime trace.')).toBeTruthy();
  expect(screen.getByText('No runtime trace')).toBeTruthy();
  fireEvent.click(button('Failing 1'));
  expect(screen.queryByTestId('tests-row-refund')).toBeNull();
  expect(screen.getByTestId('tests-row-late')).toBeTruthy();
  fireEvent.click(button('Passing 1'));
  expect(screen.getByTestId('tests-row-refund')).toBeTruthy();
  expect(screen.queryByTestId('tests-row-late')).toBeNull();
  fireEvent.click(button('All 3'));
  expect(screen.getByTestId('tests-row-odd')).toBeTruthy();
});

it('says when a filter matches nothing and shows a case that was never run', async () => {
  setup({}, { 'studio.suites.list': () => ({ ok: true, suites: [suite({ lastResults: { refund: { outcome: 'pass', runId: 'r', at: 1 } } })] }) });
  await screen.findByTestId('tests-cases-workbench');
  expect(screen.getByTestId('tests-summary').textContent).toContain('1 not run');
  fireEvent.click(screen.getByTestId('tests-row-late'));
  expect(screen.getByText('This case has not run yet')).toBeTruthy();
  expect(screen.getAllByText('Not run').length).toBeGreaterThan(1);
  fireEvent.click(button('Failing 0'));
  expect(screen.getByText(/No matching cases/)).toBeTruthy();
  fireEvent.click(button('Passing 1'));
  expect(screen.queryByText('No passing cases.')).toBeNull();
});

it('summarises runs and formats relative times', () => {
  const cases = suite().cases;
  expect(runSummary(cases, undefined)).toEqual({ pass: 0, fail: 0, ran: 0, at: 0 });
  expect(runSummary(cases, { refund: { outcome: 'pass', runId: 'r', at: 5 }, late: { outcome: 'inconclusive', runId: 'r', at: 9 }, gone: { outcome: 'fail', runId: 'r', at: 99 } })).toEqual({ pass: 1, fail: 0, ran: 2, at: 9 });
  const now = Date.UTC(2026, 9, 21, 12);
  expect(relativeTime(now - 10_000, now)).toBe('just now');
  expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
  expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
  expect(relativeTime(now - 3 * 86_400_000, now)).toMatch(/Oct/);
});

it('compares immutable source snapshots and marks the result stale after editing', async () => {
  const ref = { outcome: 'fail', runId: 'r1', at: 1, reply: 'No refund', latencyMs: 200, observed: { actions: ['Lookup'], topics: [], traced: true } };
  const candidate = { ...ref, outcome: 'pass', runId: 'r2', reply: 'Refund offered', latencyMs: 150 };
  const { call, props, view } = setup({}, { 'studio.suites.compare': () => ({ ok: true, comparison: { referenceHash: 'aaa', candidateHash: 'bbb', suiteHash: 'ccc', at: 1, reference: { refund: ref }, candidate: { refund: candidate } } }) });
  await screen.findByTestId('tests-cases-workbench');
  fireEvent.click(button('Compare saved vs draft'));
  expect(await screen.findByText('Saved source → Editor draft: 0/1 → 1/1 pass')).toBeTruthy();
  expect(screen.getByText('1 improved · 0 regressed · 0 unclear')).toBeTruthy();
  fireEvent.click(screen.getByText('Refund: fail → pass'));
  expect(screen.getByText('No refund')).toBeTruthy(); expect(screen.getByText('Refund offered')).toBeTruthy();
  expect(calls(call, 'studio.suites.compare')[0]).toMatchObject({ agentPath: PATH, source: props.source, startedByUser: true });
  expect(calls(call, 'studio.suites.run')).toHaveLength(0);
  view.rerender(<TestsPane {...props} source="changed draft" />);
  expect(screen.getByText(/editor or cases changed after/)).toBeTruthy();
});

it('reports comparison failures and validates advanced case checks before saving', async () => {
  const { call } = setup({}, { 'studio.suites.compare': () => ({ ok: false, error: 'Session unavailable' }) });
  await screen.findByTestId('tests-cases-workbench');
  fireEvent.click(button('Compare saved vs draft'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Session unavailable');
  fireEvent.click(button('+ Case'));
  const form = screen.getByRole('form', { name: 'New test case' });
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Latency' } });
  fireEvent.change(within(form).getByLabelText('Utterances, one per line'), { target: { value: 'hello' } });
  fireEvent.change(within(form).getByLabelText('Action field checks (JSON)'), { target: { value: 'not JSON' } });
  fireEvent.submit(form);
  expect(calls(call, 'studio.suites.save')).toHaveLength(0);
  expect(screen.getByRole('alert').textContent).not.toBe('Session unavailable');
});

it('shows setup separately, passes explicit preparation and exposes recovered job cancellation', async () => {
  const c = { id: 'setup', name: 'Historical replay', utterances: ['Continue'], prerequisites: ['Account selected'], expect: { forbiddenActions: ['Send'], criteria: 'Stay helpful' } };
  const last = { outcome: 'inconclusive' as const, runId: '', at: 1, setupBlocked: true, deterministic: 'pass' as const, judge: 'fail' as const, observed: { traced: false, traceComplete: false, actions: [], topics: [] } };
  const { call, table } = setup({}, { 'studio.suites.list': () => ({ ok: true, suites: [suite({ cases: [c], lastResults: { setup: last } })] }), 'studio.suites.run': () => ({ ok: true, suite: suite({ cases: [c] }) }) });
  await screen.findByTestId('tests-cases-workbench');
  expect(within(screen.getByTestId('tests-row-setup')).getByText('Setup required')).toBeTruthy();
  fireEvent.click(screen.getByTestId('tests-row-setup'));
  expect(screen.getByText('Never calls Send')).toBeTruthy();
  expect(screen.getByText(/Deterministic checks: pass · AI opinion: fail · Trace: incomplete/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText('I prepared this case for this session'));
  fireEvent.click(button('Run all in Simulate'));
  await waitFor(() => expect(calls(call, 'studio.suites.run')[0]).toMatchObject({ preparedCaseIds: ['setup'] }));
  table['studio.suites.stop'] = () => ({ ok: true, status: 'stopped' });
  table['studio.suites.list'] = () => ({ ok: true, suites: [suite({ cases: [c] })], job: { jobId: 'recovered' } });
  await act(async () => { realtime?.({ kind: 'suites', projectId: 'p1' }); });
  const stop = within(screen.getByRole('toolbar', { name: 'Test actions' })).getByRole('button', { name: 'Stop suite' });
  fireEvent.click(stop);
  await waitFor(() => expect(calls(call, 'studio.suites.stop')[0]).toMatchObject({ jobId: 'recovered' }));
});

it('saves and displays advanced checks and setup prerequisites without losing their scalar types', async () => {
  const { call } = setup({}, { 'studio.suites.save': args => ({ ok: true, suite: suite({ cases: args.cases as ScenarioCase[] }) }) });
  await screen.findByTestId('tests-cases-workbench');
  fireEvent.click(button('+ Case'));
  const form = screen.getByRole('form', { name: 'New test case' });
  for (const [label, value] of [
    ['Name', 'Read-only credit'], ['Utterances, one per line', 'Check credit'],
    ['Maximum response latency (ms)', '500'], ['Forbidden actions, comma separated (use * for all)', 'Send, Apply'],
    ['Setup prerequisites, one per line', 'Account selected\n\n Address saved '],
    ['Action field checks (JSON)', '[{"action":"Credit","side":"output","field":"applied","operator":"equals","value":false}]'],
    ['Final state checks (JSON)', '[{"variable":"orderExists","value":false}]']
  ]) fireEvent.change(within(form).getByLabelText(label!), { target: { value } });
  fireEvent.submit(form);
  await waitFor(() => expect(calls(call, 'studio.suites.save')).toHaveLength(1));
  const added = (calls(call, 'studio.suites.save')[0]!.cases as ScenarioCase[]).at(-1)!;
  expect(added).toMatchObject({ prerequisites: ['Account selected', 'Address saved'], expect: { maxLatencyMs: 500, forbiddenActions: ['Send', 'Apply'], actionChecks: [{ value: false }], stateChecks: [{ variable: 'orderExists', value: false }] } });
  fireEvent.click(await screen.findByTestId(`tests-row-${added.id}`));
  fireEvent.click(screen.getByRole('tab', { name: 'Expectations' }));
  expect(screen.getByText('Each response ≤ 500 ms')).toBeTruthy();
  expect(screen.getByText('Final orderExists equals false')).toBeTruthy();
  expect(screen.getByText('Never calls Send')).toBeTruthy();
  const prepared = screen.getByLabelText('I prepared this case for this session') as HTMLInputElement;
  fireEvent.click(prepared); expect(prepared.checked).toBe(true);
  fireEvent.click(prepared); expect(prepared.checked).toBe(false);
});

it.each([
  { status: 'stopped', role: 'status', message: 'Suite stopped. Completed cases were saved. Remaining cases were not run.' },
  { status: 'failed', role: 'alert', message: 'Preview connection lost' }
])('distinguishes a $status background suite in the user feedback', async ({ status, role, message }) => {
  const { call } = setup();
  await screen.findByTestId('tests-cases-workbench');
  call.mockImplementation(async (_plugin, method) => {
    if (method === 'studio.suites.start') return { ok: true, jobId: 'job-feedback' };
    if (method === 'studio.suites.result') return { ok: true, status, ...(status === 'failed' ? { error: message } : {}) };
    if (method === 'studio.suites.list') return { ok: true, suites: [suite()] };
    return { ok: true, loop: null };
  });
  fireEvent.click(button('Run all in Simulate'));
  await waitFor(() => expect(screen.getByRole(role)).toHaveProperty('textContent', message));
  expect(button('Run all in Simulate').disabled).toBe(false);
  if (status === 'stopped') expect(screen.queryByRole('alert')).toBeNull();
});

it('opens the shared scenario library and sends a detached saved setup to Role-play', async () => {
  const roleplay = vi.fn(() => <div>Selected role-play</div>);
  setup({ roleplay }); await screen.findByTestId('tests-row-refund');
  fireEvent.click(button('Scenarios'));
  await screen.findByTestId('studio-scenarios');
  expect((screen.getByLabelText('Scenario 1 goal') as HTMLTextAreaElement).value).toBe(starterScenarios()[0].goal);
  fireEvent.click(button('Try in Role-play'));
  expect(screen.getByText('Selected role-play')).toBeTruthy();
  expect(roleplay).toHaveBeenLastCalledWith(expect.objectContaining({ selection: { scenario: starterScenarios()[0], seq: 1 } }));
  fireEvent.click(button('Scenarios'));
  expect((screen.getByLabelText('Scenario 1 goal') as HTMLTextAreaElement).value).toBe(starterScenarios()[0].goal);
});
it('explains that shared scenarios require an open agent file', () => {
  setup({ path: null }); fireEvent.click(button('Scenarios'));
  expect(screen.getByText('Open an agent file to manage shared scenarios.')).toBeTruthy();
  expect(screen.queryByTestId('studio-scenarios')).toBeNull();
});
