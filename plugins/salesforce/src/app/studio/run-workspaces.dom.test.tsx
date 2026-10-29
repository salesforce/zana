/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStudioRunWorkspaces, getStudioRun, readWorkspaceValue, runWorkspaceRef, studioRunKey, updateStudioRun, useRunWorkspaceState, useStudioRuns, writeWorkspaceValue, type StudioRunOwner } from './run-workspaces.js';
const owner: StudioRunOwner = { pluginId: 'salesforce', projectId: 'p', orgAlias: 'dev', path: 'A.agent', view: 'preview' };
const storage = 'salesforce:studio:run-workspaces:v1';
const rpc = vi.fn();
beforeEach(() => { clearStudioRunWorkspaces(); rpc.mockReset().mockResolvedValue({ ok: true, data: [] }); (globalThis as Record<string, unknown>).__ZCC_PLUGIN_HOST__ = { callRpc: rpc }; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (globalThis as Record<string, unknown>).__ZCC_PLUGIN_HOST__; });
function Draft({ scope = owner }: { scope?: StudioRunOwner }) {
  const [value, set] = useRunWorkspaceState(studioRunKey(scope), 'draft', '');
  return <input aria-label="Draft" value={value} onChange={event => set(event.target.value)} />;
}
function Runs() { const rows = useStudioRuns('salesforce', 'p'); return <output>{JSON.stringify(rows)}</output>; }

describe('run workspaces', () => {
  it('retains state and shared request ownership across detach and scopes edits by agent and org', () => {
    const key = studioRunKey(owner), pending = runWorkspaceRef(key, 'locked', false);
    const view = render(<Draft />);
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Keep this' } });
    view.unmount();
    pending.current = true;
    writeWorkspaceValue(key, 'response', 'Late response', '');
    const restored = render(<Draft />);
    expect(screen.getByLabelText('Draft')).toHaveProperty('value', 'Keep this');
    expect(runWorkspaceRef(key, 'locked', false)).toBe(pending);
    expect(readWorkspaceValue(key, 'response', '')).toBe('Late response');
    restored.rerender(<Draft scope={{ ...owner, orgAlias: 'other' }} />);
    expect(screen.getByLabelText('Draft')).toHaveProperty('value', '');
    restored.rerender(<Draft />);
    expect(screen.getByLabelText('Draft')).toHaveProperty('value', 'Keep this');
    writeWorkspaceValue(key, 'draft', previous => `${previous}!`, '');
    expect(readWorkspaceValue(key, 'draft', '')).toBe('Keep this!');
    expect(JSON.parse(localStorage.getItem(storage)!).find((row: {key:string}) => row.key === key).values.draft).toBe('Keep this!');
  });

  it('bounds detached history, retains active requests, and falls back to descriptors for oversized source snapshots', () => {
    const lockedKey = studioRunKey(owner); runWorkspaceRef(lockedKey, 'locked', false).current = true;
    writeWorkspaceValue(lockedKey, 'draft', 'Pinned request', '');
    for (let index = 0; index < 90; index++) {
      const scope = { ...owner, path: `${index}.agent` };
      runWorkspaceRef(studioRunKey(scope), 'cancelled', true);
      updateStudioRun(scope, { runId: `${index}`, engine: 'simulate', status: 'active', turn: 0 });
    }
    expect(getStudioRun({ ...owner, path: '0.agent' })).toBeNull();
    expect(readWorkspaceValue(lockedKey, 'draft', '')).toBe('Pinned request');
    expect(JSON.parse(localStorage.getItem(storage)!).length).toBeLessThanOrEqual(16);
    const key = studioRunKey({ ...owner, path: 'large.agent' });
    updateStudioRun({ ...owner, path: 'large.agent' }, { runId: 'large', engine: 'simulate', status: 'running', turn: 1 });
    writeWorkspaceValue(key, 'draft', 'Keep my setup', '');
    writeWorkspaceValue(key, 'source', 'x'.repeat(2_100_000), '');
    const rows = JSON.parse(localStorage.getItem(storage)!);
    expect(rows.find((row: {key:string}) => row.key === key).values).toEqual({ draft: 'Keep my setup' });
    expect(rows.find((row: {key:string}) => row.key === key).descriptor.runId).toBe('large');
  });

  it('uses one metadata reconciler for all consumers and discovers or completes background runs', async () => {
    updateStudioRun(owner, { runId: 'one', engine: 'simulate', status: 'running', turn: 0 });
    rpc.mockResolvedValue({ ok: true, data: [{ id: 'one', path: 'A.agent', orgAlias: 'dev', engine: 'preview', turns: [], turnCount: 3, busy: false, execution: { phase: 'done' } }, { id: 'two', path: 'B.agent', orgAlias: 'dev', engine: 'preview', turns: [], turnCount: 1, busy: true }] });
    const view = render(<><Runs /><Runs /></>);
    await waitFor(() => expect(getStudioRun(owner)?.status).toBe('ended'));
    expect(getStudioRun(owner)?.turn).toBe(3);
    expect(getStudioRun({ ...owner, path: 'B.agent' })?.status).toBe('running');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.list', { projectId: 'p', includeClosed: true, summaryOnly: true });
    view.unmount();
  });

  it('keeps the newest run for an owner when the server also returns its older closed sessions', async () => {
    updateStudioRun(owner, { runId: 'new', engine: 'simulate', status: 'running', turn: 2 });
    writeWorkspaceValue(studioRunKey(owner), 'sessionId', 'new', null);
    rpc.mockResolvedValue({ ok: true, data: [{ id: 'new', path: 'A.agent', orgAlias: 'dev', engine: 'preview', turns: [], turnCount: 2, busy: true, createdAt: 20 }, { id: 'old', path: 'A.agent', orgAlias: 'dev', engine: 'preview', turns: [], turnCount: 8, closed: true, createdAt: 10 }] });
    render(<Runs />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(getStudioRun(owner)).toMatchObject({ runId: 'new', status: 'running', turn: 2 });
    expect(readWorkspaceValue(studioRunKey(owner), 'sessionId', null)).toBe('new');
  });

  it('does not replace a run started while an older metadata request was in flight', async () => {
    let finish!: (value: unknown) => void;
    rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<Runs />);
    act(() => updateStudioRun(owner, { runId: 'new', engine: 'simulate', status: 'running', turn: 0 }));
    await act(async () => { finish({ ok: true, data: [{ id: 'old', path: 'A.agent', orgAlias: 'dev', engine: 'preview', turns: [], closed: true, createdAt: 10 }] }); });
    expect(getStudioRun(owner)?.runId).toBe('new');
  });

  it('keeps fresher local progress when an older summary of the same run arrives later', async () => {
    updateStudioRun(owner, { runId: 'one', engine: 'simulate', status: 'active', turn: 0 });
    let finish!: (value: unknown) => void;
    rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<Runs />);
    act(() => updateStudioRun(owner, { runId: 'one', engine: 'simulate', status: 'running', turn: 2 }));
    await act(async () => { finish({ ok: true, data: [{ id: 'one', path: 'A.agent', orgAlias: 'dev', engine: 'preview', turns: [], busy: false, turnCount: 0 }] }); });
    expect(getStudioRun(owner)).toMatchObject({ runId: 'one', status: 'running', turn: 2 });
  });

  it('restores validated descriptors and saved values after a renderer module reload and rejects forged owner types', async () => {
    updateStudioRun(owner, { runId: 'one', engine: 'simulate', status: 'active', turn: 2 });
    writeWorkspaceValue(studioRunKey(owner), 'draft', 'Reload me', '');
    const row = JSON.parse(localStorage.getItem(storage)!)[0];
    localStorage.setItem(storage, JSON.stringify([row, { ...row, key: 'forged', descriptor: { ...row.descriptor, key: 'forged', path: { injected: true } } }]));
    vi.resetModules();
    const reloaded = await import('./run-workspaces.js');
    expect(reloaded.getStudioRun(owner)).toMatchObject({ runId: 'one', path: 'A.agent', orgAlias: 'dev' });
    expect(reloaded.readWorkspaceValue(studioRunKey(owner), 'draft', '')).toBe('Reload me');
    expect(reloaded.readWorkspaceValue('forged', 'draft', '')).toBe('Reload me');
    expect(reloaded.getStudioRun({ ...owner, path: '[object Object]' })).toBeNull();
    reloaded.clearStudioRunWorkspaces();
  });

  it('continues in memory when storage is disabled', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Unavailable'); });
    const key = studioRunKey(owner);
    writeWorkspaceValue(key, 'draft', 'Still here', '');
    expect(readWorkspaceValue(key, 'draft', '')).toBe('Still here');
    const ref = runWorkspaceRef(key, 'active', null as string | null, true); ref.current = 'session';
    expect(runWorkspaceRef(key, 'active', null, true).current).toBe('session');
  });
});
