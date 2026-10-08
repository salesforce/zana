import { describe, expect, it, vi } from 'vitest';
import { createActorResolver } from './tools.js';

describe('createActorResolver', () => {
  it('labels a thread by its title and caches it', async () => {
    const getThread = vi.fn(async () => ({ title: ' Planner ', titleFallback: null }));
    const resolve = createActorResolver(getThread);
    await expect(resolve('t-1')).resolves.toEqual({ kind: 'agent', label: 'Planner', threadId: 't-1' });
    await resolve('t-1');
    expect(getThread).toHaveBeenCalledTimes(1);
    getThread.mockResolvedValueOnce({ title: null, titleFallback: 'Draft the API' });
    expect((await resolve('t-2')).label).toBe('Draft the API');
  });

  it('does not cache fallbacks, so a later title still lands', async () => {
    const getThread = vi.fn(async () => ({ title: '', titleFallback: null }));
    const resolve = createActorResolver(getThread);
    expect(await resolve('t-1')).toEqual({ kind: 'agent', label: 'Agent', threadId: 't-1' });
    getThread.mockRejectedValueOnce(new Error('host down'));
    expect(await resolve('t-1')).toEqual({ kind: 'agent', label: 'Agent', threadId: 't-1' });
    getThread.mockResolvedValueOnce({ title: 'Named now', titleFallback: null });
    expect((await resolve('t-1')).label).toBe('Named now');
    expect(getThread).toHaveBeenCalledTimes(3);
  });

  it('treats an unknown thread as a terminal agent with nothing to link', async () => {
    const resolve = createActorResolver(async () => null);
    expect(await resolve('pty-7')).toEqual({ kind: 'agent', label: 'CLI agent', threadId: null });
  });

  it('evicts the oldest title past the cap', async () => {
    const getThread = vi.fn(async (threadId: string) => ({ title: `T ${threadId}` }));
    const resolve = createActorResolver(getThread, 2);
    await resolve('a');
    await resolve('b');
    await resolve('c');
    await resolve('b');
    expect(getThread).toHaveBeenCalledTimes(3);
    await resolve('a');
    expect(getThread).toHaveBeenCalledTimes(4);
  });
});
