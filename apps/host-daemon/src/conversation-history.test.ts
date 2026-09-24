import { describe, expect, it, vi } from 'vitest';
import { ConversationHistoryService, HISTORY_PAGE_SIZE, HISTORY_SNAPSHOT_TTL_MS, HISTORY_SETTLEMENT_MS, HISTORY_MAX_SNAPSHOTS, type HistoryProvider } from './conversation-history.js';
import type { HarnessHistoryAdapter } from '@zcc/harness-sdk';
import type { Project } from '@zana-ai/zcc-domain/product';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const project = (id: string, name = id): Project => ({
  id, name, path: `/work/${id}`, color: '#000', createdAt: 1, lastActiveAt: 1
});

type NativeSession = { id: string; title?: string | null; lastActiveAt?: number | null };
type Reader = (entry: Project) => Promise<NativeSession[]>;

function provider(id: string, label: string, projects: () => readonly Project[], read?: Reader): HistoryProvider {
  const adapter: HarnessHistoryAdapter | undefined = read ? {
    list: async ({ projectPath }) => {
      const entry = projects().find((candidate) => candidate.path === projectPath);
      if (!entry) return [];
      return (await read(entry)).map((row) => ({
        id: row.id, title: row.title ?? '', lastActiveAt: row.lastActiveAt ?? null
      }));
    },
    validateConversation: async () => true
  } : undefined;
  return { id, label, iconId: id, adapter };
}

function service(deps: {
  projects: () => readonly Project[];
  claude?: Reader;
  opencode?: Reader;
  codex?: Reader;
  now?: () => number;
}): ConversationHistoryService {
  const providers = [
    provider('claude', 'Claude', deps.projects, deps.claude),
    provider('opencode', 'OpenCode', deps.projects, deps.opencode),
    ...(deps.codex ? [provider('codex', 'Codex', deps.projects, deps.codex)] : [])
  ];
  return new ConversationHistoryService({ projects: deps.projects, providers, now: deps.now });
}

describe('ConversationHistoryService', () => {
  it('globally sorts recent conversations', async () => {
    const projects = [project('one'), project('two')];
    const history = service({
      projects: () => projects,
      claude: async (entry) => Array.from({ length: 6 }, (_, index) => ({
        id: `${entry.id}-${index}`, lastActiveAt: 100 - index, title: `Claude ${entry.id}-${index}`
      })),
      opencode: async (entry) => [{ id: entry.id, title: `OpenCode ${entry.id}`, lastActiveAt: 99 }]
    });

    const snapshot = history.start(10);
    expect(snapshot.status).toBe('provisional');
    await settle();
    const ready = history.get(10, snapshot.snapshotId);
    expect(ready.status).toBe('ready');
    expect(ready.rows).toHaveLength(14);
    expect(ready.rows[0]).toMatchObject({ title: expect.stringMatching(/^Claude (one|two)-0$/) });
    expect(ready.rows.some((row) => row.source === 'opencode')).toBe(true);
    expect(ready.rows.every((row) => !row.historyId.includes('one-') && !row.historyId.includes('opencode'))).toBe(true);
    expect(ready.coverage.map((entry) => entry.state)).toEqual(['fresh', 'fresh']);
    expect(ready.hasNextPage).toBe(false);
  });

  it('keeps snapshots window-scoped and releases only the owner', async () => {
    const history = service({
      projects: () => [project('one')],
      claude: async () => [], opencode: async () => []
    });
    const snapshot = history.start(10, 'one');
    await settle();

    expect(history.get(11, snapshot.snapshotId).status).toBe('expired');
    history.release(11, snapshot.snapshotId);
    expect(history.get(10, snapshot.snapshotId).status).toBe('ready');
    history.release(10, snapshot.snapshotId);
    expect(history.get(10, snapshot.snapshotId).status).toBe('expired');
  });

  it('waits for an explicit refresh to settle before returning replacement rows', async () => {
    let resolveClaude: ((rows: NativeSession[]) => void) | undefined;
    const history = service({
      projects: () => [project('one')],
      claude: () => new Promise((resolve) => { resolveClaude = resolve; }),
      opencode: async () => []
    });

    const refreshing = history.refresh(10, 'one');
    await settle();
    let returned = false;
    void refreshing.then(() => { returned = true; });
    expect(returned).toBe(false);

    resolveClaude?.([]);
    await expect(refreshing).resolves.toMatchObject({ status: 'ready', rows: [] });
  });

  it('expires stale snapshots and labels reader failures honestly', async () => {
    let now = 1;
    const history = service({
      projects: () => [project('one')], now: () => now,
      claude: async () => { throw new Error('native store unreadable'); },
      opencode: async () => []
    });
    const snapshot = history.start(10);
    await settle();
    expect(history.get(10, snapshot.snapshotId).coverage.map((entry) => entry.state)).toEqual(['failed', 'empty']);

    now += HISTORY_SNAPSHOT_TTL_MS;
    expect(history.get(10, snapshot.snapshotId).status).toBe('expired');
  });

  it('settles each provider independently without waiting for another provider', async () => {
    let resolveOpenCode: ((rows: NativeSession[]) => void) | undefined;
    const history = service({
      projects: () => [project('one')],
      claude: async () => [{ id: 'claude-1', lastActiveAt: 2, title: 'Claude result' }],
      opencode: () => new Promise((resolve) => { resolveOpenCode = resolve; })
    });

    const snapshot = history.start(10);
    await settle();
    expect(history.get(10, snapshot.snapshotId)).toMatchObject({
      status: 'provisional', rows: [{ title: 'Claude result' }],
      coverage: [{ source: 'claude', state: 'fresh' }, { source: 'opencode', state: 'loading' }]
    });

    resolveOpenCode?.([]);
    await settle();
    expect(history.get(10, snapshot.snapshotId).status).toBe('ready');
  });

  it('caps concurrent project readers', async () => {
    let active = 0;
    let peak = 0;
    const history = service({
      projects: () => Array.from({ length: 8 }, (_, index) => project(`p${index}`)),
      claude: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await settle();
        active -= 1;
        return [];
      },
      opencode: async () => []
    });

    const ready = await history.refresh(10);
    expect(ready.status).toBe('ready');
    expect(peak).toBeLessThanOrEqual(2);
  });
});

it('paginates and searches Codex history while keeping opaque identities scoped to their owner', async () => {
  const history = service({
    projects: () => [project('one'), { ...project('remote'), remote: { host: 'remote' } }],
    claude: async () => [], opencode: async () => [],
    codex: async () => Array.from({ length: 45 }, (_, i) => ({ id: `native-${i}`, title: `Saved ${i}`, lastActiveAt: i }))
  });
  const first = await history.refresh(1, 'one');
  expect(first.rows).toHaveLength(HISTORY_PAGE_SIZE);
  expect(first.hasNextPage).toBe(true);
  const next = history.get(1, first.snapshotId, first.nextPageCursor);
  expect(next.rows).toHaveLength(5); expect(next.hasNextPage).toBe(false);
  expect(history.get(1, first.snapshotId, 'bad').status).toBe('expired');
  expect(history.find(2, first.snapshotId, first.rows[0].historyId)).toBeUndefined();
  expect(history.find(1, first.snapshotId, first.rows[0].historyId)).toMatchObject({ nativeConversationId: 'native-44', projectId: 'one', projectPath: '/work/one' });
  const search = await history.refresh(1, 'one', 'Saved 44');
  expect(search.rows).toHaveLength(1);
  expect(history.query(1, search.snapshotId)).toBe('saved 44');
  expect(history.query(2, search.snapshotId)).toBe('');
  history.releaseWindow(1);
  expect(history.get(1, search.snapshotId).status).toBe('expired');
});

it('bounds abandoned snapshots, validates cursors and handles removed projects', async () => {
  let projects = [project('one')];
  const history = service({ projects: () => projects, claude: async () => [], opencode: async () => [{ id: 'native', title: '', lastActiveAt: 2 }] });
  const first = await history.refresh(1, 'one');
  expect(history.scope(1, first.snapshotId)).toBe('one'); expect(history.scope(2, first.snapshotId)).toBeUndefined();
  expect(history.find(1, first.snapshotId, {})).toBeUndefined();
  for (const cursor of ['-1', '10001', '999999999999999999999']) expect(history.get(1, first.snapshotId, cursor).status).toBe('expired');
  projects = [];
  expect(history.get(1, first.snapshotId).rows[0]).toMatchObject({ title: 'Untitled conversation', availability: 'unavailable', projectName: 'Unavailable project' });
  for (let i = 0; i <= HISTORY_MAX_SNAPSHOTS; i++) await history.refresh(1);
  expect(history.get(1, first.snapshotId).status).toBe('expired');
  expect(history.get(1, {}).status).toBe('expired');
});

it('keeps readable projects when another registered directory has disappeared', async () => {
  const history = service({ projects: () => [project('missing'), project('available')], claude: async () => [], opencode: async (entry) => {
    if (entry.id === 'missing') throw new Error('Directory missing');
    return [{ id: 'native', title: 'Still readable', lastActiveAt: 2 }];
  } });
  const result = await history.refresh(1);
  expect(result.rows).toHaveLength(1);
  expect(result.coverage[1].state).toBe('failed');
});

it('settles a timed-out reader and ignores released in-flight work', async () => {
  vi.useFakeTimers();
  try {
    const history = service({ projects: () => [project('one')], claude: () => new Promise(() => {}), opencode: async () => [] });
    const first = history.start(1);
    const second = history.start(2); history.release(2, second.snapshotId);
    await vi.advanceTimersByTimeAsync(HISTORY_SETTLEMENT_MS);
    expect(history.get(1, first.snapshotId)).toMatchObject({ status: 'ready', coverage: [{ source: 'claude', state: 'timed-out' }, { source: 'opencode', state: 'empty' }] });
    expect(history.get(2, second.snapshotId).status).toBe('expired');
  } finally { vi.useRealTimers(); }
});

it('keeps partial history when another project takes too long', async () => {
  vi.useFakeTimers();
  try {
    const history = service({ projects: () => [project('fast'), project('slow')], claude: async () => [], opencode: (entry) => entry.id === 'slow' ? new Promise(() => {}) : Promise.resolve([{ id: 'saved', title: 'Readable', lastActiveAt: 2 }]) });
    const first = history.start(1);
    await vi.advanceTimersByTimeAsync(HISTORY_SETTLEMENT_MS);
    const ready = history.get(1, first.snapshotId);
    expect(ready.rows[0].title).toBe('Readable');
    expect(ready.coverage[1].state).toBe('timed-out');
  } finally { vi.useRealTimers(); }
});
