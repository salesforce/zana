// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const p = vi.hoisted(() => ({
  configCb: null as ((c: unknown) => void) | null,
  projCb: null as ((id: string) => void) | null,
  config: { get: vi.fn(), onChanged: vi.fn() },
  hosts: { list: vi.fn() },
  projectSettings: { get: vi.fn(), onChanged: vi.fn() }
}));
vi.mock('../../product-client.js', () => ({ product: p }));

import { buildSettingsSnapshot, useSettingsSnapshot } from '../snapshot';

beforeEach(() => {
  vi.clearAllMocks();
  p.config.get.mockResolvedValue({ theme: 'dark' });
  p.config.onChanged.mockImplementation((cb) => { p.configCb = cb; return () => {}; });
  p.hosts.list.mockResolvedValue([{ name: 'mac-mini', sshHost: 'mini' }]);
  p.projectSettings.get.mockResolvedValue({ shell: 'zsh' });
  p.projectSettings.onChanged.mockImplementation((cb) => { p.projCb = cb; return () => {}; });
});

describe('buildSettingsSnapshot', () => {
  it('falls back to an empty config and omits absent parts', () => {
    const s = buildSettingsSnapshot({ config: null, project: null, machines: null });
    expect(s).toEqual({ config: {} });
    const full = buildSettingsSnapshot({ config: { a: 1 } as never, project: { id: 'p', settings: {} as never }, machines: [{ name: 'm' }] });
    expect(full.project?.id).toBe('p');
    expect(full.machines).toHaveLength(1);
  });
});

describe('useSettingsSnapshot', () => {
  it('fetches nothing until enabled', () => {
    renderHook(() => useSettingsSnapshot('p1', false));
    expect(p.config.get).not.toHaveBeenCalled();
    expect(p.hosts.list).not.toHaveBeenCalled();
  });

  it('loads config, machines and project settings and follows change events', async () => {
    const { result } = renderHook(() => useSettingsSnapshot('p1', true));
    await waitFor(() => expect(result.current.project?.id).toBe('p1'));
    expect((result.current.config as unknown as { theme: string }).theme).toBe('dark');
    expect(result.current.machines).toEqual([{ name: 'mac-mini', host: 'mini' }]);
    const first = result.current;
    act(() => p.configCb?.({ theme: 'light' }));
    expect((result.current.config as unknown as { theme: string }).theme).toBe('light');
    expect(result.current).not.toBe(first);
    p.projectSettings.get.mockResolvedValue({ shell: 'fish' });
    act(() => p.projCb?.('other'));
    expect(p.projectSettings.get).toHaveBeenCalledTimes(1);
    act(() => p.projCb?.('p1'));
    await waitFor(() => expect((result.current.project?.settings as unknown as { shell: string }).shell).toBe('fish'));
  });

  it('survives failed fetches and clears the project without a project id', async () => {
    p.config.get.mockRejectedValue(new Error('x'));
    p.hosts.list.mockRejectedValue(new Error('x'));
    p.projectSettings.get.mockRejectedValue(new Error('x'));
    const { result, rerender } = renderHook(({ id }) => useSettingsSnapshot(id, true), { initialProps: { id: 'p1' as string | null } });
    await act(async () => {});
    expect(result.current).toEqual({ config: {} });
    rerender({ id: null });
    expect(result.current.project).toBeUndefined();
  });
});
