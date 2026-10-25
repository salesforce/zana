// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({
  frames: new Map<number, FrameRequestCallback>(), nextFrame: 0,
  keyHandler: null as null | ((e: KeyboardEvent) => boolean),
  data: {
    fontSize: 14, theme: 'dark', terminalTheme: 'auto', terminalWheelArrowsEnabled: true,
    terminalCtrlVPasteEnabled: true, projects: []
  },
  ui: { agentModal: null, pushToast: vi.fn() }
}));
vi.mock('../store.js', () => ({
  useData: Object.assign((pick: (s: typeof h.data) => unknown) => pick(h.data), { getState: () => h.data }),
  useUi: Object.assign((pick: (s: typeof h.ui) => unknown) => pick(h.ui), { getState: () => h.ui })
}));
vi.mock('../lib/product-client.js', () => ({ product: { terminals: {
  resize: vi.fn().mockResolvedValue(undefined), onData: () => () => {}, onExit: () => () => {}, write: vi.fn().mockResolvedValue(undefined),
  backlog: vi.fn(async () => ''), backlogSnapshot: vi.fn(async () => ({ text: '', startOffset: 0, endOffset: 0 }))
} } }));
vi.mock('../lib/product-ws.js', () => ({ subscribeProductReconnect: () => () => {} }));
vi.mock('../hooks/useFileDrop.js', () => ({ useFileDrop: () => ({ dropOver: false, dropHandlers: {} }) }));
vi.mock('../lib/osc52-clipboard.js', () => ({ registerOsc52Clipboard: () => ({ dispose: vi.fn() }) }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options: Record<string, unknown>; constructor(options: Record<string, unknown>) { this.options = options; }
  cols = 80; rows = 24; buffer = { active: { viewportY: 0, baseY: 0 } }; parser = {};
  open() {} loadAddon() {} refresh() {} focus() {} dispose() {} resize() {} scrollToBottom() {}
  hasSelection() { return false; } getSelection() { return ''; }
  write(_data: string, done: () => void) { done(); }
  reset() {}
  onScroll() { return { dispose() {} }; } onData() { return { dispose() {} }; }
  attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean) { h.keyHandler = fn; }
  attachCustomWheelEventHandler() {}
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss() { return { dispose() {} }; } dispose() {} } }));

import { TerminalView } from './TerminalView.js';

const session = { id: 's1', projectId: 'p1', profile: 'shell' } as TerminalSession;

async function mount(platform: string) {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  render(<TerminalView session={session} area="a" />);
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      const batch = [...h.frames.values()]; h.frames.clear(); batch.forEach((cb) => cb(0));
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  expect(h.keyHandler).toBeTypeOf('function');
}

/** Run a key through the attached handler: xterm's verdict, and whether the browser default was cancelled. */
function press(init: KeyboardEventInit & { keyCode: number }) {
  const e = new KeyboardEvent('keydown', { cancelable: true, ...init });
  Object.defineProperty(e, 'keyCode', { value: init.keyCode });
  const xtermHandles = h.keyHandler!(e);
  return { xtermHandles, defaultPrevented: e.defaultPrevented };
}

const ctrlV = { key: 'v', keyCode: 86, ctrlKey: true };
const ctrlShiftV = { key: 'V', keyCode: 86, ctrlKey: true, shiftKey: true };

beforeEach(() => {
  vi.useFakeTimers();
  h.frames.clear(); h.nextFrame = 0; h.keyHandler = null;
  h.data.terminalCtrlVPasteEnabled = true;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = ++h.nextFrame; h.frames.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => h.frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('TerminalView Ctrl+V paste', () => {
  it('leaves Ctrl+V and Ctrl+Shift+V to the browser paste on Windows, without cancelling it', async () => {
    await mount('Win32');
    expect(press(ctrlV)).toEqual({ xtermHandles: false, defaultPrevented: false });
    expect(press(ctrlShiftV)).toEqual({ xtermHandles: false, defaultPrevented: false });
  });

  it('reads the setting live: off sends ^V through xterm, Ctrl+Shift+V still pastes', async () => {
    await mount('Win32');
    h.data.terminalCtrlVPasteEnabled = false;
    expect(press(ctrlV).xtermHandles).toBe(true);
    expect(press(ctrlShiftV).xtermHandles).toBe(false);
    h.data.terminalCtrlVPasteEnabled = true;
    expect(press(ctrlV).xtermHandles).toBe(false);
  });

  it('pastes with Ctrl+Shift+V on Linux and follows the setting for Ctrl+V', async () => {
    await mount('Linux x86_64');
    expect(press(ctrlShiftV).xtermHandles).toBe(false);
    h.data.terminalCtrlVPasteEnabled = false;
    expect(press(ctrlV).xtermHandles).toBe(true);
  });

  it('keeps macOS on xterm for Ctrl+V and Ctrl+Shift+V', async () => {
    await mount('MacIntel');
    expect(press(ctrlV).xtermHandles).toBe(true);
    expect(press(ctrlShiftV).xtermHandles).toBe(true);
  });

  it('leaves other keys to xterm', async () => {
    await mount('Win32');
    expect(press({ key: 'v', keyCode: 86 }).xtermHandles).toBe(true);
    expect(press({ key: 'v', keyCode: 86, ctrlKey: true, altKey: true }).xtermHandles).toBe(true);
    expect(press({ key: 'c', keyCode: 67, ctrlKey: true }).xtermHandles).toBe(true);
  });
});
