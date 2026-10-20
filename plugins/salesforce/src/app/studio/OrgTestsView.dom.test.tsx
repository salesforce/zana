/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrgTestsView, type OrgTestsViewProps } from './OrgTestsView.js';
import { OrgRunDetail, downloadText } from './OrgRunDetail.js';
import type { OrgCaseResult, OrgRunRecord, OrgRunResults, OrgTestDefinition } from '../../../lib/org-tests-contract.js';

const PATH = 'force-app/main/default/aiAuthoringBundles/MyBot/MyBot.agent';
let realtime: ((payload: unknown) => void) | null = null;
beforeEach(() => {
  realtime = null;
  (globalThis as Record<string, unknown>).__ZCC_PLUGIN_RUNTIME__ = { useRealtime: (_c: string, h: (p: unknown) => void) => { realtime = h; } };
});
afterEach(() => { cleanup(); delete (globalThis as Record<string, unknown>).__ZCC_PLUGIN_RUNTIME__; vi.restoreAllMocks(); });

const DEFS = [
  { name: 'RefundTests', label: 'Refund tests', subjectName: 'MyBot', caseCount: 2 },
  { name: 'OtherTests', subjectName: 'OtherBot', caseCount: 1 }
];
const definition = (): OrgTestDefinition => ({
  ...DEFS[0],
  label: 'Refund tests',
  testCases: [
    { number: 1, utterance: 'I want a refund', conversationHistory: [], contextVariables: [{ name: 'Region', value: 'EU' }], expectations: [{ name: 'topic_sequence_match', expectedValue: 'Billing' }] },
    { number: 2, utterance: 'Where is my order?', conversationHistory: [], contextVariables: [], expectations: [] }
  ]
});
const rcase = (number: number, verdict: OrgCaseResult['verdict'], extra: Partial<OrgCaseResult> = {}): OrgCaseResult => ({
  number, utterance: number === 1 ? 'I want a refund' : `case ${number}`, status: 'completed', actions: ['Lookup'], topic: 'Billing', reply: 'Here you go',
  metrics: [{ name: 'topic_sequence_match', expected: 'Billing', actual: verdict === 'pass' ? 'Billing' : 'Shipping', result: verdict === 'pass' ? 'pass' : 'fail', explanation: 'Because.' }], verdict, ...extra
});
const results = (id: string, status: OrgRunResults['status'], cases: OrgCaseResult[], extra: Partial<OrgRunResults> = {}): OrgRunResults => ({
  runId: id, definition: 'RefundTests', orgId: 'o', orgAlias: 'dev', status, startedAt: Date.now() - 60_000, endedAt: status === 'completed' ? Date.now() : undefined, startedBy: 'studio',
  counts: { total: cases.length, pass: cases.filter(c => c.verdict === 'pass').length, fail: cases.filter(c => c.verdict === 'fail').length, error: 0, pending: 0 }, cases, ...extra
});
const toRecord = (r: OrgRunResults): OrgRunRecord => { const { cases: _cases, ...rest } = r; return rest; };

type Call = NonNullable<OrgTestsViewProps['call']>;
type Handler = (args: Record<string, unknown>) => unknown;
function setup(overrides: Partial<OrgTestsViewProps> = {}, handlers: Record<string, Handler> = {}) {
  const table: Record<string, Handler> = {
    'studio.orgTests.list': () => ({ ok: true, org: { alias: 'dev' }, definitions: DEFS, at: 1 }),
    'studio.orgTests.runs': () => ({ ok: true, runs: [] }),
    'studio.orgTests.definition': () => ({ ok: true, definition: definition() }),
    ...handlers
  };
  const call = vi.fn<Call>(async (_p, method, args) => {
    const handler = table[method];
    return handler ? handler(args as Record<string, unknown>) : { ok: false, error: `unexpected ${method}` };
  });
  const requestApproval = vi.fn<NonNullable<OrgTestsViewProps['requestApproval']>>(async () => ({ approved: true, token: 'tok', expiresAt: 1 }));
  const props: OrgTestsViewProps = { pluginId: 'salesforce', projectId: 'p1', threadId: 't1', path: PATH, visible: true, onAskAgent: vi.fn(), call, requestApproval, pollMs: 15, ...overrides };
  const view = render(<OrgTestsView {...props} />);
  return { call, requestApproval, props, view, table };
}
const button = (name: RegExp | string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const calls = (call: ReturnType<typeof setup>['call'], method: string) => call.mock.calls.filter(([, m]) => m === method).map(([, , a]) => a as Record<string, unknown>);

it('lists definitions, filters them, and toggles this agent', async () => {
  const { call } = setup({}, { 'studio.orgTests.runs': () => ({ ok: true, runs: [
    toRecord(results('r2', 'completed', [rcase(1, 'pass'), rcase(2, 'fail')])), toRecord(results('r1', 'completed', [rcase(1, 'fail'), rcase(2, 'fail')]))
  ] }) });
  expect(await screen.findByTestId('org-def-RefundTests')).toBeTruthy();
  expect(screen.getByText('2 of 2 tests', { exact: false })).toBeTruthy();
  expect(within(screen.getByTestId('org-def-RefundTests')).getByText(/50%/)).toBeTruthy();
  expect(screen.getByRole('img', { name: /Pass rate trend/ })).toBeTruthy();
  expect(within(screen.getByTestId('org-def-OtherTests')).getByText('No runs')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Filter org tests'), { target: { value: 'other' } });
  expect(screen.queryByTestId('org-def-RefundTests')).toBeNull();
  fireEvent.change(screen.getByLabelText('Filter org tests'), { target: { value: '' } });
  fireEvent.click(screen.getByLabelText(/This agent/));
  expect(screen.queryByTestId('org-def-OtherTests')).toBeNull();
  fireEvent.change(screen.getByLabelText('Filter org tests'), { target: { value: 'zzz' } });
  expect(screen.getByText('No org tests match.')).toBeTruthy();
  fireEvent.click(button('Refresh'));
  await waitFor(() => expect(calls(call, 'studio.orgTests.list').at(-1)).toEqual({ projectId: 'p1', refresh: true }));
});

it('shows list errors and the empty org', async () => {
  setup({}, { 'studio.orgTests.list': () => ({ ok: false, error: 'No org' }) });
  expect(await screen.findByText('No org')).toBeTruthy();
  cleanup();
  setup({}, { 'studio.orgTests.list': () => { throw new Error('rpc down'); } });
  expect(await screen.findByText('rpc down')).toBeTruthy();
  cleanup();
  setup({}, { 'studio.orgTests.list': () => ({ ok: true, definitions: [] }) });
  expect(await screen.findByText('This org has no test definitions.')).toBeTruthy();
});

it('does not load while hidden', () => {
  const { call } = setup({ visible: false });
  expect(call).not.toHaveBeenCalled();
});

it('selects a definition and shows its cases', async () => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  const cases = await screen.findByRole('list', { name: 'Test cases' });
  expect(within(cases).getByText('I want a refund')).toBeTruthy();
  expect(within(cases).getByText(/topic_sequence_match: Billing/)).toBeTruthy();
  expect(within(cases).getByText(/context Region/)).toBeTruthy();
});

it('fills a bare list row from its loaded definition', async () => {
  setup({}, {
    'studio.orgTests.list': () => ({ ok: true, org: { alias: 'dev' }, definitions: [{ name: 'Bare_Test' }], at: 1 }),
    'studio.orgTests.definition': () => ({ ok: true, definition: { ...definition(), name: 'Bare_Test', label: 'Bare label', subjectName: 'BareBot', caseCount: undefined } }),
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Bare_Test' }));
  const row = await screen.findByTestId('org-def-Bare_Test');
  await waitFor(() => expect(row.textContent).toContain('BareBot'));
  expect(within(row).getByRole('button', { name: 'Bare label' })).toBeTruthy();
  expect(row.textContent).toContain(String(definition().testCases.length));
});

it('reports a definition load failure', async () => {
  setup({}, { 'studio.orgTests.definition': () => ({ ok: false, error: 'bad xml' }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  expect(await screen.findByText('bad xml')).toBeTruthy();
  cleanup();
  setup({}, { 'studio.orgTests.definition': () => { throw new Error('boom'); } });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  expect(await screen.findByText('boom')).toBeTruthy();
});

it('confirms before starting, polls until completed, then stops polling', async () => {
  let polls = 0;
  const { call } = setup({}, {
    'studio.orgTests.run.start': () => ({ ok: true, run: toRecord(results('run-1', 'in_progress', [])) }),
    'studio.orgTests.run.get': () => {
      polls++;
      return polls < 3 ? { ok: true, run: results('run-1', 'in_progress', [rcase(1, 'pass')]) } : { ok: true, run: results('run-1', 'completed', [rcase(1, 'pass'), rcase(2, 'fail')]) };
    }
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('list', { name: 'Test cases' });
  fireEvent.click(button('Run in org'));
  expect(calls(call, 'studio.orgTests.run.start')).toHaveLength(0);
  fireEvent.click(button('Not now'));
  expect(screen.queryByRole('group', { name: 'Confirm run' })).toBeNull();
  fireEvent.click(button('Run in org'));
  expect(screen.getByRole('group', { name: 'Confirm run' }).textContent).toContain('uses org evaluation resources');
  fireEvent.click(button('Start run'));
  await waitFor(() => expect(screen.getByTestId('org-run-counts').textContent).toContain('1 pass · 1 fail'));
  expect(calls(call, 'studio.orgTests.run.start')[0]).toEqual({ projectId: 'p1', name: 'RefundTests', via: 'studio', threadId: 't1' });
  const after = calls(call, 'studio.orgTests.run.get').length;
  await act(async () => { await new Promise(r => setTimeout(r, 80)); });
  expect(calls(call, 'studio.orgTests.run.get').length).toBe(after);
  expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull();
});

it('a refused list goes through a read approval, then lists the tests', async () => {
  let lists = 0;
  const { call, requestApproval } = setup({}, {
    'studio.orgTests.list': () => (++lists === 1 ? { ok: false, code: 'refused', error: 'Operator headless' } : { ok: true, org: { alias: 'prod', isProduction: true }, definitions: DEFS }),
    'release.prepare': () => ({ ok: true, data: { request: { title: 'Allow' } } }),
    'release.run': () => ({ ok: true })
  });
  expect((await screen.findByRole('alert')).textContent).toContain('Allow reads to list its org tests');
  fireEvent.click(screen.getByRole('button', { name: 'Allow reads…' }));
  expect(await screen.findByRole('button', { name: 'Refund tests' })).toBeTruthy();
  expect(requestApproval).toHaveBeenCalledTimes(1);
  expect(calls(call, 'release.run')[0]).toMatchObject({ action: 'org.read', token: 'tok', path: PATH });
  expect(calls(call, 'studio.orgTests.list').at(-1)).toMatchObject({ refresh: true });
  expect(await screen.findByText('Reads allowed for this org.')).toBeTruthy();
  expect(screen.getByText(/prod \(production\)/)).toBeTruthy();
});

it('a later successful list clears the read prompt', async () => {
  let lists = 0;
  setup({}, { 'studio.orgTests.list': () => (++lists === 1 ? { ok: false, code: 'refused' } : { ok: true, definitions: DEFS }) });
  await screen.findByRole('button', { name: 'Allow reads…' });
  fireEvent.click(button('Refresh'));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Allow reads…' })).toBeNull());
});

it('a refused start explains the write confirmation and offers no read grant', async () => {
  const start = () => ({ ok: false, code: 'refused', error: 'no' });
  setup({}, { 'studio.orgTests.run.start': start });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('list', { name: 'Test cases' });
  fireEvent.click(button('Run in org')); fireEvent.click(button('Start run'));
  expect(await screen.findByText('The run on this production or unknown org was not approved.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Allow reads…' })).toBeNull();
  cleanup();
  setup({ threadId: undefined }, { 'studio.orgTests.run.start': start });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('list', { name: 'Test cases' });
  fireEvent.click(button('Run in org')); fireEvent.click(button('Start run'));
  expect(await screen.findByText(/Start the run from a thread so you can approve it/)).toBeTruthy();
});

it('handles a declined approval, a failed grant, and a failed start', async () => {
  const handlers = {
    'studio.orgTests.list': () => ({ ok: false, code: 'refused' }),
    'release.prepare': () => ({ ok: true, data: { request: {} } }),
  };
  const { requestApproval } = setup({}, handlers);
  requestApproval.mockResolvedValueOnce({ approved: false, reason: 'cancelled' } as never);
  fireEvent.click(await screen.findByRole('button', { name: 'Allow reads…' }));
  await waitFor(() => expect(requestApproval).toHaveBeenCalled());
  cleanup();
  const second = setup({}, { ...handlers, 'release.run': () => ({ ok: false, error: 'token bad' }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Allow reads…' }));
  expect(await screen.findByText('token bad')).toBeTruthy();
  expect(second.requestApproval).toHaveBeenCalled();
  cleanup();
  setup({}, { 'studio.orgTests.run.start': () => ({ ok: false, error: 'Quota exceeded' }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('list', { name: 'Test cases' });
  fireEvent.click(button('Run in org')); fireEvent.click(button('Start run'));
  expect(await screen.findByText('Quota exceeded')).toBeTruthy();
});

it('cancels an active run', async () => {
  const { call } = setup({ pollMs: 10_000 }, {
    'studio.orgTests.run.start': () => ({ ok: true, run: toRecord(results('run-3', 'in_progress', [])) }),
    'studio.orgTests.run.get': () => ({ ok: true, run: results('run-3', 'in_progress', []) }),
    'studio.orgTests.run.cancel': () => ({ ok: true, run: toRecord(results('run-3', 'terminated', [])) })
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('list', { name: 'Test cases' });
  fireEvent.click(button('Run in org')); fireEvent.click(button('Start run'));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
  expect(await screen.findByText('Cancelled run run-3.')).toBeTruthy();
  expect(calls(call, 'studio.orgTests.run.cancel')[0]).toEqual({ projectId: 'p1', runId: 'run-3' });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull());
});

it('attaches a run by id, with validation and errors', async () => {
  const attached = results('ext9ABCDEFGHIJKL', 'completed', [rcase(1, 'pass')]);
  const { call } = setup({}, { 'studio.orgTests.run.attach': a => (a.runId === 'bad0000000000000' ? { ok: false, error: 'Unknown run' } : { ok: true, run: attached }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('list', { name: 'Test cases' });
  fireEvent.click(button('Attach'));
  expect(screen.getByText('Enter a run id.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Attach run by id'), { target: { value: 'short' } });
  fireEvent.click(button('Attach'));
  expect(screen.getByText('A run id is 15 to 18 letters and digits.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Attach run by id'), { target: { value: 'bad0000000000000' } });
  fireEvent.click(button('Attach'));
  expect(await screen.findByText('Unknown run')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Attach run by id'), { target: { value: ' ext9ABCDEFGHIJKL ' } });
  fireEvent.click(button('Attach'));
  expect(await screen.findByText('Attached run ext9ABCDEFGHIJKL.')).toBeTruthy();
  expect(calls(call, 'studio.orgTests.run.attach')[1]).toEqual({ projectId: 'p1', runId: 'ext9ABCDEFGHIJKL' });
  expect(screen.getByTestId('org-run-detail')).toBeTruthy();
});

it('imports a definition into the suite and tells when cases were left out', async () => {
  const big: OrgTestDefinition = { ...definition(), testCases: Array.from({ length: 60 }, (_, i) => ({ number: i + 1, utterance: `u${i + 1}`, conversationHistory: [], contextVariables: [], expectations: [] })) };
  const { call } = setup({}, { 'studio.orgTests.definition': () => ({ ok: true, definition: big }), 'studio.suites.import': () => ({ ok: true, imported: 50 }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('list', { name: 'Test cases' });
  fireEvent.click(button('Import to suite'));
  expect(await screen.findByText(/Imported 50 cases into the suite\. A suite holds 50 cases, so 10 were left out\./)).toBeTruthy();
  const sent = calls(call, 'studio.suites.import')[0];
  expect(sent.agentPath).toBe(PATH);
  expect(JSON.parse(sent.text as string).testCases).toHaveLength(50);
});

it('reports an import failure and requires an open agent', async () => {
  setup({}, { 'studio.suites.import': () => ({ ok: false, error: 'Bad spec' }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('list', { name: 'Test cases' });
  fireEvent.click(button('Import to suite'));
  expect(await screen.findByText('Bad spec')).toBeTruthy();
  cleanup();
  setup({ path: null });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('list', { name: 'Test cases' });
  expect(button('Import to suite').disabled).toBe(true);
  expect((screen.getByLabelText(/This agent/) as HTMLInputElement).disabled).toBe(true);
});

it('opens a run from history with the previous run as the diff base, and reacts to realtime', async () => {
  const prev = results('r1', 'completed', [rcase(1, 'fail'), rcase(2, 'pass')], { startedAt: 1000 });
  const cur = results('r2', 'completed', [rcase(1, 'pass'), rcase(2, 'fail')], { startedAt: 2000 });
  const { call } = setup({}, {
    'studio.orgTests.runs': () => ({ ok: true, runs: [toRecord(cur), toRecord(prev)] }),
    'studio.orgTests.run.get': a => ({ ok: true, run: a.runId === 'r2' ? cur : prev })
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  fireEvent.click(await screen.findByRole('button', { name: /^r2 ·/ }));
  expect((await screen.findByTestId('org-run-diff')).textContent).toContain('1 newly failing, 1 fixed');
  const before = calls(call, 'studio.orgTests.runs').length;
  act(() => realtime?.({ kind: 'orgTests', projectId: 'p1', runId: 'r2' }));
  await waitFor(() => expect(calls(call, 'studio.orgTests.runs').length).toBe(before + 1));
  act(() => realtime?.({ kind: 'orgTests', projectId: 'other' }));
  act(() => realtime?.({ kind: 'files', projectId: 'p1' }));
  act(() => realtime?.(null));
  expect(calls(call, 'studio.orgTests.runs').length).toBe(before + 1);
});

it('shows a run read error', async () => {
  setup({}, {
    'studio.orgTests.runs': () => ({ ok: true, runs: [toRecord(results('r9', 'completed', []))] }),
    'studio.orgTests.run.get': () => ({ ok: false, error: 'Run expired' })
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  fireEvent.click(await screen.findByRole('button', { name: /^r9 ·/ }));
  expect(await screen.findByText('Run expired')).toBeTruthy();
});

// ---- OrgRunDetail ----
function detail(extra: Partial<React.ComponentProps<typeof OrgRunDetail>> = {}, cases?: OrgCaseResult[]) {
  const run = results('r5', 'completed', cases ?? [rcase(1, 'pass'), rcase(2, 'fail'), rcase(3, 'error', { metrics: [{ name: 'coherence', result: null, error: 'timeout' }] })], { errorMessage: undefined });
  const props = { run, path: PATH, onImport: vi.fn(), onAskAgent: vi.fn(), ...extra };
  render(<OrgRunDetail {...props} />);
  return props;
}

it('detail: tabs, search, sort and expansion', () => {
  detail({ previous: results('r4', 'completed', [rcase(1, 'fail'), rcase(2, 'fail')]) });
  expect(screen.getByRole('tab', { name: /All 3/ }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: /Failing 1/ }));
  expect(screen.getByRole('tab', { name: /Failing/ }).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByTestId('org-case-1')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: /Errors/ }));
  expect(screen.getByTestId('org-case-3')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /Passing/ }));
  expect(screen.getByTestId('org-case-1')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /Changed/ }));
  expect(screen.getByTestId('org-case-1')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /All/ }));
  fireEvent.change(screen.getByLabelText('Search cases'), { target: { value: 'nomatch' } });
  expect(screen.getByText('No cases match.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search cases'), { target: { value: 'case 2' } });
  expect(screen.getByTestId('org-case-2')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search cases'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'verdict' } });
  const order = within(screen.getByTestId('org-run-table')).getAllByTestId(/org-case-/).map(r => r.getAttribute('data-testid'));
  expect(order).toEqual(['org-case-2', 'org-case-3', 'org-case-1']);
  fireEvent.click(within(screen.getByTestId('org-case-2')).getByRole('button', { name: 'case 2' }));
  expect(screen.getByText('Because.')).toBeTruthy();
  expect(screen.getByText('Here you go')).toBeTruthy();
  fireEvent.click(within(screen.getByTestId('org-case-3')).getByRole('button', { name: 'case 3' }));
  expect(screen.getByText(/Error: timeout/)).toBeTruthy();
  expect(screen.queryByText('Because.')).toBeNull();
  fireEvent.click(within(screen.getByTestId('org-case-3')).getByRole('button', { name: 'case 3' }));
  expect(screen.queryByText(/Error: timeout/)).toBeNull();
});

it('detail: no previous run disables Changed; metric bars render', () => {
  detail();
  expect((screen.getByRole('tab', { name: /Changed/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('img', { name: 'Topic 50%' })).toBeTruthy();
  expect(screen.queryByTestId('org-run-diff')).toBeNull();
});

it('detail: pages 25 at a time', () => {
  const cases = Array.from({ length: 30 }, (_, i) => rcase(i + 1, 'pass'));
  detail({}, cases);
  expect(screen.getByText('Page 1 of 2')).toBeTruthy();
  expect(screen.queryByTestId('org-case-26')).toBeNull();
  fireEvent.click(button('Next'));
  expect(screen.getByTestId('org-case-26')).toBeTruthy();
  expect(button('Next').disabled).toBe(true);
  fireEvent.click(button('Previous'));
  expect(screen.getByTestId('org-case-1')).toBeTruthy();
});

it('detail: empty run, import and fix actions', () => {
  const props = detail();
  fireEvent.click(button('Import failing to suite'));
  expect((props.onImport.mock.calls[0][0] as Array<{ number: number }>).map(c => c.number)).toEqual([2, 3]);
  fireEvent.click(button('Add case 2 to suite'));
  expect(props.onImport.mock.calls[1][0]).toHaveLength(1);
  fireEvent.click(button('Fix with agent'));
  const prompt = props.onAskAgent.mock.calls[0][0] as string;
  expect(prompt).toContain('2 cases');
  expect(prompt).toContain('- #2 "case 2" -> Topic: expected Billing, got Shipping');
  cleanup();
  detail({}, []);
  expect(screen.getByText('No case results yet.')).toBeTruthy();
});

it('detail: no path or agent callback disables/hides actions', () => {
  detail({ path: null, onAskAgent: undefined });
  expect(button('Import failing to suite').disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Fix with agent' })).toBeNull();
});

it('detail: exports CSV when downloads exist, and says so when they do not', () => {
  const saved = URL.createObjectURL;
  Object.assign(URL, { createObjectURL: undefined });
  detail();
  fireEvent.click(button('Export CSV'));
  expect(screen.getByText('Downloads are not available here.')).toBeTruthy();
  Object.assign(URL, { createObjectURL: saved });
  cleanup();
  const create = vi.fn(() => 'blob:x'); const revoke = vi.fn();
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  detail();
  fireEvent.click(button('Export CSV'));
  expect(create).toHaveBeenCalled();
  expect(click).toHaveBeenCalled();
  expect(revoke).toHaveBeenCalledWith('blob:x');
  expect(screen.getByText('Exported 3 cases.')).toBeTruthy();
  expect(downloadText('a.csv', 'x')).toBe(true);
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
});

it('attaches without a selected test; an unknown definition is not looked up', async () => {
  const attached = results('ext9ABCDEFGHIJKL', 'completed', [rcase(1, 'pass')], { definition: 'unknown', startedBy: 'attached' });
  const { call } = setup({}, { 'studio.orgTests.run.attach': () => ({ ok: true, run: attached }) });
  await screen.findByTestId('org-def-RefundTests');
  fireEvent.change(screen.getByLabelText('Attach run by id'), { target: { value: 'ext9ABCDEFGHIJKL' } });
  fireEvent.click(button('Attach'));
  expect(await screen.findByTestId('org-run-detail')).toBeTruthy();
  expect(calls(call, 'studio.orgTests.run.attach')[0]).toEqual({ projectId: 'p1', runId: 'ext9ABCDEFGHIJKL' });
  expect(calls(call, 'studio.orgTests.definition')).toHaveLength(0);
});

it('attaching a run of another known test selects that test', async () => {
  const attached = results('ext9ABCDEFGHIJKL', 'completed', [rcase(1, 'pass')], { definition: 'RefundTests' });
  const { call } = setup({}, { 'studio.orgTests.run.attach': () => ({ ok: true, run: attached }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('list', { name: 'Test cases' });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  fireEvent.change(screen.getByLabelText('Attach run by id'), { target: { value: 'ext9ABCDEFGHIJKL' } });
  fireEvent.click(button('Attach'));
  expect(await screen.findByText('Attached run ext9ABCDEFGHIJKL.')).toBeTruthy();
  expect(calls(call, 'studio.orgTests.definition').length).toBeGreaterThanOrEqual(1);
});

const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

it('ignores a late definition reply for a test the user left', async () => {
  const slow = deferred<unknown>();
  const { } = setup({}, { 'studio.orgTests.definition': a => (a.name === 'RefundTests' ? slow.promise : { ok: true, definition: { ...definition(), name: 'OtherTests', label: 'Other label', testCases: [] } }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  fireEvent.click(await screen.findByRole('button', { name: 'OtherTests' }));
  expect(await screen.findByRole('heading', { name: 'Other label' })).toBeTruthy();
  await act(async () => { slow.resolve({ ok: true, definition: definition() }); await Promise.resolve(); });
  expect(screen.getByRole('heading', { name: 'Other label' })).toBeTruthy();
  expect(screen.queryByText('I want a refund')).toBeNull();
});

it('ignores a late run reply after switching tests', async () => {
  const slow = deferred<unknown>();
  const rec = toRecord(results('r2ABCDEFGHIJKLM', 'completed', [rcase(1, 'pass')]));
  setup({}, {
    'studio.orgTests.runs': () => ({ ok: true, runs: [rec] }),
    'studio.orgTests.run.get': () => slow.promise
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  fireEvent.click(await screen.findByRole('button', { name: /^FGHIJKLM|ABCDEFGHIJKLM|JKLM|·/ }).catch(() => screen.getByRole('group', { name: 'Run history' }).querySelector('button')!));
  fireEvent.click(screen.getByRole('button', { name: 'OtherTests' }));
  await act(async () => { slow.resolve({ ok: true, run: results('r2ABCDEFGHIJKLM', 'completed', [rcase(1, 'pass')]) }); await Promise.resolve(); });
  expect(screen.queryByTestId('org-run-detail')).toBeNull();
});

it('does not override a later choice when an attach finishes, and presses the attached run', async () => {
  const id = 'ext9ABCDEFGHIJKL';
  const attached = results(id, 'completed', [rcase(1, 'pass')], { definition: 'OtherTests' });
  const slow = deferred<unknown>();
  setup({}, {
    'studio.orgTests.run.attach': () => slow.promise,
    'studio.orgTests.runs': () => ({ ok: true, runs: [toRecord(attached)] }),
    'studio.orgTests.definition': a => ({ ok: true, definition: { ...definition(), name: a.name, label: String(a.name), testCases: [] } })
  });
  await screen.findByTestId('org-def-RefundTests');
  fireEvent.change(screen.getByLabelText('Attach run by id'), { target: { value: id } });
  fireEvent.click(button('Attach'));
  fireEvent.click(screen.getByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('heading', { name: 'RefundTests' });
  await act(async () => { slow.resolve({ ok: true, run: attached }); await Promise.resolve(); });
  expect(await screen.findByText(`Attached run ${id}.`)).toBeTruthy();
  expect(screen.queryByTestId('org-run-detail')).toBeNull();
});

it('selects the attached run definition and marks the run pressed', async () => {
  const id = 'ext9ABCDEFGHIJKL';
  const attached = results(id, 'completed', [rcase(1, 'pass')], { definition: 'OtherTests' });
  setup({}, {
    'studio.orgTests.run.attach': () => ({ ok: true, run: attached }),
    'studio.orgTests.runs': () => ({ ok: true, runs: [toRecord(attached)] }),
    'studio.orgTests.definition': a => ({ ok: true, definition: { ...definition(), name: a.name, label: 'Other label', testCases: [] } })
  });
  await screen.findByTestId('org-def-RefundTests');
  fireEvent.change(screen.getByLabelText('Attach run by id'), { target: { value: id } });
  fireEvent.click(button('Attach'));
  expect(await screen.findByTestId('org-run-detail')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Other label' })).toBeTruthy();
  await waitFor(() => expect(within(screen.getByRole('group', { name: 'Run history' })).getAllByRole('button')[0].getAttribute('aria-pressed')).toBe('true'));
});

it('stops polling and shows the error when run.get fails', async () => {
  let gets = 0;
  const { call } = setup({}, {
    'studio.orgTests.run.start': () => ({ ok: true, run: toRecord(results('run-4', 'in_progress', [])) }),
    'studio.orgTests.run.get': () => (++gets === 1 ? { ok: true, run: results('run-4', 'in_progress', []) } : { ok: false, code: 'not_found', error: 'Run is gone' })
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('list', { name: 'Test cases' });
  fireEvent.click(button('Run in org')); fireEvent.click(button('Start run'));
  expect(await screen.findByText('Run is gone')).toBeTruthy();
  const n = calls(call, 'studio.orgTests.run.get').length;
  await act(async () => { await new Promise(r => setTimeout(r, 80)); });
  expect(calls(call, 'studio.orgTests.run.get').length).toBe(n);
});

it('stops polling when run.get throws', async () => {
  let gets = 0;
  setup({}, {
    'studio.orgTests.run.start': () => ({ ok: true, run: toRecord(results('run-5', 'in_progress', [])) }),
    'studio.orgTests.run.get': () => { if (++gets === 1) return { ok: true, run: results('run-5', 'in_progress', []) }; throw new Error('net down'); }
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('list', { name: 'Test cases' });
  fireEvent.click(button('Run in org')); fireEvent.click(button('Start run'));
  expect(await screen.findByText('net down')).toBeTruthy();
});

it('opens a focused run on its definition, once per request, and only while visible', async () => {
  const run = results('4KB000000000009AAA', 'completed', [rcase(1, 'pass'), rcase(2, 'fail')], { startedBy: 'thread' });
  const onFocusHandled = vi.fn();
  const handlers = {
    'studio.orgTests.runs': () => ({ ok: true, runs: [toRecord(run)] }),
    'studio.orgTests.run.get': () => ({ ok: true, run })
  };
  const { call, props, view } = setup({ visible: false, focus: { runId: run.runId, seq: 1 }, onFocusHandled }, handlers);
  expect(onFocusHandled).not.toHaveBeenCalled();
  view.rerender(<OrgTestsView {...props} visible />);
  await waitFor(() => expect(screen.getByTestId('org-run-counts').textContent).toContain('1 pass · 1 fail · 0 error of 2'));
  expect(onFocusHandled).toHaveBeenCalledWith(1);
  expect(calls(call, 'studio.orgTests.definition')).toEqual([expect.objectContaining({ name: 'RefundTests' })]);
  expect(screen.getByTestId('org-def-detail')).toBeTruthy();
  // The same request is not replayed on rerender.
  view.rerender(<OrgTestsView {...props} visible focus={{ runId: run.runId, seq: 1 }} />);
  await act(async () => { await Promise.resolve(); });
  expect(calls(call, 'studio.orgTests.definition')).toHaveLength(1);
});

it('focuses a named definition, and a run whose definition is unknown without reading one', async () => {
  const attached = results('4KB000000000010AAA', 'in_progress', [], { definition: 'unknown', startedBy: 'attached' });
  const { call, props, view } = setup({ focus: { name: 'RefundTests', seq: 1 } }, {
    'studio.orgTests.runs': () => ({ ok: true, runs: [toRecord(attached)] }),
    'studio.orgTests.run.get': () => ({ ok: true, run: attached })
  });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Refund tests' })).toBeTruthy());
  expect(calls(call, 'studio.orgTests.run.get')).toHaveLength(0);
  view.rerender(<OrgTestsView {...props} focus={{ runId: attached.runId, seq: 2 }} />);
  await waitFor(() => expect(calls(call, 'studio.orgTests.run.get')).toEqual([expect.objectContaining({ runId: attached.runId })]));
  expect(calls(call, 'studio.orgTests.definition')).toHaveLength(1);
});

it('focuses a run that is not in the history yet, keeping the loaded history when runs fail', async () => {
  const run = results('4KB000000000011AAA', 'completed', [rcase(1, 'pass')]);
  const { call } = setup({ focus: { runId: run.runId, seq: 1 } }, {
    'studio.orgTests.runs': () => ({ ok: false, error: 'nope' }),
    'studio.orgTests.run.get': () => ({ ok: true, run })
  });
  await waitFor(() => expect(screen.getByTestId('org-run-counts').textContent).toContain('1 pass · 0 fail · 0 error of 1'));
  expect(calls(call, 'studio.orgTests.definition')).toHaveLength(0);
});
