import { describe, expect, it, vi } from 'vitest';
import { findUnscopedWindow, isUnscopedEntry, isUnscopedRegistration, leaveProjectWindow } from './main-window-registry.js';

const win = (destroyed = false) => ({ isDestroyed: () => destroyed });

describe('main window registry', () => {
  it('rules out project, plugin view and thread view windows', () => {
    expect(isUnscopedEntry({})).toBe(true);
    expect(isUnscopedEntry({ secondary: true })).toBe(false);
    expect(isUnscopedEntry({ projectId: 'p-1' })).toBe(false);
    expect(isUnscopedEntry({ threadView: { threadId: 't-1' } })).toBe(false);
  });

  it('matches a registration only for the same, unscoped window', () => {
    const main = win();
    expect(isUnscopedRegistration({ win: main }, main)).toBe(true);
    expect(isUnscopedRegistration({ win: main }, win())).toBe(false);
    expect(isUnscopedRegistration(undefined, main)).toBe(false);
    expect(isUnscopedRegistration({ win: main, threadView: { threadId: 't-1' } }, main)).toBe(false);
  });

  it('finds the first live unscoped window', () => {
    const main = win();
    expect(findUnscopedWindow([{ win: win(), threadView: { threadId: 't-1' } }, { win: win(true) }, { win: main }])).toBe(main);
    expect(findUnscopedWindow([{ win: win(), projectId: 'p-1' }])).toBeNull();
  });
});

describe('leaving a project window', () => {
  const origin = 'http://localhost:8780';
  function windowEntry() {
    const clear = vi.fn();
    const loadURL = vi.fn(async (_url: string) => undefined);
    return { projectId: 'a', win: { loadURL, webContents: { navigationHistory: { clear } } } };
  }

  it.each([['projects', '/agents'], ['settings', '/settings']])('opens %s in this window', async (destination, path) => {
    const entry = windowEntry();
    expect(await leaveProjectWindow(entry, destination, origin)).toBe(true);
    expect(entry.projectId).toBeUndefined();
    expect(entry.win.loadURL).toHaveBeenCalledWith(origin + path + '?projectId=');
    expect(entry.win.webContents.navigationHistory.clear).toHaveBeenCalledOnce();
  });

  it('rejects unknown destinations, unavailable renderers and windows outside the project shell', async () => {
    const entry = windowEntry();
    expect(await leaveProjectWindow(entry, 'https://example.com', origin)).toBe(false);
    expect(await leaveProjectWindow(entry, 'projects', null)).toBe(false);
    for (const other of [undefined, { ...entry, projectId: undefined }, { ...entry, view: {} }, { ...entry, threadView: {} }]) {
      expect(await leaveProjectWindow(other, 'projects', origin)).toBe(false);
    }
    expect(entry.win.loadURL).not.toHaveBeenCalled();
  });

  it('preserves the project and its history if loading fails', async () => {
    const entry = windowEntry();
    entry.win.loadURL.mockRejectedValueOnce(new Error('offline'));
    await expect(leaveProjectWindow(entry, 'projects', origin)).rejects.toThrow('offline');
    expect(entry.projectId).toBe('a');
    expect(entry.win.webContents.navigationHistory.clear).not.toHaveBeenCalled();
  });
});
