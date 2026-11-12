// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ catalogue: vi.fn() }));
vi.mock('../product-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../product-client.js')>();
  return { ...actual, product: { ...actual.product, mcp: { ...actual.product.mcp, catalogue: h.catalogue } } };
});

import { useMcpCatalogue } from '../use-mcp-catalogue.js';

beforeEach(() => h.catalogue.mockReset());

describe('useMcpCatalogue', () => {
  it('stays idle and never calls the host while disabled', () => {
    const { result } = renderHook(() => useMcpCatalogue(false));
    expect(result.current.status).toBe('idle');
    expect(h.catalogue).not.toHaveBeenCalled();
  });

  it('maps a ready catalogue into named servers and notes', async () => {
    h.catalogue.mockResolvedValue({
      ok: true,
      value: { entries: [{ key: 'plugin:acme:search', source: 'plugin', available: true }, { key: 'corp:gh', source: 'user', available: false, reason: 'credentials-stripped' }], notes: ['n'] }
    });
    const { result } = renderHook(() => useMcpCatalogue(true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({
      servers: [
        { key: 'plugin:acme:search', name: 'search', available: true },
        { key: 'corp:gh', name: 'corp:gh', available: false, reason: 'credentials-stripped' }
      ],
      notes: ['n']
    });
  });

  it('is unavailable for a not-ok result and for a rejected call, never throwing', async () => {
    h.catalogue.mockResolvedValueOnce({ ok: false, error: { code: 'MCP_CATALOGUE_FAILED' } });
    const a = renderHook(() => useMcpCatalogue(true));
    await waitFor(() => expect(a.result.current.status).toBe('unavailable'));
    h.catalogue.mockRejectedValueOnce(new Error('ipc down'));
    const b = renderHook(() => useMcpCatalogue(true));
    await waitFor(() => expect(b.result.current.status).toBe('unavailable'));
  });

  it('ignores a result that arrives after unmount', async () => {
    let resolve!: (v: unknown) => void;
    h.catalogue.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result, unmount } = renderHook(() => useMcpCatalogue(true));
    unmount();
    resolve({ ok: true, value: { entries: [], notes: [] } });
    await Promise.resolve();
    expect(result.current.status).toBe('loading');
  });
});
