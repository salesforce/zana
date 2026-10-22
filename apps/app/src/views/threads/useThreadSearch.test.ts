/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';

const { conversationOutline } = vi.hoisted(() => ({ conversationOutline: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { threads: { conversationOutline } } }));
// The fixtures are already view rows.
vi.mock('@zana-ai/zcc-thread-view', async (orig) => ({
  ...(await orig<object>()),
  buildTimelineViewRows: (rows: unknown) => rows
}));

import { THREAD_SEARCH_MAX_OLDER_LOADS, useThreadSearch } from './useThreadSearch.js';

const message = (id: string, text: string, seq: number) =>
  ({ kind: 'conversation', id, role: 'assistant', text, sourceSeqStart: seq, sourceSeqEnd: seq });

interface Props {
  threadId?: string;
  rows: unknown[];
  hasOlder?: boolean;
  olderCursorKey?: string | null;
  loadingOlder?: boolean;
}

function renderSearch(initialProps: Props, loadOlder = vi.fn()) {
  const hook = renderHook((props: Props) => useThreadSearch({
    threadId: props.threadId ?? 't1',
    rows: props.rows as TimelineRow[],
    hasOlder: props.hasOlder ?? false,
    olderCursorKey: props.olderCursorKey ?? null,
    loadingOlder: props.loadingOlder ?? false,
    loadOlder
  }), { initialProps });
  return { ...hook, loadOlder };
}

async function submit(hook: ReturnType<typeof renderSearch>, query: string, direction?: 'next' | 'previous') {
  act(() => hook.result.current.submit(query, direction));
  await waitFor(() => expect(hook.result.current.pending).toBe(false));
}

const rows = [message('a', 'cat and cat', 10), message('b', 'dog', 11), message('c', 'Cat', 12)];

describe('useThreadSearch', () => {
  afterEach(() => {
    cleanup();
    conversationOutline.mockReset();
    vi.restoreAllMocks();
  });

  it('counts matches, lands on the first and steps next/previous with wrap', async () => {
    conversationOutline.mockResolvedValue({ items: [], maxSeq: 12, matches: [] });
    const hook = renderSearch({ rows });
    await submit(hook, ' cat ');
    expect(conversationOutline).toHaveBeenCalledWith('t1', 'cat');
    expect(hook.result.current.query).toBe('cat');
    expect(hook.result.current.matches).toHaveLength(3);
    expect(hook.result.current.index).toBe(0);
    expect(hook.result.current.current).toMatchObject({ id: 'a', occurrence: 0 });
    const navigation = hook.result.current.navigation;

    act(() => hook.result.current.submit('cat'));
    expect(hook.result.current.current).toMatchObject({ id: 'a', occurrence: 1 });
    act(() => hook.result.current.submit('cat'));
    expect(hook.result.current.current).toMatchObject({ id: 'c', occurrence: 0 });
    act(() => hook.result.current.submit('cat'));
    expect(hook.result.current.index).toBe(0);
    act(() => hook.result.current.submit('cat', 'previous'));
    expect(hook.result.current.index).toBe(2);
    expect(hook.result.current.navigation).toBe(navigation + 4);
    expect(conversationOutline).toHaveBeenCalledTimes(1);
  });

  it('starts a Shift+Enter search at the last match', async () => {
    conversationOutline.mockResolvedValue({ items: [], maxSeq: 12 });
    const hook = renderSearch({ rows });
    await submit(hook, 'cat', 'previous');
    expect(hook.result.current.index).toBe(2);
  });

  it('starts over when the query changes and clears on an empty query', async () => {
    conversationOutline.mockResolvedValue({ items: [], maxSeq: 12, matches: [] });
    const hook = renderSearch({ rows });
    await submit(hook, 'cat');
    act(() => hook.result.current.submit('cat'));
    await submit(hook, 'dog');
    expect(hook.result.current.matches).toHaveLength(1);
    expect(hook.result.current.current).toMatchObject({ id: 'b', occurrence: 0 });

    await submit(hook, 'zebra');
    expect(hook.result.current.matches).toEqual([]);
    expect(hook.result.current.index).toBe(-1);
    act(() => hook.result.current.submit('zebra'));
    expect(hook.result.current.index).toBe(-1);

    act(() => hook.result.current.submit('  '));
    expect(hook.result.current.query).toBe('');
    expect(hook.result.current.pending).toBe(false);
    expect(hook.result.current.matches).toEqual([]);
  });

  it('keeps the current match by identity as rows stream in', async () => {
    conversationOutline.mockResolvedValue({ items: [], maxSeq: 12, matches: [] });
    const hook = renderSearch({ rows });
    await submit(hook, 'cat');
    act(() => hook.result.current.submit('cat'));
    act(() => hook.result.current.submit('cat'));
    expect(hook.result.current.current).toMatchObject({ id: 'c', occurrence: 0 });

    // An earlier row gains a match: the counter follows `c`, now 4th of 4.
    hook.rerender({ rows: [message('a', 'cat and cat', 10), message('b', 'dog cat', 11), message('c', 'Cat', 12), message('d', 'cat', 13)] });
    expect(hook.result.current.matches).toHaveLength(5);
    expect(hook.result.current.index).toBe(3);
    // The current row goes away: fall back to where the user navigated to.
    hook.rerender({ rows: [message('a', 'cat and cat', 10), message('b', 'dog cat', 11), message('d', 'cat', 13)] });
    expect(hook.result.current.index).toBe(2);
    expect(hook.result.current.current).toMatchObject({ id: 'b' });
  });

  it('ignores a stale outline reply and still searches loaded rows when the outline fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let resolveFirst!: (value: unknown) => void;
    conversationOutline.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    conversationOutline.mockRejectedValueOnce(new Error('offline'));
    const hook = renderSearch({ rows, hasOlder: true });
    act(() => hook.result.current.submit('cat'));
    expect(hook.result.current.pending).toBe(true);
    await submit(hook, 'dog');
    expect(warn).toHaveBeenCalledWith('[thread-search] outline search failed', expect.objectContaining({ threadId: 't1' }));
    // The counter says it may be short: only loaded rows were counted.
    expect(hook.result.current.partial).toBe(true);
    await act(async () => { resolveFirst({ items: [], maxSeq: 1, matches: [{ id: 'old', seq: 1, count: 3 }] }); });
    expect(hook.result.current.query).toBe('dog');
    expect(hook.result.current.matches).toHaveLength(1);
    conversationOutline.mockResolvedValue({ items: [], maxSeq: 12, matches: [] });
    await submit(hook, 'cat');
    expect(hook.result.current.partial).toBe(false);
    warn.mockRestore();
  });

  it('starts clean on another thread and drops the previous thread’s reply', async () => {
    let resolveFirst!: (value: unknown) => void;
    conversationOutline.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    const hook = renderSearch({ rows, hasOlder: true });
    act(() => hook.result.current.submit('cat'));
    hook.rerender({ threadId: 't2', rows, hasOlder: true });
    expect(hook.result.current).toMatchObject({ query: '', pending: false, partial: false, matches: [], index: -1, current: null });
    await act(async () => { resolveFirst({ items: [], maxSeq: 1, matches: [{ id: 'old', seq: 1, count: 3 }] }); });
    expect(hook.result.current).toMatchObject({ query: '', matches: [] });
    expect(hook.loadOlder).not.toHaveBeenCalled();

    conversationOutline.mockResolvedValue({ items: [], maxSeq: 12, matches: [] });
    await submit(hook, 'cat');
    expect(conversationOutline).toHaveBeenLastCalledWith('t2', 'cat');
    expect(hook.result.current.current).toMatchObject({ id: 'a', occurrence: 0 });
    // Back on the first thread, its old search does not resurface.
    hook.rerender({ threadId: 't1', rows, hasOlder: true });
    expect(hook.result.current).toMatchObject({ query: '', current: null });
  });

  it('loads older pages, once per cursor, until an older match is present', async () => {
    conversationOutline.mockResolvedValue({ items: [], maxSeq: 12, matches: [{ id: 'old', seq: 2, count: 1 }] });
    const hook = renderSearch({ rows, hasOlder: true, olderCursorKey: 'p1' });
    await submit(hook, 'cat');
    expect(hook.result.current.matches).toHaveLength(4);
    expect(hook.result.current.current).toMatchObject({ id: 'old', unloaded: true });
    expect(hook.loadOlder).toHaveBeenCalledTimes(1);

    hook.rerender({ rows, hasOlder: true, olderCursorKey: 'p1', loadingOlder: true });
    hook.rerender({ rows, hasOlder: true, olderCursorKey: 'p1' });
    expect(hook.loadOlder).toHaveBeenCalledTimes(1);
    hook.rerender({ rows, hasOlder: true, olderCursorKey: 'p2' });
    expect(hook.loadOlder).toHaveBeenCalledTimes(2);

    // The page with the match arrives: it is now a loaded row.
    hook.rerender({ rows: [message('old', 'cat', 2), ...rows], hasOlder: true, olderCursorKey: 'p3' });
    expect(hook.result.current.current).toEqual({ id: 'old', ancestorIds: [], occurrence: 0 });
    expect(hook.loadOlder).toHaveBeenCalledTimes(2);
  });

  it('stops loading older pages at the cap, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    conversationOutline.mockResolvedValue({ items: [], maxSeq: 12, matches: [{ id: 'old', seq: 2, count: 1 }] });
    const hook = renderSearch({ rows, hasOlder: true, olderCursorKey: 'p0' });
    await submit(hook, 'cat');
    for (let page = 1; page <= THREAD_SEARCH_MAX_OLDER_LOADS + 5; page += 1) {
      hook.rerender({ rows, hasOlder: true, olderCursorKey: `p${page}` });
    }
    expect(hook.loadOlder).toHaveBeenCalledTimes(THREAD_SEARCH_MAX_OLDER_LOADS);
    expect(warn.mock.calls.filter(([message]) => message === '[thread-search] stopped loading older pages')).toHaveLength(1);
  });
});
