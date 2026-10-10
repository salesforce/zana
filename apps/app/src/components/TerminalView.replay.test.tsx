// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({
  frames: new Map<number, FrameRequestCallback>(), nextFrame: 0,
  reconnect: null as null | (() => void), streams: vi.fn(async (_id: string) => true),
  write: vi.fn(), stall: false, reset: vi.fn(), scrollToBottom: vi.fn(), scrollToLine: vi.fn(), selected: false,
  active: { viewportY: 0, baseY: 0 }, snapshot: vi.fn(),
  data: { fontSize: 14, theme: 'dark', terminalTheme: 'auto', terminalWheelArrowsEnabled: true, projects: [] },
  ui: { agentModal: null, pushToast: vi.fn() }
}));
vi.mock('../store.js', () => ({
  useData: Object.assign((pick: (s: typeof h.data) => unknown) => pick(h.data), { getState: () => h.data }),
  useUi: Object.assign((pick: (s: typeof h.ui) => unknown) => pick(h.ui), { getState: () => h.ui })
}));
vi.mock('../lib/product-client.js', () => ({ product: { terminals: {
  resize: vi.fn().mockResolvedValue(undefined), onData: () => () => {}, onExit: () => () => {}, write: vi.fn(),
  backlog: vi.fn(), backlogSnapshot: (...args: unknown[]) => h.snapshot(...args),
  streamsOverProductSocket: (id: string) => h.streams(id)
} } }));
vi.mock('../lib/product-ws.js', () => ({ subscribeProductReconnect: (fn: () => void) => { h.reconnect = fn; return () => { h.reconnect = null; }; } }));
vi.mock('../hooks/useFileDrop.js', () => ({ useFileDrop: () => ({ dropOver: false, dropHandlers: {} }) }));
vi.mock('../lib/osc52-clipboard.js', () => ({ registerOsc52Clipboard: () => ({ dispose: vi.fn() }) }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options: Record<string, unknown>; constructor(options: Record<string, unknown>) { this.options = options; }
  cols = 80; rows = 24; buffer = { active: h.active }; parser = {};
  open() {} loadAddon() {} refresh() {} focus() {} dispose() {} resize() {} fit() {}
  scrollToBottom() { h.scrollToBottom(); } scrollToLine(line: number) { h.scrollToLine(line); }
  hasSelection() { return h.selected; }
  write(data: string, done: () => void) { h.write(data); if (!h.stall) done(); }
  reset() { h.reset(); }
  onScroll() { return { dispose() {} }; } onData() { return { dispose() {} }; }
  attachCustomKeyEventHandler() {} attachCustomWheelEventHandler() {}
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss() { return { dispose() {} }; } dispose() {} } }));

import { TerminalView } from './TerminalView.js';

const session = { id: 's1', projectId: 'p1', profile: 'shell' } as TerminalSession;
const snap = (text: string, startOffset: number) => ({ text, startOffset, endOffset: startOffset + text.length });
async function frames() {
  await act(async () => {
    const batch = [...h.frames.values()]; h.frames.clear(); batch.forEach(cb => cb(0));
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function mount() {
  const view = render(<TerminalView session={session} area="a" />);
  await frames(); await frames();
  return view;
}
async function reconnect() {
  await act(async () => { h.reconnect!(); await vi.advanceTimersByTimeAsync(0); });
  await frames(); await frames();
}

beforeEach(() => {
  vi.useFakeTimers();
  h.frames.clear(); h.nextFrame = 0; h.selected = false; h.stall = false; h.active.viewportY = h.active.baseY = 0; h.reconnect = null;
  vi.clearAllMocks();
  vi.stubGlobal('cc', {}); // desktop bridge present, so the routing decision is consulted
  h.streams.mockResolvedValue(true);
  h.snapshot.mockResolvedValueOnce(snap('abc', 0));
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(() => document.body);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => 600);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = ++h.nextFrame; h.frames.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => h.frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); Reflect.deleteProperty(document, 'fonts'); });

describe('terminal product reset replay', () => {
  it('ignores a product reset for a session that streams over the desktop bridge', async () => {
    h.streams.mockResolvedValue(false);
    await mount(); h.snapshot.mockClear();
    await reconnect();
    expect(h.streams).toHaveBeenCalledWith('s1'); expect(h.snapshot).not.toHaveBeenCalled(); expect(h.reset).not.toHaveBeenCalled();
  });

  it('replays a host session without clearing when nothing was missed (case a)', async () => {
    await mount(); h.snapshot.mockResolvedValue(snap('abc', 0));
    await reconnect();
    expect(h.snapshot).toHaveBeenCalledTimes(2); expect(h.reset).not.toHaveBeenCalled();
    expect(h.write.mock.calls.map(([d]) => d)).toEqual(['abc']);
  });

  it('appends only missed output without clearing (case b)', async () => {
    await mount(); h.snapshot.mockResolvedValue(snap('bcdef', 1));
    await reconnect();
    expect(h.reset).not.toHaveBeenCalled(); expect(h.write.mock.calls.map(([d]) => d)).toEqual(['abc', 'def']);
  });

  it('hides the host during a redraw, then restores distance from the bottom when not following', async () => {
    const view = await mount();
    h.active.baseY = 50; h.active.viewportY = 40; h.scrollToBottom.mockClear();
    h.snapshot.mockResolvedValue(snap('xyz', 100));
    const hosts = [...view.container.querySelectorAll('div')] as HTMLElement[];
    await reconnect();
    expect(h.reset).toHaveBeenCalledOnce();
    expect(h.scrollToLine).toHaveBeenCalledWith(40); expect(h.scrollToBottom).not.toHaveBeenCalled();
    expect(hosts.every(el => el.style.opacity !== '0')).toBe(true);
  });

  it('follows the bottom after a redraw when the user was at the bottom', async () => {
    await mount();
    h.active.baseY = 50; h.active.viewportY = 50; h.scrollToLine.mockClear();
    h.snapshot.mockResolvedValue(snap('xyz', 100));
    await reconnect();
    expect(h.reset).toHaveBeenCalledOnce(); expect(h.scrollToBottom).toHaveBeenCalled(); expect(h.scrollToLine).not.toHaveBeenCalled();
  });

  it('never scrolls after a redraw while text is selected', async () => {
    await mount();
    h.active.baseY = 50; h.active.viewportY = 40; h.selected = true;
    h.scrollToBottom.mockClear(); h.scrollToLine.mockClear();
    h.snapshot.mockResolvedValue(snap('xyz', 100));
    await reconnect();
    expect(h.reset).toHaveBeenCalledOnce(); expect(h.scrollToLine).not.toHaveBeenCalled(); expect(h.scrollToBottom).not.toHaveBeenCalled();
  });

  it('reveals the host after the 1000 ms cap even if the rewrite never lands', async () => {
    const view = await mount();
    h.snapshot.mockResolvedValue(snap('xyz', 100));
    const hidden = () => [...view.container.querySelectorAll('div')].some(el => (el as HTMLElement).style.opacity === '0');
    h.stall = true; // the parser never completes, so follow() never sees an idle queue
    await act(async () => { h.reconnect!(); await vi.advanceTimersByTimeAsync(0); });
    await frames();
    expect(hidden()).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(hidden()).toBe(false);
    view.unmount();
  });
});
