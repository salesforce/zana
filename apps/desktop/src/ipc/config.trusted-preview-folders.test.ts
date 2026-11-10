import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { registerConfigIpc } from './config.js';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  fallbacks: new Map<string, (...args: unknown[]) => unknown>(),
  product: new Map<string, (...args: unknown[]) => unknown>(),
  state: { config: {} as Record<string, unknown> },
  setConfig: vi.fn(),
  safeSend: vi.fn(),
  win: { current: {} as unknown },
  showOpenDialog: vi.fn()
}));
vi.mock('electron', () => ({ dialog: { showOpenDialog: h.showOpenDialog } }));
vi.mock('./shared-product-registration.js', () => ({
  productHandle: (channel: string, handler: (...args: unknown[]) => unknown) => h.product.set(channel, handler),
  safeProductHandle: (channel: string, handler: (...args: unknown[]) => unknown) => h.product.set(channel, handler)
}));
vi.mock('./ctx.js', () => ({
  ctx: {
    safeHandle: (channel: string, handler: (...args: unknown[]) => unknown, fallback: (...args: unknown[]) => unknown) => {
      h.handlers.set(channel, handler); h.fallbacks.set(channel, fallback);
    },
    safeSend: h.safeSend,
    mainWindow: () => h.win.current,
    refreshTitleBarOverlays: vi.fn(),
    invalidateLlmReuse: vi.fn(),
    keepAwake: { refresh: vi.fn() }
  }
}));
vi.mock('./shared.js', () => ({ harnessVerifyState: {} }));
vi.mock('@zana-ai/zcc-server/http/public-app-url', () => ({ presentAppConfig: (config: unknown) => config }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: { getConfig: () => h.state.config, setConfig: h.setConfig }
}));

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'cfg-trust-')));
  for (const m of [h.handlers, h.fallbacks, h.product]) m.clear();
  h.state.config = {};
  h.win.current = {};
  h.setConfig.mockReset().mockImplementation((patch: Record<string, unknown>) => {
    h.state.config = { ...h.state.config, ...patch };
    return h.state.config;
  });
  h.safeSend.mockClear();
  h.showOpenDialog.mockReset();
  registerConfigIpc();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const add = () => h.handlers.get(IPC.config.addTrustedPreviewFolder)!() as Promise<{ config: unknown; error?: string }>;

describe('config.set', () => {
  it('strips trustedPreviewFolders from renderer patches', () => {
    h.product.get(IPC.config.set)!({ theme: 'light', trustedPreviewFolders: ['/etc'] });
    expect(h.setConfig).toHaveBeenCalledWith({ theme: 'light' });
  });
});

describe('addTrustedPreviewFolder', () => {
  it('persists the chooser result and broadcasts', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [dir] });
    const result = await add();
    expect(result.config).toEqual({ trustedPreviewFolders: [dir] });
    expect(h.showOpenDialog).toHaveBeenCalledWith(h.win.current, expect.objectContaining({ properties: ['openDirectory'] }));
    expect(h.safeSend).toHaveBeenCalledWith(IPC.config.onChanged, { trustedPreviewFolders: [dir] });
  });
  it('is a no-op when cancelled or empty', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [dir] });
    expect(await add()).toEqual({ config: null });
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] });
    expect(await add()).toEqual({ config: null });
    expect(h.setConfig).not.toHaveBeenCalled();
    expect(h.safeSend).not.toHaveBeenCalled();
  });
  it('does nothing without a main window', async () => {
    h.win.current = null;
    expect(await add()).toEqual({ config: null });
    expect(h.showOpenDialog).not.toHaveBeenCalled();
  });
  it('fails closed over the cap without writing or broadcasting', async () => {
    h.state.config = { trustedPreviewFolders: Array.from({ length: 20 }, (_, i) => `/t/${i}`) };
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [dir] });
    const result = await add();
    expect(result.config).toBeNull();
    expect(result.error).toMatch(/At most 20/);
    expect(h.setConfig).not.toHaveBeenCalled();
    expect(h.safeSend).not.toHaveBeenCalled();
  });
  it('reports a generic error for non-Error throws and has a safe fallback', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [join(dir, 'missing')] });
    const result = await add();
    expect(result.config).toBeNull();
    expect(typeof result.error).toBe('string');
    expect(h.fallbacks.get(IPC.config.addTrustedPreviewFolder)!()).toEqual({ config: null, error: 'Could not trust this folder.' });
  });
});

describe('removeTrustedPreviewFolder', () => {
  const remove = (path: unknown) => h.handlers.get(IPC.config.removeTrustedPreviewFolder)!(path);
  it('removes one entry and broadcasts', () => {
    h.state.config = { trustedPreviewFolders: ['/a', '/b'] };
    expect(remove('/a')).toEqual({ trustedPreviewFolders: ['/b'] });
    expect(h.safeSend).toHaveBeenCalledWith(IPC.config.onChanged, { trustedPreviewFolders: ['/b'] });
  });
  it('throws on invalid input (fallback returns current config)', () => {
    expect(() => remove('relative')).toThrow('Unknown trusted folder.');
    h.state.config = { trustedPreviewFolders: ['/a'] };
    expect(h.fallbacks.get(IPC.config.removeTrustedPreviewFolder)!()).toEqual({ trustedPreviewFolders: ['/a'] });
    expect(h.setConfig).not.toHaveBeenCalled();
  });
});
