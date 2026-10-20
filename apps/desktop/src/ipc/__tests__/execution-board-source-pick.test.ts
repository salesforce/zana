import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const root = mkdtempSync(path.join(os.tmpdir(), 'source-pick-'));
const projectDir = path.join(root, 'project');
const otherDir = path.join(root, 'project', '.zcc');
mkdirSync(otherDir, { recursive: true });
const state = vi.hoisted(() => ({ windows: new Map<string, Function>(), projects: [] as Array<{ id: string; path: string }> }));
const showOpenDialog = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ dialog: { showOpenDialog } }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => state.projects } }));
vi.mock('../shared-product-registry.js', () => ({ registerSharedProduct: vi.fn() }));
import { bindIpcCtx } from '../ctx.js';
import { registerExecutionBoardIpc } from '../execution-board.js';

const issue = vi.fn();
const win = { id: 8 };
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  state.windows.clear(); vi.clearAllMocks();
  state.projects = [{ id: 'p1', path: projectDir }];
  bindIpcCtx({
    safeHandle: vi.fn(), safeHandleFromWindow: (channel: string, fn: Function) => state.windows.set(channel, fn),
    ptys: { list: () => [] }, teams: { list: () => [] }, personas: { list: () => [] },
    windows: new Map([[7, { projectId: 'other' }]]), executionSources: { issue }
  } as any);
  registerExecutionBoardIpc();
});
const pick = (w: unknown, id: unknown) => state.windows.get(IPC.executionSources.pick)!(w, id);

it('returns NOT_FOUND for an unknown project without opening a dialog', async () => {
  expect(await pick(win, 'nope')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(await pick(win, 5)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(showOpenDialog).not.toHaveBeenCalled();
});

it('returns NOT_FOUND for a window scoped to another project', async () => {
  expect(await pick({ id: 7 }, 'p1')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(showOpenDialog).not.toHaveBeenCalled();
});

it('returns [] on cancel and remembers nothing', async () => {
  showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
  expect(await pick(win, 'p1')).toEqual({ ok: true, value: [] });
  showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
  await pick(win, 'p1');
  expect(showOpenDialog.mock.calls[1][1].defaultPath).toBe(projectDir);
  expect(issue).not.toHaveBeenCalled();
});

it('opens in the project with hidden files, then in the last picked folder', async () => {
  const file = path.join(otherDir, 'a.md');
  issue.mockResolvedValue([{ id: 's1' }]);
  showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [file] });
  expect(await pick(win, 'p1')).toEqual({ ok: true, value: [{ id: 's1' }] });
  const first = showOpenDialog.mock.calls[0];
  expect(first[0]).toBe(win);
  expect(first[1].properties).toContain('showHiddenFiles');
  expect(first[1].defaultPath).toBe(projectDir);
  expect(issue).toHaveBeenCalledWith({ windowId: 8, projectId: 'p1', paths: [file] });
  await pick(win, 'p1');
  expect(showOpenDialog.mock.calls[1][1].defaultPath).toBe(otherDir);
});

it('returns the error and remembers nothing when issue throws', async () => {
  issue.mockRejectedValueOnce(new Error('denied'));
  showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path.join(otherDir, 'a.md')] });
  expect(await pick(win, 'p1')).toMatchObject({ ok: false, code: 'SOURCE_SELECTION_FAILED', message: 'denied' });
  await pick(win, 'p1');
  expect(showOpenDialog.mock.calls[1][1].defaultPath).toBe(projectDir);
});
