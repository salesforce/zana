// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  shown: true,
  frames: new Map<number, FrameRequestCallback>(),
  nextFrame: 0,
  clears: {} as Record<string, ReturnType<typeof vi.fn>>,
  textareas: [] as HTMLTextAreaElement[],
  data: {
    fontSize: 14, theme: 'dark', terminalTheme: 'auto', terminalWheelArrowsEnabled: true, projects: [],
    terminals: {} as Record<string, Array<{ id: string; projectId: string; profile: string }>>
  },
  ui: {
    nav: 'projects', selectedProjectId: 'p', selectedTabId: { p: 's0' } as Record<string, string>,
    splitLayout: {} as Record<string, string>, splitTabIds: {} as Record<string, string[]>,
    agentModal: null as { sessionId: string; projectId: string } | null,
    agentMonitor: null as { sessionId: string; projectId: string } | null,
    threadPanelTerminal: null as { sessionId: string; projectId: string } | null,
    pushToast: vi.fn()
  }
}));
vi.mock('../store.js', () => ({
  useData: Object.assign((pick: (s: typeof h.data) => unknown) => pick(h.data), { getState: () => h.data }),
  useUi: Object.assign((pick: (s: typeof h.ui) => unknown) => pick(h.ui), { getState: () => h.ui })
}));
vi.mock('../lib/split-layout/store.js', () => ({ useSplitWorkspace: (pick: (s: unknown) => unknown) => pick({ layout: null }) }));
vi.mock('../lib/split-layout/agentSessionPortal.js', () => ({
  pickAgentSessionPortalTarget: () => null, pickProjectTerminalsPortalTarget: () => null,
  agentSessionAnchorId: () => '', projectTerminalsAnchorId: () => ''
}));
vi.mock('../lib/findRegistry.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/findRegistry.js')>('../lib/findRegistry.js');
  return {
    ...actual,
    registerTerminal: (id: string, handle: { clear: () => void }) => {
      const spy = vi.fn(() => handle.clear());
      h.clears[id] = spy;
      return actual.registerTerminal(id, { ...handle, clear: spy });
    }
  };
});
vi.mock('../lib/product-client.js', () => ({ product: { terminals: {
  resize: vi.fn().mockResolvedValue(undefined), onData: () => () => {}, onExit: () => () => {}, write: vi.fn(),
  backlog: vi.fn(async () => ''), backlogSnapshot: vi.fn(async () => ({ text: '', startOffset: 0, endOffset: 0 }))
} } }));
vi.mock('../lib/product-ws.js', () => ({ subscribeProductReconnect: () => () => {} }));
vi.mock('../lib/terminal-replay.js', () => ({ createTerminalReplay: () => ({ replay: vi.fn(), dispose: vi.fn() }) }));
vi.mock('../hooks/useFileDrop.js', () => ({ useFileDrop: () => ({ dropOver: false, dropHandlers: {} }) }));
vi.mock('../lib/osc52-clipboard.js', () => ({ registerOsc52Clipboard: () => ({ dispose: vi.fn() }) }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80; rows = 24; options: Record<string, unknown>;
  buffer = { active: { viewportY: 0, baseY: 0 } }; parser = {};
  textarea = (() => { const t = document.createElement('textarea'); h.textareas.push(t); return t; })();
  constructor(options: Record<string, unknown>) { this.options = options; }
  resize() {} open() {} loadAddon() {} refresh() {} scrollToBottom() {} focus() {} dispose() {} clear() {}
  hasSelection() { return false; }
  write(_d: string, done?: () => void) { done?.(); }
  reset() {}
  onScroll() { return { dispose() {} }; } onData() { return { dispose() {} }; }
  attachCustomKeyEventHandler() {} attachCustomWheelEventHandler() {}
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss() { return { dispose() {} }; } dispose() {} } }));

import { AGENT_MODAL_TERMINAL_ANCHOR_ID, AGENT_MONITOR_TERMINAL_ANCHOR_ID, PROJECTS_TERMINAL_ANCHOR_ID, TerminalSurface } from './TerminalSurface.js';
import { getActiveTerminalId, getTerminal } from '../lib/findRegistry.js';

const fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
const ids = ['s0', 's1', 's2', 'm1'];

async function frames() {
  await act(async () => {
    for (let i = 0; i < 40 && h.frames.size; i++) {
      const batch = [...h.frames.values()];
      h.frames.clear();
      batch.forEach((cb) => cb(0));
    }
  });
}
const tree = () => (
  <MemoryRouter initialEntries={['/']}>
    <div id={PROJECTS_TERMINAL_ANCHOR_ID} />
    {h.ui.agentModal && <div id={AGENT_MODAL_TERMINAL_ANCHOR_ID} />}
    {h.ui.agentMonitor && <div id={AGENT_MONITOR_TERMINAL_ANCHOR_ID} />}
    <TerminalSurface />
  </MemoryRouter>
);
async function mount() {
  const view = render(tree());
  await frames();
  return { view, update: async () => { view.rerender(tree()); await frames(); } };
}
/** Cmd+K target resolution, exactly as shortcuts.ts does it. */
function cmdK() {
  const target = getActiveTerminalId();
  if (!target) return;
  getTerminal(target)?.clear();
}
const cleared = () => ids.filter((id) => h.clears[id]?.mock.calls.length);
/** Focus the xterm textarea belonging to `id` (textareas are created in mount order of sessions). */
function focus(id: string) {
  const textarea = h.textareas[ids.indexOf(id)];
  act(() => { textarea.dispatchEvent(new Event('focus')); });
}

beforeEach(() => {
  h.shown = true; h.frames.clear(); h.nextFrame = 0; h.clears = {}; h.textareas = [];
  h.data.terminals = {
    p: ['s0', 's1', 's2'].map((id) => ({ id, projectId: 'p', profile: 'shell' })),
    q: [{ id: 'm1', projectId: 'q', profile: 'shell' }]
  };
  Object.assign(h.ui, {
    nav: 'projects', selectedProjectId: 'p', selectedTabId: { p: 's0' }, splitLayout: {}, splitTabIds: {},
    agentModal: null, agentMonitor: null, threadPanelTerminal: null
  });
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(() => document.body);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => 600);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = ++h.nextFrame; h.frames.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => h.frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (fontsDescriptor) Object.defineProperty(document, 'fonts', fontsDescriptor);
  else Reflect.deleteProperty(document, 'fonts');
});

describe('Cmd+K targets the terminal the user is looking at', () => {
  it('clears the selected project tab', async () => {
    await mount();
    expect(getActiveTerminalId()).toBe('s0');
    cmdK();
    expect(cleared()).toEqual(['s0']);
  });

  it('clears the modal session, not the project tab underneath, and returns when it closes', async () => {
    const { update } = await mount();
    h.ui.agentModal = { sessionId: 'm1', projectId: 'q' };
    await update();
    expect(getActiveTerminalId()).toBe('m1');
    cmdK();
    expect(cleared()).toEqual(['m1']);
    h.ui.agentModal = null;
    await update();
    expect(getActiveTerminalId()).toBe('s0');
    cmdK();
    expect(h.clears.s0).toHaveBeenCalledTimes(1);
    expect(h.clears.m1).toHaveBeenCalledTimes(1);
  });

  it('clears the list monitor session only', async () => {
    const { update } = await mount();
    h.ui.agentMonitor = { sessionId: 'm1', projectId: 'q' };
    await update();
    expect(getActiveTerminalId()).toBe('m1');
    cmdK();
    expect(cleared()).toEqual(['m1']);
  });

  it('targets the area-a pane, then a focused area-b pane, each exclusively', async () => {
    h.ui.splitLayout = { p: 'cols' };
    h.ui.splitTabIds = { p: ['s0', 's1'] };
    const { update } = await mount();
    expect(getActiveTerminalId()).toBe('s0');
    cmdK();
    expect(cleared()).toEqual(['s0']);

    focus('s1');
    expect(getActiveTerminalId()).toBe('s1');
    cmdK();
    expect(h.clears.s0).toHaveBeenCalledTimes(1);
    expect(h.clears.s1).toHaveBeenCalledTimes(1);
    expect(h.clears.s2).not.toHaveBeenCalled();

    focus('s0');
    expect(getActiveTerminalId()).toBe('s0');
    cmdK();
    expect(h.clears.s0).toHaveBeenCalledTimes(2);
    expect(h.clears.s1).toHaveBeenCalledTimes(1);
    await update();
  });
});
