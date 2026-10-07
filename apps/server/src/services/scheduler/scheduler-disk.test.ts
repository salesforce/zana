import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Project, ScheduledTask } from '@zana-ai/zcc-domain/product';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/cc-test-home' } }));
const data = vi.hoisted(() => ({ path: '' }));
vi.mock('../../electron-data-dir.js', () => ({ electronZccDataDir: () => data.path }));
import { readSchedule, saveSchedule, listAllSchedules, deleteSchedule, globalDir } from './scheduler-store.js';
const dirs: string[] = [];
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'scheduler-disk-')); dirs.push(root); data.path = join(root, 'state');
  const project = { id: 'p', path: root } as Project;
  const task: ScheduledTask = { id: 'schedule', name: 'Work', projectId: 'p', source: { projectId: 'p' }, enabled: false, profile: 'claude', prompt: 'Old', extraArgs: ['--effort', 'max'], schedule: { every: '5m' }, overlap: 'skip', history: { retain: 10 }, status: { runs: [], runCount: 0 }, createdAt: '2026-10-01', updatedAt: '2026-10-01' };
  const path = join(root, '.zcc', 'schedules', 'schedule.json');
  saveSchedule(task, [project]);
  const disk = () => JSON.parse(readFileSync(path, 'utf8'));
  const edit = (patch: object) => writeFileSync(path, JSON.stringify({ ...disk(), ...patch }));
  return { task, project, path, disk, edit };
}
it('merges runtime status into the current disk definition without relying on timestamps', () => {
  const { task, project, disk, edit } = fixture();
  edit({ prompt: 'New', extraArgs: ['--effort', 'high'], schedule: { every: '1h' } });
  task.status.runCount = 1;
  saveSchedule(task, [project], {});
  expect(disk()).toMatchObject({ prompt: 'New', extraArgs: ['--effort', 'high'], updatedAt: '2026-10-01', schedule: { every: '1h' }, status: { runCount: 1 } });
  expect(task.prompt).toBe('New'); expect(disk()).not.toHaveProperty('source');
});
it('patches only explicit definition fields even when another writer changed the disk after the manager read', () => {
  const { task, project, disk, edit } = fixture();
  edit({ prompt: 'External', extraArgs: ['--effort', 'medium'] });
  saveSchedule({ ...task, enabled: true }, [project], { enabled: true, updatedAt: '2026-10-06' });
  expect(disk()).toMatchObject({ prompt: 'External', extraArgs: ['--effort', 'medium'], enabled: true, updatedAt: '2026-10-06' });
});
it.each(['{', JSON.stringify({ id: 'schedule', schedule: { every: 'bad' } })])('refuses status writes over invalid JSON: %s', content => {
  const { task, project, path } = fixture(); writeFileSync(path, content);
  expect(() => saveSchedule(task, [project], {})).toThrow('Cannot read schedule');
  expect(readFileSync(path, 'utf8')).toBe(content);
});
it('refuses to recreate a deleted definition during a status write', () => {
  const { task, project, path } = fixture(); rmSync(path);
  expect(() => saveSchedule(task, [project], {})).toThrow('Cannot read schedule');
});
it.each([{ id: 'different' }, { projectId: 'foreign' }])('rejects a mismatched file identity: %j', patch => {
  const { task, project, edit } = fixture(); edit(patch);
  expect(() => readSchedule(task, [project])).toThrow('identity mismatch');
});
it('refuses path-bearing ids and unknown owners', () => {
  const { task, project } = fixture();
  for (const id of ['../escape', '/escape', '.', '..', 'dir\\escape']) expect(() => saveSchedule({ ...task, id }, [project])).toThrow('Invalid schedule id');
  expect(() => readSchedule(task, [])).toThrow('metadata is unavailable');
});
it('cleans up the uniquely named temporary file after a failed rename', () => {
  const { task, project, path } = fixture(); rmSync(path); mkdirSync(path);
  expect(() => saveSchedule(task, [project])).toThrow();
  expect(readdirSync(join(project.path, '.zcc', 'schedules'))).toEqual(['schedule.json']);
});

it('loads global and project definitions with loader-owned sources and logs malformed files', () => {
  const { task, project, path } = fixture();
  saveSchedule({ ...task, id: 'global', source: 'global' }, [project]);
  writeFileSync(join(project.path, '.zcc', 'schedules', 'broken.json'), '{');
  writeFileSync(join(project.path, '.zcc', 'schedules', 'ignore.tmp'), '{}');
  const invalid = vi.fn(); const tasks = listAllSchedules([project], invalid);
  expect(tasks.map(task => [task.id, task.source])).toEqual([['global', 'global'], ['schedule', { projectId: 'p' }]]);
  expect(invalid).toHaveBeenCalledOnce(); expect(invalid.mock.calls[0][1]).toContain('unreadable JSON');
  rmSync(path); rmSync(globalDir(), { recursive: true });
  expect(listAllSchedules([project])).toEqual([]);
});
it('deletes the located global or project file and reports missing files', () => {
  const { task, project } = fixture();
  saveSchedule({ ...task, id: 'global', source: 'global' }, [project]);
  expect(deleteSchedule('global', [project])).toBe(true);
  expect(deleteSchedule(task.id, [project])).toBe(true);
  expect(deleteSchedule('missing', [project])).toBe(false);
});
