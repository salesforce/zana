import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ home: '', config: {} as { cloneRoot?: string }, projects: [] as any[], pick: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: { showOpenDialog: state.pick } }));
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => state.home }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { getConfig: () => state.config, listProjects: () => state.projects } }));
import { repairPluginSource } from './plugin-source-repair';
const supervisor = { listPluginApps: vi.fn(), repairPlugin: vi.fn() };
let root: string;
const run = (id: unknown = 'example', action: unknown = 'locate', window: any = {}) => repairPluginSource(supervisor as any, id, action, window);
beforeEach(() => {
  vi.resetAllMocks(); root = mkdtempSync(join(tmpdir(), 'plugin-picker-'));
  state.home = join(root, 'home'); mkdirSync(state.home); state.config = {}; state.projects = [];
  supervisor.listPluginApps.mockResolvedValue([{ id: 'example', sourceRecovery: { canLocate: true, canSwitchOfficial: true } }]);
  state.pick.mockResolvedValue({ canceled: false, filePaths: [state.home] });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it('uses the main-owned canonical picker path and never accepts a renderer path', async () => {
  expect(await run()).toEqual({ ok: true, value: true });
  expect(supervisor.repairPlugin).toHaveBeenCalledWith('example', realpathSync(state.home));
  expect(await run('example', { path: state.home })).toMatchObject({ code: 'BAD_REQUEST' });
});
it.each(['../escape', '', 3])('rejects invalid identities: %s', async id => {
  expect(await run(id)).toMatchObject({ code: 'BAD_REQUEST' }); expect(state.pick).not.toHaveBeenCalled();
});
it('handles unavailable runtime, stale choices, missing window and cancellation', async () => {
  expect(await repairPluginSource(null, 'example', 'locate', null)).toMatchObject({ code: 'UNAVAILABLE' });
  expect(await run('example', 'locate', null)).toMatchObject({ code: 'NO_WINDOW' });
  state.pick.mockResolvedValue({ canceled: true, filePaths: [] });
  expect(await run()).toMatchObject({ code: 'CANCELED' });
  supervisor.listPluginApps.mockResolvedValue([]); expect(await run()).toMatchObject({ code: 'UNAVAILABLE' });
});
it('resolves official sources in the server, without a folder picker', async () => {
  expect(await run('example', 'official', null)).toEqual({ ok: true, value: true });
  expect(supervisor.repairPlugin).toHaveBeenCalledWith('example', undefined); expect(state.pick).not.toHaveBeenCalled();
  supervisor.listPluginApps.mockResolvedValue([{ id: 'example', sourceRecovery: { canLocate: true, canSwitchOfficial: false } }]);
  expect(await run('example', 'official')).toMatchObject({ code: 'UNAVAILABLE' });
});
it('confines symlink destinations and ignores remote project paths', async () => {
  const outside = join(root, 'outside'); mkdirSync(outside); const link = join(state.home, 'link'); symlinkSync(outside, link);
  state.pick.mockResolvedValue({ canceled: false, filePaths: [link] });
  state.projects = [{ path: outside, remote: { host: 'remote' } }];
  expect(await run()).toMatchObject({ code: 'BAD_SOURCE' }); expect(supervisor.repairPlugin).not.toHaveBeenCalled();
  state.projects = [{ path: outside }]; expect(await run()).toMatchObject({ ok: true });
});
it('allows a configured clone root and tolerates invalid roots', async () => {
  const clone = join(root, 'clone'); mkdirSync(clone); state.pick.mockResolvedValue({ canceled: false, filePaths: [clone] });
  state.config = { cloneRoot: clone }; expect(await run()).toMatchObject({ ok: true });
  state.config = { cloneRoot: 'relative' }; state.projects = [{ path: join(root, 'missing') }]; expect(await run()).toMatchObject({ code: 'BAD_SOURCE' });
});
it.each([new Error('activation failed'), 'failed'])('reports failures without claiming recovery: %s', async error => {
  supervisor.repairPlugin.mockRejectedValue(error); expect(await run()).toMatchObject({ code: 'REPAIR_FAILED' });
});
