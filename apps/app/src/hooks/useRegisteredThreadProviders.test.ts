// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRegisteredThreadProviders } from './useRegisteredThreadProviders.js';
const api = vi.hoisted(() => ({ providers: vi.fn(), plugins: vi.fn(), changed: null as (() => void) | null, off: vi.fn() }));
vi.mock('../lib/product-client.js', () => ({ product: {
  threads: { providers: api.providers },
  pluginApps: { list: api.plugins, onChanged: (cb: () => void) => { api.changed = cb; return api.off; } }
} }));
const first = { id: 'example', displayName: 'Example', pluginId: 'example-plugin' };
beforeEach(() => { api.providers.mockReset().mockResolvedValue({ providers: [first] }); api.plugins.mockReset().mockResolvedValue([{ id: 'example-plugin', name: 'Example plugin' }]); api.off.mockClear(); api.changed = null; });
afterEach(cleanup);
describe('registered provider inventory', () => {
  it('loads the actual registry and plugin ownership and refreshes on lifecycle changes', async () => {
    const { result, unmount } = renderHook(useRegisteredThreadProviders);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.providers).toEqual([first]));
    expect(result.current.plugins[0].name).toBe('Example plugin');
    api.providers.mockResolvedValue({ providers: [] });
    act(() => api.changed?.());
    await waitFor(() => expect(result.current.providers).toEqual([]));
    expect(result.current.loading).toBe(false);
    unmount(); expect(api.off).toHaveBeenCalledOnce();
  });
  it('retains the last registry on refresh failure and recovers explicitly', async () => {
    const { result } = renderHook(useRegisteredThreadProviders);
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.providers.mockRejectedValueOnce(new Error('offline'));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toContain('Could not refresh'));
    expect(result.current.providers).toEqual([first]);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBeNull());
  });
  it('does not discard registrations when optional plugin metadata cannot load', async () => {
    api.plugins.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(useRegisteredThreadProviders);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.providers).toEqual([first]);
    expect(result.current.plugins).toEqual([]);
  });
  it('ignores a response superseded by a plugin lifecycle update', async () => {
    let resolve!: (value: { providers: typeof first[] }) => void;
    api.providers.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { result } = renderHook(useRegisteredThreadProviders);
    api.providers.mockResolvedValue({ providers: [] });
    act(() => api.changed?.());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => resolve({ providers: [first] }));
    expect(result.current.providers).toEqual([]);
  });
});
