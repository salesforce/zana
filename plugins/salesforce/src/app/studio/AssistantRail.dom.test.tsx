/** @vitest-environment happy-dom */
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioThreadLink, StudioViewState } from '../../../lib/studio-contract.js';
import { STUDIO_CHANGED_CHANNEL } from '../../../lib/studio-contract.js';
import { AssistantRail } from './AssistantRail.js';
import { ContextStrip, describeVisibleContext } from './ContextStrip.js';
import { buildViewState, SHARE_STORAGE_KEY, useStudioView } from './useStudioView.js';

const rpc = vi.fn();
const navigate = { toThread: vi.fn() };
let realtime: ((payload: unknown) => void) | undefined;
const view = (over: Partial<StudioViewState> = {}): StudioViewState => ({ surface: 'studio', path: 'force-app/Help.agent', dirty: false, tool: 'code', diagnostics: [], share: true, at: 1, ...over });
const link = (over: Partial<StudioThreadLink> = {}): StudioThreadLink => ({ threadId: 't1', title: 'Review · Help.agent', role: 'reviewer', path: 'force-app/Help.agent', lastActivityAt: Date.now(), ...over });

beforeEach(() => {
  rpc.mockReset(); navigate.toThread.mockReset(); realtime = undefined; localStorage.clear();
  rpc.mockImplementation(async (_id: string, method: string) => {
    if (method === 'studio.threads') return { ok: true, threads: [link(), link({ threadId: 't2', title: 'Tests', role: 'tester', lastActivityAt: Date.now() - 7_200_000 })] };
    if (method === 'studio.askAgent') return { ok: true, threadId: 'new1' };
    return { ok: true };
  });
  (globalThis as any).__ZCC_HOST_REACT__ = React;
  (globalThis as any).__ZCC_PLUGIN_HOST__ = { callRpc: rpc };
  (globalThis as any).__ZCC_PLUGIN_RUNTIME__ = {
    useZccNavigate: () => navigate,
    useRealtime: (channel: string, handler: (p: unknown) => void) => { if (channel === STUDIO_CHANGED_CHANNEL) realtime = handler; },
    ThreadChat: (props: { threadId: string }) => <div data-testid="thread-chat">{props.threadId}</div>
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

describe('AssistantRail', () => {
  const props = { pluginId: 'salesforce', projectId: 'p1', path: 'force-app/Help.agent', view: view() };

  it('shows chips, loads linked threads with role badges and refreshes on realtime', async () => {
    render(<AssistantRail {...props} />);
    expect(await screen.findByText('Review · Help.agent')).toBeTruthy();
    expect(screen.getByText('Reviewer')).toBeTruthy();
    expect(screen.getByText('Tester')).toBeTruthy();
    expect(screen.getByText(/2h ago/)).toBeTruthy();
    for (const label of ['Review', 'Fix problems', 'Address comments', 'Write scenarios', 'Explain selection', 'Generate action', 'Harden guardrails']) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'studio.threads', { projectId: 'p1', path: 'force-app/Help.agent' });
    const calls = rpc.mock.calls.length;
    act(() => realtime!({ kind: 'comments', projectId: 'p1' }));
    act(() => realtime!({ kind: 'threads', projectId: 'other' }));
    expect(rpc.mock.calls.length).toBe(calls);
    act(() => realtime!({ kind: 'threads', projectId: 'p1' }));
    await waitFor(() => expect(rpc.mock.calls.length).toBe(calls + 1));
  });

  it('starts an action, then embeds the new thread chat with back and open-full', async () => {
    render(<AssistantRail {...props} view={view({ diagnostics: [{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: 'error', message: 'm' }] })} />);
    await screen.findByText('Tests');
    fireEvent.click(screen.getByRole('button', { name: 'Fix problems' }));
    await waitFor(() => expect(screen.getByTestId('thread-chat').textContent).toBe('new1'));
    const call = rpc.mock.calls.find(c => c[1] === 'studio.askAgent')!;
    expect(call[2]).toMatchObject({ projectId: 'p1', path: 'force-app/Help.agent', action: 'fix-problems', diagnostics: [{ message: 'm' }] });
    expect(screen.getByText('Agent thread')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open full thread' }));
    expect(navigate.toThread).toHaveBeenCalledWith('new1');
    fireEvent.click(screen.getByRole('button', { name: 'All agents' }));
    expect(screen.getByTestId('studio-assistant')).toBeTruthy();
  });

  it('opens a linked thread in the embedded chat using the onOpenThread override', async () => {
    const onOpenThread = vi.fn();
    render(<AssistantRail {...props} onOpenThread={onOpenThread} />);
    fireEvent.click((await screen.findByText('Review · Help.agent')).closest('button')!);
    expect(screen.getByTestId('thread-chat').textContent).toBe('t1');
    expect(screen.getByText('Reviewer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open full thread' }));
    expect(onOpenThread).toHaveBeenCalledWith('t1');
  });

  it('sends a free-form request and clears the input', async () => {
    render(<AssistantRail {...props} />);
    await screen.findByText('Tests');
    const input = screen.getByLabelText('Request for the agent') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  add a topic ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(rpc.mock.calls.some(c => c[1] === 'studio.askAgent' && c[2].prompt === 'add a topic')).toBe(true));
    await waitFor(() => expect(screen.getByTestId('thread-chat')).toBeTruthy());
  });

  it('shows errors from a failed ask and from a thrown rpc', async () => {
    rpc.mockImplementation(async (_i: string, method: string) => method === 'studio.askAgent' ? { ok: false, error: 'No provider' } : { ok: true, threads: [] });
    render(<AssistantRail {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect((await screen.findByRole('alert')).textContent).toBe('No provider');
    rpc.mockImplementation(async (_i: string, method: string) => { if (method === 'studio.askAgent') throw new Error('offline'); return { ok: true, threads: [] }; });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('offline'));
    expect(screen.getByText(/No agents yet/)).toBeTruthy();
  });

  it('delegates to onAskAgent when provided and disables chips without a file', async () => {
    const onAskAgent = vi.fn();
    const { rerender } = render(<AssistantRail {...props} onAskAgent={onAskAgent} threads={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onAskAgent).toHaveBeenCalledWith('review', undefined);
    expect(rpc).not.toHaveBeenCalled();
    rerender(<AssistantRail {...props} path={null} threads={[]} />);
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Request for the agent') as HTMLInputElement).disabled).toBe(true);
  });

  it('unlinks a thread and reports failures', async () => {
    render(<AssistantRail {...props} />);
    await screen.findByText('Tests');
    fireEvent.click(screen.getByRole('button', { name: 'Unlink Tests' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('salesforce', 'studio.unlinkThread', { projectId: 'p1', threadId: 't2' }));
    rpc.mockImplementation(async (_i: string, method: string) => method === 'studio.unlinkThread' ? { ok: false, error: 'nope' } : { ok: true, threads: [link()] });
    fireEvent.click(screen.getByRole('button', { name: 'Unlink Review · Help.agent' }));
    expect((await screen.findByRole('alert')).textContent).toBe('nope');
  });

  it('disables Explain selection until there is a selection or cursor', async () => {
    const { rerender } = render(<AssistantRail {...props} threads={[]} />);
    expect((screen.getByRole('button', { name: 'Explain selection' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<AssistantRail {...props} threads={[]} view={view({ cursor: { line: 1, column: 1 } })} />);
    expect((screen.getByRole('button', { name: 'Explain selection' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('compact mode offers the share toggle and an Ask agent menu', async () => {
    const onShareChange = vi.fn();
    render(<AssistantRail {...props} compact onShareChange={onShareChange} threads={[]} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onShareChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ask agent' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Review/ }));
    await waitFor(() => expect(rpc.mock.calls.some(c => c[1] === 'studio.askAgent' && c[2].action === 'review')).toBe(true));
    await screen.findByTestId('thread-chat');
  });
});

describe('AskAgentMenu behaviours (via compact rail)', () => {
  it('closes on Escape, sends a custom request and disables unavailable items', async () => {
    render(<AssistantRail pluginId="salesforce" projectId="p1" path="a.agent" view={view()} compact threads={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask agent' }));
    expect((screen.getByRole('menuitem', { name: /Explain selection/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ask agent' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ask agent' }));
    const input = screen.getByLabelText('Request for the agent');
    fireEvent.submit(input.closest('form')!);
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(rpc.mock.calls.some(c => c[1] === 'studio.askAgent' && c[2].prompt === 'hello')).toBe(true));
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
