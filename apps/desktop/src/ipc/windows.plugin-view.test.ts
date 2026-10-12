import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { registerPluginViewIpc } from './windows.js';

const h = vi.hoisted(() => ({
  handlers: new Map<string, { handler: (...args: unknown[]) => unknown; fallback: () => unknown }>()
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('./ctx.js', () => ({ ctx: {} }));

const target = { pluginId: 'salesforce', tabId: 'salesforce', projectId: 'p-1' };

const views = {
  open: vi.fn(async () => true),
  close: vi.fn(() => true),
  list: vi.fn(() => [target]),
  showPath: vi.fn(async () => true)
};

beforeEach(() => {
  h.handlers.clear();
  registerPluginViewIpc(
    (channel, handler, fallback) => h.handlers.set(channel, { handler, fallback }),
    views
  );
});

describe('plugin view window IPC', () => {
  it('hands renderer input to main untouched, so main is the one that parses it', async () => {
    const raw = { ...target, extra: '<script>' };
    await expect(h.handlers.get(IPC.windows.openPluginView)!.handler(raw)).resolves.toBe(true);
    expect(views.open).toHaveBeenCalledWith(raw);
    expect(h.handlers.get(IPC.windows.closePluginView)!.handler(raw)).toBe(true);
    expect(views.close).toHaveBeenCalledWith(raw);
    await expect(h.handlers.get(IPC.windows.showInMain)!.handler('/projects/p-1')).resolves.toBe(true);
    expect(views.showPath).toHaveBeenCalledWith('/projects/p-1');
  });

  it('lists the open view windows', () => {
    expect(h.handlers.get(IPC.windows.listPluginViews)!.handler()).toEqual([target]);
  });

  it('fails closed when a handler throws', () => {
    expect(h.handlers.get(IPC.windows.openPluginView)!.fallback()).toBe(false);
    expect(h.handlers.get(IPC.windows.closePluginView)!.fallback()).toBe(false);
    expect(h.handlers.get(IPC.windows.showInMain)!.fallback()).toBe(false);
    expect(h.handlers.get(IPC.windows.listPluginViews)!.fallback()).toEqual([]);
  });
});
