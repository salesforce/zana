/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RECENT_AGENT_LIMIT, readRecentAgents, recordRecentAgent } from './recent-agents.js';
import { readProjectView, rememberProjectView } from './project-view.js';

beforeEach(() => localStorage.clear());

describe('recent agents', () => {
  it('keeps the newest first, without duplicates, up to the limit', () => {
    recordRecentAgent('p', 'a.agent', 1);
    recordRecentAgent('p', 'b.agent', 2);
    recordRecentAgent('p', 'a.agent', 3);
    expect(readRecentAgents()).toEqual([{ projectId: 'p', path: 'a.agent', openedAt: 3 }, { projectId: 'p', path: 'b.agent', openedAt: 2 }]);
    for (let i = 0; i < RECENT_AGENT_LIMIT + 3; i++) recordRecentAgent('q', `${i}.agent`, 10 + i);
    expect(readRecentAgents()).toHaveLength(RECENT_AGENT_LIMIT);
    expect(readRecentAgents()[0].path).toBe(`${RECENT_AGENT_LIMIT + 2}.agent`);
  });

  it('ignores invalid input and drops malformed storage', () => {
    recordRecentAgent('', 'a.agent');
    recordRecentAgent('p', 'x'.repeat(501));
    expect(readRecentAgents()).toEqual([]);
    localStorage.setItem('salesforce:recent-agents', JSON.stringify([{ projectId: 'p', path: 'ok.agent', openedAt: 1 }, { projectId: 1 }, null, 'x']));
    expect(readRecentAgents()).toEqual([{ projectId: 'p', path: 'ok.agent', openedAt: 1 }]);
    localStorage.setItem('salesforce:recent-agents', '{not json');
    expect(readRecentAgents()).toEqual([]);
    localStorage.setItem('salesforce:recent-agents', '{}');
    expect(readRecentAgents()).toEqual([]);
  });

  it('survives storage that refuses writes', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota'); });
    expect(() => recordRecentAgent('p', 'a.agent')).not.toThrow();
    expect(() => rememberProjectView('p', 'data')).not.toThrow();
    spy.mockRestore();
  });
});

describe('project view', () => {
  it('remembers the tab and Studio window views separately', () => {
    rememberProjectView('p', 'data');
    rememberProjectView('p', 'apex', true);
    expect(readProjectView('p')).toBe('data');
    expect(readProjectView('p', true)).toBe('apex');
    expect(readProjectView('other')).toBe('overview');
    expect(readProjectView('other', true)).toBe('agentforce');
  });
});
