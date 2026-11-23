import { describe, expect, it } from 'vitest';
import type { ThreadListItem } from '../../thread-store.js';
import { basicConversationGroups } from './basic-conversation-groups.js';

const projects = [
  { id: 'personal', name: 'zcc-workspace', quickAgent: true },
  { id: 'web', name: 'Website', hostId: 'mac' },
  { id: 'remote', name: 'SSH project', remote: { host: 'devbox', remotePath: '/work' } },
  { id: 'daemon', name: 'Other machine', hostId: 'devbox' }
];
function thread(id: string, patch: Partial<ThreadListItem> = {}): ThreadListItem {
  return { id, projectId: 'personal', hostId: 'mac', environmentId: null, providerId: 'fake', status: 'idle',
    title: `Chat ${id}`, createdAt: 1, cwd: null, branchName: null, isWorktree: false, ...patch };
}
const group = (threads: readonly ThreadListItem[], query = '', scope: string | null = null, hostId: string | undefined = 'mac') =>
  basicConversationGroups(threads, projects, hostId, query, scope);

describe('Basic project conversation groups', () => {
  it('sorts projects and their conversations by recent activity without mutating the roster', () => {
    const rows = Object.freeze([
      thread('old'), thread('middle', { projectId: 'web', updatedAt: 10 }),
      thread('newest', { updatedAt: 20 }), thread('created', { projectId: 'web', createdAt: 15 })
    ]);
    const groups = group(rows);
    expect(groups.map(row => [row.projectId, row.name, row.threads.map(thread => thread.id)])).toEqual([
      ['personal', 'Default Project', ['newest', 'old']], ['web', 'Website', ['created', 'middle']]
    ]);
    expect(rows.map(row => row.id)).toEqual(['old', 'middle', 'newest', 'created']);
    expect(group([rows[0]!, rows[1]!]).map(row => row.projectId)).toEqual(['web', 'personal']);
  });

  it('includes only current-Mac executions and excludes hidden, archived, SSH and other-daemon projects', () => {
    const rows = [thread('local'), thread('bound-local', { projectId: 'web' }),
      thread('scratch-on-other-host', { hostId: 'devbox' }), thread('local-project-on-other-host', { projectId: 'web', hostId: 'devbox' }),
      thread('ssh-on-local-daemon', { projectId: 'remote' }), thread('other-daemon-project', { projectId: 'daemon' }),
      thread('hidden', { visibility: 'hidden', parentThreadId: 'local' }), thread('archived', { archivedAt: 1 })];
    expect(group(rows).flatMap(row => row.threads.map(thread => thread.id))).toEqual(['local', 'bound-local']);
    expect(basicConversationGroups(rows, projects, undefined, '', null)).toEqual([]);
  });

  it('searches project names and conversation titles, respecting dedicated project windows', () => {
    const rows = [thread('one'), thread('two', { projectId: 'web', title: 'Draft introduction' }), thread('three', { projectId: 'web' })];
    expect(group(rows, ' WEBSITE ').flatMap(row => row.threads.map(thread => thread.id))).toEqual(['two', 'three']);
    expect(group(rows, 'introduction').flatMap(row => row.threads.map(thread => thread.id))).toEqual(['two']);
    expect(group(rows, 'chat', 'web').flatMap(row => row.threads.map(thread => thread.id))).toEqual(['three']);
    expect(group(rows, 'personal', 'web')).toEqual([]);
    expect(group(rows, '', 'personal').flatMap(row => row.threads.map(thread => thread.id))).toEqual(['one']);
  });

  it('keeps identifiable local conversations when project metadata is unavailable and handles untitled chats', () => {
    const groups = group([thread('untitled', { projectId: 'missing', title: null }), thread('empty-title', { title: '' })], 'conversation');
    expect(groups.map(row => [row.name, row.threads[0]?.id])).toEqual([
      ['Project unavailable', 'untitled'], ['Default Project', 'empty-title']
    ]);
    expect(group([])).toEqual([]);
  });
});
