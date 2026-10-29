/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { TestCasesWorkbench, caseStatus } from './TestCasesWorkbench.js';
import type { CaseResult, ScenarioCase } from '../../../lib/studio-contract.js';

afterEach(cleanup);
const cases: ScenarioCase[] = [
  { id: 'quote', name: 'Quote journey', utterances: ['Create a quote', 'MX75 please'], expect: { criteria: 'Ask for missing details.', topic: 'Quote_Creation', actions: ['ParseInput'] }, pinned: { runId: 'saved-1', at: 1 } },
  { id: 'billing', name: 'Billing stays in scope', utterances: ['Update billing'], expect: { forbiddenActions: ['*'] } },
  { id: 'empty', name: 'No expectations', utterances: ['Hello'], expect: {} }
];
const result = (extra: Partial<CaseResult> = {}): CaseResult => ({ outcome: 'pass', runId: 'r', at: 1, reply: 'Which address?', judge: 'pass', deterministic: 'pass', ...extra });
function setup(extra: Partial<ComponentProps<typeof TestCasesWorkbench>> = {}) {
  const props = { cases, results: {}, filter: 'all' as const, running: false, sourceReady: true, prepared: [], onFilterChange: vi.fn(), onPreparedChange: vi.fn(), onRun: vi.fn(), onRemove: vi.fn(), onFix: vi.fn(), onShowPath: vi.fn(), ...extra };
  const view = render(<TestCasesWorkbench {...props} />);
  return { props, ...view };
}
const details = () => screen.getByRole('region', { name: 'Case details' });
const select = (name = 'Quote journey') => fireEvent.click(screen.getByRole('button', { name: `Details for ${name}` }));
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

it('opens the selected case variables and includes the new tab in keyboard navigation', () => {
  const renderVariables = vi.fn((scenario: ScenarioCase) => <div>Variables for {scenario.name}</div>);
  setup({ renderVariables }); select();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Result' }), { key: 'End' });
  expect(screen.getByText('Variables for Quote journey')).toBeTruthy();
  select('Billing stays in scope'); tab('Variables');
  expect(screen.getByText('Variables for Billing stays in scope')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Variables' }), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Result' }).getAttribute('aria-selected')).toBe('true');
});

it.each([
  [undefined, 'not-run'], [result({ outcome: 'fail' }), 'fail'], [result({ stopped: true, outcome: 'inconclusive' }), 'stopped'],
  [result({ setupBlocked: true, stopped: true }), 'setup'], [result({ outcome: 'inconclusive', notes: ['This operation was aborted'] }), 'stopped'],
  [result({ outcome: 'inconclusive', notes: ['Network request cancelled unexpectedly'] }), 'inconclusive'],
  [result({ outcome: 'fail', notes: ['This operation was aborted'] }), 'fail']
])('classifies result %s as %s without turning arbitrary failures into cancellation', (value, status) => {
  expect(caseStatus(value as CaseResult | undefined)).toBe(status);
});

it('shows a concise list, opens a case, and keeps technical checks in Expectations', () => {
  const { props } = setup();
  const row = screen.getByTestId('tests-row-quote');
  expect(within(row).getByText('2 turns')).toBeTruthy();
  expect(within(row).getByText('Pinned').title).toContain('saved-1');
  expect(within(row).queryByText('Quote_Creation')).toBeNull();
  select();
  expect(row.getAttribute('aria-pressed')).toBe('true');
  expect(document.getElementById(row.getAttribute('aria-controls')!)).toBe(details());
  expect(within(details()).getByText('This case has not run yet')).toBeTruthy();
  fireEvent.click(within(details()).getByRole('button', { name: 'Run case' }));
  expect(props.onRun).toHaveBeenCalledWith('quote');
  tab('Expectations');
  expect(screen.getByText('Ask for missing details.')).toBeTruthy();
  expect(screen.getByText('MX75 please')).toBeTruthy();
  const technical = screen.getByText('Technical checks · 2').closest('details')!;
  expect(technical.open).toBe(false);
  fireEvent.click(within(technical).getByText('Technical checks · 2'));
  expect(technical.open).toBe(true);
  expect(within(technical).getByText('Calls ParseInput')).toBeTruthy();
  select('No expectations'); tab('Expectations');
  expect(screen.getByText('No expectations have been configured for this case.')).toBeTruthy();
});

it('searches titles and messages, reports no matches, and clears filters', () => {
  const { props } = setup();
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'MX75' } });
  expect(screen.queryByTestId('tests-row-billing')).toBeNull();
  expect(screen.getByText('1 of 3 cases')).toBeTruthy();
  fireEvent.change(search, { target: { value: 'nothing here' } });
  expect(screen.getByText('Select a case to see its details.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(props.onFilterChange).toHaveBeenCalledWith('all');
  expect((search as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'stopped' } });
  expect(props.onFilterChange).toHaveBeenCalledWith('stopped');
});

it('filters by status, safely changes selection when filtering or removing a case', () => {
  const { props, rerender } = setup({ results: { quote: result(), billing: result({ outcome: 'inconclusive', stopped: true }) } });
  select();
  rerender(<TestCasesWorkbench {...props} filter="stopped" />);
  expect(screen.queryByTestId('tests-row-quote')).toBeNull();
  expect(within(details()).getByRole('heading', { name: 'Billing stays in scope' })).toBeTruthy();
  rerender(<TestCasesWorkbench {...props} cases={[cases[2]!]} />);
  expect(within(details()).getByRole('heading', { name: 'No expectations' })).toBeTruthy();
});

it('supports keyboard case navigation, tab navigation, and returning focus to the list', () => {
  setup();
  const first = screen.getByTestId('tests-row-quote');
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByTestId('tests-row-billing'));
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(document.activeElement).toBe(screen.getByTestId('tests-row-empty'));
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  fireEvent.keyDown(first, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'a' });
  fireEvent.keyDown(screen.getByRole('region', { name: 'Test case list' }), { key: 'ArrowDown' });
  select();
  const resultTab = screen.getByRole('tab', { name: 'Result' });
  fireEvent.keyDown(resultTab, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Conversation' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(screen.getByRole('tab', { name: 'Expectations' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  fireEvent.keyDown(document.activeElement!, { key: 'x' });
  fireEvent.click(within(details()).getByText('← All cases'));
  expect(document.activeElement).toBe(first);
  expect(screen.getByTestId('tests-cases-workbench').classList.contains('has-selection')).toBe(false);
});

it('explains stopped attempts without showing a verdict or raw AbortError', () => {
  const { props } = setup({ results: { quote: result({ outcome: 'inconclusive', stopped: true, notes: ['This operation was aborted'], reply: undefined }) } });
  select();
  expect(screen.getByText('This case was stopped')).toBeTruthy();
  expect(screen.queryByText('This operation was aborted')).toBeNull();
  expect(screen.queryByText('Run evidence')).toBeNull();
  expect(screen.getByText(/Completed cases keep their results/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Run case again' }));
  expect(props.onRun).toHaveBeenCalledWith('quote');
  tab('Conversation');
  expect(screen.getByText(/The run stopped before a conversation was saved/)).toBeTruthy();
});

it('shows recorded messages and truncation, including preserved messages for stopped attempts', () => {
  setup({ results: { quote: result({ stopped: true, outcome: 'inconclusive', conversationTruncated: true, conversation: [{ role: 'user', message: 'First message' }, { role: 'agent', message: 'Recorded answer' }] }) } });
  select();
  expect(screen.getByText(/Recorded messages are available/)).toBeTruthy();
  tab('Conversation');
  expect(screen.getByText('First message')).toBeTruthy();
  expect(screen.getByText('Recorded answer')).toBeTruthy();
  expect(screen.getByText(/shortened to fit/)).toBeTruthy();
});

it('shows legacy replies honestly and never invents a conversation from scripted inputs', () => {
  setup({ results: { quote: result() } });
  select(); tab('Conversation');
  expect(screen.getByText(/Only the final reply was saved/)).toBeTruthy();
  expect(screen.queryByText('MX75 please')).toBeNull();
  expect(screen.getByText('Which address?')).toBeTruthy();
  select('Billing stays in scope'); tab('Conversation');
  expect(screen.getByText('Run this case to record the customer and agent messages.')).toBeTruthy();
});

it('keeps progress cases visible under filters and suppresses their old results', () => {
  setup({ filter: 'fail', running: true, results: { quote: result({ outcome: 'fail', reply: 'Old reply' }) }, progress: { id: 'p', mode: 'simulate', startedAt: 1, caseIds: ['quote', 'billing'], currentCaseId: 'quote', completed: 0, stage: 'conversation', results: {} } });
  expect(within(screen.getByTestId('tests-row-billing')).getByText('Queued')).toBeTruthy();
  expect(screen.queryByTestId('tests-row-empty')).toBeNull();
  select();
  expect(screen.getByText('This case is running')).toBeTruthy();
  expect((within(details()).getByRole('button', { name: 'Running…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('Old reply')).toBeNull();
  tab('Conversation');
  expect(screen.getByText('Messages will appear once this case completes.')).toBeTruthy();
  select('Billing stays in scope');
  expect(screen.getByText('Waiting to run')).toBeTruthy();
});

it('shows failure evidence, fix and graph actions, while keeping removal in case options', () => {
  const { props } = setup({ results: { quote: result({ outcome: 'fail', notes: ['AI: Address skipped'], judge: 'fail', observed: { topics: [], actions: [], traced: true, traceComplete: true }, latencyMs: 321 }) } });
  select();
  expect(screen.getByText('Judge: Address skipped')).toBeTruthy();
  expect(screen.getByText('Not entered')).toBeTruthy();
  expect(screen.getByText('Not called')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Fix this case' }));
  expect(props.onFix).toHaveBeenCalledWith(cases[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Show path on graph' }));
  expect(props.onShowPath).toHaveBeenCalledWith('quote');
  fireEvent.click(screen.getByText('Case options'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove case' }));
  expect(props.onRemove).toHaveBeenCalledWith('quote');
  fireEvent.click(screen.getByText(/Run evidence/));
  expect(screen.getByText('Maximum response time: 321 ms')).toBeTruthy();
});

it('exposes prerequisites, accepts preparation, and protects the final case', () => {
  const c = { ...cases[0]!, prerequisites: ['Account selected'] };
  const { props, rerender } = setup({ cases: [c], results: { quote: result({ setupBlocked: true }) }, prepared: ['quote'], sourceReady: false });
  select();
  expect(screen.getByText('Account selected')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('I prepared this case for this session'));
  expect(props.onPreparedChange).toHaveBeenCalledWith('quote', false);
  expect((screen.getByRole('button', { name: 'Run case again' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Case options'));
  expect((screen.getByRole('button', { name: 'Remove case' }) as HTMLButtonElement).disabled).toBe(true);
  rerender(<TestCasesWorkbench {...props} prepared={[]} />);
  fireEvent.click(screen.getByLabelText('I prepared this case for this session'));
  expect(props.onPreparedChange).toHaveBeenCalledWith('quote', true);
});

it('keeps org eval and proposal outcomes distinct from Simulate', () => {
  const lastEval = { at: 1, org: 'sandbox', orgId: 'o', passed: false, specPath: 'x', perCase: true, results: { quote: { outcome: 'fail' as const } }, multiTurn: ['quote'], historyReplay: true as const };
  const { props, rerender } = setup({ results: { quote: result() }, lastEval, proposal: { quote: 'inconclusive' } });
  select();
  expect(screen.getByText('Failed · sandbox')).toBeTruthy();
  expect(screen.getByText(/Final-turn replay/)).toBeTruthy();
  expect(screen.getByText(/Needs review · These results are not saved/)).toBeTruthy();
  expect(within(screen.getByTestId('tests-row-quote')).getByText('Proposal: Needs review')).toBeTruthy();
  rerender(<TestCasesWorkbench {...props} lastEval={{ ...lastEval, historyReplay: undefined, perCase: false, results: {} }} proposal={{}} />);
  expect(screen.getByText('Org eval (totals)')).toBeTruthy();
  expect(screen.getByText('No per-case result · sandbox')).toBeTruthy();
  expect(screen.getByText(/older evaluation/)).toBeTruthy();
});

it.each([undefined, ['Incomplete trace']])('explains inconclusive evidence with notes %s', notes => {
  setup({ results: { quote: result({ outcome: 'inconclusive', observed: { topics: [], actions: [], traced: false, traceComplete: false }, notes, deterministic: undefined, judge: undefined }) } });
  select();
  expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0);
  expect(screen.getByText(notes?.[0] ?? 'There was not enough evidence to reach a verdict. Review the checks or run this case again.')).toBeTruthy();
});

it('shows passing checks, a passing reply, and assertion-only criteria', () => {
  setup({ results: { quote: result({ observed: { topics: ['Quote_Creation'], actions: ['ParseInput'], traced: true, traceComplete: true }, notes: ['AI: Asked for address'] }) } });
  select();
  expect(screen.getByText('The recorded response met this case’s expectations.')).toBeTruthy();
  expect(screen.getByText('Routed to Quote_Creation')).toBeTruthy();
  expect(screen.getByText('Asked for address')).toBeTruthy();
  select('Billing stays in scope'); tab('Expectations');
  expect(screen.getByText('Meet the configured checks below.')).toBeTruthy();
});
