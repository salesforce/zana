import { describe, expect, it } from 'vitest';
import {
  applyBoardMove,
  createTask,
  dueFromFlag,
  EMPTY_FILTERS,
  formatDueDate,
  formatHelp,
  formatTaskListLine,
  groupColumns,
  groupTasksByStatus,
  hasActiveFilters,
  matchesFilters,
  migrateLegacyItem,
  normalizeStore,
  openTaskCount,
  parseCliArgs,
  patchTask,
  priorityFromFlag,
  sortTasks,
  statusFromFlag,
  taskKey,
  toggleDone,
  toPublic,
  visibleBoardStatuses
} from './model.js';

describe('task model', () => {
  it('mints sequential keys and public done flags', () => {
    const { task, nextSeq } = createTask({ title: ' Ship it ' }, { nextSeq: 1, now: 10 });
    expect(task.key).toBe('TSK-1');
    expect(task.title).toBe('Ship it');
    expect(task.status).toBe('todo');
    expect(nextSeq).toBe(2);
    expect(toPublic(task).done).toBe(false);
    expect(taskKey(12)).toBe('TSK-12');
  });

  it('rejects a blank title', () => {
    expect(() => createTask({ title: '  ' }, { nextSeq: 1 })).toThrow(/title is required/);
  });

  it('migrates the v1 checkbox list into tracker tasks', () => {
    const store = normalizeStore(
      [
        { id: 'a', title: 'Open', done: false },
        { id: 'b', title: 'Closed', done: true },
        { title: '' },
        null
      ],
      50
    );
    expect(store.version).toBe(2);
    expect(store.items).toHaveLength(2);
    expect(store.items[0]).toMatchObject({ id: 'a', key: 'TSK-1', status: 'todo' });
    expect(store.items[1]).toMatchObject({ id: 'b', key: 'TSK-2', status: 'done' });
    expect(store.nextSeq).toBe(3);
  });

  it('loads a v2 store and advances nextSeq past existing keys', () => {
    const store = normalizeStore({
      version: 2,
      nextSeq: 2,
      items: [{ id: 'x', key: 'TSK-9', title: 'Later', status: 'in_progress', priority: 'high' }]
    });
    expect(store.items[0]?.key).toBe('TSK-9');
    expect(store.nextSeq).toBe(10);
  });

  it('treats junk storage as empty', () => {
    expect(normalizeStore('nope').items).toEqual([]);
    expect(normalizeStore(4).items).toEqual([]);
  });

  it('patches, toggles done, and filters by status/priority', () => {
    const { task } = createTask({ title: 'A', status: 'todo', priority: 'low' }, { nextSeq: 1, now: 1 });
    const updated = patchTask(task, { status: 'in_progress', priority: 'urgent', dueDate: '2026-09-12' }, 2);
    expect(updated.status).toBe('in_progress');
    expect(updated.dueDate).toBe('2026-09-12');
    expect(toggleDone(updated, 3).status).toBe('done');
    expect(toggleDone({ ...updated, status: 'done' }).status).toBe('todo');
    expect(matchesFilters(updated, EMPTY_FILTERS)).toBe(true);
    expect(matchesFilters(updated, { statuses: ['todo'], priorities: [] })).toBe(false);
    expect(matchesFilters(updated, { statuses: [], priorities: ['urgent'] })).toBe(true);
    expect(hasActiveFilters({ statuses: ['todo'], priorities: [] })).toBe(true);
    expect(() => patchTask(task, { title: '  ' })).toThrow(/title is required/);
  });

  it('groups by status and sorts by priority and due date', () => {
    const a = createTask({ title: 'A', priority: 'low', dueDate: '2026-09-20' }, { nextSeq: 1, now: 1 }).task;
    const b = createTask({ title: 'B', priority: 'urgent', dueDate: null }, { nextSeq: 2, now: 2 }).task;
    const c = {
      ...createTask({ title: 'C', status: 'done', dueDate: '2026-01-01' }, { nextSeq: 3, now: 3 }).task
    };
    const grouped = groupTasksByStatus([c, a]);
    expect(grouped.map((group) => group.status)).toEqual(['todo', 'done']);
    expect(sortTasks([a, b], 'priority')[0]?.title).toBe('B');
    expect(sortTasks([b, a, c], 'due')[0]?.title).toBe('C');
    expect(sortTasks([b, a], 'due').map((task) => task.title)).toEqual(['A', 'B']);
    expect(sortTasks([b, a], 'manual').map((task) => task.title)).toEqual(['A', 'B']);
  });

  it('moves a card between board columns and hides empty canceled', () => {
    const todo = createTask({ title: 'A', status: 'todo' }, { nextSeq: 1, now: 1 }).task;
    const review = createTask({ title: 'B', status: 'in_review' }, { nextSeq: 2, now: 2 }).task;
    const moved = applyBoardMove([todo, review], todo.id, 'in_progress', 0, 9);
    expect(moved.find((task) => task.id === todo.id)?.status).toBe('in_progress');
    const columns = groupColumns(moved);
    expect(visibleBoardStatuses(columns)).toEqual(['backlog', 'todo', 'in_progress', 'in_review', 'done']);
    const canceled = applyBoardMove(moved, review.id, 'canceled', 0, 10);
    expect(visibleBoardStatuses(groupColumns(canceled))).toContain('canceled');
    expect(applyBoardMove(moved, 'missing', 'todo', 0)).toHaveLength(2);
  });

  it('counts open work and formats list/help/cli flags', () => {
    const open = createTask({ title: 'Open' }, { nextSeq: 1, now: 1 }).task;
    const done = { ...open, id: 'd', key: 'TSK-2', status: 'done' as const };
    expect(openTaskCount([open, done])).toBe(1);
    expect(formatTaskListLine(open)).toContain('TSK-1');
    expect(formatDueDate('not-a-date')).toBe('not-a-date');
    expect(formatDueDate('2020-01-15', new Date('2026-09-11'))).toMatch(/2020/);
    expect(parseCliArgs(['list', '--json']).flags.json).toBe('true');
    expect(formatHelp()).toContain('zcc tasks list');
    expect(parseCliArgs(['add', 'Ship', '--priority', 'high', '--due', '2026-09-12'])).toEqual({
      command: 'add',
      rest: ['Ship'],
      flags: { priority: 'high', due: '2026-09-12' },
      help: false
    });
    expect(parseCliArgs(['--help']).help).toBe(true);
    expect(statusFromFlag('in-progress')).toBe('in_progress');
    expect(statusFromFlag('inreview')).toBe('in_review');
    expect(priorityFromFlag('none')).toBe('none');
    expect(dueFromFlag('clear')).toBeNull();
    expect(dueFromFlag('2026-09-11')).toBe('2026-09-11');
    expect(() => statusFromFlag('nope')).toThrow(/unknown status/);
    expect(() => priorityFromFlag('nope')).toThrow(/unknown priority/);
    expect(() => dueFromFlag('tomorrow')).toThrow(/YYYY-MM-DD/);
  });

  it('migrates a single legacy row with defaults', () => {
    expect(migrateLegacyItem({ title: 'Keep' }, 4, 8)?.key).toBe('TSK-4');
    expect(migrateLegacyItem(null, 1, 1)).toBeNull();
  });
});
