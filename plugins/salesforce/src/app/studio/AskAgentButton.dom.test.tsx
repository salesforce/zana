/** @vitest-environment happy-dom */
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioThreadLink, StudioViewState } from '../../../lib/studio-contract.js';
import { STUDIO_CHANGED_CHANNEL } from '../../../lib/studio-contract.js';
import { AskAgentButton } from './AskAgentButton.js';
import { ContextStrip, describeVisibleContext } from './ContextStrip.js';
import { buildViewState, SHARE_STORAGE_KEY, useStudioView } from './useStudioView.js';

const rpc = vi.fn();
const navigate: { toThread: ReturnType<typeof vi.fn>; openPanelAgent?: ReturnType<typeof vi.fn> } = { toThread: vi.fn() };
let realtime: ((payload: unknown) => void) | undefined;
const view = (over: Partial<StudioViewState> = {}): StudioViewState => ({ surface: 'studio', path: 'force-app/Help.agent', dirty: false, tool: 'code', diagnostics: [], share: true, at: 1, ...over });
const link = (over: Partial<StudioThreadLink> = {}): StudioThreadLink => ({ threadId: 't1', title: 'Review · Help.agent', role: 'reviewer', path: 'force-app/Help.agent', lastActivityAt: Date.now(), ...over });

beforeEach(() => {
  rpc.mockReset(); navigate.toThread.mockReset(); delete navigate.openPanelAgent; realtime = undefined; localStorage.clear();
  rpc.mockImplementation(async (_id: string, method: string) => {
    if (method === 'studio.threads') return { ok: true, threads: [link(), link({ threadId: 't2', title: 'Tests', role: 'tester', lastActivityAt: Date.now() - 7_200_000 })] };
    if (method === 'studio.askAgent') return { ok: true, threadId: 'new1' };
    if (method === 'studio.draftAgent') return { ok: true, prompt: 'BRIEF', title: 'Review · Help.agent' };
    return { ok: true };
  });
  (globalThis as any).__ZCC_HOST_REACT__ = React;
  (globalThis as any).__ZCC_PLUGIN_HOST__ = { callRpc: rpc };
  (globalThis as any).__ZCC_PLUGIN_RUNTIME__ = {
    useZccNavigate: () => navigate,
    useRealtime: (channel: string, handler: (p: unknown) => void) => { if (channel === STUDIO_CHANGED_CHANNEL) realtime = handler; }
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); delete (globalThis as any).__ZCC_PLUGIN_RUNTIME__; delete (globalThis as any).__ZCC_PLUGIN_HOST__; });

describe('ContextStrip', () => {
  it('describes what the agent sees and hides the toggle outside compact mode', () => {
    const { rerender } = render(<ContextStrip view={view({ dirty: true, selection: { startLine: 2, endLine: 3, text: 'x' }, diagnostics: [{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: 'error', message: 'm' }, { line: 1, column: 1, endLine: 1, endColumn: 2, severity: 'hint', message: 'h' }], lastRun: { runId: 'abcdefghij', engine: 'live' } })} onShareChange={() => undefined} />);
    const text = screen.getByTestId('studio-context-strip').textContent!;
    expect(text).toContain('Agent sees: Help.agent · unsaved edits · lines 2-3 · code tool · 1 problem · run abcdefgh');
    expect(screen.queryByRole('switch')).toBeNull();
    rerender(<ContextStrip view={view({ path: null, cursor: { line: 5, column: 1 }, tool: null, diagnostics: Array(2).fill({ line: 1, column: 1, endLine: 1, endColumn: 2, severity: 'warning', message: 'w' }) })} />);
    expect(screen.getByTestId('studio-context-strip').textContent).toContain('unsaved draft · line 5 · 2 problems');
    expect(describeVisibleContext(view({ share: false }))).toEqual([]);
  });

  it('toggles sharing in compact mode', () => {
    const onShareChange = vi.fn();
    const { rerender } = render(<ContextStrip view={view()} compact onShareChange={onShareChange} />);
    const toggle = screen.getByRole('switch', { name: /share/i });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(onShareChange).toHaveBeenCalledWith(false);
    rerender(<ContextStrip view={view({ share: false })} compact onShareChange={onShareChange} />);
    expect(screen.getByTestId('studio-context-strip').textContent).toContain('nothing (sharing is off)');
    fireEvent.click(screen.getByRole('switch'));
    expect(onShareChange).toHaveBeenLastCalledWith(true);
  });
});

describe('AskAgentButton', () => {
  const props = { pluginId: 'salesforce', projectId: 'p1', path: 'force-app/Help.agent', view: view() };
  const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Ask agent' }));
  const action = (label: string) => within(screen.getByRole('region', { name: 'Agent actions' })).getByRole('button', { name: new RegExp(`^${label}`) });

  it('lists actions, what the agent sees and recent agents with role badges, refreshing on realtime', async () => {
    render(<AskAgentButton {...props} />);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('salesforce', 'studio.threads', { projectId: 'p1', path: 'force-app/Help.agent' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    openMenu();
    expect(screen.getByRole('dialog', { name: 'Ask an agent' })).toBeTruthy();
    expect(await screen.findByText('Review · Help.agent')).toBeTruthy();
    expect(screen.getByText('Reviewer')).toBeTruthy();
    expect(screen.getByText('Tester')).toBeTruthy();
    expect(screen.getByText(/2h ago/)).toBeTruthy();
    expect(screen.getByTestId('studio-context-strip').textContent).toContain('Agent sees: Help.agent');
    for (const label of ['Review', 'Fix problems', 'Address comments', 'Write scenarios', 'Explain selection', 'Generate action', 'Harden guardrails']) expect(action(label)).toBeTruthy();
    const calls = rpc.mock.calls.length;
    act(() => realtime!({ kind: 'comments', projectId: 'p1' }));
    act(() => realtime!({ kind: 'threads', projectId: 'other' }));
    expect(rpc.mock.calls.length).toBe(calls);
    act(() => realtime!({ kind: 'threads', projectId: 'p1' }));
    await waitFor(() => expect(rpc.mock.calls.length).toBe(calls + 1));
  });

  it('caps the recent list and closes on Escape or an outside click', async () => {
    rpc.mockImplementation(async () => ({ ok: true, threads: Array.from({ length: 7 }, (_, n) => link({ threadId: `t${n}`, title: `Agent ${n}`, lastActivityAt: Date.now() - n * 1000 })) }));
    render(<AskAgentButton {...props} />);
    openMenu();
    await screen.findByText('Agent 0');
    expect(screen.getByText('Agent 4')).toBeTruthy();
    expect(screen.queryByText('Agent 5')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    openMenu();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('toggles sharing from the menu', () => {
    const onShareChange = vi.fn();
    render(<AskAgentButton {...props} onShareChange={onShareChange} />);
    openMenu();
    fireEvent.click(screen.getByRole('switch'));
    expect(onShareChange).toHaveBeenCalledWith(false);
  });

  it('hands an action to the side-panel composer and closes', async () => {
    navigate.openPanelAgent = vi.fn(() => true);
    render(<AskAgentButton {...props} view={view({ diagnostics: [{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: 'error', message: 'm' }] })} />);
    openMenu();
    fireEvent.click(action('Fix problems'));
    await waitFor(() => expect(navigate.openPanelAgent).toHaveBeenCalledWith({ draft: { prompt: 'BRIEF', view: 'force-app/Help.agent', projectId: 'p1' }, title: 'Review · Help.agent' }));
    expect(rpc.mock.calls.find(c => c[1] === 'studio.draftAgent')![2]).toMatchObject({ projectId: 'p1', path: 'force-app/Help.agent', action: 'fix-problems', diagnostics: [{ message: 'm' }] });
    expect(rpc.mock.calls.some(c => c[1] === 'studio.askAgent')).toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Ask agent' })).toBeTruthy();
  });

  it('opens a recent agent in the side panel, or as its own thread without one', async () => {
    navigate.openPanelAgent = vi.fn(() => true);
    render(<AskAgentButton {...props} />);
    openMenu();
    fireEvent.click((await screen.findByText('Review · Help.agent')).closest('button')!);
    expect(navigate.openPanelAgent).toHaveBeenCalledWith({ threadId: 't1', title: 'Review · Help.agent' });
    expect(navigate.toThread).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    navigate.openPanelAgent = vi.fn(() => false);
    openMenu();
    fireEvent.click((await screen.findByText('Tests')).closest('button')!);
    expect(navigate.toThread).toHaveBeenCalledWith('t2');
  });

  it('starts the thread and goes to it when the page has no side panel', async () => {
    rpc.mockImplementation(async (_id: string, method: string) => method === 'studio.askAgent' ? { ok: true, threadId: 'new1', title: 'Agent script · Help.agent' } : { ok: true, threads: [] });
    render(<AskAgentButton {...props} />);
    openMenu();
    const input = screen.getByLabelText('Request for the agent') as HTMLInputElement;
    fireEvent.submit(input.closest('form')!);
    expect(rpc.mock.calls.some(c => c[1] === 'studio.askAgent')).toBe(false);
    fireEvent.change(input, { target: { value: '  add a topic ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(navigate.toThread).toHaveBeenCalledWith('new1'));
    expect(rpc.mock.calls.find(c => c[1] === 'studio.askAgent')![2]).toEqual({ projectId: 'p1', path: 'force-app/Help.agent', prompt: 'add a topic' });
    expect(rpc.mock.calls.some(c => c[1] === 'studio.draftAgent')).toBe(false);
  });

  it('falls back to starting the thread when the panel refuses the draft', async () => {
    navigate.openPanelAgent = vi.fn((options: { threadId?: string }) => Boolean(options.threadId));
    render(<AskAgentButton {...props} />);
    openMenu();
    fireEvent.click(action('Review'));
    await waitFor(() => expect(navigate.openPanelAgent).toHaveBeenCalledWith({ threadId: 'new1' }));
    expect(navigate.openPanelAgent).toHaveBeenCalledTimes(2);
    expect(navigate.toThread).not.toHaveBeenCalled();
  });

  it('shows draft, start and unlink failures in the menu', async () => {
    navigate.openPanelAgent = vi.fn(() => true);
    rpc.mockImplementation(async (_i: string, method: string) => method === 'studio.draftAgent' ? { ok: false, error: 'Choose an agent file inside this project.' } : { ok: true, threads: [link()] });
    render(<AskAgentButton {...props} />);
    openMenu();
    fireEvent.click(action('Review'));
    expect((await screen.findByRole('alert')).textContent).toBe('Choose an agent file inside this project.');
    expect(navigate.openPanelAgent).not.toHaveBeenCalled();
    delete navigate.openPanelAgent;
    rpc.mockImplementation(async (_i: string, method: string) => { if (method === 'studio.askAgent') throw new Error('offline'); return method === 'studio.unlinkThread' ? { ok: false, error: 'nope' } : { ok: true, threads: [link()] }; });
    fireEvent.click(action('Review'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('offline'));
    rpc.mockImplementation(async (_i: string, method: string) => method === 'studio.askAgent' ? { ok: false } : method === 'studio.unlinkThread' ? { ok: false, error: 'nope' } : { ok: true, threads: [link()] });
    fireEvent.click(action('Review'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not start the agent.'));
    fireEvent.click(screen.getByRole('button', { name: 'Unlink Review · Help.agent' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('nope'));
    rpc.mockImplementation(async (_i: string, method: string) => { if (method === 'studio.unlinkThread') throw new Error('gone'); return { ok: true, threads: [link()] }; });
    fireEvent.click(screen.getByRole('button', { name: 'Unlink Review · Help.agent' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('gone'));
  });

  it('unlinks a thread and reloads the list', async () => {
    render(<AskAgentButton {...props} />);
    openMenu();
    await screen.findByText('Tests');
    fireEvent.click(screen.getByRole('button', { name: 'Unlink Tests' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('salesforce', 'studio.unlinkThread', { projectId: 'p1', threadId: 't2' }));
    await waitFor(() => expect(rpc.mock.calls.filter(c => c[1] === 'studio.threads').length).toBe(2));
  });

  it('explains unavailable actions and is disabled without a project', async () => {
    const { rerender } = render(<AskAgentButton {...props} />);
    openMenu();
    expect((action('Explain selection') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Select some lines first.')).toBeTruthy();
    rerender(<AskAgentButton {...props} view={view({ cursor: { line: 1, column: 1 } })} />);
    expect((action('Explain selection') as HTMLButtonElement).disabled).toBe(false);
    rerender(<AskAgentButton {...props} path={null} />);
    expect((action('Review') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Request for the agent') as HTMLInputElement).disabled).toBe(true);
    cleanup();
    rpc.mockClear();
    render(<AskAgentButton {...props} projectId={undefined} />);
    expect((screen.getByRole('button', { name: 'Ask agent' }) as HTMLButtonElement).disabled).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('keeps the list when loading threads fails', async () => {
    rpc.mockRejectedValue(new Error('offline'));
    render(<AskAgentButton {...props} />);
    openMenu();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.getByText(/No agents yet/)).toBeTruthy();
  });
});

describe('useStudioView', () => {
  const input = { surface: 'sidepanel' as const, path: 'a.agent', dirty: false, tool: null, diagnostics: [] };
  it('caps selection and diagnostics when building state', () => {
    const state = buildViewState({ ...input, selection: { startLine: 1, endLine: 2, text: 'x'.repeat(3000) }, diagnostics: Array(80).fill({ line: 1, column: 1, endLine: 1, endColumn: 1, severity: 'error', message: 'm' }) }, true, 5);
    expect(state.selection!.text).toHaveLength(2000);
    expect(state.diagnostics).toHaveLength(50);
    expect(state).toMatchObject({ share: true, at: 5 });
    expect(buildViewState(input, false, 1).selection).toBeUndefined();
  });

  it('publishes debounced, dedupes identical state and republishes on share change', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ i }) => useStudioView({ pluginId: 'salesforce', projectId: 'p1', threadId: 't9', input: i }), { initialProps: { i: input } });
    expect(rpc).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(399); });
    expect(rpc).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toMatchObject([ 'salesforce', 'studio.view.publish', { projectId: 'p1', threadId: 't9', state: { path: 'a.agent', share: true } } ]);
    rerender({ i: { ...input } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(rpc).toHaveBeenCalledTimes(1);
    rerender({ i: { ...input, path: 'b.agent' } });
    rerender({ i: { ...input, path: 'c.agent' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][2].state.path).toBe('c.agent');
    act(() => result.current.setShare(false));
    expect(localStorage.getItem(SHARE_STORAGE_KEY)).toBe('false');
    expect(result.current.view.share).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(rpc.mock.calls[2][2].state.share).toBe(false);
  });

  it('restores the saved preference, skips publishing without a project and tolerates rpc failure', async () => {
    vi.useFakeTimers();
    localStorage.setItem(SHARE_STORAGE_KEY, 'false');
    const { result } = renderHook(() => useStudioView({ pluginId: 'salesforce', projectId: null, input }));
    expect(result.current.share).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockRejectedValue(new Error('x'));
    renderHook(() => useStudioView({ pluginId: 'salesforce', projectId: 'p', input }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
