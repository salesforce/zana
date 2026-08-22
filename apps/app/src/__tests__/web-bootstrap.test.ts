import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBrowserBootstrap } from '../web-bootstrap.js';

describe('loadBrowserBootstrap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a JSON bootstrap payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => 'application/json; charset=utf-8' },
        text: async () => JSON.stringify({ appVersion: '1.0.0', projects: [] })
      }))
    );
    await expect(loadBrowserBootstrap()).resolves.toEqual({ appVersion: '1.0.0', projects: [] });
  });

  it('does not treat an HTML SPA fallback as bootstrap JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => '<!DOCTYPE html><html></html>'
      }))
    );
    await expect(loadBrowserBootstrap()).rejects.toThrow('not available on this origin');
  });
});
