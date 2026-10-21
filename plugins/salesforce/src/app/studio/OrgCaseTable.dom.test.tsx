/** @vitest-environment happy-dom */
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { OrgCaseResult, OrgRunResults, OrgTestCase } from '../../../lib/org-tests-contract.js';
import { OrgCaseTable } from './OrgCaseTable.js';

afterEach(cleanup);

const QUALITY = [{ name: 'completeness' }, { name: 'coherence' }, { name: 'output_latency_milliseconds' }];
const CASES: OrgTestCase[] = [
  {
    number: 1, utterance: 'Account Precheck', conversationHistory: [], contextVariables: [{ name: 'currentObjectApiName', value: 'Opportunity' }, { name: 'currentRecordId', value: '' }],
    expectations: [{ name: 'topic_sequence_match', expectedValue: 'Account_Pre_Check' }, { name: 'action_sequence_match', expectedValue: '[]' }, { name: 'bot_response_rating', expectedValue: 'Agent asks for the Contact' }, ...QUALITY],
  },
  {
    number: 2, utterance: '{""contactId"": ""003X"", ""billingAccountId"": ""001Y"", ""extra"": ""z""}',
    conversationHistory: [{ role: 'user', message: 'Account Precheck' }, { role: 'agent', message: 'Please provide the Contact.' }, { role: 'user', message: '{"a": 1}' }],
    contextVariables: [],
    expectations: [{ name: 'topic_sequence_match', expectedValue: 'Account_Pre_Check' }, { name: 'action_sequence_match', expectedValue: "['BT_Pre_Check', 'Second', 'Third']" }, { name: 'bot_response_rating', expectedValue: 'Agent validates' }, ...QUALITY],
  },
  { number: 3, utterance: 'Start Guided Quote', conversationHistory: [], contextVariables: [], expectations: [{ name: 'topic_sequence_match', expectedValue: 'Guided_Quote' }, { name: 'factuality', expectedValue: 'Accurate' }] },
  { number: 4, utterance: 'Just scored', conversationHistory: [], contextVariables: [], expectations: [{ name: 'coherence' }] },
];
const result = (number: number, verdict: OrgCaseResult['verdict'], extra: Partial<OrgCaseResult> = {}): OrgCaseResult => ({ number, utterance: '', status: 'completed', actions: [], metrics: [], verdict, ...extra });
const RUN: OrgRunResults = {
  runId: 'R1', definition: 'Quote', orgId: 'o', orgAlias: 'dev', status: 'completed', startedAt: 1, startedBy: 'studio', counts: { total: 4, pass: 2, fail: 1, error: 1, pending: 0 },
  cases: [
    result(1, 'pass', { topic: 'Account_Pre_Check', reply: 'Please give the Contact', metrics: [
      { name: 'topic_sequence_match', result: 'pass' }, { name: 'action_sequence_match', result: 'pass' }, { name: 'bot_response_rating', score: 5, result: 'pass' },
      { name: 'coherence', score: 4, result: null }, { name: 'output_latency_milliseconds', actual: '3100', result: null },
    ] }),
    result(2, 'fail', { metrics: [
      { name: 'topic_sequence_match', actual: 'Other_Topic', result: 'fail' }, { name: 'action_sequence_match', result: 'fail' }, { name: 'bot_response_rating', score: 2, result: 'fail' },
      { name: 'completeness', result: null, error: 'Scoring timed out' },
    ] }),
    result(3, 'error', { actions: ['Ran_Something'] }),
  ],
};

const rows = () => [...document.querySelectorAll('tr.sf-oc-row')].map(row => row.querySelector('.sf-oc-num')!.textContent);
const open = (n: number) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Case ${n}\\b`) }));

it('shows one row per case with its topic, actions, response, form and context, and the quality metrics once', () => {
  render(<OrgCaseTable cases={CASES} />);
  const table = screen.getByRole('table', { name: 'Test cases' });
  expect(rows()).toEqual(['1', '2', '3', '4']);
  expect(screen.getByText('Scored on every case: Completeness · Coherence · Latency')).toBeTruthy();
  const second = table.querySelectorAll('tr.sf-oc-row')[1] as HTMLElement;
  expect(within(second).getByText('{ } Form · contactId, billingAccountId +1')).toBeTruthy();
  expect(within(second).getByText('after 3 earlier turns')).toBeTruthy();
  expect(within(second).getByText('BT_Pre_Check')).toBeTruthy();
  expect(within(second).getByText('Second')).toBeTruthy();
  expect(within(second).getByText('+1').getAttribute('title')).toBe('Third');
  const first = table.querySelectorAll('tr.sf-oc-row')[0] as HTMLElement;
  expect(within(first).getByText('none')).toBeTruthy();
  expect(within(first).getByText('2 vars')).toBeTruthy();
  expect(within(first).getByText('Agent asks for the Contact')).toBeTruthy();
  expect(document.querySelector('.sf-oc-dot')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Failed/ })).toBeNull();
});

it('opens a row in place with the conversation, the form as fields, the expectations and the context', () => {
  render(<OrgCaseTable cases={CASES} />);
  open(2);
  expect(screen.getByRole('button', { name: /^Case 2/ }).getAttribute('aria-expanded')).toBe('true');
  const conversation = within(screen.getByLabelText('Conversation'));
  expect(conversation.getByText('Account Precheck')).toBeTruthy();
  expect(conversation.getByText('Please provide the Contact.')).toBeTruthy();
  expect(conversation.getByText('{ } Form · a')).toBeTruthy();
  expect(conversation.getByText('Form submission')).toBeTruthy();
  expect(conversation.getByText('contactId')).toBeTruthy();
  expect(conversation.getByText('003X')).toBeTruthy();
  expect(screen.queryByText(/""contactId""/)).toBeNull();
  fireEvent.click(conversation.getByRole('button', { name: 'Show raw utterance' }));
  expect(conversation.getByText(/""contactId""/)).toBeTruthy();
  fireEvent.click(conversation.getByRole('button', { name: 'Hide raw utterance' }));
  expect(screen.queryByText(/""contactId""/)).toBeNull();
  const expected = within(screen.getByLabelText('Expected'));
  expect(expected.getByText('Agent validates')).toBeTruthy();
  expect(expected.getByText('Third')).toBeTruthy();
  expect(screen.queryByLabelText('Last run')).toBeNull();
  expect(screen.queryByLabelText('Context variables')).toBeNull();
  open(2);
  expect(screen.queryByLabelText('Conversation')).toBeNull();

  open(1);
  expect(within(screen.getByLabelText('Conversation')).queryByRole('button', { name: 'Show raw utterance' })).toBeNull();
  const context = within(screen.getByLabelText('Context variables'));
  expect(context.getByText('Opportunity')).toBeTruthy();
  expect(context.getByText('—')).toBeTruthy();
  open(3);
  expect(within(screen.getAllByLabelText('Expected')[1]!).getByText('Accurate')).toBeTruthy();
  open(4);
  expect(screen.getByText('Only quality metrics are scored.')).toBeTruthy();
});

it('opens a row from a click anywhere on it', () => {
  render(<OrgCaseTable cases={CASES} />);
  fireEvent.click(screen.getByText('Start Guided Quote'));
  expect(screen.getByRole('button', { name: /^Case 3/ }).getAttribute('aria-expanded')).toBe('true');
});

it('filters by search and topic, and says when nothing matches', () => {
  render(<OrgCaseTable cases={CASES} />);
  fireEvent.click(screen.getByRole('button', { name: 'Guided_Quote 1' }));
  expect(rows()).toEqual(['3']);
  fireEvent.click(screen.getByRole('button', { name: 'Guided_Quote 1' }));
  expect(rows()).toEqual(['1', '2', '3', '4']);
  fireEvent.click(screen.getByRole('button', { name: 'Account_Pre_Check 2' }));
  expect(rows()).toEqual(['1', '2']);
  fireEvent.click(screen.getByRole('button', { name: 'All 4' }));
  expect(rows()).toEqual(['1', '2', '3', '4']);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search cases' }), { target: { value: 'validates' } });
  expect(rows()).toEqual(['2']);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search cases' }), { target: { value: 'zzz' } });
  expect(screen.getByText('No case matches.')).toBeTruthy();
});

it('hides topic chips when the cases share one topic', () => {
  render(<OrgCaseTable cases={CASES.slice(0, 2)} />);
  expect(screen.queryByRole('button', { name: /^All/ })).toBeNull();
});

it('shows each case\'s verdict and last run next to what it expected, and filters to failures', () => {
  render(<OrgCaseTable cases={CASES} run={RUN} />);
  expect(screen.getByRole('button', { name: 'Case 1 · pass' }).querySelector('.sf-oc-dot.is-pass')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Case 4' }).querySelector('.sf-oc-dot')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Failed 2' }));
  expect(rows()).toEqual(['2', '3']);
  fireEvent.click(screen.getByRole('button', { name: 'Failed 2' }));
  expect(rows()).toEqual(['1', '2', '3', '4']);

  open(1);
  let last = within(screen.getByLabelText('Last run'));
  expect(last.getByText('Last run · pass')).toBeTruthy();
  expect(last.getAllByLabelText('passed')).toHaveLength(2);
  expect(last.getByText('none called')).toBeTruthy();
  expect(last.getByText(/✓ 5/)).toBeTruthy();
  expect(last.getByText('“Please give the Contact”')).toBeTruthy();
  expect(last.getByText('Coherence 4')).toBeTruthy();
  expect(last.getByText('Latency 3.1 s')).toBeTruthy();
  open(1);

  open(2);
  last = within(screen.getByLabelText('Last run'));
  expect(last.getByText('Other_Topic')).toBeTruthy();
  expect(last.getByText(/✗ expected Account_Pre_Check/)).toBeTruthy();
  expect(last.getByText(/✗ expected BT_Pre_Check, Second, Third/)).toBeTruthy();
  expect(last.getByText(/✗ 2/)).toBeTruthy();
  expect(last.getByText('No reply')).toBeTruthy();
  expect(last.getByText('Completeness: Scoring timed out')).toBeTruthy();
  open(2);

  open(3);
  last = within(screen.getByLabelText('Last run'));
  expect(last.getByText('Last run · error')).toBeTruthy();
  expect(last.getByText('Ran_Something')).toBeTruthy();
  expect(last.queryByText('Topic')).toBeNull();
});

it('marks a failed action check that expected none', () => {
  const cases: OrgTestCase[] = [{ number: 1, utterance: 'x', conversationHistory: [], contextVariables: [], expectations: [{ name: 'action_sequence_match', expectedValue: '[]' }] }];
  render(<OrgCaseTable cases={cases} run={{ ...RUN, cases: [result(1, 'fail', { actions: ['Surprise'], metrics: [{ name: 'action_sequence_match', result: 'fail' }] })] }} />);
  open(1);
  expect(within(screen.getByLabelText('Last run')).getByText(/✗ expected none/)).toBeTruthy();
});
