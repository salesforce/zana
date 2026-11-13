// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({
  frames: new Map<number, FrameRequestCallback>(),
  nextFrame: 0,
  keyHandler: null as null | ((e: KeyboardEvent) => boolean),
  selection: '',
  selectionListeners: new Set<() => void>(),
  data: {
    fontSize: 14,
    theme: 'dark',
    terminalTheme: 'auto',
    terminalWheelArrowsEnabled: true,
    terminalCtrlVPasteEnabled: true,
    terminalCopyOnSelectEnabled: true as boolean | undefined,
    projects: []
  },
  ui: { agentModal: null, pushToast: vi.fn() },
  copyText: vi.fn<(text: string) => Promise<void>>()
}));

vi.mock('../store.js', () => ({
  useData: Object.assign((pick: (s: typeof h.data) => unknown) => pick(h.data), { getState: () => h.data }),
  useUi: Object.assign((pick: (s: typeof h.ui) => unknown) => pick(h.ui), { getState: () => h.ui })
}));
vi.mock('../lib/copy-text.js', () => ({ copyText: h.copyText }));
vi.mock('../lib/product-client.js', () => ({
  product: {
    terminals: {
      resize: vi.fn().mockResolvedValue(undefined),
      onData: () => () => {},
      onExit: () => () => {},
      write: vi.fn().mockResolvedValue(undefined),
      backlog: vi.fn(async () => ''),
      backlogSnapshot: vi.fn(async () => ({ text: '', startOffset: 0, endOffset: 0 }))
    }
  }
}));
vi.mock('../lib/product-ws.js', () => ({ subscribeProductReconnect: () => () => {} }));
vi.mock('../hooks/useFileDrop.js', () => ({ useFileDrop: () => ({ dropOver: false, dropHandlers: {} }) }));
vi.mock('../lib/osc52-clipboard.js', () => ({ registerOsc52Clipboard: () => ({ dispose: vi.fn() }) }));
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) { this.options = options; }
    cols = 80;
    rows = 24;
    buffer = { active: { viewportY: 0, baseY: 0 } };
    parser = {};
    open() {}
    loadAddon() {}
    refresh() {}
    focus() {}
    dispose() {}
    resize() {}
    scrollToBottom() {}
    hasSelection() { return h.selection !== ''; }
    getSelection() { return h.selection; }
    onSelectionChange(fn: () => void) { h.selectionListeners.add(fn); return { dispose: () => h.selectionListeners.delete(fn) }; }
    write(_data: string, done: () => void) { done(); }
    reset() {}
    onScroll() { return { dispose() {} }; }
    onData() { return { dispose() {} }; }
    attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean) { h.keyHandler = fn; }
    attachCustomWheelEventHandler() {}
  }
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class { onContextLoss() { return { dispose() {} }; } dispose() {} }
}));

import { TerminalView } from './TerminalView.js';

const session = { id: 's1', projectId: 'p1', profile: 'claude' } as TerminalSession;

async function flushFrames() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      const batch = [...h.frames.values()];
      h.frames.clear();
      batch.forEach((cb) => cb(0));
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

async function mount() {
  const view = render(<TerminalView session={session} area="a" />);
  await flushFrames();
  const host = view.container.firstElementChild as HTMLElement;
  expect(host).not.toBeNull();
  return { ...view, host };
}

/** Left-drag inside the terminal host that leaves `text` selected. */
async function selectWithMouse(host: HTMLElement, text: string) {
  host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  h.selection = text;
  h.selectionListeners.forEach((fn) => fn());
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await act(async () => { await vi.runAllTimersAsync(); });
}

beforeEach(() => {
  vi.useFakeTimers();
  h.frames.clear();
  h.nextFrame = 0;
  h.keyHandler = null;
  h.selection = '';
  h.selectionListeners.clear();
  h.data.terminalCopyOnSelectEnabled = true;
  h.ui.pushToast.mockReset();
  h.copyText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++h.nextFrame;
    h.frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => h.frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('TerminalView copy on select', () => {
  it('copies a finished mouse selection through copyText, with no toast', async () => {
    const { host } = await mount();
    await selectWithMouse(host, 'git status');
    expect(h.copyText).toHaveBeenCalledTimes(1);
    expect(h.copyText).toHaveBeenCalledWith('git status');
    expect(h.ui.pushToast).not.toHaveBeenCalled();
  });

  it('is on when the setting is unset, and follows the setting live', async () => {
    const { host } = await mount();
    h.data.terminalCopyOnSelectEnabled = undefined;
    await selectWithMouse(host, 'unset');
    h.data.terminalCopyOnSelectEnabled = false;
    await selectWithMouse(host, 'off');
    expect(h.copyText.mock.calls).toEqual([['unset']]);
  });

  it('keeps Ctrl+C on xterm (SIGINT) while text is selected', async () => {
    const { host } = await mount();
    await selectWithMouse(host, 'selected');
    const ctrlC = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, cancelable: true });
    expect(h.keyHandler!(ctrlC)).toBe(true);
    expect(ctrlC.defaultPrevented).toBe(false);
  });

  it('logs and shows an error toast when the copy fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.copyText.mockRejectedValueOnce(new Error('clipboard busy'));
    const { host } = await mount();
    await selectWithMouse(host, 'text');
    expect(error).toHaveBeenCalledWith('[TerminalView] copy on select failed (session s1): clipboard busy');
    expect(h.ui.pushToast).toHaveBeenCalledWith('Could not copy the terminal selection', 'error');
  });

  it('logs a copy failure that is not an Error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.copyText.mockRejectedValueOnce('no clipboard');
    const { host } = await mount();
    await selectWithMouse(host, 'text');
    expect(error).toHaveBeenCalledWith('[TerminalView] copy on select failed (session s1): no clipboard');
  });

  it('stops copying after the terminal unmounts', async () => {
    const { host, unmount } = await mount();
    unmount();
    await selectWithMouse(host, 'gone');
    expect(h.copyText).not.toHaveBeenCalled();
  });
});
