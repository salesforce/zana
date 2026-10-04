// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PluginProjectTabRegistration } from '@zana-ai/zcc-plugin-sdk';

const apiJson = vi.hoisted(() => vi.fn());
vi.mock('../lib/fetch-with-app-surface.js', () => ({ apiJson }));
import { useProjectTabAvailability } from './useProjectTabAvailability.js';

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function tab(id: string, pluginId = 'plug'): PluginProjectTabRegistration {
  return {
    id,
    pluginId,
    generation: 1,
    label: id,
    component: () => null
  } as PluginProjectTabRegistration;
}

const railIdFor = (t: PluginProjectTabRegistration) => `${t.pluginId}:${t.id}`;

it('reports available: true when the plugin evaluator approves', async () => {
  apiJson.mockResolvedValue({ available: true });
  const { result } = renderHook(() => useProjectTabAvailability('proj', [tab('a')], railIdFor));
  await waitFor(() => expect(result.current['plug:a']).toEqual({ available: true }));
});

it('reports available: false with the evaluator-supplied reason', async () => {
  apiJson.mockResolvedValue({ available: false, reason: 'not configured' });
  const { result } = renderHook(() => useProjectTabAvailability('proj', [tab('a')], railIdFor));
  await waitFor(() => expect(result.current['plug:a']).toEqual({ available: false, reason: 'not configured' }));
});

it('degrades to unavailable (not available) on a transport failure — OBL-006 fail-closed contract', async () => {
  apiJson.mockRejectedValue(new Error('network down'));
  const { result } = renderHook(() => useProjectTabAvailability('proj', [tab('a')], railIdFor));
  await waitFor(() =>
    expect(result.current['plug:a']).toEqual({ available: false, reason: 'Could not check availability' })
  );
});

it('keys rows by rail id, resolving multiple tabs independently', async () => {
  apiJson.mockImplementation(async (path: string) => {
    if (path.includes('plug-a')) return { available: true };
    throw new Error('boom');
  });
  const tabs = [tab('x', 'plug-a'), tab('y', 'plug-b')];
  const { result } = renderHook(() => useProjectTabAvailability('proj', tabs, railIdFor));
  await waitFor(() => {
    expect(result.current['plug-a:x']).toEqual({ available: true });
    expect(result.current['plug-b:y']).toEqual({ available: false, reason: 'Could not check availability' });
  });
});

it('clears rows synchronously when there are no tabs', async () => {
  apiJson.mockResolvedValue({ available: true });
  const { result, rerender } = renderHook(
    ({ tabs }: { tabs: PluginProjectTabRegistration[] }) => useProjectTabAvailability('proj', tabs, railIdFor),
    { initialProps: { tabs: [tab('a')] } }
  );
  await waitFor(() => expect(result.current['plug:a']).toEqual({ available: true }));
  rerender({ tabs: [] });
  expect(result.current).toEqual({});
});
