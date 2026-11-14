import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRemovedRoutesVersion,
  isRemovedRoute,
  liveRoutePath,
  markSessionsRemoved,
  markThreadsLive,
  markThreadsRemoved,
  resetRemovedRoutes,
  subscribeRemovedRoutes
} from '../removed-routes.js';

const HOME = '/';

afterEach(() => {
  resetRemovedRoutes();
});

describe('liveRoutePath', () => {
  it('keeps a route whose thread or session was never removed', () => {
    expect(liveRoutePath('/threads/t1', HOME)).toBe('/threads/t1');
    expect(liveRoutePath('/projects/p1/sessions/s1', HOME)).toBe('/projects/p1/sessions/s1');
    expect(liveRoutePath('/settings/terminal', HOME)).toBe('/settings/terminal');
  });

  it("sends a removed thread to its project's home, or the fallback outside a project", () => {
    markThreadsRemoved(['t1']);
    expect(isRemovedRoute('/threads/t1')).toBe(true);
    expect(liveRoutePath('/threads/t1', HOME)).toBe(HOME);
    expect(liveRoutePath('/threads/t1', null)).toBeNull();
    expect(liveRoutePath('/projects/p%201/threads/t1?x=1#a', HOME)).toBe('/projects/p%201');
    expect(liveRoutePath('/threads/t2', HOME)).toBe('/threads/t2');
  });

  it("sends a removed session to its project's home, or the fallback outside a project", () => {
    markSessionsRemoved(['s1']);
    expect(liveRoutePath('/sessions/s1', '/agents')).toBe('/agents');
    expect(liveRoutePath('/projects/p1/sessions/s1', HOME)).toBe('/projects/p1');
    // A thread id that happens to match a session id is not affected.
    expect(liveRoutePath('/threads/s1', HOME)).toBe('/threads/s1');
  });

  it('decodes encoded ids the way the router does', () => {
    markThreadsRemoved(['thread:a b']);
    expect(liveRoutePath(`/threads/${encodeURIComponent('thread:a b')}`, HOME)).toBe(HOME);
  });

  it('treats a restored thread as live again', () => {
    markThreadsRemoved(['t1']);
    markThreadsLive(['t1']);
    expect(liveRoutePath('/threads/t1', HOME)).toBe('/threads/t1');
  });
});

describe('removal record', () => {
  it('notifies subscribers only when the record changes', () => {
    const listener = vi.fn();
    const off = subscribeRemovedRoutes(listener);
    const start = getRemovedRoutesVersion();
    markThreadsRemoved(['t1']);
    markThreadsRemoved(['t1']);
    markThreadsLive(['other']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getRemovedRoutesVersion()).toBe(start + 1);
    off();
    markSessionsRemoved(['s1']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps at most 500 ids per kind, dropping the oldest first', () => {
    markThreadsRemoved(Array.from({ length: 501 }, (_, i) => `t${i}`));
    expect(isRemovedRoute('/threads/t0')).toBe(false);
    expect(isRemovedRoute('/threads/t1')).toBe(true);
    expect(isRemovedRoute('/threads/t500')).toBe(true);
  });
});
