import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { control } = vi.hoisted(() => ({ control: vi.fn(async () => ({ ok: true, value: { prompt: 'Live', updatedAt: '2026-10-06' } })) }));
vi.mock('../lib/control-client.js', () => ({ isAppRunning: () => true, callControlPlane: control }));
import { runCli } from '../lib/run-cli.js';
const dirs: string[] = [];
afterEach(() => { control.mockClear(); for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });
const cli = (args: string[]) => runCli(['node', 'zcc', 'schedule', ...args, '--json'], { dataDir: '/instance' });
it.each(['get', 'reload'])('reads %s from the running app', async command => {
  const result = await cli([command, 'task']); expect(result.exitCode).toBe(0);
  expect(control).toHaveBeenCalledWith(expect.objectContaining({ op: `sched.${command}`, args: { id: 'task' } }));
  expect(JSON.parse(result.stdout)).toMatchObject({ prompt: 'Live', updatedAt: '2026-10-06' });
});
it('sends a JSON definition patch without flattening multiline prompts or array arguments', async () => {
  const patch = { prompt: 'First\nSecond', extraArgs: ['--effort', 'high'], cron: '0 9 * * *', tz: 'Europe/Zurich' };
  expect((await cli(['update', 'task', '--patch', JSON.stringify(patch)])).exitCode).toBe(0);
  expect(control).toHaveBeenCalledWith(expect.objectContaining({ op: 'sched.update', args: { id: 'task', patch } }));
});
it('loads a bounded patch file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'schedule-cli-')); dirs.push(root); const path = join(root, 'patch.json');
  writeFileSync(path, JSON.stringify({ prompt: 'File prompt' }));
  expect((await cli(['update', 'task', '--patch-file', path])).exitCode).toBe(0);
  expect(control).toHaveBeenCalledWith(expect.objectContaining({ args: { id: 'task', patch: { prompt: 'File prompt' } } }));
  control.mockClear(); writeFileSync(path, ' '.repeat(1_000_001));
  expect((await cli(['update', 'task', '--patch-file', path])).exitCode).toBe(2); expect(control).not.toHaveBeenCalled();
});
it.each([['get'], ['reload'], ['update'], ['update', 'task', '--patch', '{'], ['update', 'task', '--patch', '[]'], ['update', 'task', '--patch-file', '/missing/patch'], ['update', 'task', '--bad', '{}']].map(args => [args]))('rejects invalid input before calling the app: %j', async args => {
  expect((await cli(args)).exitCode).toBe(2); expect(control).not.toHaveBeenCalled();
});
