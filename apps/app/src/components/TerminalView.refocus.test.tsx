// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({
  shown: false,
  frames: new Map<number, FrameRequestCallback>(),
  nextFrame: 0,
  observer: null as ResizeObserverCallback | null,
  fit: vi.fn(), resize: vi.fn(), resizePty: vi.fn().mockResolvedValue(undefined),
  gpuCreated: vi.fn(), gpuDisposed: vi.fn(), constructed: vi.fn(), options: {} as Record<string,unknown>,
  write: vi.fn(), reset: vi.fn(), scroll: vi.fn(), selected: false,
  active: { viewportY: 0, baseY: 0 }, exit: null as any, replayRead: null as any, replayOptions: null as any,
  backlog: vi.fn(async () => ''), snapshot: vi.fn(async () => ({ text: '', startOffset: 0, endOffset: 0 })),
  data: { fontSize: 14, theme: 'dark', terminalTheme: 'auto', terminalWheelArrowsEnabled: true, projects: [] },
  order: [] as string[],
  ui: { agentModal: null as { sessionId: string } | null, pushToast: vi.fn() }
}));
vi.mock('../store.js', () => ({
  useData: Object.assign((pick: (s: typeof h.data) => unknown) => pick(h.data), { getState: () => h.data }),
  useUi: Object.assign((pick: (s: typeof h.ui) => unknown) => pick(h.ui), { getState: () => h.ui })
}));
vi.mock('../lib/product-client.js', () => ({ product: { terminals: {
  resize: h.resizePty, onData: () => () => {}, onExit: (fn: any) => { h.exit = fn; return () => {}; }, write: vi.fn(),
  backlog: h.backlog, backlogSnapshot: h.snapshot
} } }));
vi.mock('../lib/product-ws.js', () => ({ subscribeProductReconnect: () => () => {} }));
vi.mock('../lib/terminal-replay.js', () => ({ createTerminalReplay: (read: any, options: any) => {
  h.replayRead = read; h.replayOptions = options; return { replay: vi.fn(), dispose: vi.fn() };
} }));
vi.mock('../lib/terminal-write-queue.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/terminal-write-queue.js')>('../lib/terminal-write-queue.js');
  return { createTerminalWriteQueue: (write: any, visible: boolean) => {
    const queue = actual.createTerminalWriteQueue(write, visible);
    return {
      ...queue,
      clearGap: () => { h.order.push('clearGap'); queue.clearGap(); },
      setVisible: (value: boolean) => { h.order.push(`setVisible(${value})`); queue.setVisible(value); }
    };
  } };
});
vi.mock('../hooks/useFileDrop.js', () => ({ useFileDrop: () => ({ dropOver: false, dropHandlers: {} }) }));
vi.mock('../lib/osc52-clipboard.js', () => ({ registerOsc52Clipboard: () => ({ dispose: vi.fn() }) }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80; rows = 24;
  options: Record<string, unknown>;
  buffer = { active: h.active };
  parser = {};
  constructor(options: Record<string, unknown>) { this.options = options; h.options = options; h.constructed(); }
  resize(cols: number, rows: number) { h.resize(cols, rows); this.cols = cols; this.rows = rows; }
  open() {} loadAddon() {} refresh() {} scrollToBottom() { h.scroll(); } focus() {} dispose() {}
  hasSelection() { return h.selected; }
  write(data: string, done: () => void) { h.write(data); done(); }
  reset() { h.reset(); }
  onScroll() { return { dispose() {} }; } onData() { return { dispose() {} }; }
  attachCustomKeyEventHandler() {} attachCustomWheelEventHandler() {}
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = h.fit; } }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { constructor() { h.gpuCreated(); } onContextLoss() { return { dispose() {} }; } dispose() { h.gpuDisposed(); } } }));

import { TerminalView } from './TerminalView.js';

const session = { id: 's1', projectId: 'p1', profile: 'shell' } as TerminalSession;
const fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
async function frames() {
  await act(async () => {
    const batch = [...h.frames.values()];
    h.frames.clear();
    batch.forEach((cb) => cb(0));
  });
}
function observe(width: number, height: number) {
  act(() => h.observer?.([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver));
}

beforeEach(() => {
  vi.useFakeTimers();
  h.shown = false; h.frames.clear(); h.nextFrame = 0; h.order = [];
  h.selected = false; h.active.viewportY = h.active.baseY = 0;
  h.data.fontSize = 14; h.ui.agentModal = null;
  vi.clearAllMocks();
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function () { return h.shown ? document.body : null; });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => h.shown ? 800 : 0);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => h.shown ? 600 : 0);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = ++h.nextFrame; h.frames.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => h.frames.delete(id));
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: ResizeObserverCallback) { h.observer = cb; }
    observe() {} disconnect() {}
  });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  if (fontsDescriptor) Object.defineProperty(document, 'fonts', fontsDescriptor);
  else Reflect.deleteProperty(document, 'fonts');
});

const GAP_TEXT = 'omitted while this terminal was hidden or busy';
const written = () => h.write.mock.calls.map(([data]) => data as string).join('');

describe('terminal refocus omitted-output marker', () => {
  it('clears the pending marker before the visible transition and never writes it', async () => {
    const view = render(<TerminalView session={session} area={undefined} />);
    await frames();
    act(() => h.replayOptions.write('x'.repeat(300000)));
    await frames();
    expect(h.write).not.toHaveBeenCalled();
    h.shown = true; h.order = [];
    view.rerender(<TerminalView session={session} area="a" />);
    for (let i = 0; i < 40 && h.frames.size; i++) await frames();
    expect(h.order.indexOf('clearGap')).toBeGreaterThanOrEqual(0);
    expect(h.order.indexOf('clearGap')).toBeLessThan(h.order.indexOf('setVisible(true)', h.order.indexOf('clearGap')));
    expect(written()).not.toContain(GAP_TEXT);
    expect(written().replace(/\r\n/g, '').length).toBeGreaterThan(0);
  });

  it('keeps a marker that was already flushed in scrollback across hide and return', async () => {
    h.shown = true;
    const view = render(<TerminalView session={session} area="a" />);
    await frames(); await frames();
    act(() => h.replayOptions.write('x'.repeat(300000)));
    for (let i = 0; i < 40 && h.frames.size; i++) await frames();
    expect(written().split(GAP_TEXT).length - 1).toBe(1);
    view.rerender(<TerminalView session={session} area={undefined} />);
    await frames();
    view.rerender(<TerminalView session={session} area="a" />);
    for (let i = 0; i < 5 && h.frames.size; i++) await frames();
    expect(written().split(GAP_TEXT).length - 1).toBe(1);
    expect(h.reset).not.toHaveBeenCalled();
  });

  it('does not clear a pending marker when the area changes while already visible', async () => {
    h.shown = true;
    const view = render(<TerminalView session={session} area="a" />);
    for (let i = 0; i < 5 && h.frames.size; i++) await frames();
    expect(h.order.filter((entry) => entry === 'clearGap')).toHaveLength(1);
    h.order = [];
    view.rerender(<TerminalView session={session} area="b" />);
    for (let i = 0; i < 5 && h.frames.size; i++) await frames();
    expect(h.order).not.toContain('clearGap');
  });
});
