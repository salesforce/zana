import { describe, expect, it, vi } from 'vitest';
import { createPluginApprovalVerifier } from '@zana-ai/zcc-server/http/plugin-approval-proof';
import type { ApprovalSheetOutcome } from '../window/approval-sheet.js';
import { createPluginApprovalHandler, type PluginApprovalDeps } from './plugin-approvals.js';

const secret = 'desktop-only-boot-secret-of-at-least-32-bytes';
const now = 1_800_000_000_000;
const binding = { action: 'agent.publish', target: '00D000000000001', targetLabel: 'agentaidev (sandbox)', subject: 'Help_Agent', revision: 'f'.repeat(64) };
const request = { pluginId: 'salesforce', binding, title: 'Publish Help_Agent' };
const app = { id: 'salesforce', name: 'Salesforce', enabled: true, status: 'running' };
const win = (id = 1, destroyed = false) => ({ id, isDestroyed: () => destroyed });

function handler(overrides: Partial<PluginApprovalDeps> = {}, outcome: ApprovalSheetOutcome = { kind: 'approved', typed: '' }) {
  const showSheet = vi.fn(async () => outcome);
  const deps: PluginApprovalDeps = { secret: () => secret, listApps: async () => [app], showSheet, now: () => now, ...overrides };
  return { handle: createPluginApprovalHandler(deps), showSheet };
}

describe('pluginApprovals:request', () => {
  it('signs exactly the binding main showed, for that plugin', async () => {
    const { handle, showSheet } = handler();
    const result = await handle(win(), { ...request, binding: { ...binding, subject: '  Help_Agent ' } });
    expect(showSheet).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), { pluginName: 'Salesforce', request: { binding, title: 'Publish Help_Agent' } });
    expect(result).toEqual({ approved: true, token: expect.any(String), expiresAt: now + 5 * 60_000 });
    if (!result.approved) throw new Error('expected approval');
    const verify = createPluginApprovalVerifier(secret, () => now);
    expect(verify(result.token, 'other', binding)).toBe(false);
    expect(verify(result.token, 'salesforce', binding)).toBe(true);
  });

  it('refuses malformed input before drawing anything', async () => {
    const { handle, showSheet } = handler();
    for (const raw of [null, 'x', { ...request, pluginId: 'Bad' }, { ...request, pluginId: 7 }, { ...request, title: '' }, { ...request, binding: {} }]) {
      await expect(handle(win(), raw)).resolves.toEqual({ approved: false, reason: 'invalid' });
    }
    expect(showSheet).not.toHaveBeenCalled();
  });

  it('is unavailable without a real signing secret', async () => {
    const { handle, showSheet } = handler({ secret: () => 'short' });
    await expect(handle(win(), request)).resolves.toEqual({ approved: false, reason: 'unavailable' });
    expect(showSheet).not.toHaveBeenCalled();
  });

  it('refuses plugins main does not see running', async () => {
    for (const apps of [[], [{ ...app, enabled: false }], [{ ...app, status: 'disabled' }], [{ ...app, id: 'other' }]]) {
      const { handle, showSheet } = handler({ listApps: async () => apps });
      await expect(handle(win(), request)).resolves.toEqual({ approved: false, reason: 'invalid' });
      expect(showSheet).not.toHaveBeenCalled();
    }
  });

  it('allows one sheet per window at a time', async () => {
    const answers: Array<(outcome: ApprovalSheetOutcome) => void> = [];
    const showSheet = vi.fn(() => new Promise<ApprovalSheetOutcome>((resolve) => { answers.push(resolve); }));
    const { handle } = handler({ showSheet });
    const first = handle(win(1), request);
    await vi.waitFor(() => expect(showSheet).toHaveBeenCalledTimes(1));
    await expect(handle(win(1), request)).resolves.toEqual({ approved: false, reason: 'busy' });
    const other = handle(win(2), request);
    await vi.waitFor(() => expect(showSheet).toHaveBeenCalledTimes(2));
    answers[1]!({ kind: 'cancelled' });
    await expect(other).resolves.toEqual({ approved: false, reason: 'cancelled' });
    answers[0]!({ kind: 'approved', typed: '' });
    await expect(first).resolves.toMatchObject({ approved: true });
    const again = handle(win(1), request);
    await vi.waitFor(() => expect(showSheet).toHaveBeenCalledTimes(3));
    answers[2]!({ kind: 'cancelled' });
    await expect(again).resolves.toEqual({ approved: false, reason: 'cancelled' });
    // A failed listing still frees the window: the retry fails the same way, not as busy.
    const failing = handler({ listApps: async () => { throw new Error('offline'); } });
    await expect(failing.handle(win(1), request)).rejects.toThrow('offline');
    await expect(failing.handle(win(1), request)).rejects.toThrow('offline');
  });

  it('cancels on a cancelled sheet or a closed window', async () => {
    await expect(handler({}, { kind: 'cancelled' }).handle(win(), request)).resolves.toEqual({ approved: false, reason: 'cancelled' });
    await expect(handler().handle(win(1, true), request)).resolves.toEqual({ approved: false, reason: 'cancelled' });
  });

  it('checks typed confirmation text itself', async () => {
    const typedRequest = { ...request, binding: { ...binding, confirmText: 'prod' } };
    await expect(handler({}, { kind: 'approved', typed: 'pro' }).handle(win(), typedRequest)).resolves.toEqual({ approved: false, reason: 'cancelled' });
    await expect(handler({}, { kind: 'approved', typed: 'prod' }).handle(win(), typedRequest)).resolves.toMatchObject({ approved: true });
  });

  it('defaults to the wall clock', async () => {
    const { handle } = handler({ now: undefined });
    const before = Date.now();
    const result = await handle(win(), request);
    expect(result.approved && result.expiresAt).toBeGreaterThanOrEqual(before + 5 * 60_000);
  });
});
