/** @vitest-environment happy-dom */
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STUDIO_CHANGED_CHANNEL, type ExplorerNode, type ScenarioSuite } from '../../../lib/studio-contract.js';
import { BottomTests, BottomTrace } from './BottomPanes.js';
import { StudioShell } from './StudioShell.js';
import { suiteStatus, useSuites, withSuiteBadges } from './useSuites.js';

const rpc = vi.fn();
let realtime: ((payload: unknown) => void) | undefined;
const suite = (over: Partial<ScenarioSuite> = {}): ScenarioSuite => ({ id: 's1', path: 'tests/a.scenario.json', cases: [{ id: 'c1', name: 'one', utterances: ['hi'], expect: {} }], ...over });
const res = (outcome: 'pass' | 'fail' | 'inconclusive') => ({ outcome, runId: 'r', at: 1 });

beforeEach(() => {
  rpc.mockReset(); realtime = undefined;
  (globalThis as any).__ZCC_HOST_REACT__ = React;
  (globalThis as any).__ZCC_PLUGIN_HOST__ = { callRpc: rpc };
  (globalThis as any).__ZCC_PLUGIN_RUNTIME__ = {
    useRealtime: (channel: string, handler: (p: unknown) => void) => { if (channel === STUDIO_CHANGED_CHANNEL) realtime = handler; }
  };
});
afterEach(() => { cleanup(); delete (globalThis as any).__ZCC_PLUGIN_RUNTIME__; delete (globalThis as any).__ZCC_PLUGIN_HOST__; });

describe('StudioShell', () => {
  const setup = (over: Record<string, unknown> = {}) => {
    const p = { onSave: vi.fn(), onQuickOpenChange: vi.fn(), onQuickPick: vi.fn() };
    const view = render(<StudioShell layout="wide" tier={960} top={<i data-testid="top" />} activity={<i data-testid="act" />} explorer={<i data-testid="exp" />}
      quickOpen={false} quickItems={[{ id: 'a', label: 'Help.agent', path: 'Help.agent' } as any]} {...p} {...over}><button data-testid="child">x</button></StudioShell>);
    return { ...p, ...view };
  };
  it('renders slots and layout attributes', () => {
    const { container } = setup();
    const root = container.querySelector('.sf-studio')!;
    expect(root.getAttribute('data-layout')).toBe('wide');
    expect(root.getAttribute('data-tier')).toBe('960');
    for (const id of ['top', 'act', 'exp', 'child']) expect(screen.getByTestId(id)).toBeTruthy();
  });
  it('handles Cmd/Ctrl+S and Cmd/Ctrl+P but ignores other chords', () => {
    const { onSave, onQuickOpenChange } = setup({ tier: null });
    const child = screen.getByTestId('child');
    fireEvent.keyDown(child, { key: 's', metaKey: true });
    fireEvent.keyDown(child, { key: 'S', ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(child, { key: 'p', ctrlKey: true });
    expect(onQuickOpenChange).toHaveBeenCalledWith(true);
    fireEvent.keyDown(child, { key: 's' });
    fireEvent.keyDown(child, { key: 's', metaKey: true, shiftKey: true });
    fireEvent.keyDown(child, { key: 's', metaKey: true, altKey: true });
    fireEvent.keyDown(child, { key: 'x', metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onQuickOpenChange).toHaveBeenCalledTimes(1);
  });
  it('toggles the explorer with Cmd/Ctrl+B only when the layout offers it', () => {
    const onToggleExplorer = vi.fn();
    const { rerender } = render(<StudioShell layout="wide" tier={960} quickOpen={false} quickItems={[]} onQuickOpenChange={vi.fn()} onQuickPick={vi.fn()} onSave={vi.fn()} onToggleExplorer={onToggleExplorer}><div data-testid="b-child" /></StudioShell>);
    fireEvent.keyDown(screen.getByTestId('b-child'), { key: 'b', metaKey: true });
    expect(onToggleExplorer).toHaveBeenCalledTimes(1);
    rerender(<StudioShell layout="compact" tier={400} quickOpen={false} quickItems={[]} onQuickOpenChange={vi.fn()} onQuickPick={vi.fn()} onSave={vi.fn()}><div data-testid="b-child" /></StudioShell>);
    fireEvent.keyDown(screen.getByTestId('b-child'), { key: 'b', ctrlKey: true });
    expect(onToggleExplorer).toHaveBeenCalledTimes(1);
  });
  it('shows QuickOpen and closes it', () => {
    const { onQuickOpenChange } = setup({ quickOpen: true });
    expect(screen.getByText('Help.agent')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog', {}) ?? document.body, { key: 'Escape' });
    expect(onQuickOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('useSuites helpers', () => {
  it('computes suite status', () => {
    expect(suiteStatus(suite())).toBeUndefined();
    expect(suiteStatus(suite({ lastResults: { a: res('pass'), b: res('pass') } }))).toBe('pass');
    expect(suiteStatus(suite({ lastResults: { a: res('pass'), b: res('fail') } }))).toBe('fail');
    expect(suiteStatus(suite({ lastResults: { a: res('inconclusive') } }))).toBeUndefined();
  });
  it('badges scenario nodes only', () => {
    const nodes: ExplorerNode[] = [{ kind: 'scenario', path: 'tests/a.scenario.json', apiName: 'a' }, { kind: 'scenario', path: 'tests/b.scenario.json', apiName: 'b' }, { kind: 'agent', path: 'x.agent', apiName: 'x' }];
    expect(withSuiteBadges(nodes, [])).toBe(nodes);
    const out = withSuiteBadges(nodes, [suite({ lastResults: { a: res('fail') } })]);
    expect(out[0].badge?.status).toBe('fail');
    expect(out[1].badge).toBeUndefined();
    expect(out[2]).toBe(nodes[2]);
  });
});

describe('useSuites', () => {
  it('loads, refreshes on suites changes and tolerates failures', async () => {
    rpc.mockResolvedValue({ ok: true, suites: [suite()] });
    const { result } = renderHook(() => useSuites('salesforce', 'p1'));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(rpc).toHaveBeenCalledWith('salesforce', 'studio.suites.list', { projectId: 'p1' });
    rpc.mockResolvedValue({ ok: true, suites: [suite(), suite({ id: 's2' })] });
    await act(async () => { realtime?.({ kind: 'comments', projectId: 'p1' }); });
    await act(async () => { realtime?.({ kind: 'suites', projectId: 'other' }); });
    expect(rpc).toHaveBeenCalledTimes(1);
    await act(async () => { realtime?.({ kind: 'suites', projectId: 'p1' }); });
    await waitFor(() => expect(result.current).toHaveLength(2));
    rpc.mockRejectedValue(new Error('boom'));
    await act(async () => { realtime?.({ kind: 'suites' }); });
    expect(result.current).toHaveLength(2);
  });
  it('is empty without a project', async () => {
    const { result } = renderHook(() => useSuites('salesforce', undefined));
    expect(result.current).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('BottomTests', () => {
  it('shows an empty state and suite rows', () => {
    const onOpenTests = vi.fn();
    const { rerender } = render(<BottomTests suites={[]} onOpenTests={onOpenTests} />);
    expect(screen.getByText(/No scenario suites yet/)).toBeTruthy();
    fireEvent.click(screen.getByText('Open Tests'));
    expect(onOpenTests).toHaveBeenCalledTimes(1);
    rerender(<BottomTests onOpenTests={onOpenTests} suites={[
      suite({ lastResults: { a: res('pass'), b: res('fail') } }),
      suite({ id: 's2', path: 'tests/b.scenario.json', cases: [], lastResults: { a: res('pass') } }),
      suite({ id: 's3', path: 'tests/c.scenario.json' })
    ]} />);
    expect(screen.getByText('1/2 passing')).toBeTruthy();
    expect(screen.getByText('1/1 passing')).toBeTruthy();
    expect(screen.getByText('not run')).toBeTruthy();
    expect(screen.getByText('a.scenario.json · 1 case')).toBeTruthy();
    expect(screen.getByText('b.scenario.json · 0 cases')).toBeTruthy();
    fireEvent.click(screen.getByText('a.scenario.json · 1 case'));
    expect(onOpenTests).toHaveBeenCalledTimes(2);
  });
});

describe('BottomTrace', () => {
  const base = { pluginId: 'salesforce', path: 'Help.agent', visible: true, onOpenPreview: vi.fn() };
  it('prompts when there is no run and opens Preview', () => {
    render(<BottomTrace {...base} run={null} />);
    expect(screen.getByText(/Run a conversation in Preview/)).toBeTruthy();
    fireEvent.click(screen.getByText('Open Preview'));
    expect(base.onOpenPreview).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('shows the rehearse approximation without fetching', () => {
    render(<BottomTrace {...base} run={{ runId: 'r1', engine: 'rehearse', turn: 1 }} />);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('fetches the trace for a live run, and does not fetch when hidden', async () => {
    rpc.mockResolvedValue({ ok: true, data: { runId: 'r1', turn: 1, available: true, steps: [] } });
    const { rerender } = render(<BottomTrace {...base} visible={false} run={{ runId: 'r1', engine: 'live', turn: 1 }} />);
    expect(rpc).not.toHaveBeenCalled();
    rerender(<BottomTrace {...base} run={{ runId: 'r1', engine: 'live', turn: 1 }} />);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.trace', { id: 'r1', engine: 'live', path: 'Help.agent' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('reports unavailable and rejected traces', async () => {
    rpc.mockResolvedValueOnce({ ok: false, error: 'No planner trace.' });
    const { rerender } = render(<BottomTrace {...base} path={null} run={{ runId: 'r1', engine: 'simulate', turn: 1 }} />);
    expect((await screen.findByRole('alert')).textContent).toBe('No planner trace.');
    rpc.mockRejectedValueOnce(new Error('network'));
    rerender(<BottomTrace {...base} path={null} run={{ runId: 'r2', engine: 'simulate', turn: 1 }} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('network'));
    rpc.mockResolvedValueOnce(null);
    rerender(<BottomTrace {...base} path={null} run={{ runId: 'r3', engine: 'simulate', turn: 1 }} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The trace is unavailable.'));
  });
});
