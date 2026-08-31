import { describe, expect, it } from 'vitest';
import { ConversationHistoryService, HISTORY_PAGE_SIZE, HISTORY_SNAPSHOT_TTL_MS } from './conversation-history.js';
import type { ClaudeSessionSummary, Project } from '@zana-ai/zcc-domain/product';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const project = (id: string, name = id): Project => ({
  id, name, path: `/work/${id}`, color: '#000', createdAt: 1, lastActiveAt: 1
});

describe('ConversationHistoryService', () => {
  it('globally sorts and bounds page one to eight', async () => {
    const projects = [project('one'), project('two')];
    const service = new ConversationHistoryService({
      projects: () => projects,
      claude: async (entry) => Array.from({ length: 6 }, (_, index) => ({
        id: `${entry.id}-${index}`, projectPath: entry.path, startedAt: 1, lastActiveAt: 100 - index,
        messageCount: 0, firstUserPrompt: null, title: `Claude ${entry.id}-${index}`
      })),
      opencode: async (entry) => [{ id: entry.id, title: `OpenCode ${entry.id}`, startedAt: 1, lastActiveAt: 99 }]
    });

    const snapshot = service.start(10);
    expect(snapshot.status).toBe('provisional');
    await settle();
    const ready = service.get(10, snapshot.snapshotId);
    expect(ready.status).toBe('ready');
    expect(ready.rows).toHaveLength(HISTORY_PAGE_SIZE);
    expect(ready.rows[0]).toMatchObject({ title: expect.stringMatching(/^Claude (one|two)-0$/) });
    expect(ready.rows.some((row) => row.source === 'opencode')).toBe(true);
    expect(ready.rows.every((row) => !row.historyId.includes('one-') && !row.historyId.includes('opencode'))).toBe(true);
    expect(ready.coverage.map((entry) => entry.state)).toEqual(['fresh', 'fresh']);
    expect(ready.hasNextPage).toBe(false);
  });

  it('keeps snapshots window-scoped and releases only the owner', async () => {
    const service = new ConversationHistoryService({
      projects: () => [project('one')],
      claude: async () => [], opencode: async () => []
    });
    const snapshot = service.start(10, 'one');
    await settle();

    expect(service.get(11, snapshot.snapshotId).status).toBe('expired');
    service.release(11, snapshot.snapshotId);
    expect(service.get(10, snapshot.snapshotId).status).toBe('ready');
    service.release(10, snapshot.snapshotId);
    expect(service.get(10, snapshot.snapshotId).status).toBe('expired');
  });

  it('waits for an explicit refresh to settle before returning replacement rows', async () => {
    let resolveClaude: ((rows: ClaudeSessionSummary[]) => void) | undefined;
    const service = new ConversationHistoryService({
      projects: () => [project('one')],
      claude: () => new Promise((resolve) => { resolveClaude = resolve; }),
      opencode: async () => []
    });

    const refreshing = service.refresh(10, 'one');
    await settle();
    let returned = false;
    void refreshing.then(() => { returned = true; });
    expect(returned).toBe(false);

    resolveClaude?.([]);
    await expect(refreshing).resolves.toMatchObject({ status: 'ready', rows: [] });
  });

  it('expires stale snapshots and labels reader failures honestly', async () => {
    let now = 1;
    const service = new ConversationHistoryService({
      projects: () => [project('one')], now: () => now,
      claude: async () => { throw new Error('native store unreadable'); },
      opencode: async () => []
    });
    const snapshot = service.start(10);
    await settle();
    expect(service.get(10, snapshot.snapshotId).coverage.map((entry) => entry.state)).toEqual(['failed', 'empty']);

    now += HISTORY_SNAPSHOT_TTL_MS;
    expect(service.get(10, snapshot.snapshotId).status).toBe('expired');
  });

  it('settles each provider independently without waiting for another provider', async () => {
    let resolveOpenCode: ((rows: { id: string; title: string; startedAt: number; lastActiveAt: number }[]) => void) | undefined;
    const service = new ConversationHistoryService({
      projects: () => [project('one')],
      claude: async () => [{
        id: 'claude-1', projectPath: '/work/one', startedAt: 1, lastActiveAt: 2,
        messageCount: 0, firstUserPrompt: null, title: 'Claude result'
      }],
      opencode: () => new Promise((resolve) => { resolveOpenCode = resolve; })
    });

    const snapshot = service.start(10);
    await settle();
    expect(service.get(10, snapshot.snapshotId)).toMatchObject({
      status: 'provisional', rows: [{ title: 'Claude result' }],
      coverage: [{ source: 'claude', state: 'fresh' }, { source: 'opencode', state: 'loading' }]
    });

    resolveOpenCode?.([]);
    await settle();
    expect(service.get(10, snapshot.snapshotId).status).toBe('ready');
  });

  it('caps concurrent project readers', async () => {
    let active = 0;
    let peak = 0;
    const service = new ConversationHistoryService({
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

    // Drive settlement through refresh() — it awaits settle() and resolves
    // with the ready snapshot — so the concurrency cap is observed
    // deterministically instead of racing a wall-clock poll (flaked under
    // parallel-run CPU contention because settlement's chained setTimeout(0)
    // rounds did not finish inside the fixed 20ms window).
    const ready = await service.refresh(10);
    expect(ready.status).toBe('ready');
    expect(peak).toBeLessThanOrEqual(2);
  });
});
