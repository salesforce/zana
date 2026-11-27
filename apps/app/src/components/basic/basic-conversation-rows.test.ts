import { describe, expect, it } from 'vitest';
import type { ThreadListItem } from '../../thread-store.js';
import { basicConversationRows, groupBasicConversationRows } from './basic-conversation-rows.js';
import { DEFAULT_BASIC_CONVERSATION_VIEW, type BasicConversationView } from './basic-conversation-view.js';

const projects = [
  { id: 'personal', name: 'zcc-workspace', quickAgent: true },
  { id: 'web', name: 'Website', color: '#2f81f7', hostId: 'mac' },
  { id: 'remote', name: 'SSH project', remote: { host: 'devbox', remotePath: '/work' } },
  { id: 'daemon', name: 'Other machine', hostId: 'devbox' }
];
function thread(id: string, patch: Partial<ThreadListItem> = {}): ThreadListItem {
  return { id, projectId: 'personal', hostId: 'mac', environmentId: null, providerId: 'fake', status: 'idle',
    title: `Chat ${id}`, createdAt: 1, cwd: null, branchName: null, isWorktree: false, ...patch };
}
const list = (threads: readonly ThreadListItem[], query = '', scope: string | null = null, hostId: string | undefined = 'mac') =>
  basicConversationRows(threads, projects, hostId, query, scope);
const idsOf = (rows: ReturnType<typeof list>) => rows.map(row => row.thread.id);

describe('Basic conversation rows', () => {
  it('lists every project in one recent-activity order, labelled with its project, without mutating the roster', () => {
    const rows = Object.freeze([
      thread('old'), thread('middle', { projectId: 'web', updatedAt: 10 }),
      thread('newest', { updatedAt: 20 }), thread('created', { projectId: 'web', createdAt: 15 })
    ]);
    expect(list(rows).map(row => [row.thread.id, row.projectName, row.projectColor])).toEqual([
      ['newest', 'Default Project', undefined], ['created', 'Website', '#2f81f7'],
      ['middle', 'Website', '#2f81f7'], ['old', 'Default Project', undefined]
    ]);
    expect(rows.map(row => row.id)).toEqual(['old', 'middle', 'newest', 'created']);
  });

  it('includes only current-Mac executions and excludes hidden, archived, SSH and other-daemon projects', () => {
    const rows = [thread('local'), thread('bound-local', { projectId: 'web' }),
      thread('scratch-on-other-host', { hostId: 'devbox' }), thread('local-project-on-other-host', { projectId: 'web', hostId: 'devbox' }),
      thread('ssh-on-local-daemon', { projectId: 'remote' }), thread('other-daemon-project', { projectId: 'daemon' }),
      thread('hidden', { visibility: 'hidden', parentThreadId: 'local' }), thread('archived', { archivedAt: 1 })];
    expect(idsOf(list(rows))).toEqual(['local', 'bound-local']);
    expect(basicConversationRows(rows, projects, undefined, '', null)).toEqual([]);
  });

  it('groups by project identity even when project labels match and keeps the input sort order', () => {
    const rows = list([
      thread('latest', { projectId: 'missing-b', updatedAt: 30 }),
      thread('middle', { projectId: 'missing-a', updatedAt: 10 }),
      thread('newest', { projectId: 'missing-b', updatedAt: 20 })
    ]);
    const groups = groupBasicConversationRows(rows);
    expect([...groups].map(([id, entries]) => [id, idsOf(entries)])).toEqual([
      ['missing-b', ['latest', 'newest']], ['missing-a', ['middle']]
    ]);
  });

  it('searches project names and conversation titles, respecting dedicated project windows', () => {
    const rows = [thread('one'), thread('two', { projectId: 'web', title: 'Draft introduction' }), thread('three', { projectId: 'web' })];
    expect(idsOf(list(rows, ' WEBSITE '))).toEqual(['two', 'three']);
    expect(idsOf(list(rows, 'introduction'))).toEqual(['two']);
    expect(idsOf(list(rows, 'chat', 'web'))).toEqual(['three']);
    expect(list(rows, 'personal', 'web')).toEqual([]);
    expect(idsOf(list(rows, '', 'personal'))).toEqual(['one']);
  });

  it('keeps identifiable local conversations when project metadata is unavailable and handles untitled chats', () => {
    const rows = list([thread('untitled', { projectId: 'missing', title: null }), thread('empty-title', { title: '' })], 'conversation');
    expect(rows.map(row => [row.projectName, row.thread.id])).toEqual([
      ['Project unavailable', 'untitled'], ['Default Project', 'empty-title']
    ]);
    expect(list([])).toEqual([]);
  });

  describe('view options', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = 100 * DAY;
    const ids = (view: Partial<BasicConversationView>, rows: readonly ThreadListItem[]) =>
      idsOf(basicConversationRows(rows, projects, 'mac', '', null, { ...DEFAULT_BASIC_CONVERSATION_VIEW, ...view }, now));

    it('sorts by created time or by title across projects', () => {
      const rows = [thread('b', { title: 'beta', createdAt: 3, updatedAt: 9 }), thread('a', { title: 'Alpha', createdAt: 1, updatedAt: 20 }),
        thread('w', { projectId: 'web', title: 'zulu', createdAt: 5, updatedAt: 5 }), thread('untitled', { title: null, createdAt: 2, updatedAt: 2 }),
        thread('a2', { title: 'alpha', createdAt: 0, updatedAt: 30 })];
      expect(ids({ sort: 'created' }, rows)).toEqual(['w', 'b', 'untitled', 'a', 'a2']);
      expect(ids({ sort: 'title' }, rows)).toEqual(['a2', 'a', 'b', 'untitled', 'w']);
    });

    it('filters by archived status', () => {
      const rows = [thread('live'), thread('gone', { archivedAt: 5 })];
      expect(ids({ status: 'archived' }, rows)).toEqual(['gone']);
      expect(ids({ status: 'all' }, rows)).toEqual(['live', 'gone']);
    });

    it('keeps active pins first in saved pin order, including pins without an order', () => {
      const rows = [thread('recent', { updatedAt: 45 }), thread('second', { pinnedAt: 2, pinOrder: 2 }),
        thread('legacy', { pinnedAt: 3 }), thread('first', { pinnedAt: 1, pinOrder: 1 }),
        thread('retired', { archivedAt: 7, pinnedAt: 4, pinOrder: 0, updatedAt: 5 })];
      expect(ids({ status: 'all' }, rows)).toEqual(['first', 'second', 'legacy', 'recent', 'retired']);
    });

    it('limits to a last-activity window', () => {
      const rows = [thread('hour', { updatedAt: now - 1000 }), thread('days', { updatedAt: now - 3 * DAY }),
        thread('weeks', { createdAt: now - 20 * DAY }), thread('old', { updatedAt: now - 60 * DAY })];
      expect(ids({ window: 'day' }, rows)).toEqual(['hour']);
      expect(ids({ window: 'week' }, rows)).toEqual(['hour', 'days']);
      expect(ids({ window: 'month' }, rows)).toEqual(['hour', 'days', 'weeks']);
    });

    it('hides plugin- and automation-created conversations when Automations is off', () => {
      const rows = [thread('mine'), thread('bot', { originPluginId: 'bots' })];
      expect(ids({}, rows)).toEqual(['mine', 'bot']);
      expect(ids({ automations: false }, rows)).toEqual(['mine']);
    });
  });
});
