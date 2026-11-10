import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';

const THREAD_ID = '11111111-1111-4111-8111-111111111111';
const baseThread = {
  id: THREAD_ID,
  projectId: 'proj-1',
  hostId: 'host-1',
  environmentId: '22222222-2222-4222-8222-222222222222',
  providerId: 'modern',
  providerThreadId: 'prov-1'
};
const state = vi.hoisted(() => ({ thread: undefined as unknown }));

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(() => state.thread),
  getEnvironment: vi.fn(() => ({ path: '/tmp/proj' })),
  getThreadExecutionState: vi.fn(() => null),
  getLatestConversationCheckpoint: vi.fn(() => null)
}));
vi.mock('./provider-service-tier.js', () => ({ authorizedServiceTier: vi.fn(() => undefined) }));
vi.mock('./conversation-session-tools.js', () => ({ packConversationSessionTooling: vi.fn(async () => ({})) }));
vi.mock('./derived-provider-options.js', () => ({ derivedProviderOptionsForCommand: vi.fn(async () => undefined) }));
vi.mock('./thread-provider-catalog.js', () => ({
  bridgeLaunchForProvider: vi.fn(() => undefined),
  getThreadProvider: vi.fn(() => undefined)
}));
vi.mock('./conversation-execution-mode.js', () => ({ claudeCodePermissionModeForTurn: vi.fn() }));
vi.mock('./thread-permission-mode.js', () => ({ threadPermissionMode: vi.fn(() => 'auto') }));
vi.mock('./thread-last-execution.js', () => ({ readLastThreadExecution: vi.fn(() => ({})) }));
vi.mock('./thread-automated-skill-selection.js', () => ({ threadAutomatedSkillIds: vi.fn(() => undefined), threadSkillSelection: vi.fn(() => ({})) }));

import { resumeConversationStrict, StrictResumeError } from './conversation-host-rpc.js';

function ctxWith(result: unknown) {
  const callHostOnlineRpc = vi.fn(async () => result);
  return {
    ctx: { db: {}, plugins: undefined, pluginHostArtifacts: undefined, hostHub: { callHostOnlineRpc } } as unknown as ProductHttpContext,
    callHostOnlineRpc
  };
}

describe('resumeConversationStrict', () => {
  beforeEach(() => {
    state.thread = { ...baseThread };
  });

  it('sends requireNativeLoad with the expected id and returns the confirmed result', async () => {
    const reply = { threadId: THREAD_ID, resumed: true, providerThreadId: 'prov-1', nativeLoaded: true };
    const { ctx, callHostOnlineRpc } = ctxWith(reply);
    const assertCurrent = vi.fn();
    await expect(resumeConversationStrict(ctx, THREAD_ID, 'prov-1', assertCurrent)).resolves.toEqual(reply);
    expect(assertCurrent).toHaveBeenCalledOnce();
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: 'host-1',
      command: expect.objectContaining({
        type: 'thread.resume',
        threadId: THREAD_ID,
        providerThreadId: 'prov-1',
        requireNativeLoad: true
      })
    });
  });

  it.each([
    ['nativeLoaded false', { threadId: THREAD_ID, resumed: true, providerThreadId: 'prov-1', nativeLoaded: false }],
    ['nativeLoaded missing (older host)', { threadId: THREAD_ID, resumed: true, providerThreadId: 'prov-1' }],
    ['empty result', undefined]
  ])('throws native_load_unconfirmed on %s', async (_name, reply) => {
    const { ctx } = ctxWith(reply);
    await expect(resumeConversationStrict(ctx, THREAD_ID, 'prov-1')).rejects.toMatchObject({
      name: 'StrictResumeError',
      code: 'native_load_unconfirmed'
    });
  });

  it('throws provider_thread_mismatch when the host returns a different session', async () => {
    const { ctx } = ctxWith({ threadId: THREAD_ID, resumed: true, providerThreadId: 'prov-other', nativeLoaded: true });
    const error = await resumeConversationStrict(ctx, THREAD_ID, 'prov-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StrictResumeError);
    expect(error).toMatchObject({ code: 'provider_thread_mismatch' });
  });

  it('rejects an unknown or non-resumable thread before any host call', async () => {
    const { ctx, callHostOnlineRpc } = ctxWith({});
    state.thread = null;
    await expect(resumeConversationStrict(ctx, THREAD_ID, 'prov-1')).rejects.toMatchObject({ status: 404 });
    state.thread = { ...baseThread, providerThreadId: null };
    await expect(resumeConversationStrict(ctx, THREAD_ID, 'prov-1')).rejects.toBeInstanceOf(ThreadCreateError);
    state.thread = { ...baseThread, environmentId: null };
    await expect(resumeConversationStrict(ctx, THREAD_ID, 'prov-1')).rejects.toMatchObject({ code: 'not_resumable' });
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
  });

  it('propagates host RPC failures without masking them', async () => {
    const { ctx, callHostOnlineRpc } = ctxWith(undefined);
    callHostOnlineRpc.mockRejectedValueOnce(new Error('session/load failed'));
    await expect(resumeConversationStrict(ctx, THREAD_ID, 'prov-1')).rejects.toThrow('session/load failed');
  });
});
