import { beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const electron = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), off: vi.fn() }));
vi.mock('electron', () => ({
  ipcRenderer: { invoke: electron.invoke, setMaxListeners: vi.fn(), on: electron.on, off: electron.off },
  contextBridge: { exposeInMainWorld: electron.expose }, webFrame: { getZoomFactor: () => 1 }, webUtils: { getPathForFile: vi.fn() },
}));

async function companion() {
  await import('./preload.js');
  return electron.expose.mock.calls.find(([name]) => name === 'cc')![1].companion;
}

beforeEach(() => {
  electron.invoke.mockReset().mockResolvedValue('ok');
  electron.on.mockReset();
  electron.off.mockReset();
});

it('forwards every Command Center request to its own channel with its arguments', async () => {
  const api = await companion();
  const tip = { label: 'Agents', detail: '1 working', y: 40, panel: 'agents' };
  const calls: Array<[Promise<unknown>, string, unknown[]]> = [
    [api.request(), IPC.companion.request, []],
    [api.enter(), IPC.companion.enter, []],
    [api.exit(), IPC.companion.exit, []],
    [api.openPanel('needs', 'req-1'), IPC.companion.openPanel, ['needs', 'req-1']],
    [api.closePanel(), IPC.companion.closePanel, []],
    [api.panelState(), IPC.companion.panelState, []],
    [api.tooltip(tip), IPC.companion.tooltip, [tip]],
    [api.tooltip(null), IPC.companion.tooltip, [null]],
    [api.tooltipState(), IPC.companion.tooltipState, []],
    [api.dragStart(), IPC.companion.dragStart, []],
    [api.dragEnd(), IPC.companion.dragEnd, []],
    [api.answer('req-1', 'Yes'), IPC.companion.answer, ['req-1', 'Yes']],
    [api.open({ kind: 'agent', id: 's1' }), IPC.companion.open, [{ kind: 'agent', id: 's1' }]],
    [api.runSchedule('task-1'), IPC.companion.runSchedule, ['task-1']]
  ];
  for (const [result, channel, args] of calls) {
    await expect(result).resolves.toBe('ok');
    expect(electron.invoke).toHaveBeenCalledWith(channel, ...args);
  }
  expect(electron.invoke).toHaveBeenCalledTimes(calls.length);
});

it('relays main pushes to subscribers and unsubscribes the same handler', async () => {
  const api = await companion();
  const cases: Array<[(cb: (v?: unknown) => void) => () => void, string, unknown[], unknown[]]> = [
    [api.onSnapshot, IPC.companion.onSnapshot, [{ agents: [] }], [{ agents: [] }]],
    [api.onPanel, IPC.companion.onPanel, [{ kind: 'agents' }], [{ kind: 'agents' }]],
    [api.onPanelClosed, IPC.companion.onPanelClosed, [], []],
    [api.onTooltip, IPC.companion.onTooltip, [null], [null]]
  ];
  for (const [subscribe, channel, payload, expected] of cases) {
    const cb = vi.fn();
    const off = subscribe(cb);
    const [onChannel, handler] = electron.on.mock.calls.at(-1)!;
    expect(onChannel).toBe(channel);
    handler({ sender: 'ignored' }, ...payload);
    expect(cb).toHaveBeenCalledExactlyOnceWith(...expected);
    off();
    expect(electron.off).toHaveBeenLastCalledWith(channel, handler);
  }
});

it('exposes the companion API on the desktop bridge too', async () => {
  await companion();
  const desktop = electron.expose.mock.calls.find(([name]) => name === 'zccDesktop')![1];
  const cc = electron.expose.mock.calls.find(([name]) => name === 'cc')![1];
  expect(desktop.companion).toBe(cc.companion);
});
