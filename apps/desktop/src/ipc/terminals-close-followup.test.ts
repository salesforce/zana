import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, { handler: (...args: any[]) => any; fallback?: (...args: any[]) => any }>();
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() }, app: { getPath: () => '/tmp' } }));
vi.mock('./shared-product-registration.js', () => ({
  productHandle: (channel: string, handler: (...args: any[]) => any) => { handlers.set(channel, { handler }); },
  safeProductHandle: (channel: string, handler: (...args: any[]) => any, fallback?: (...args: any[]) => any) => {
    handlers.set(channel, { handler, fallback });
  }
}));
const config: { closeWrapUpEnabled?: boolean } = {};
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => [], getConfig: () => config } }));
vi.mock('@zana-ai/zcc-host-daemon/tmux', () => ({ listLocalTmuxSessionIds: vi.fn(), verifyTmux: vi.fn() }));
vi.mock('@zana-ai/zcc-host-daemon/remembered-sessions', () => ({ listRememberedTombstones: vi.fn() }));
vi.mock('@zana-ai/zcc-host-daemon/harness/cli-plan-watch', () => ({ CliPlanWatcher: class { onSessionExit() {} } }));

import { IPC } from '@zana-ai/zcc-desktop-contract';
import { bindIpcCtx } from './ctx.js';
import { registerTerminalsIpc } from './terminals.js';

const closeSummary = { summarizeAndFollowUp: vi.fn(async () => ({ summarized: 1, followedUp: 1 })) };
const wrapUpClose = { run: vi.fn(async () => ({ summarized: 2, followedUp: 0, keptOpen: [{ sessionId: 'a', reason: 'asks-you' }] })) };

describe('terminals closeFollowup handler', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    delete config.closeWrapUpEnabled;
    bindIpcCtx({ ptys: { on: vi.fn() }, safeSend: vi.fn(), closeSummary, wrapUpClose } as never);
    registerTerminalsIpc();
  });

  it('uses today\'s summary when the wrap-up experiment is off or absent', async () => {
    const { handler } = handlers.get(IPC.terminals.closeFollowup)!;
    expect(await handler('p', ['a'])).toEqual({ summarized: 1, followedUp: 1 });
    config.closeWrapUpEnabled = false;
    await handler('p', ['a']);
    expect(closeSummary.summarizeAndFollowUp).toHaveBeenCalledTimes(2);
    expect(closeSummary.summarizeAndFollowUp).toHaveBeenCalledWith('p', ['a']);
    expect(wrapUpClose.run).not.toHaveBeenCalled();
  });

  it('runs the wrap-up and returns its result as is when the experiment is on', async () => {
    config.closeWrapUpEnabled = true;
    const { handler } = handlers.get(IPC.terminals.closeFollowup)!;
    expect(await handler('p', ['a', 'b'])).toEqual({ summarized: 2, followedUp: 0, keptOpen: [{ sessionId: 'a', reason: 'asks-you' }] });
    expect(wrapUpClose.run).toHaveBeenCalledWith('p', ['a', 'b']);
    expect(closeSummary.summarizeAndFollowUp).not.toHaveBeenCalled();
  });

  it('falls back to closing everything, with no keptOpen, when the handler throws', () => {
    const { fallback } = handlers.get(IPC.terminals.closeFollowup)!;
    expect(fallback!()).toEqual({ summarized: 0, followedUp: 0 });
  });
});
