import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { registerConfigIpc } from './config.js';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  setConfig: vi.fn((patch: Record<string, unknown>) => ({ ...patch })),
  safeSend: vi.fn(),
  refreshTitleBarOverlays: vi.fn(),
  invalidateLlmReuse: vi.fn(),
  verifyState: { cache: undefined as unknown }
}));
vi.mock('./shared-product-registration.js', () => ({
  productHandle: (channel: string, handler: (...args: unknown[]) => unknown) => h.handlers.set(channel, handler),
  safeProductHandle: (channel: string, handler: (...args: unknown[]) => unknown) => h.handlers.set(channel, handler)
}));
vi.mock('./ctx.js', () => ({ ctx: { safeSend: h.safeSend, refreshTitleBarOverlays: h.refreshTitleBarOverlays, invalidateLlmReuse: h.invalidateLlmReuse } }));
vi.mock('./shared.js', () => ({ harnessVerifyState: h.verifyState }));
vi.mock('@zana-ai/zcc-server/http/public-app-url', () => ({ presentAppConfig: (config: unknown) => config }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: { setConfig: h.setConfig, getConfig: () => ({}) }
}));

beforeEach(() => {
  h.handlers.clear();
  h.setConfig.mockClear();
  h.safeSend.mockClear();
  h.refreshTitleBarOverlays.mockClear();
  h.invalidateLlmReuse.mockClear();
  h.verifyState.cache = undefined;
  registerConfigIpc();
});

describe('config.set window state', () => {
  it('invalidates the runtime cache (providers read the binary live) after committing a binary change', () => {
    h.verifyState.cache = { cached: true };
    const next = h.handlers.get(IPC.config.set)!({ claudeBinary: '/configured/claude' });
    expect(h.setConfig).toHaveBeenCalledWith({ claudeBinary: '/configured/claude' });
    expect(h.verifyState.cache).toBeUndefined();
    expect(h.safeSend).toHaveBeenCalledWith(IPC.config.onChanged, next);
    expect(h.invalidateLlmReuse).toHaveBeenCalledTimes(1);
  });
  it('rejects persistence failures so neither IPC nor HTTP acknowledges an unapplied config', () => {
    h.setConfig.mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    expect(() => h.handlers.get(IPC.config.set)!({ theme: 'light' })).toThrow('disk unavailable');
    expect(h.safeSend).not.toHaveBeenCalled();
  });
  it('drops main-owned window geometry from renderer writes', () => {
    const next = h.handlers.get(IPC.config.set)!({
      theme: 'light',
      windowBounds: { x: 0, y: 0, width: 1000, height: 700 },
      windowMaximized: true,
      pluginViewWindowBounds: { 'salesforce/salesforce@p-1': { bounds: { width: 1, height: 1 }, at: 1 } },
      threadViewWindowBounds: { bounds: { width: 1, height: 1 }, maximized: true }
    });
    expect(h.setConfig).toHaveBeenCalledWith({ theme: 'light' });
    expect(next).toEqual({ theme: 'light' });
    expect(h.safeSend).toHaveBeenCalledWith(IPC.config.onChanged, { theme: 'light' });
  });
});

describe('config.set theme', () => {
  it('re-colours the Windows caption buttons of every window when the theme changes', () => {
    h.handlers.get(IPC.config.set)!({ theme: 'system' });
    expect(h.refreshTitleBarOverlays).toHaveBeenCalledTimes(1);
  });
  it('leaves the caption buttons alone for other settings', () => {
    h.handlers.get(IPC.config.set)!({ claudeBinary: '/configured/claude' });
    expect(h.refreshTitleBarOverlays).not.toHaveBeenCalled();
  });
  it('does not invalidate LLM reuse for unrelated settings', () => {
    h.handlers.get(IPC.config.set)!({ theme: 'dark' });
    expect(h.invalidateLlmReuse).not.toHaveBeenCalled();
  });
});
