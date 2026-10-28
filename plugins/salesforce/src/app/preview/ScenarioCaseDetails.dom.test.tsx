/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScenarioCaseDetails } from './ScenarioCaseDetails.js';
import type { CaseResult, ScenarioCase } from '../../../lib/studio-contract.js';
import type { LabSnapshot } from '../../../lib/agentforce-lab-contract.js';

afterEach(cleanup);
const scenario: ScenarioCase = { id: 'order', name: 'Find an order', utterances: ['Where is it?', 'Order 42'], prerequisites: ['An order exists'], expect: { actions: ['Lookup'], contains: ['shipped'] } };
const result: CaseResult = { outcome: 'fail', runId: 'r1', at: 1, reply: 'Not found', notes: ['Missing text: "shipped"'], observed: { topics: ['Orders'], actions: ['Lookup'], traced: true, traceComplete: true } };
const recording: LabSnapshot = { id: 'r1', engine: 'preview', orgAlias: 'dev', sourceHash: 'h', model: 'm', path: 'Order.agent', turns: [{ role: 'user', text: 'Where is it?' }, { role: 'agent', text: 'Your order number?', planId: 'p1' }, { role: 'user', text: 'Order 42' }, { role: 'agent', text: 'Not found', planId: 'p2' }], closed: true, failed: false };
const trace = { runId: 'r1', turn: 1, available: true, steps: [{ kind: 'action', label: 'Lookup', inputPreview: '42', outputPreview: 'NotFound' }] };
function setup(extra: Partial<Parameters<typeof ScenarioCaseDetails>[0]> = {}, handler: (method: string) => unknown = () => ({ ok: true, data: recording })) {
  const call = vi.fn(async (_plugin: string, method: string) => handler(method));
  const props = { pluginId: 'salesforce', projectId: 'p', scenario, result, onClose: vi.fn(), call, ...extra };
  return { ...render(<ScenarioCaseDetails {...props} />), props, call };
}
it('loads the full scoped conversation on demand, renders checks and notes and opens the selected reply trace', async () => {
  const { call, props } = setup({}, method => ({ ok: true, data: method === 'agentLab.get' ? recording : trace }));
  expect(screen.getByRole('status').textContent).toContain('Loading conversation');
  expect(await screen.findByText('Your order number?')).toBeTruthy();
  expect(call).toHaveBeenCalledWith('salesforce', 'agentLab.get', { projectId: 'p', id: 'r1' });
  expect(call).toHaveBeenCalledTimes(1);
  expect(screen.getByText('An order exists')).toBeTruthy();
  expect(screen.getByText('Actual: Not in the reply')).toBeTruthy();
  expect(screen.getByText('Missing text: "shipped"')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View trace for reply 1' }));
  await screen.findByRole('region', { name: 'Planner trace' });
  expect(call).toHaveBeenLastCalledWith('salesforce', 'agentLab.trace', { projectId: 'p', id: 'r1', planId: 'p1', turn: 1, path: 'Order.agent' });
  fireEvent.click(screen.getByRole('button', { name: 'Expand all payloads' }));
  expect(screen.getByText('NotFound')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View trace for reply 1' }));
  expect(screen.queryByRole('region', { name: 'Planner trace' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
  expect(props.onClose).toHaveBeenCalledOnce();
});
it('keeps saved conversation history and final reply when a run expires', async () => {
  setup({ result: { ...result, history: [{ role: 'user', message: 'Where is it?' }, { role: 'agent', message: 'Your order number?' }] } }, () => ({ ok: false, error: 'Run expired.' }));
  await screen.findByText(/Run expired.*saved evidence only/);
  expect(screen.getByRole('log').textContent).toContain('Your order number?');
  expect(screen.getByRole('log').textContent).toContain('Order 42');
  expect(screen.getByRole('log').textContent).toContain('Not found');
  expect(screen.queryByRole('button', { name: /View trace/ })).toBeNull();
});
it('explains missing recordings without inventing replies and preserves saved checks', async () => {
  setup({ projectId: undefined, scenario: { ...scenario, prerequisites: [], expect: {} }, result: { outcome: 'inconclusive', runId: '', at: 1, observed: { traced: false, topics: [], actions: [], traceComplete: false } } });
  expect(screen.getByText('Inconclusive')).toBeTruthy();
  expect(screen.getByText(/A full recording was not saved/)).toBeTruthy();
  expect(screen.getByText('No checks defined for this case.')).toBeTruthy();
  expect(screen.getByRole('log').textContent).toBe('');
  expect(screen.getByText('Actions: None recorded')).toBeTruthy();
  expect(screen.getByText(/trace is unavailable or incomplete/)).toBeTruthy();
});
it('shows unrun inputs and never loads a recording for a case without results', () => {
  const { call } = setup({ result: undefined, scenario: { ...scenario, expect: { topic: 'Orders' } } });
  expect(call).not.toHaveBeenCalled();
  expect(screen.getByText('Not run')).toBeTruthy();
  expect(screen.getByText('Run this case to record a conversation.')).toBeTruthy();
  expect(screen.getByText('Actual: Not run')).toBeTruthy();
});
it.each([new Error('Offline'), 'Offline'])('handles recording rejection: %s', async error => {
  setup({}, () => { throw error; });
  await screen.findByText(/Offline.*saved evidence only/);
  expect(screen.getByRole('log').textContent).toContain('Not found');
});
it('handles empty recordings, passes and missing response bodies', async () => {
  const { rerender, props } = setup({ result: { ...result, outcome: 'pass' } }, () => ({ ok: true, data: { ...recording, turns: [] } }));
  await screen.findByText('No messages were recorded.');
  expect(screen.getByText('Passed')).toBeTruthy();
  rerender(<ScenarioCaseDetails {...props} result={{ ...result, runId: 'missing' }} call={async () => null} />);
  await screen.findByText(/full recording is no longer available/);
});
it.each([{ ok: false, error: 'Trace expired' }, null, new Error('Trace offline'), 'Trace offline'])('explains a missing trace: %s', async reply => {
  setup({ projectId: undefined }, method => { if (method === 'agentLab.get') return { ok: true, data: recording }; if (reply instanceof Error || typeof reply === 'string') throw reply; return reply; });
  fireEvent.click(await screen.findByRole('button', { name: 'View trace for reply 2' }));
  await waitFor(() => expect(screen.queryByText('Loading trace…')).toBeNull());
  expect(screen.getByTestId('sf-trace').textContent).toMatch(/Trace (expired|unavailable|offline)/);
});
it('ignores a late recording after the reader switches cases', async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  const { rerender, props } = setup({}, () => pending);
  rerender(<ScenarioCaseDetails {...props} result={undefined} />);
  await act(async () => { finish({ ok: true, data: recording }); });
  expect(screen.queryByText('Your order number?')).toBeNull();
  expect(screen.getByText('Run this case to record a conversation.')).toBeTruthy();
});
it('ignores a stale trace response after selecting a different reply', async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  setup({}, method => method === 'agentLab.get' ? { ok: true, data: recording } : pending);
  fireEvent.click(await screen.findByRole('button', { name: 'View trace for reply 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'View trace for reply 1' }));
  await act(async () => { finish({ ok: true, data: trace }); });
  expect(screen.queryByTestId('sf-trace')).toBeNull();
});

it('shows the persisted transcript after the live run expires and labels shortened recordings', async () => {
  setup({ result: { ...result, conversation: [{ role: 'user', message: 'Saved input' }, { role: 'agent', message: 'Saved answer' }], conversationTruncated: true } }, () => ({ ok: false }));
  await screen.findByText(/Showing the saved conversation/);
  expect(screen.getByRole('log').textContent).toContain('Saved input');
  expect(screen.getByRole('log').textContent).toContain('Saved answer');
  expect(screen.getByText(/shortened to fit/)).toBeTruthy();
});
