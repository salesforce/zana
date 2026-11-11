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
  onScroll() { return { dispose() {} }; } onData() { return { dispose() {} }; } onSelectionChange() { return { dispose() {} }; }
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
  h.shown = false; h.frames.clear(); h.nextFrame = 0;
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

describe('terminal resize visibility', () => {
  it('releases hidden GPU surfaces and changes history allocation without recreating the terminal', async () => {
    const slot = render(<TerminalView session={session} area={undefined} scrollbackLimit={50000} />);
    await frames(); expect(h.gpuCreated).not.toHaveBeenCalled();
    h.shown = true;
    slot.rerender(<TerminalView session={session} area="a" scrollbackLimit={12500} />);
    await frames(); expect(h.gpuCreated).toHaveBeenCalledTimes(1); expect(h.options.scrollback).toBe(12500);
    slot.rerender(<TerminalView session={session} area={undefined} scrollbackLimit={3125} />);
    expect(h.gpuDisposed).toHaveBeenCalledTimes(1); expect(h.options.scrollback).toBe(3125);
    expect(h.constructed).toHaveBeenCalledTimes(1);
    slot.rerender(<TerminalView session={session} area="a" scrollbackLimit={3125} />);
    await frames(); expect(h.gpuCreated).toHaveBeenCalledTimes(2);
    h.shown = false; observe(0,0); expect(h.gpuDisposed).toHaveBeenCalledTimes(2);
    slot.unmount(); expect(h.gpuDisposed).toHaveBeenCalledTimes(2);
  });
  it('does not fit or nudge a selected terminal parked under a hidden ancestor', async () => {
    render(<TerminalView session={session} area="a" />);
    observe(800,600);
    await frames(); await frames();
    expect(h.gpuCreated).not.toHaveBeenCalled();
    expect(h.fit).not.toHaveBeenCalled();
    expect(h.resize).not.toHaveBeenCalled();
    expect(h.resizePty).not.toHaveBeenCalled();
  });

  it('skips a pending observer fit when navigation hides the host before the frame', async () => {
    render(<TerminalView session={session} area={undefined} />);
    await frames();
    h.shown = true;
    observe(800, 600);
    h.shown = false;
    await frames();
    expect(h.fit).not.toHaveBeenCalled();
    expect(h.resizePty).not.toHaveBeenCalled();
  });

  it('cancels hidden observer work and refits when shown again at the same size', async () => {
    render(<TerminalView session={session} area={undefined} />);
    await frames();
    h.shown = true; observe(800, 600); await frames();
    expect(h.fit).toHaveBeenCalledTimes(1);
    observe(810, 600);
    h.shown = false; observe(0, 0); await frames();
    await act(async () => vi.advanceTimersByTime(100));
    expect(h.fit).toHaveBeenCalledTimes(1);
    h.shown = true; observe(810, 600); await frames();
    expect(h.fit).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(100));
    expect(h.resize).toHaveBeenCalledWith(80, 23);
    await frames();
    expect(h.resizePty).toHaveBeenLastCalledWith('s1', 80, 24);
  });

  it('defers font and modal resizes while hidden, then resyncs when visible', async () => {
    const view = render(<TerminalView session={session} area={undefined} />);
    await frames();
    h.data.fontSize = 16; h.ui.agentModal = { sessionId: 's1' };
    view.rerender(<TerminalView session={session} area="a" />);
    await frames();
    expect(h.fit).not.toHaveBeenCalled();
    h.shown = true;
    view.rerender(<TerminalView session={session} area="b" />);
    await frames(); await frames();
    expect(h.fit).toHaveBeenCalledTimes(1);
    expect(h.resizePty).toHaveBeenLastCalledWith('s1', 80, 24);
  });
});

it('wires bounded replay writes, reset, selection-safe following and terminal exit reasons', async () => {
  h.shown = true;
  const view = render(<TerminalView session={session} area="a" />); await frames(); await frames();
  const signal = new AbortController().signal;
  await h.replayRead(signal); expect(h.snapshot).toHaveBeenCalledWith('s1', signal);
  act(() => h.replayOptions.write('stream')); await frames();
  expect(h.write).toHaveBeenCalledWith('stream'); expect(h.scroll).toHaveBeenCalled();
  h.scroll.mockClear(); h.selected = true;
  act(() => h.replayOptions.write('selected')); await frames();
  expect(h.scroll).not.toHaveBeenCalled();
  h.selected = false; h.active.viewportY = 0; h.active.baseY = 1;
  act(() => h.replayOptions.write('scrolled')); await frames();
  expect(h.scroll).not.toHaveBeenCalled();
  await act(async () => { h.replayOptions.reset(); await vi.advanceTimersByTimeAsync(0); }); expect(h.reset).toHaveBeenCalled();
  await act(async () => {
    h.exit('other', 1); h.exit('s1', 9, 'overflow'); h.exit('s1', 1); h.exit('s1', 0);
    await vi.advanceTimersByTimeAsync(0);
  });
  await frames();
  expect(h.write.mock.calls.map(([data]) => data).join('')).toContain('overflow');
  expect(h.write.mock.calls.map(([data]) => data).join('')).toContain('[exited code 1]');
  expect(h.write.mock.calls.map(([data]) => data).join('')).toContain('[session exited]');
  view.unmount(); h.replayOptions.follow();
});
