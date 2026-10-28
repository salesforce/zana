/** @vitest-environment happy-dom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomTests, suiteCounts, type FooterTestContext } from './BottomTests.js';
import { BottomPanel } from './BottomPanel.js';
import { STUDIO_RPC, type CaseResult, type ScenarioSuite } from '../../../lib/studio-contract.js';

const rpc = vi.fn();
const context: FooterTestContext = { pluginId: 'salesforce', projectId: 'p1', threadId: 't1', path: 'force-app/Support.agent', source: 'unsaved editor source', dirty: true };
const result = (outcome: CaseResult['outcome']): CaseResult => ({ outcome, runId: '', at: 1, notes: outcome === 'fail' ? ['Missing text: "order"'] : [] });
const suite = (over: Partial<ScenarioSuite> = {}): ScenarioSuite => ({
  id: 'Support', path: 'tests/Support.scenario.json',
  cases: ['pass', 'fail', 'unclear', 'pending'].map(id => ({ id, name: `Case ${id}`, utterances: ['Find my order'], expect: { contains: ['order'] } })),
  lastResults: { pass: result('pass'), fail: result('fail'), unclear: result('inconclusive'), deleted: result('fail') }, ...over
});
const setup = (suites = [suite()], scope: FooterTestContext | undefined = context) => render(<BottomTests suites={suites} context={scope} onOpenTests={vi.fn()} />);
const expand = () => { document.querySelectorAll('details').forEach(node => { node.open = true; fireEvent(node, new Event('toggle')); }); };
beforeEach(() => {
  rpc.mockReset();
  (globalThis as any).__ZCC_HOST_REACT__ = React;
  (globalThis as any).__ZCC_PLUGIN_HOST__ = { callRpc: rpc };
});
afterEach(() => { cleanup(); delete (globalThis as any).__ZCC_PLUGIN_HOST__; });

describe('footer scenario results', () => {
  it('shows a failure badge on the Tests tab even when the panel is collapsed', () => {
    const { rerender } = render(<BottomPanel open={false} active="tests" problems={0} testFailures={3} onToggle={vi.fn()} onSelect={vi.fn()} render={() => null} />);
    expect(screen.getByRole('tab', { name: 'Tests 3' })).toBeTruthy();
    rerender(<BottomPanel open={false} active="tests" problems={0} testFailures={0} onToggle={vi.fn()} onSelect={vi.fn()} render={() => null} />);
    expect(screen.getByRole('tab', { name: 'Tests', exact: true })).toBeTruthy();
  });
  it('counts current cases only, including inconclusive and unrun cases', () => {
    expect(suiteCounts(suite())).toEqual({ pass: 1, fail: 1, inconclusive: 1, pending: 1 });
    expect(suiteCounts(suite({ lastResults: undefined }))).toEqual({ pass: 0, fail: 0, inconclusive: 0, pending: 4 });
  });
  it('shows an empty state and opens the full workbench', () => {
    const onOpenTests = vi.fn();
    render(<BottomTests suites={[]} onOpenTests={onOpenTests} />);
    expect(screen.getByText(/No scenario suites yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Tests' }));
    expect(onOpenTests).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Rerun/)).toBeNull();
  });
  it('filters by failure, case name and suite path without counting removed results', () => {
    setup(); expand();
    expect(screen.getByText('1 failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Case pass' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Failed only' }));
    expect(screen.queryByRole('button', { name: 'Case pass' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Case fail' })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing case' } });
    expect(screen.getByText('No matching cases.')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'tests/Support' } }); expand();
    expect(screen.getByRole('button', { name: 'Case fail' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Failed only' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  CASE UNCLEAR  ' } }); expand();
    expect(screen.getByRole('button', { name: 'Case unclear' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Case fail' })).toBeNull();
  });
  it('distinguishes no failures, an empty suite, and passing suites', () => {
    const s = suite({ cases: [suite().cases[0]], lastResults: { pass: result('pass') } });
    const { rerender } = setup([s]);
    expect(document.querySelector('summary')!.textContent).toContain('✓');
    fireEvent.click(screen.getByRole('button', { name: 'Failed only' }));
    expect(screen.getByText('No failing cases.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Failed only' }));
    rerender(<BottomTests suites={[suite({ cases: [], lastResults: {} })]} onOpenTests={vi.fn()} />); expand();
    expect(screen.getByText('This suite has no cases.')).toBeTruthy();
  });
  it('shows saved evidence inline and closes details without requiring a live run', () => {
    setup(); expand();
    expect(screen.getByText('Missing text: "order"')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Case fail' }));
    const details = screen.getByRole('region', { name: 'Details for Case fail' });
    expect(within(details).getByText('Expected vs actual')).toBeTruthy();
    expect(within(details).getByText('Actual: Not in the reply')).toBeTruthy();
    fireEvent.click(within(details).getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('region', { name: 'Details for Case fail' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Case pending' }));
    expect(screen.getByRole('region', { name: 'Details for Case pending' }).textContent).toContain('Not run');
    fireEvent.click(screen.getByRole('button', { name: 'Case pending' }));
    expect(rpc).not.toHaveBeenCalled();
  });
  it('reruns only current failures using the editor snapshot, and disables duplicate starts', async () => {
    let finish!: (value: unknown) => void;
    rpc.mockImplementation((_plugin: string, method: string) => method === STUDIO_RPC.suiteStart
      ? Promise.resolve({ ok: true, jobId: 'job-1' })
      : new Promise(resolve => { finish = resolve; }));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Rerun failed (1)' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('salesforce', STUDIO_RPC.suiteStart, expect.objectContaining({
      projectId: 'p1', agentPath: 'force-app/Support.agent', source: context.source, path: 'tests/Support.scenario.json',
      engine: 'preview', caseIds: ['fail'], threadId: 't1', startedByUser: true, requestId: expect.any(String)
    })));
    expect(screen.getByRole('button', { name: 'Rerun failed (1)' }).hasAttribute('disabled')).toBe(true);
    await act(async () => finish({ ok: true, status: 'completed', result: { ok: true } }));
    expect(await screen.findByText('Rerun complete. Results saved.')).toBeTruthy();
    expect(screen.getByText(/including unsaved changes/)).toBeTruthy();
  });
  it('reruns a single case and omits an absent thread id', async () => {
    rpc.mockImplementation((_plugin: string, method: string) => Promise.resolve(method === STUDIO_RPC.suiteStart ? { ok: true, jobId: 'j' } : { ok: true, status: 'completed', result: { ok: true } }));
    setup([suite()], { ...context, threadId: undefined, dirty: false }); expand();
    fireEvent.click(screen.getByRole('button', { name: 'Rerun Case pending' }));
    await screen.findByText('Rerun complete. Results saved.');
    const args = rpc.mock.calls[0][2];
    expect(args.caseIds).toEqual(['pending']);
    expect(args).not.toHaveProperty('threadId');
    expect(screen.queryByText(/including unsaved/)).toBeNull();
  });
  it('never reruns another agent’s suite or an empty editor', () => {
    const { rerender } = setup([suite({ path: 'tests/Other.scenario.json' })]); expand();
    expect(screen.queryByRole('button', { name: /Rerun/ })).toBeNull();
    rerender(<BottomTests suites={[suite()]} context={{ ...context, source: ' ' }} onOpenTests={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Rerun failed (1)' }).hasAttribute('disabled')).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('shows externally started progress and disables overlapping reruns', () => {
    setup([suite({ progress: { id: 'j', mode: 'simulate', startedAt: 1, stage: 'conversation', caseIds: ['fail', 'pass'], completed: 1, results: {} } })]);
    expect(screen.getByRole('status').textContent).toBe('Running · 1/2 cases complete');
    expect(screen.getByRole('button', { name: 'Rerun failed (1)' }).hasAttribute('disabled')).toBe(true);
  });
  it.each([
    [{ ok: false, error: 'Start refused.' }, 'Start refused.'],
    [null, 'No response from Studio.'],
    [new Error('Disconnected'), 'Disconnected']
  ])('reports start errors and makes retry available (%s)', async (reply, text) => {
    if (reply instanceof Error) rpc.mockRejectedValue(reply); else rpc.mockResolvedValue(reply);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Rerun failed (1)' }));
    expect((await screen.findByRole('alert')).textContent).toBe(text);
    expect(screen.getByRole('button', { name: 'Rerun failed (1)' }).hasAttribute('disabled')).toBe(false);
  });
  it('reports a completed run error', async () => {
    rpc.mockResolvedValueOnce({ ok: true, jobId: 'j' }).mockResolvedValueOnce({ ok: true, status: 'completed', result: { ok: false } });
    setup(); fireEvent.click(screen.getByRole('button', { name: 'Rerun failed (1)' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The cases could not run.');
  });
  it('stops a running suite and reports saved partial results', async () => {
    let finish!: (value: unknown) => void;
    rpc.mockImplementation((_plugin: string, method: string) => {
      if (method === STUDIO_RPC.suiteStart) return Promise.resolve({ ok: true, jobId: 'j' });
      if (method === STUDIO_RPC.suiteStop) { finish({ ok: true, status: 'stopped' }); return Promise.resolve({ ok: true }); }
      return new Promise(resolve => { finish = resolve; });
    });
    setup(); fireEvent.click(screen.getByRole('button', { name: 'Rerun failed (1)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop suite' }));
    expect(await screen.findByText(/Suite stopped. Completed cases were saved/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('reports a stop error and ignores completion after the footer unmounts', async () => {
    let finish!: (value: unknown) => void;
    rpc.mockImplementation((_plugin: string, method: string) => {
      if (method === STUDIO_RPC.suiteStart) return Promise.resolve({ ok: true, jobId: 'j' });
      if (method === STUDIO_RPC.suiteStop) return Promise.resolve({ ok: false });
      return new Promise(resolve => { finish = resolve; });
    });
    const { unmount } = setup(); fireEvent.click(screen.getByRole('button', { name: 'Rerun failed (1)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop suite' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not stop the suite.');
    unmount();
    await act(async () => finish({ ok: true, status: 'completed', result: { ok: true } }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
