import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { registerThreadViewIpc } from './windows.js';

const h = vi.hoisted(() => ({
  handlers: new Map<string, { handler: (...args: unknown[]) => unknown; fallback: () => unknown }>()
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('./ctx.js', () => ({ ctx: {} }));

const target = { threadId: 't-1', projectId: 'p-1' };

const views = {
  open: vi.fn(() => true),
  close: vi.fn(() => true),
  list: vi.fn(() => [target])
};

beforeEach(() => {
  h.handlers.clear();
  registerThreadViewIpc(
    (channel, handler, fallback) => h.handlers.set(channel, { handler, fallback }),
    views
  );
});

describe('thread view window IPC', () => {
  it('hands renderer input to main untouched, so main is the one that parses it', () => {
    const raw = { ...target, extra: '<script>' };
    expect(h.handlers.get(IPC.windows.openThreadView)!.handler(raw)).toBe(true);
    expect(views.open).toHaveBeenCalledWith(raw);
    expect(h.handlers.get(IPC.windows.closeThreadView)!.handler(raw)).toBe(true);
    expect(views.close).toHaveBeenCalledWith(raw);
  });

  it('lists the open thread windows', () => {
    expect(h.handlers.get(IPC.windows.listThreadViews)!.handler()).toEqual([target]);
  });

  it('fails closed when a handler throws', () => {
    expect(h.handlers.get(IPC.windows.openThreadView)!.fallback()).toBe(false);
    expect(h.handlers.get(IPC.windows.closeThreadView)!.fallback()).toBe(false);
    expect(h.handlers.get(IPC.windows.listThreadViews)!.fallback()).toEqual([]);
  });
});
