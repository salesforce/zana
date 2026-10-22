/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrgTestsView, type OrgTestsViewProps } from './OrgTestsView.js';
import { OrgRunDetail, downloadText, runLabel } from './OrgRunDetail.js';
import type { OrgCaseResult, OrgRunRecord, OrgRunResults, OrgTestDefinition } from '../../../lib/org-tests-contract.js';
import type { ScenarioSuite } from '../../../lib/studio-contract.js';

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
/** Attach lives in the ⋯ menu. */
const openMenu = () => { if (!screen.queryByLabelText('Attach run by id')) fireEvent.click(button('More actions')); };
/** With MyBot open the list shows its tests; this shows every agent's, with OtherBot's group open. */
const everyAgent = () => { fireEvent.click(button('All agents')); fireEvent.click(button(/^OtherBot/)); };

const LOCAL: ScenarioSuite[] = [
  { id: 'MyBot', path: 'tests/MyBot.scenario.json', cases: [{ id: 'refund', name: 'Refund locally', utterances: ['Refund please'], expect: {} }] },
  { id: 'OtherBot', path: 'tests/OtherBot.scenario.json', cases: [{ id: 'other', name: 'Other case', utterances: ['Hello'], expect: {} }], lastResults: { other: { outcome: 'pass', at: 1, runId: 'preview-1' } } }
];
const renderLocalSuite = (suite: ScenarioSuite) => <div data-testid="local-editor">{suite.path}</div>;

it('includes local cases when no org definition tests the current agent, and switches between both sources', async () => {
  const { call } = setup({ renderLocalSuite }, { 'studio.suites.list': () => ({ ok: true, suites: LOCAL }), 'studio.orgTests.list': () => ({ ok: true, definitions: [DEFS[1]] }) });
  const local = await screen.findByTestId('local-suite-MyBot');
  expect(within(local).getByText('1 case')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Tests' })).toBeTruthy();
  expect(screen.getByTestId('org-tests-none-for-agent')).toBeTruthy();
  expect(screen.queryByTestId('local-suite-OtherBot')).toBeNull();
  fireEvent.click(within(local).getByRole('button'));
  expect(screen.getByTestId('local-editor').textContent).toBe('tests/MyBot.scenario.json');
  expect(calls(call, 'studio.suites.list')[0]).toEqual({ projectId: 'p1' });
  expect(calls(call, 'studio.orgTests.run.start')).toHaveLength(0);
  fireEvent.click(button('All agents'));
  fireEvent.click(button(/^OtherBot.*test/));
  fireEvent.click(button('OtherTests'));
  await screen.findByTestId('org-def-detail');
  expect(screen.queryByTestId('local-editor')).toBeNull();
});

it('filters local suites and org definitions with the same agent, search and run filters', async () => {
  setup({ renderLocalSuite }, { 'studio.suites.list': () => ({ ok: true, suites: LOCAL }) });
  await screen.findByTestId('local-suite-MyBot');
  fireEvent.click(button('All agents'));
  expect(screen.getByTestId('local-suite-OtherBot')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Filter tests'), { target: { value: 'refund please' } });
  expect(screen.getByTestId('local-suite-MyBot')).toBeTruthy();
  expect(screen.queryByTestId('local-suite-OtherBot')).toBeNull();
  expect(screen.getByText('No org tests match.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Filter tests'), { target: { value: '' } });
  fireEvent.click(button('Has runs'));
  expect(screen.queryByTestId('local-suite-MyBot')).toBeNull();
  expect(screen.getByTestId('local-suite-OtherBot')).toBeTruthy();
  fireEvent.click(button('This agent'));
  expect(screen.getByText('No local cases match.')).toBeTruthy();
});

it.each([
  { ok: false, error: 'Org unavailable' },
  { ok: false, code: 'refused' }
])('keeps local suites usable when org reads fail: %j', async orgReply => {
  setup({ renderLocalSuite }, { 'studio.suites.list': () => ({ ok: true, suites: LOCAL }), 'studio.orgTests.list': () => orgReply });
  fireEvent.click(within(await screen.findByTestId('local-suite-MyBot')).getByRole('button'));
  expect(screen.getByTestId('local-editor')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain(orgReply.error ?? 'Allow reads');
});

it.each([false, true])('reports local list failures independently and recovers on refresh (throws=%j)', async throws => {
  let failed = true;
  const { call } = setup({ renderLocalSuite }, { 'studio.suites.list': () => { if (!failed) return { ok: true, suites: LOCAL }; if (throws) throw Error('Local read failed'); return { ok: false, error: 'Local read failed' }; } });
  expect(await screen.findByText('Local read failed')).toBeTruthy();
  expect(screen.getByTestId('org-def-RefundTests')).toBeTruthy();
  failed = false;
  fireEvent.click(button('Refresh'));
  await screen.findByTestId('local-suite-MyBot');
  expect(screen.queryByText('Local read failed')).toBeNull();
  expect(calls(call, 'studio.orgTests.list').at(-1)).toEqual({ projectId: 'p1', refresh: true });
});

it('updates local cases on project events, isolates other projects and clears a removed selection', async () => {
  let suites = LOCAL;
  const { call } = setup({ renderLocalSuite }, { 'studio.suites.list': () => ({ ok: true, suites }) });
  fireEvent.click(within(await screen.findByTestId('local-suite-MyBot')).getByRole('button'));
  const count = calls(call, 'studio.suites.list').length;
  await act(async () => realtime?.({ kind: 'suites', projectId: 'other' }));
  expect(calls(call, 'studio.suites.list')).toHaveLength(count);
  suites = [];
  await act(async () => realtime?.({ kind: 'suite-progress', projectId: 'p1' }));
  await waitFor(() => expect(screen.queryByTestId('local-suite-MyBot')).toBeNull());
  expect(screen.queryByTestId('local-editor')).toBeNull();
  expect(screen.getByText('No local cases for MyBot yet.')).toBeTruthy();
  expect(screen.getByText('Pick local cases or an org test to see its cases and runs.')).toBeTruthy();
});

it('abandons a pending org selection when local cases are selected', async () => {
  let resolve!: (value: unknown) => void;
  setup({ renderLocalSuite }, { 'studio.suites.list': () => ({ ok: true, suites: LOCAL }), 'studio.orgTests.definition': () => new Promise(r => { resolve = r; }) });
  await screen.findByTestId('local-suite-MyBot');
  fireEvent.click(button('Refund tests'));
  fireEvent.click(within(screen.getByTestId('local-suite-MyBot')).getByRole('button'));
  await act(async () => resolve({ ok: true, definition: definition() }));
  expect(screen.getByTestId('local-editor')).toBeTruthy();
  expect(screen.queryByTestId('org-def-detail')).toBeNull();
});

it('honors an org focus request after viewing local cases', async () => {
  const { view, props } = setup({ renderLocalSuite }, { 'studio.suites.list': () => ({ ok: true, suites: LOCAL }) });
  fireEvent.click(within(await screen.findByTestId('local-suite-MyBot')).getByRole('button'));
  view.rerender(<OrgTestsView {...props} focus={{ name: 'RefundTests', seq: 1 }} />);
  await screen.findByTestId('org-def-detail');
  expect(screen.queryByTestId('local-editor')).toBeNull();
});

it('discards stale local listings when changing projects and when unmounted', async () => {
  let oldReply!: (value: unknown) => void;
  const { props, view } = setup({ renderLocalSuite }, { 'studio.suites.list': args => args.projectId === 'p1'
    ? new Promise(resolve => { oldReply = resolve; })
    : { ok: true, suites: [] } });
  await waitFor(() => expect(oldReply).toBeTruthy());
  view.rerender(<OrgTestsView {...props} projectId="p2" />);
  await screen.findByText('No local cases for MyBot yet.');
  await act(async () => oldReply({ ok: true, suites: LOCAL }));
  expect(screen.queryByTestId('local-suite-MyBot')).toBeNull();
  view.rerender(<OrgTestsView {...props} projectId="p1" />);
  view.unmount();
  await act(async () => oldReply({ ok: true, suites: LOCAL }));
});

it('lists local suites with running progress or org eval evidence under Has runs, without an open agent', async () => {
  setup({ renderLocalSuite, path: null }, { 'studio.suites.list': () => ({ ok: true, suites: [
    { ...LOCAL[0], progress: { mode: 'simulate' } },
    { ...LOCAL[1], lastResults: {}, lastEval: { passed: true } }
  ] }) });
  await screen.findByTestId('local-suite-MyBot');
  fireEvent.click(button('Has runs'));
  expect(within(screen.getByTestId('local-suite-MyBot')).getByText('Running…')).toBeTruthy();
  expect(within(screen.getByTestId('local-suite-OtherBot')).getByText('Has runs')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'This agent' })).toBeNull();
});

it('scopes the list to the open agent, then groups every agent with this one pinned and open', async () => {
  const { call } = setup({}, { 'studio.orgTests.runs': () => ({ ok: true, runs: [
    toRecord(results('r2', 'completed', [rcase(1, 'pass'), rcase(2, 'fail')])), toRecord(results('r1', 'completed', [rcase(1, 'fail'), rcase(2, 'fail')]))
  ] }) });
  expect(await screen.findByTestId('org-def-RefundTests')).toBeTruthy();
  expect(screen.getByTestId('org-tests-scope').textContent).toBe('MyBot· 1 test · 1 with runs');
  expect(screen.queryByTestId('org-def-OtherTests')).toBeNull();
  expect(screen.getByText('1 of 2 tests')).toBeTruthy();
  expect(screen.getByText(/1 more test for other agents/)).toBeTruthy();
  const refund = screen.getByTestId('org-def-RefundTests');
  expect(within(refund).getByText('50%').className).toContain('is-bad');
  expect(within(refund).getByText('2 cases')).toBeTruthy();
  expect(within(refund).getByText('RefundTests')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Pass rate trend: 0%, 50%' })).toBeTruthy();
  expect(calls(call, 'studio.orgTests.details')).toHaveLength(0);

  fireEvent.click(button('Show all agents'));
  expect(button('All agents').getAttribute('aria-pressed')).toBe('true');
  const groups = screen.getAllByTestId(/^org-tests-group-/).map(g => g.getAttribute('data-testid'));
  expect(groups).toEqual(['org-tests-group-mybot', 'org-tests-group-otherbot']);
  expect(within(screen.getByTestId('org-tests-group-mybot')).getByText('open in Studio')).toBeTruthy();
  expect(screen.queryByTestId('org-def-OtherTests')).toBeNull();
  fireEvent.click(button(/^OtherBot/));
  expect(within(screen.getByTestId('org-def-OtherTests')).getByText('No runs')).toBeTruthy();
  fireEvent.click(button(/^MyBot/));
  expect(screen.queryByTestId('org-def-RefundTests')).toBeNull();
  expect(screen.getByText('2 of 2 tests')).toBeTruthy();

  fireEvent.click(button('Has runs'));
  expect(screen.queryByTestId('org-tests-group-otherbot')).toBeNull();
  fireEvent.click(button('Has runs'));
  fireEvent.change(screen.getByLabelText('Filter org tests'), { target: { value: 'refund' } });
  // A search opens every group it matches.
  expect(screen.getByTestId('org-def-RefundTests')).toBeTruthy();
  expect(screen.queryByTestId('org-tests-group-otherbot')).toBeNull();
  fireEvent.change(screen.getByLabelText('Filter org tests'), { target: { value: 'zzz' } });
  expect(screen.getByText('No org tests match.')).toBeTruthy();
  fireEvent.click(button('This agent'));
  expect(screen.getByText('No org tests for MyBot match.')).toBeTruthy();
  fireEvent.click(button('Refresh'));
  await waitFor(() => expect(calls(call, 'studio.orgTests.list').at(-1)).toEqual({ projectId: 'p1', refresh: true }));
});

it('groups by agent with only the largest group open when no agent is open', async () => {
  setup({ path: null }, { 'studio.orgTests.list': () => ({ ok: true, org: { alias: 'dev' }, definitions: [...DEFS, { name: 'OtherMore', subjectName: 'OtherBot' }] }) });
  await screen.findByTestId('org-tests-group-otherbot');
  expect(screen.queryByRole('group', { name: 'Scope' })).toBeNull();
  expect(screen.getAllByTestId(/^org-tests-group-/).map(g => g.getAttribute('data-testid'))).toEqual(['org-tests-group-otherbot', 'org-tests-group-mybot']);
  expect(screen.getByTestId('org-def-OtherMore')).toBeTruthy();
  expect(screen.queryByTestId('org-def-RefundTests')).toBeNull();
  expect(button(/^OtherBot/).textContent).toContain('2 tests');
  expect(button(/^OtherBot/).textContent).not.toContain('with runs');
  expect(screen.getByText('Pick a test to see its cases and runs.')).toBeTruthy();
});

it('reads the agent of unknown definitions in batches, three at a time, with progress', async () => {
  const names = Array.from({ length: 60 }, (_, i) => `Bare_${i}`);
  const gates: Array<{ names: string[]; open: () => void }> = [];
  const { call } = setup({}, {
    'studio.orgTests.list': () => ({ ok: true, org: { alias: 'dev' }, definitions: names.map(name => ({ name })) }),
    'studio.orgTests.details': a => new Promise(resolve => {
      const batch = a.names as string[];
      gates.push({ names: batch, open: () => resolve(batch.includes('Bare_0')
        ? { ok: true, definitions: batch.filter(n => n !== 'Bare_1').map((name, i) => ({ name, label: `Label ${name}`, subjectName: i % 2 ? 'OtherBot' : 'MyBot', caseCount: 3 })), missing: ['Bare_1'] }
        : batch.includes('Bare_25') ? { ok: false, error: 'UNKNOWN_EXCEPTION' } : { ok: true, definitions: batch.map(name => ({ name, subjectName: 'MyBot' })), missing: [] }) });
    }),
  });
  await waitFor(() => expect(gates).toHaveLength(3));
  expect(gates.map(g => g.names.length)).toEqual([25, 25, 10]);
  expect(screen.getByText('Looking for tests of MyBot…')).toBeTruthy();
  expect(screen.getByText('Reading definitions 0/60')).toBeTruthy();
  await act(async () => { gates[0]!.open(); });
  await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Reading definitions' }).getAttribute('aria-valuenow')).toBe('25'));
  expect(gates).toHaveLength(3);
  expect(screen.getByRole('progressbar', { name: 'Reading definitions' }).getAttribute('aria-valuenow')).toBe('25');
  expect(screen.getByTestId('org-def-Bare_0').textContent).toContain('Label Bare_0');
  fireEvent.click(button('All agents'));
  expect(screen.getAllByTestId(/^org-tests-group-/).map(g => g.getAttribute('data-testid'))).toEqual(['org-tests-group-mybot', 'org-tests-group-otherbot', 'org-tests-group-loading', 'org-tests-group-unknown']);
  fireEvent.click(button(/^Reading agent/));
  expect(screen.getByTestId('org-def-Bare_30').querySelector('[aria-label="Reading definition"]')).toBeTruthy();
  await act(async () => { gates[1]!.open(); gates[2]!.open(); });
  await waitFor(() => expect(screen.getByText('26 could not be read')).toBeTruthy());
  expect(screen.queryByTestId('org-tests-group-loading')).toBeNull();
  expect(button(/^Agent unknown/).textContent).toContain('26 tests');
  expect(calls(call, 'studio.orgTests.details').flatMap(a => a.names as string[]).sort()).toEqual([...names].sort());
});

it('stops reading agents when the org refuses, and when a batch throws keeps the others', async () => {
  const names = Array.from({ length: 80 }, (_, i) => `N${i}`);
  const { call } = setup({ path: null }, {
    'studio.orgTests.list': () => ({ ok: true, definitions: names.map(name => ({ name })) }),
    'studio.orgTests.details': () => ({ ok: false, code: 'refused' }),
  });
  await waitFor(() => expect(screen.getByText('80 could not be read')).toBeTruthy());
  expect(calls(call, 'studio.orgTests.details')).toHaveLength(3);
  cleanup();
  let n = 0;
  setup({ path: null }, {
    'studio.orgTests.list': () => ({ ok: true, definitions: names.slice(0, 30).map(name => ({ name })) }),
    'studio.orgTests.details': a => { if (n++ === 0) throw new Error('down'); return { ok: true, definitions: (a.names as string[]).map(name => ({ name, subjectName: 'MyBot' })) }; },
  });
  await waitFor(() => expect(screen.getByText('25 could not be read')).toBeTruthy());
  expect(button(/^MyBot/).textContent).toContain('5 tests');
});

it('a newer list abandons the agent reads of the previous one', async () => {
  const slow = deferred<unknown>();
  let lists = 0;
  const { call } = setup({ path: null }, {
    'studio.orgTests.list': () => (++lists === 1 ? { ok: true, definitions: [{ name: 'Old_One' }] } : { ok: true, definitions: [{ name: 'New_One', subjectName: 'MyBot' }] }),
    'studio.orgTests.details': () => slow.promise,
  });
  await waitFor(() => expect(calls(call, 'studio.orgTests.details')).toHaveLength(1));
  fireEvent.click(button('Refresh'));
  await screen.findByTestId('org-def-New_One');
  await act(async () => { slow.resolve({ ok: true, definitions: [{ name: 'Old_One', subjectName: 'Ghost' }] }); await Promise.resolve(); });
  expect(screen.queryByTestId('org-tests-group-ghost')).toBeNull();
  expect(screen.queryByText(/Reading definitions/)).toBeNull();
});

it('offers every agent when the open agent has no org tests', async () => {
  setup({ path: 'force-app/main/default/aiAuthoringBundles/Lonely/Lonely.agent' });
  const none = await screen.findByTestId('org-tests-none-for-agent');
  expect(none.textContent).toContain('No org tests for Lonely yet');
  expect(none.textContent).toContain('None of the 2 definitions in dev test this agent.');
  fireEvent.click(within(none).getByRole('button', { name: 'Browse all agents' }));
  expect(screen.getByTestId('org-tests-group-mybot')).toBeTruthy();
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
  expect(screen.getByText('0 of 0 tests')).toBeTruthy();
});

it('does not load while hidden', () => {
  const { call } = setup({ visible: false });
  expect(call).not.toHaveBeenCalled();
});

it('selects a definition and shows its cases', async () => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  const cases = await screen.findByRole('table', { name: 'Test cases' });
  expect(within(cases).getByText('I want a refund')).toBeTruthy();
  expect(within(cases).getByText('Billing')).toBeTruthy();
  expect(within(cases).getByText('1 var')).toBeTruthy();
  expect(screen.getByTestId('org-runs-note').textContent).toContain("Runs started in Testing Center aren't visible here.");
  fireEvent.click(within(screen.getByTestId('org-runs-note')).getByRole('button', { name: 'Add one by run ID.' }));
  expect(screen.getByLabelText('Attach run by id')).toBeTruthy();
  const detail = within(screen.getByTestId('org-def-detail'));
  expect(detail.getByRole('heading', { name: 'Refund tests' })).toBeTruthy();
  expect(detail.getByText('MyBot')).toBeTruthy();
  expect(screen.getByTestId('org-def-RefundTests').getAttribute('aria-selected')).toBe('true');
});

it('selects from a click anywhere on the row and says when a definition has no cases', async () => {
  setup({}, { 'studio.orgTests.definition': () => ({ ok: true, definition: { ...definition(), testCases: [], truncated: true } }) });
  fireEvent.click(await screen.findByTestId('org-def-RefundTests'));
  expect(screen.getByText('Reading the definition…')).toBeTruthy();
  expect(await screen.findByText('This definition has no cases.')).toBeTruthy();
  expect(screen.getByText('Cases (truncated)')).toBeTruthy();
});

it('shows 50 cases at a time', async () => {
  const many: OrgTestDefinition = { ...definition(), testCases: Array.from({ length: 55 }, (_, i) => ({ number: i + 1, utterance: `u${i + 1}`, conversationHistory: [], contextVariables: [], expectations: [] })) };
  setup({}, { 'studio.orgTests.definition': () => ({ ok: true, definition: many }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  const table = await screen.findByRole('table', { name: 'Test cases' });
  expect(table.querySelectorAll('tr.sf-oc-row')).toHaveLength(50);
  expect(screen.getByText(/Showing 50 of 55 cases\./)).toBeTruthy();
  fireEvent.click(button('Show more'));
  expect(table.querySelectorAll('tr.sf-oc-row')).toHaveLength(55);
  expect(screen.queryByText(/Showing 50/)).toBeNull();
});

it('fills a bare list row from its loaded definition', async () => {
  setup({ path: null }, {
    'studio.orgTests.list': () => ({ ok: true, org: { alias: 'dev' }, definitions: [{ name: 'Bare_Test' }], at: 1 }),
    'studio.orgTests.definition': () => ({ ok: true, definition: { ...definition(), name: 'Bare_Test', label: 'Bare label', subjectName: 'BareBot', caseCount: undefined } }),
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Bare_Test' }));
  await waitFor(() => expect(screen.getByTestId('org-tests-group-barebot')).toBeTruthy());
  const row = screen.getByTestId('org-def-Bare_Test');
  expect(within(row).getByRole('button', { name: 'Bare label' })).toBeTruthy();
  expect(row.textContent).toContain('2 cases');
  const meta = within(screen.getByTestId('org-def-detail'));
  expect(meta.getByText('BareBot')).toBeTruthy();
  expect(meta.getByText('Never')).toBeTruthy();
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
  await screen.findByRole('table', { name: 'Test cases' });
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
  await screen.findByRole('table', { name: 'Test cases' });
  fireEvent.click(button('Run in org')); fireEvent.click(button('Start run'));
  expect(await screen.findByText('The run on this production or unknown org was not approved.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Allow reads…' })).toBeNull();
  cleanup();
  setup({ threadId: undefined }, { 'studio.orgTests.run.start': start });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('table', { name: 'Test cases' });
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
  await screen.findByRole('table', { name: 'Test cases' });
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
  await screen.findByRole('table', { name: 'Test cases' });
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
  await screen.findByRole('table', { name: 'Test cases' });
  openMenu();
  fireEvent.click(button('Attach'));
  expect(screen.getByText('Enter a run id.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Attach run by id'), { target: { value: 'short' } });
  fireEvent.click(button('Attach'));
  expect(screen.getByText('A run id is 15 to 18 letters and digits.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Attach run by id'), { target: { value: 'bad0000000000000' } });
  fireEvent.click(button('Attach'));
  expect(await screen.findByText('Unknown run')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Attach run by id'), { target: { value: ' ext9ABCDEFGHIJKL ' } });
  fireEvent.keyDown(screen.getByLabelText('Attach run by id'), { key: 'Enter' });
  expect(await screen.findByText('Attached run ext9ABCDEFGHIJKL.')).toBeTruthy();
  expect(calls(call, 'studio.orgTests.run.attach')[1]).toEqual({ projectId: 'p1', runId: 'ext9ABCDEFGHIJKL' });
  expect(screen.getByTestId('org-run-detail')).toBeTruthy();
  // A successful attach closes the menu; Escape closes it too.
  expect(screen.queryByLabelText('Attach run by id')).toBeNull();
  openMenu();
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Attach a run' }), { key: 'Escape' });
  expect(screen.queryByLabelText('Attach run by id')).toBeNull();
});

it('imports a definition into the suite and tells when cases were left out', async () => {
  const big: OrgTestDefinition = { ...definition(), testCases: Array.from({ length: 60 }, (_, i) => ({ number: i + 1, utterance: `u${i + 1}`, conversationHistory: [], contextVariables: [], expectations: [] })) };
  const { call } = setup({}, { 'studio.orgTests.definition': () => ({ ok: true, definition: big }), 'studio.suites.import': () => ({ ok: true, imported: 50 }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('table', { name: 'Test cases' });
  fireEvent.click(button('Import to suite'));
  expect(await screen.findByText(/Imported 50 cases into the suite\. A suite holds 50 cases, so 10 were left out\./)).toBeTruthy();
  const sent = calls(call, 'studio.suites.import')[0];
  expect(sent.agentPath).toBe(PATH);
  expect(JSON.parse(sent.text as string).testCases).toHaveLength(50);
});

it('reports an import failure and requires an open agent', async () => {
  setup({}, { 'studio.suites.import': () => ({ ok: false, error: 'Bad spec' }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('table', { name: 'Test cases' });
  fireEvent.click(button('Import to suite'));
  expect(await screen.findByText('Bad spec')).toBeTruthy();
  cleanup();
  setup({ path: null });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  await screen.findByRole('table', { name: 'Test cases' });
  expect(button('Import to suite').disabled).toBe(true);
  expect(screen.queryByRole('group', { name: 'Scope' })).toBeNull();
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
  openMenu();
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
  await screen.findByRole('table', { name: 'Test cases' });
  fireEvent.click(await screen.findByRole('button', { name: 'Refund tests' }));
  openMenu();
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
  everyAgent();
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
  everyAgent();
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
  openMenu();
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
  openMenu();
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
  await screen.findByRole('table', { name: 'Test cases' });
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
  await screen.findByRole('table', { name: 'Test cases' });
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

it('labels a run by its start time and falls back to the id', () => {
  expect(runLabel({ runId: 'R1' })).toBe('Run R1');
  expect(runLabel({ runId: 'R1', startedAt: Number.NaN })).toBe('Run R1');
  expect(runLabel({ runId: 'R1', startedAt: Date.UTC(2026, 0, 5, 12, 0) })).toMatch(/^Run · /);
});
