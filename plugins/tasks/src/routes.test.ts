import { describe, expect, it } from 'vitest';
import { parseTasksRoute, resolveTasksRoute, subPathForRoute } from './routes.js';

describe('tasks routes', () => {
  it('parses list, board, and task keys', () => {
    expect(parseTasksRoute('')).toEqual({ kind: 'browse' });
    expect(parseTasksRoute('list')).toEqual({ kind: 'browse', view: 'list' });
    expect(parseTasksRoute('board')).toEqual({ kind: 'browse', view: 'board' });
    expect(parseTasksRoute('task/TSK-9')).toEqual({ kind: 'task', taskKey: 'TSK-9' });
  });

  it('fills a missing view from the stored fallback', () => {
    expect(resolveTasksRoute('', 'board')).toEqual({ kind: 'browse', view: 'board' });
    expect(resolveTasksRoute('list', 'board')).toEqual({ kind: 'browse', view: 'list' });
    expect(resolveTasksRoute('task/TSK-1', 'board')).toEqual({ kind: 'task', taskKey: 'TSK-1' });
  });

  it('serializes routes back to subPaths', () => {
    expect(subPathForRoute({ kind: 'browse', view: 'list' })).toBe('');
    expect(subPathForRoute({ kind: 'browse', view: 'board' })).toBe('board');
    expect(subPathForRoute({ kind: 'task', taskKey: 'TSK-3' })).toBe('task/TSK-3');
  });
});
