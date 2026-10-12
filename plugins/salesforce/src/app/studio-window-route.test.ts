import { describe, expect, it, vi } from 'vitest';
import { openInStudioWindow, STUDIO_ACK_WAIT_MS, STUDIO_TAB_ID } from './studio-window-route.js';

const studio = { id: 'studio', surface: 'workbench', window: 'plugin-view', commands: ['state', 'view.open'] };
const acked = { ok: true, state: 'completed' };
function setup(views: unknown, sent: unknown = { ok: true, commandId: 'c' }, result: unknown = acked) {
  const call = vi.fn(async (_plugin: string, method: string) => method === 'control.views' ? views : method === 'control.result' ? result : sent);
  const navigate = { openInWindow: vi.fn(async () => true) };
  return { call, navigate, open: (extra: { line?: number } = {}) => openInStudioWindow({ pluginId: 'salesforce', projectId: 'p', path: 'a/Help.agent', ...extra, navigate, call: call as never }) };
}

describe('openInStudioWindow', () => {
  it('sends the open to the Studio window lease and brings that window forward', async () => {
    const main = { id: 'main', surface: 'workbench', window: 'main', commands: ['view.open'] };
    const { call, navigate, open } = setup({ ok: true, views: [main, studio] });
    await expect(open({ line: 12.7 })).resolves.toBe(true);
    expect(call).toHaveBeenCalledWith('salesforce', 'control.views', { projectId: 'p' });
    expect(call).toHaveBeenCalledWith('salesforce', 'control.command', { projectId: 'p', viewId: 'studio', command: 'view.open', input: { view: 'agentforce', path: 'a/Help.agent', line: 12 } });
    expect(call).toHaveBeenCalledWith('salesforce', 'control.result', { projectId: 'p', commandId: 'c', waitMs: STUDIO_ACK_WAIT_MS });
    expect(navigate.openInWindow).toHaveBeenCalledWith('p', { tabId: STUDIO_TAB_ID });
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
    await expect(openInStudioWindow({ pluginId: 'salesforce', projectId: 'p', path: 'x.agent', navigate: {}, call: call as never })).resolves.toBe(true);
  });
});
