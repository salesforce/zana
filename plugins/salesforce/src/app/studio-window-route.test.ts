import { describe, expect, it, vi } from 'vitest';
import { openAgentInStudioWindow, openInStudioWindow, STUDIO_ACK_WAIT_MS, STUDIO_TAB_ID, studioAgentResource } from './studio-window-route.js';

const studio = { id: 'studio', surface: 'workbench', window: 'plugin-view', commands: ['state', 'view.open'], state: { resourceId: 'a/Help.agent' } };
const acked = { ok: true, state: 'completed' };
function setup(views: unknown, sent: unknown = { ok: true, commandId: 'c' }, result: unknown = acked) {
  const call = vi.fn(async (_plugin: string, method: string) => method === 'control.views' ? views : method === 'control.result' ? result : sent);
  const navigate = { openInWindow: vi.fn(async () => true) };
  return { call, navigate, open: (extra: { line?: number } = {}) => openInStudioWindow({ pluginId: 'salesforce', projectId: 'p', path: 'a/Help.agent', ...extra, navigate, call: call as never }) };
}

describe('studioAgentResource', () => {
  it('normalizes relative AgentScript identity and refuses invalid or ambiguous paths', () => {
    expect(studioAgentResource('./a//Help.agent')).toBe('a/Help.agent');
    expect(studioAgentResource('a\\Help.agent')).toBe('a/Help.agent');
    expect(studioAgentResource('a/Help.afscript')).toBe('a/Help.afscript');
    for (const path of [null, '', '/a.agent', 'C:/a.agent', '../a.agent', 'a/../b.agent', 'a.txt', 'a\0.agent', 'a'.repeat(501)]) expect(studioAgentResource(path)).toBeNull();
  });
});

describe('openInStudioWindow', () => {
  it('routes by resource identity, never to the first Studio in the project', async () => {
    const other = { ...studio, id: 'other', state: { resourceId: 'a/Other.agent' } };
    const { call, open } = setup({ ok: true, views: [other, studio] });
    await expect(open()).resolves.toBe(true);
    expect(call).toHaveBeenCalledWith('salesforce', 'control.command', expect.objectContaining({ viewId: 'studio' }));
    await expect(setup({ ok: true, views: [other, { ...studio, state: {} }] }).open()).resolves.toBe(false);
  });
  it('does not call the host or list views for an invalid path', async () => {
    const call = vi.fn(); const navigate = { openInWindow: vi.fn() };
    await expect(openAgentInStudioWindow({ pluginId: 'salesforce', projectId: 'p', path: '../bad.agent', call: call as never, navigate: navigate as never })).resolves.toBe(false);
    expect(call).not.toHaveBeenCalled(); expect(navigate.openInWindow).not.toHaveBeenCalled();
  });
  it('sends the open to the Studio window lease and brings that window forward', async () => {
    const main = { id: 'main', surface: 'workbench', window: 'main', commands: ['view.open'] };
    const { call, navigate, open } = setup({ ok: true, views: [main, studio] });
    await expect(open({ line: 12.7 })).resolves.toBe(true);
    expect(call).toHaveBeenCalledWith('salesforce', 'control.views', { projectId: 'p' });
    expect(call).toHaveBeenCalledWith('salesforce', 'control.command', { projectId: 'p', viewId: 'studio', command: 'view.open', input: { view: 'agentforce', path: 'a/Help.agent', line: 12 } });
    expect(call).toHaveBeenCalledWith('salesforce', 'control.result', { projectId: 'p', commandId: 'c', waitMs: STUDIO_ACK_WAIT_MS });
    expect(navigate.openInWindow).toHaveBeenCalledWith('p', { tabId: STUDIO_TAB_ID, resourceId: 'a/Help.agent' });
    await open({ line: 0 });
    expect([...call.mock.calls].reverse().find(([, method]) => method === 'control.command')![2]).toMatchObject({ input: { view: 'agentforce', path: 'a/Help.agent' } });
  });
  it('leaves the open to the caller without a live Studio window lease', async () => {
    for (const views of [null, { ok: false }, { ok: true, views: 'x' }, { ok: true, views: [] },
      { ok: true, views: [{ ...studio, window: 'main' }] }, { ok: true, views: [{ ...studio, surface: 'agentforce' }] },
      { ok: true, views: [{ ...studio, commands: ['state'] }] }, { ok: true, views: [{ ...studio, commands: 'view.open' }] },
      { ok: true, views: [{ ...studio, id: 4 }] }]) {
      const { call, navigate, open } = setup(views);
      await expect(open()).resolves.toBe(false);
      expect(call).not.toHaveBeenCalledWith('salesforce', 'control.command', expect.anything());
      expect(navigate.openInWindow).not.toHaveBeenCalled();
    }
  });
  it('falls back when the command is refused or the RPC throws', async () => {
    const refused = setup({ ok: true, views: [studio] }, { ok: false, error: 'busy' });
    await expect(refused.open()).resolves.toBe(false);
    expect(refused.navigate.openInWindow).not.toHaveBeenCalled();
    await expect(setup({ ok: true, views: [studio] }, { ok: true }).open()).resolves.toBe(false);
    const broken = setup({ ok: true, views: [studio] });
    broken.call.mockRejectedValueOnce(new Error('offline'));
    await expect(broken.open()).resolves.toBe(false);
  });
  it('falls back when a window that just closed never acknowledges, or the window refuses', async () => {
    for (const result of [{ ok: true, state: 'pending' }, { ok: false, state: 'failed', error: 'The view did not acknowledge this command. It may have closed.' },
      { ok: false, state: 'completed', error: 'Provide an agent path for the agentforce view.' }, null]) {
      const { navigate, open } = setup({ ok: true, views: [studio] }, undefined, result);
      await expect(open()).resolves.toBe(false);
      expect(navigate.openInWindow).not.toHaveBeenCalled();
    }
  });
  it('still reports the routed open on hosts without openInWindow', async () => {
    const call = vi.fn(async (_plugin: string, method: string) => method === 'control.views' ? { ok: true, views: [studio] } : method === 'control.result' ? acked : { ok: true, commandId: 'c' });
    await expect(openInStudioWindow({ pluginId: 'salesforce', projectId: 'p', path: 'a/Help.agent', navigate: {}, call: call as never })).resolves.toBe(true);
  });
});

describe('openAgentInStudioWindow', () => {
  const sleep = vi.fn(async () => undefined);
  const run = (call: ReturnType<typeof vi.fn>, navigate: { openInWindow?: ReturnType<typeof vi.fn> }) =>
    openAgentInStudioWindow({ pluginId: 'salesforce', projectId: 'p', path: 'a/Help.agent', navigate: navigate as never, call: call as never, startMs: 2000, pollMs: 500, sleep });

  it('uses a running Studio window without opening another', async () => {
    const { call, navigate } = setup({ ok: true, views: [studio] });
    await expect(run(call, navigate)).resolves.toBe(true);
    expect(navigate.openInWindow).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('salesforce', 'control.command', expect.objectContaining({ viewId: 'studio' }));
  });

  it('opens the window, then sends the agent once its lease appears', async () => {
    let polls = 0;
    const call = vi.fn(async (_plugin: string, method: string) => {
      if (method === 'control.views') return { ok: true, views: ++polls >= 3 ? [studio] : [] };
      return method === 'control.result' ? acked : { ok: true, commandId: 'c' };
    });
    const navigate = { openInWindow: vi.fn(async () => true) };
    await expect(run(call, navigate)).resolves.toBe(true);
    expect(navigate.openInWindow).toHaveBeenNthCalledWith(1, 'p', { tabId: STUDIO_TAB_ID, resourceId: 'a/Help.agent' });
    expect(call).toHaveBeenCalledWith('salesforce', 'control.command', expect.objectContaining({ input: { view: 'agentforce', path: 'a/Help.agent' } }));
    expect(polls).toBe(3);
  });

  it('gives up when the window never takes a lease in time', async () => {
    const { call, navigate } = setup({ ok: true, views: [] });
    await expect(run(call, navigate)).resolves.toBe(false);
    expect(call.mock.calls.filter(([, method]) => method === 'control.views')).toHaveLength(5);
  });

  it('reports false when the host cannot open a window', async () => {
    const { call } = setup({ ok: true, views: [] });
    await expect(run(call, {})).resolves.toBe(false);
    await expect(run(call, { openInWindow: vi.fn(async () => false) })).resolves.toBe(false);
  });

  it('waits with real timers by default', async () => {
    vi.useFakeTimers();
    try {
      const { call, navigate } = setup({ ok: true, views: [] });
      const done = openAgentInStudioWindow({ pluginId: 'salesforce', projectId: 'p', path: 'a/Help.agent', navigate, call: call as never, startMs: 500 });
      await vi.advanceTimersByTimeAsync(500);
      await expect(done).resolves.toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
