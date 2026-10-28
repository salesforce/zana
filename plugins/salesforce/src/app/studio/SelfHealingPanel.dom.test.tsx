/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SelfHealingPanel, type SelfHealingPanelProps } from './SelfHealingPanel.js';
import { SELF_HEALING_RPC, type SelfHealingRun } from '../../../lib/self-healing-contract.js';
import type { SimulationBatch } from '../../../lib/simulation-contract.js';
afterEach(cleanup);
const run: SelfHealingRun = { id: 'run', agentPath: 'Help.agent', baselineBatchId: 'base', baselineHash: 'h', savedHash: 'h', baselinePass: 1, total: 2, bestPass: 1, bestHash: 'h', bestBatchId: 'base', maxAttempts: 3, attempts: [], status: 'awaiting_candidate', startedAt: 1, updatedAt: 1 };
const batch = { id: 'base', engine: 'preview', status: 'done', counts: { pass: 1, total: 2, error: 0, stopped: 0 } } as SimulationBatch;
function setup(overrides: Partial<SelfHealingPanelProps> = {}) {
  let current: SelfHealingRun | null = null;
  const rpc = vi.fn(async (method: string) => { if (method !== SELF_HEALING_RPC.status) current = run; return { ok: true, run: current }; });
  const props: SelfHealingPanelProps = { path: 'Help.agent', source: 'source', batch, visible: true, rpc, onAskAgent: vi.fn(), pollMs: 10, ...overrides };
  return { rpc, props, view: render(<SelfHealingPanel {...props} />) };
}
it('starts a bounded run and hands a complete autonomous brief to the agent', async () => {
  const { props, rpc } = setup();
  fireEvent.change(screen.getByLabelText('Candidate attempts'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start self-healing' }));
  await screen.findByText(/Waiting for the agent/);
  expect(rpc).toHaveBeenCalledWith(SELF_HEALING_RPC.start, { batchId: 'base', source: 'source', maxAttempts: 2 });
  expect(props.onAskAgent).toHaveBeenCalledWith(expect.stringContaining('Continue autonomously'));
  fireEvent.click(screen.getByRole('button', { name: 'Continue with agent' }));
  expect(props.onAskAgent).toHaveBeenCalledTimes(2);
});
it.each([null, { ...batch, engine: 'rehearsal' }, { ...batch, status: 'running' }, { ...batch, counts: { ...batch.counts, error: 1 } }, { ...batch, counts: { ...batch.counts, stopped: 1 } }, { ...batch, counts: { ...batch.counts, pass: 2 } }])('requires a completed failing Simulate baseline (%j)', value => {
  setup({ batch: value as SimulationBatch | null });
  expect((screen.getByRole('button', { name: 'Start self-healing' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/First complete a Simulate batch/)).toBeTruthy();
});
it('reconciles background progress, displays regressions, stops, and reviews the best candidate', async () => {
  let current: SelfHealingRun | null = { ...run, status: 'testing', attempts: [{ number: 1, sourceHash: 'candidate', total: 2, pass: 1, outcome: 'regression', regressions: ['Scope'] }] };
  const rpc = vi.fn(async (method: string) => { if (method === SELF_HEALING_RPC.stop) current = { ...current!, status: 'stopped', bestPass: 2 }; return { ok: true, run: current }; });
  const { props } = setup({ rpc });
  await screen.findByText(/Testing candidate/);
  expect(screen.getByText(/Regressions: Scope/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Stop self-healing' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Stopped · 1/3 attempts'));
  fireEvent.click(screen.getByRole('button', { name: 'Review best candidate with agent' }));
  expect(props.onAskAgent).toHaveBeenCalledWith(expect.stringContaining('Run id: run'));
  current = { ...current!, status: 'passed', attempts: [] };
  await screen.findByText(/Ready for review/);
});
it('surfaces actionable start and stop errors, retaining evidence on refresh failures', async () => {
  const rpc = vi.fn(async (method: string): Promise<any> => method === SELF_HEALING_RPC.status ? { ok: false } : { ok: false });
  setup({ rpc });
  fireEvent.click(screen.getByRole('button', { name: 'Start self-healing' }));
  expect((await screen.findByRole('alert')).textContent).toContain('could not continue');
  rpc.mockImplementation(async method => method === SELF_HEALING_RPC.status ? { ok: true, run } : Promise.reject('offline'));
  await screen.findByRole('button', { name: 'Stop self-healing' });
  fireEvent.click(screen.getByRole('button', { name: 'Stop self-healing' }));
  expect((await screen.findByRole('alert')).textContent).toContain('offline');
  rpc.mockRejectedValue(Error('refresh failed'));
  await waitFor(() => expect(screen.getByText(/Waiting for the agent/)).toBeTruthy());
});
it('ignores stale refreshes and late handoffs after unmount, and releases timers', async () => {
  let finish!: (value: any) => void;
  const rpc = vi.fn(async (method: string): Promise<any> => method === SELF_HEALING_RPC.status ? new Promise(resolve => { finish = resolve; }) : { ok: true, run });
  const { props, view } = setup({ rpc });
  fireEvent.click(screen.getByRole('button', { name: 'Start self-healing' }));
  await screen.findByText(/Waiting for the agent/);
  finish({ ok: true, run: null });
  await waitFor(() => expect(screen.getByText(/Waiting for the agent/)).toBeTruthy());
  view.unmount();
  const late = setup({ rpc: vi.fn(() => new Promise(resolve => { finish = resolve; })), onAskAgent: props.onAskAgent });
  fireEvent.click(screen.getByRole('button', { name: 'Start self-healing' }));
  late.view.unmount(); finish({ ok: true, run });
  expect(props.onAskAgent).toHaveBeenCalledTimes(1);
});
it('does not poll an invisible view or allow a missing authoring agent', async () => {
  const { rpc } = setup({ visible: false, onAskAgent: undefined });
  expect(rpc).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: 'Start self-healing' }) as HTMLButtonElement).disabled).toBe(true);
});
