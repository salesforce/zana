import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(),
  listConversationOpenBackgroundTaskItems: vi.fn()
}));
vi.mock('./conversation-lifecycle.js', () => ({
  sendConversationTurn: vi.fn(async () => ({ id: 'thr-1' }))
}));

import { getConversationThread, listConversationOpenBackgroundTaskItems } from '@zana-ai/zcc-db';
import { sendConversationTurn } from './conversation-lifecycle.js';
import { backgroundStopPrompt, stopConversationBackgroundTasks } from './conversation-background-stop.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import type { ProductHttpContext } from '../../http/product-context.js';

function row(id: string, taskStatus: string, description = `desc-${id}`, workflowName?: string) {
  return {
    type: 'backgroundTask', id, taskType: 'local_bash', status: 'pending', taskStatus,
    skipTranscript: false, description, ...(workflowName ? { workflowName } : {})
  };
}
const listOpen = vi.mocked(listConversationOpenBackgroundTaskItems);

function makeCtx(rpc: (args: unknown) => Promise<unknown>) {
  const callHostOnlineRpc = vi.fn(rpc);
  return { ctx: { db: {}, hostHub: { callHostOnlineRpc } } as unknown as ProductHttpContext, callHostOnlineRpc };
}

describe('backgroundStopPrompt', () => {
  it('lists descriptions', () => {
    expect(backgroundStopPrompt(['a', 'b'])).toContain('tasks now: a; b.');
  });
  it('falls back when there are no descriptions', () => {
    expect(backgroundStopPrompt([])).toContain('the running background tasks');
  });
});

describe('stopConversationBackgroundTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(getConversationThread).mockReturnValue({ id: 'thr-1', hostId: 'host-1' } as never);
  });

  const stoppedRpc = async (args: unknown) => ({
    threadId: (args as { command: { threadId: string } }).command.threadId,
    stopped: true
  });

  it('404s for an unknown thread', async () => {
    vi.mocked(getConversationThread).mockReturnValue(undefined as never);
    const { ctx } = makeCtx(stoppedRpc);
    await expect(stopConversationBackgroundTasks(ctx, 'nope')).rejects.toMatchObject({
      status: 404,
      code: 'unknown-thread'
    });
    await expect(stopConversationBackgroundTasks(ctx, 'nope')).rejects.toBeInstanceOf(ThreadCreateError);
  });

  it('409s when nothing is open', async () => {
    listOpen.mockReturnValue([]);
    const { ctx } = makeCtx(stoppedRpc);
    await expect(stopConversationBackgroundTasks(ctx, 'thr-1')).rejects.toMatchObject({
      status: 409,
      code: 'not-running'
    });
  });

  it('409s when the itemIds filter matches nothing', async () => {
    listOpen.mockReturnValue([row('a', 'running')] as never);
    const { ctx, callHostOnlineRpc } = makeCtx(stoppedRpc);
    await expect(stopConversationBackgroundTasks(ctx, 'thr-1', ['zzz'])).rejects.toMatchObject({
      status: 409,
      code: 'not-running'
    });
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
  });

  it('excludes settled items and treats pending/running/paused as open', async () => {
    listOpen.mockReturnValue([
      row('done', 'completed'),
      row('bad', 'failed'),
      row('killed', 'killed'),
      row('stopped', 'stopped'),
      row('p', 'pending'),
      row('r', 'running'),
      row('z', 'paused')
    ] as never);
    const { ctx } = makeCtx(stoppedRpc);
    const result = await stopConversationBackgroundTasks(ctx, 'thr-1');
    expect(result).toEqual({ ok: true, stopped: ['p', 'r', 'z'], requested: [] });
  });

  it('409s when only settled items exist', async () => {
    listOpen.mockReturnValue([row('done', 'completed')] as never);
    const { ctx } = makeCtx(stoppedRpc);
    await expect(stopConversationBackgroundTasks(ctx, 'thr-1')).rejects.toMatchObject({ code: 'not-running' });
  });

  it('stops natively without messaging the agent and sends the RPC shape', async () => {
    listOpen.mockReturnValue([row('a', 'running')] as never);
    const { ctx, callHostOnlineRpc } = makeCtx(stoppedRpc);
    const result = await stopConversationBackgroundTasks(ctx, 'thr-1');
    expect(result).toEqual({ ok: true, stopped: ['a'], requested: [] });
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: 'host-1',
      command: { type: 'thread.background.stop', threadId: 'thr-1', itemId: 'a' }
    });
    expect(sendConversationTurn).not.toHaveBeenCalled();
  });

  it('falls back to the agent for stopped:false, mismatched thread, and rpc errors', async () => {
    listOpen.mockReturnValue([
      row('ok', 'running', 'fine'),
      row('no', 'running', '  build server  '),
      row('other', 'running', 'ignored-desc', 'deploy-flow'),
      row('boom', 'running', '   ')
    ] as never);
    const { ctx } = makeCtx(async (args) => {
      const id = (args as { command: { itemId: string } }).command.itemId;
      if (id === 'ok') return { threadId: 'thr-1', stopped: true };
      if (id === 'no') return { threadId: 'thr-1', stopped: false };
      if (id === 'other') return { threadId: 'someone-else', stopped: true };
      throw new Error('host offline');
    });
    const result = await stopConversationBackgroundTasks(ctx, 'thr-1');
    expect(result).toEqual({ ok: true, stopped: ['ok'], requested: ['no', 'other', 'boom'] });
    expect(sendConversationTurn).toHaveBeenCalledTimes(1);
    const [, threadId, prompt, mode] = vi.mocked(sendConversationTurn).mock.calls[0] as unknown[];
    expect(threadId).toBe('thr-1');
    expect(mode).toBe('auto');
    expect(prompt).toBe(backgroundStopPrompt(['build server', 'deploy-flow']));
    expect(prompt).not.toContain('ignored-desc');
  });

  it('only targets the requested itemIds', async () => {
    listOpen.mockReturnValue([
      row('a', 'running'),
      row('b', 'running'),
      row('c', 'running')
    ] as never);
    const { ctx, callHostOnlineRpc } = makeCtx(stoppedRpc);
    const result = await stopConversationBackgroundTasks(ctx, 'thr-1', ['b', 'missing']);
    expect(result.stopped).toEqual(['b']);
    expect(callHostOnlineRpc).toHaveBeenCalledTimes(1);
    expect(callHostOnlineRpc.mock.calls[0]?.[0]).toMatchObject({ command: { itemId: 'b' } });
  });

  it('reads the open items of this thread only and skips malformed rows', async () => {
    listOpen.mockReturnValue([{ id: 'broken' }, row('a', 'running')]);
    const { ctx, callHostOnlineRpc } = makeCtx(stoppedRpc);
    const result = await stopConversationBackgroundTasks(ctx, 'thr-1');
    expect(listOpen).toHaveBeenCalledWith(ctx.db, 'thr-1');
    expect(result.stopped).toEqual(['a']);
    expect(callHostOnlineRpc).toHaveBeenCalledTimes(1);
  });

  it('logs a failed native stop', async () => {
    listOpen.mockReturnValue([row('a', 'running')]);
    const { ctx } = makeCtx(async () => { throw 'bridge gone'; });
    await stopConversationBackgroundTasks(ctx, 'thr-1');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('thr-1'), 'bridge gone');
  });

  it('keeps native stops when the agent cannot be asked about the rest', async () => {
    listOpen.mockReturnValue([row('a', 'running'), row('b', 'running')]);
    vi.mocked(sendConversationTurn).mockRejectedValueOnce(new Error('thread is archived'));
    const { ctx } = makeCtx(async (args) => ({
      threadId: 'thr-1',
      stopped: (args as { command: { itemId: string } }).command.itemId === 'a'
    }));
    await expect(stopConversationBackgroundTasks(ctx, 'thr-1')).resolves.toEqual({
      ok: true, stopped: ['a'], requested: [], fallbackError: 'thread is archived'
    });
  });

  it('rethrows the fallback failure when nothing was stopped', async () => {
    listOpen.mockReturnValue([row('a', 'running')]);
    vi.mocked(sendConversationTurn).mockRejectedValueOnce('nope');
    const { ctx } = makeCtx(async () => ({ threadId: 'thr-1', stopped: false }));
    await expect(stopConversationBackgroundTasks(ctx, 'thr-1')).rejects.toBe('nope');
  });

  it('stringifies a non-Error fallback failure', async () => {
    listOpen.mockReturnValue([row('a', 'running'), row('b', 'running')]);
    vi.mocked(sendConversationTurn).mockRejectedValueOnce('busy');
    const { ctx } = makeCtx(async (args) => ({
      threadId: 'thr-1',
      stopped: (args as { command: { itemId: string } }).command.itemId === 'a'
    }));
    expect((await stopConversationBackgroundTasks(ctx, 'thr-1')).fallbackError).toBe('busy');
  });
});
