/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useScenarioLibrary } from './useScenarioLibrary.js';
import { SCENARIOS_CHANGED, starterScenarios } from '../../../lib/scenario-library-contract.js';
let channels: Record<string, (payload: unknown) => void>;
beforeEach(() => { channels = {}; (globalThis as any).__ZCC_PLUGIN_RUNTIME__ = { useRealtime: (name: string, handler: (payload: unknown) => void) => { channels[name] = handler; } }; });
afterEach(() => { cleanup(); delete (globalThis as any).__ZCC_PLUGIN_RUNTIME__; });
const props = { pluginId: 'salesforce', projectId: 'p', path: 'Bot.agent' as string | null, enabled: true };
it('loads, explicitly saves and removes within the selected agent and reloads only matching events', async () => {
  const saved = { ...starterScenarios()[0], id: 'new', name: 'New' };
  const call = vi.fn(async (_p, method) => method.endsWith('list') ? { ok: true, scenarios: starterScenarios() } : method.endsWith('save') ? { ok: true, scenario: saved } : { ok: true });
  const { result } = renderHook(() => useScenarioLibrary({ ...props, call })); await waitFor(() => expect(result.current.loading).toBe(false)); expect(result.current.scenarios).toHaveLength(3);
  act(() => channels[SCENARIOS_CHANGED]({ projectId: 'other', agentPath: props.path })); expect(call).toHaveBeenCalledTimes(1);
  act(() => channels[SCENARIOS_CHANGED]({ projectId: 'p', agentPath: props.path })); await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  await act(async () => { await result.current.save(saved, saved.id, saved.revision); }); expect(result.current.scenarios).toHaveLength(4);
  expect(call.mock.calls.at(-1)).toEqual(['salesforce', 'studio.scenarios.save', expect.objectContaining({ projectId: 'p', agentPath: 'Bot.agent', expectedRevision: 1 })]);
  await act(async () => { await result.current.remove(saved); }); expect(result.current.scenarios).toHaveLength(3);
});
it('shows load failures, supports retry and rejects incomplete mutation replies', async () => {
  const call = vi.fn(async () => ({ ok: false, error: 'Unavailable' } as any));
  const { result } = renderHook(() => useScenarioLibrary({ ...props, call })); await waitFor(() => expect(result.current.error).toBe('Unavailable'));
  call.mockResolvedValue({ ok: true, scenarios: [] }); act(() => result.current.reload()); await waitFor(() => expect(result.current.error).toBe(''));
  await expect(result.current.save(starterScenarios()[0])).rejects.toThrow('not returned');
  call.mockResolvedValue(undefined); await expect(result.current.remove(starterScenarios()[0])).rejects.toThrow('could not be loaded');
});
it('ignores delayed reads and writes from a previous agent', async () => {
  let finishList: (value: unknown) => void = () => {}; let finishSave: (value: unknown) => void = () => {};
  const call = vi.fn(async (_p, method, input: any) => input.agentPath === 'Bot.agent' ? new Promise(resolve => { if (method.endsWith('save')) finishSave = resolve; else finishList = resolve; }) : { ok: true, scenarios: [] });
  const view = renderHook(input => useScenarioLibrary({ ...input, call }), { initialProps: props });
  const saving = view.result.current.save(starterScenarios()[0]);
  view.rerender({ ...props, path: 'Other.agent' }); await waitFor(() => expect(view.result.current.loading).toBe(false));
  await act(async () => { finishList({ ok: true, scenarios: starterScenarios() }); finishSave({ ok: true, scenario: starterScenarios()[0] }); await saving; });
  expect(view.result.current.scenarios).toEqual([]);
});
it.each([{ enabled: false }, { path: null }, { projectId: undefined }])('does not fetch without a complete enabled scope %#', async patch => {
  const call = vi.fn(); const { result } = renderHook(() => useScenarioLibrary({ ...props, ...patch, call })); await waitFor(() => expect(result.current.loading).toBe(false)); expect(call).not.toHaveBeenCalled();
});
it('does not update an unmounted view after mutations finish', async () => {
  let finish: (value: unknown) => void = () => {};
  const call = vi.fn(async (_p, method) => method.endsWith('list') ? { ok: true, scenarios: [] } : new Promise(resolve => { finish = resolve; }));
  const view = renderHook(() => useScenarioLibrary({ ...props, call })); await waitFor(() => expect(view.result.current.loading).toBe(false));
  const removing = view.result.current.remove(starterScenarios()[0]); view.unmount(); finish({ ok: true }); await removing;
});
