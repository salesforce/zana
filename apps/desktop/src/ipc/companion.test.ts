import { beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  companion: null as Record<string, ReturnType<typeof vi.fn>> | null,
  logMainError: vi.fn()
}));
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => fixture.handlers.set(channel, fn) }
}));
vi.mock('./ctx.js', () => ({
  ctx: {
    get companion() {
      return fixture.companion;
    },
    logMainError: fixture.logMainError
  }
}));
vi.mock('../window/renderer-url.js', () => ({ isTrustedRendererUrl: (url: string) => url.startsWith('app://zcc/') }));
import { registerCompanionIpc } from './companion.js';

const OWN = 7;
function event(opts: { id?: number; url?: string; subframe?: boolean } = {}) {
  const mainFrame = {};
  return {
    sender: { id: opts.id ?? OWN, mainFrame, getURL: () => opts.url ?? 'app://zcc/companion.html' },
    senderFrame: opts.subframe ? {} : mainFrame
  };
}
const invoke = (channel: string, ev: unknown, ...args: unknown[]) => fixture.handlers.get(channel)!(ev, ...args);

beforeEach(() => {
  vi.clearAllMocks();
  fixture.handlers.clear();
  fixture.companion = {
    ownsSender: vi.fn((s: { id: number }) => s.id === OWN),
    buildSnapshot: vi.fn(() => ({ requests: [] })),
    exit: vi.fn(),
    openPanel: vi.fn(),
    closePanel: vi.fn(),
    getPanelState: vi.fn(() => ({ kind: 'agents' })),
    tooltip: vi.fn(),
    getTooltip: vi.fn(() => null),
    dragStart: vi.fn(),
    dragEnd: vi.fn(),
    answer: vi.fn(() => ({ ok: true })),
    open: vi.fn(),
    runSchedule: vi.fn(async () => true),
    enter: vi.fn(() => true)
  };
  registerCompanionIpc();
});

it('registers every companion channel and forwards companion-window calls with their args', async () => {
  expect([...fixture.handlers.keys()].sort()).toEqual(Object.values(IPC.companion).filter((ch) => !ch.includes(':on')).sort());
  expect(invoke(IPC.companion.request, event())).toEqual({ requests: [] });
  invoke(IPC.companion.openPanel, event(), 'agents', 'inbox:e1');
  expect(fixture.companion!.openPanel).toHaveBeenCalledWith('agents', 'inbox:e1');
  invoke(IPC.companion.tooltip, event(), { label: 'x' });
  expect(fixture.companion!.tooltip).toHaveBeenCalledWith({ label: 'x' });
  expect(invoke(IPC.companion.answer, event(), 'e1', 'yes')).toEqual({ ok: true });
  expect(fixture.companion!.answer).toHaveBeenCalledWith('e1', 'yes');
  expect(await invoke(IPC.companion.runSchedule, event(), 't1')).toBe(true);
  invoke(IPC.companion.open, event(), { kind: 'session', id: 's1' });
  expect(fixture.companion!.open).toHaveBeenCalledWith({ kind: 'session', id: 's1' });
  for (const ch of [IPC.companion.exit, IPC.companion.closePanel, IPC.companion.dragStart, IPC.companion.dragEnd]) invoke(ch, event());
  expect(fixture.companion!.exit).toHaveBeenCalledOnce();
  expect(invoke(IPC.companion.panelState, event())).toEqual({ kind: 'agents' });
  expect(invoke(IPC.companion.tooltipState, event())).toBeNull();
});

it('returns the fallback to app windows, subframes and untrusted origins', async () => {
  for (const ev of [event({ id: 99 }), event({ subframe: true }), event({ url: 'https://evil.example/' })]) {
    expect(invoke(IPC.companion.request, ev)).toBeNull();
    expect(invoke(IPC.companion.answer, ev, 'e1', 'yes')).toEqual({ ok: false, reason: 'unknown' });
    expect(await invoke(IPC.companion.runSchedule, ev, 't1')).toBe(false);
    expect(invoke(IPC.companion.exit, ev)).toBeUndefined();
  }
  expect(fixture.companion!.answer).not.toHaveBeenCalled();
  expect(fixture.companion!.runSchedule).not.toHaveBeenCalled();
  expect(fixture.companion!.exit).not.toHaveBeenCalled();
});

it('returns the fallback when no controller exists (non-macOS)', () => {
  fixture.companion = null;
  expect(invoke(IPC.companion.request, event())).toBeNull();
  expect(invoke(IPC.companion.enter, event({ id: 99, url: 'app://zcc/index.html' }))).toBe(false);
});

it('forwards the asynchronous scheduler refusal', async () => {
  fixture.companion!.runSchedule.mockResolvedValueOnce(false);
  expect(await invoke(IPC.companion.runSchedule, event(), 't1')).toBe(false);
  expect(fixture.companion!.runSchedule).toHaveBeenCalledWith('t1');
  fixture.companion = null;
  expect(await invoke(IPC.companion.runSchedule, event(), 't1')).toBe(false);
});

it('logs a throwing handler and answers with the fallback', () => {
  const boom = new Error('boom');
  fixture.companion!.answer.mockImplementation(() => {
    throw boom;
  });
  fixture.companion!.enter.mockImplementation(() => {
    throw boom;
  });
  expect(invoke(IPC.companion.answer, event(), 'e1', 'x')).toEqual({ ok: false, reason: 'unknown' });
  expect(fixture.logMainError).toHaveBeenCalledWith(`ipc ${IPC.companion.answer}`, boom);
  expect(invoke(IPC.companion.enter, event({ id: 99 }))).toBe(false);
  expect(fixture.logMainError).toHaveBeenCalledWith(`ipc ${IPC.companion.enter}`, boom);
});

it('lets any trusted app frame enter, but never a subframe or foreign origin', () => {
  expect(invoke(IPC.companion.enter, event({ id: 99, url: 'app://zcc/index.html' }))).toBe(true);
  expect(invoke(IPC.companion.enter, event({ id: 99, subframe: true }))).toBe(false);
  expect(invoke(IPC.companion.enter, event({ id: 99, url: 'https://evil.example/' }))).toBe(false);
  expect(fixture.companion!.enter).toHaveBeenCalledOnce();
});
