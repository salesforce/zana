import { describe, expect, it } from 'vitest';
import { toSessionInfo } from '../sessionInfo';

describe('toSessionInfo', () => {
  it('projects a core session onto the SDK SessionInfo shape', () => {
    const session = {
      id: 'sess-1',
      projectId: 'proj-1',
      title: 'Build the thing',
      status: 'running',
      // Extra core fields the SDK projection must drop:
      profile: 'claude',
      cwd: '/tmp/x',
      createdAt: 123,
      headless: true
    };
    expect(toSessionInfo(session)).toEqual({
      id: 'sess-1',
      projectId: 'proj-1',
      title: 'Build the thing',
      status: 'running'
    });
  });

  it('only carries the four SessionInfo keys', () => {
    const info = toSessionInfo({
      id: 'a',
      projectId: 'b',
      title: 'c',
      status: 'exited'
    });
    expect(Object.keys(info).sort()).toEqual(['id', 'projectId', 'status', 'title']);
  });
});
