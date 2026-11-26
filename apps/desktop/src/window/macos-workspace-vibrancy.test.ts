import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { bindWorkspaceVibrancy, supportsMacosWorkspaceVibrancy } from './macos-workspace-vibrancy.js';

function makeWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    setBackgroundColor: vi.fn(),
    setVibrancy: vi.fn(),
    webContents: new EventEmitter()
  };
}

describe('macOS workspace vibrancy', () => {
  it('uses the native sidebar material in macOS workspace windows', () => {
    expect(supportsMacosWorkspaceVibrancy('darwin', false)).toBe(true);
  });

  it.each([
    ['darwin', true],
    ['win32', false],
    ['linux', false]
  ] as const)('keeps the default material on %s with detached=%s', (platform, detached) => {
    expect(supportsMacosWorkspaceVibrancy(platform, detached)).toBe(false);
  });

  it('retains the opaque startup background until the workspace loads', () => {
    const win = makeWindow();
    const refresh = bindWorkspaceVibrancy(win, { repairing: () => false, enabled: () => true, opaqueBackground: () => '#f6f8fa' });
    refresh();
    expect(win.setBackgroundColor).not.toHaveBeenCalled();
    expect(win.setVibrancy).not.toHaveBeenCalled();

    win.webContents.emit('did-finish-load');
    expect(win.setBackgroundColor).toHaveBeenCalledWith('#00000000');
    expect(win.setVibrancy).toHaveBeenCalledWith('sidebar');
    expect(win.webContents.listenerCount('did-finish-load')).toBe(0);

    win.webContents.emit('did-finish-load');
    expect(win.setBackgroundColor).toHaveBeenCalledOnce();
  });

  it('waits for the normal renderer when the first load is a repair page', () => {
    const win = makeWindow();
    const repairing = vi.fn(() => true);
    bindWorkspaceVibrancy(win, { repairing, enabled: () => true, opaqueBackground: () => '#f6f8fa' });

    win.webContents.emit('did-finish-load');
    expect(win.setBackgroundColor).not.toHaveBeenCalled();
    expect(win.webContents.listenerCount('did-finish-load')).toBe(1);

    repairing.mockReturnValue(false);
    win.webContents.emit('did-finish-load');
    expect(win.setBackgroundColor).toHaveBeenCalledOnce();
  });

  it('applies both live transitions from the default opaque workspace', () => {
    const win = makeWindow();
    const enabled = vi.fn(() => false);
    const refresh = bindWorkspaceVibrancy(win, { repairing: () => false, enabled, opaqueBackground: () => '#181818' });
    win.webContents.emit('did-finish-load');
    expect(win.setVibrancy).not.toHaveBeenCalled();
    enabled.mockReturnValue(true);
    refresh();
    refresh();
    expect(win.setVibrancy.mock.calls).toEqual([['sidebar']]);
    expect(win.setBackgroundColor.mock.calls).toEqual([['#00000000']]);
    enabled.mockReturnValue(false);
    refresh();
    expect(win.setVibrancy.mock.calls).toEqual([['sidebar'], [null]]);
    expect(win.setBackgroundColor.mock.calls).toEqual([['#00000000'], ['#181818']]);
    win.isDestroyed.mockReturnValue(true);
    enabled.mockReturnValue(true);
    refresh();
    expect(win.setVibrancy).toHaveBeenCalledTimes(2);
  });

  it('skips a destroyed window at load', () => {
    const win = makeWindow();
    win.isDestroyed.mockReturnValue(true);
    bindWorkspaceVibrancy(win, { repairing: () => false, enabled: () => true, opaqueBackground: () => '#f6f8fa' });

    win.webContents.emit('did-finish-load');
    expect(win.setBackgroundColor).not.toHaveBeenCalled();
  });
});
