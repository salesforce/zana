import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import plugin from '../server.ts';

vi.mock('../src/app/styles.css', () => ({ default: '.tsk-panel{}' }));
vi.mock('@zana-ai/zcc-ui/kanban.css', () => ({ default: '.zcc-kanban{}' }));

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('tasks plugin', () => {
  it('is official (stable id) and ships a skill', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(derivePluginId(pkg.name)).toBe('tasks');
    const manifest = readPluginManifest(pkg);
    expect(manifest.skillsRootPaths).toEqual(['skills']);
    expect(readFileSync(join(root, 'skills/tasks/SKILL.md'), 'utf8')).toContain('zcc tasks');
    expect(manifest.appEntry).toBe('./app.js');
    expect(manifest.serverEntry).toBe('./server.mjs');
  });

  it('registers zcc tasks and lists/adds/updates items', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'tasks' });
    await plugin(zcc);
    expect(harness.cli?.name).toBe('tasks');
    const added = (await harness.callRpc('add', { title: 'Loop', priority: 'high' })) as {
      id: string;
      key: string;
      title: string;
      status: string;
    };
    expect(added).toMatchObject({ title: 'Loop', key: 'TSK-1', status: 'todo' });
    const listed = await harness.cli!.run(['list'], { pluginId: 'tasks', argv: ['list'] });
    expect(listed.stdout).toContain('Loop');
    expect(listed.stdout).toContain('TSK-1');
    await harness.callRpc('update', { key: 'TSK-1', status: 'in_progress' });
    const shown = await harness.cli!.run(['show', 'TSK-1'], { pluginId: 'tasks', argv: ['show', 'TSK-1'] });
    expect(shown.stdout).toContain('in_progress');
    const toggled = (await harness.callRpc('toggle', { id: added.id })) as { done: boolean; status: string };
    expect(toggled.done).toBe(true);
    expect(toggled.status).toBe('done');
    expect(harness.mentionProviders[0]).toMatchObject({ id: 'task', label: 'Tasks' });
    await expect(harness.mentionProviders[0]!.search({ query: 'Loop' })).resolves.toEqual([
      expect.objectContaining({ label: expect.stringContaining('Loop'), insertText: '::task{key="TSK-1"}' })
    ]);
    await expect(harness.mentionProviders[0]!.search({} as never)).resolves.toEqual([]);
    await expect(harness.mentionProviders[0]!.resolve(added.id)).resolves.toMatchObject({
      context: expect.stringContaining('Loop')
    });
    expect(harness.published.some((row) => row.event === 'tasks-changed')).toBe(true);
    const badge = (await harness.callRpc('badge')) as { count: number | null };
    expect(badge.count).toBeNull();
    await harness.callRpc('update', { key: 'TSK-1', status: 'todo' });
    await expect(harness.callRpc('badge')).resolves.toEqual({ count: 1 });
  });

  it('migrates the legacy checkbox list from KV', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'tasks' });
    await zcc.storage.kv.set('items', [{ id: 'old', title: 'Legacy', done: true }]);
    await plugin(zcc);
    const listed = (await harness.callRpc('list')) as { items: Array<{ key: string; status: string; title: string }> };
    expect(listed.items).toEqual([expect.objectContaining({ title: 'Legacy', status: 'done', key: 'TSK-1' })]);
  });

  it('moves a card on the board and removes it', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'tasks' });
    await plugin(zcc);
    const added = (await harness.callRpc('add', { title: 'Move me' })) as { id: string };
    await harness.callRpc('boardMove', { id: added.id, status: 'in_review', index: 0 });
    const listed = (await harness.callRpc('list')) as { items: Array<{ status: string }> };
    expect(listed.items[0]?.status).toBe('in_review');
    await harness.callRpc('remove', { id: added.id });
    await expect(harness.callRpc('list')).resolves.toEqual({ items: [] });
  });

  it('covers CLI help and error exits', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'tasks' });
    await plugin(zcc);
    const help = await harness.cli!.run(['--help'], { pluginId: 'tasks', argv: ['--help'] });
    expect(help.stdout).toContain('zcc tasks list');
    const empty = await harness.cli!.run(['list'], { pluginId: 'tasks', argv: ['list'] });
    expect(empty.stdout).toBe('No tasks.\n');
    const missingAdd = await harness.cli!.run(['add'], { pluginId: 'tasks', argv: ['add'] });
    expect(missingAdd.exitCode).toBe(2);
    const created = await harness.cli!.run(['add', 'Ship', '--priority', 'high'], {
      pluginId: 'tasks',
      argv: ['add', 'Ship', '--priority', 'high']
    });
    expect(created.stdout).toContain('TSK-1');
    const done = await harness.cli!.run(['done', 'TSK-1'], { pluginId: 'tasks', argv: ['done', 'TSK-1'] });
    expect(done.stdout).toMatch(/^done /);
    const update = await harness.cli!.run(['update', 'TSK-1', '--status', 'todo'], {
      pluginId: 'tasks',
      argv: ['update', 'TSK-1', '--status', 'todo']
    });
    expect(update.stdout).toContain('todo');
    const unknown = await harness.cli!.run(['nope'], { pluginId: 'tasks', argv: ['nope'] });
    expect(unknown.exitCode).toBe(2);
    const missingShow = await harness.cli!.run(['show', 'TSK-9'], { pluginId: 'tasks', argv: ['show', 'TSK-9'] });
    expect(missingShow.exitCode).toBe(3);
    await expect(harness.callRpc('get', { key: 'TSK-1' })).resolves.toMatchObject({
      task: expect.objectContaining({ key: 'TSK-1' })
    });
    await expect(harness.callRpc('add', { title: '  ' })).rejects.toThrow(/title is required/);
    const filtered = await harness.cli!.run(['list', '--status', 'todo'], {
      pluginId: 'tasks',
      argv: ['list', '--status', 'todo']
    });
    expect(filtered.stdout).toContain('Ship');
    const badStatus = await harness.cli!.run(['update', 'TSK-1', '--status', 'nope'], {
      pluginId: 'tasks',
      argv: ['update', 'TSK-1', '--status', 'nope']
    });
    expect(badStatus.exitCode).toBe(2);
    expect((await harness.cli!.run(['done'], { pluginId: 'tasks', argv: ['done'] })).exitCode).toBe(2);
    expect((await harness.cli!.run(['update'], { pluginId: 'tasks', argv: ['update'] })).exitCode).toBe(2);
    expect((await harness.cli!.run(['show'], { pluginId: 'tasks', argv: ['show'] })).exitCode).toBe(2);
    expect((await harness.cli!.run(['done', 'TSK-9'], { pluginId: 'tasks', argv: ['done', 'TSK-9'] })).exitCode).toBe(3);
    expect((await harness.cli!.run(['update', 'TSK-9'], { pluginId: 'tasks', argv: ['update', 'TSK-9'] })).exitCode).toBe(3);
  });

  it('registers a Tasks nav panel, thread panel, and task directive', async () => {
    const { default: app } = await import('../app.tsx');
    const set = collectTestPluginApp(app, 'tasks');
    expect(set.navPanels[0]?.title).toBe('Tasks');
    expect(typeof set.navPanels[0]?.experimental_sidebarAccessory).toBe('function');
    expect(set.threadPanelActions[0]?.id).toBe('board');
    expect(set.threadPanelActions[0]?.scopes).toEqual(['thread', 'agent-session']);
    expect(set.threadPanelActions[0]?.layout).toBe('flush');
    expect(set.messageDirectives[0]?.id).toBe('task');
    expect(set.commandPaletteActions[0]?.id).toBe('open');
    expect(existsSync(join(root, 'app.js'))).toBe(true);
    expect(existsSync(join(root, 'server.mjs'))).toBe(true);
    expect(readFileSync(join(root, 'app.js'), 'utf8')).toContain('tsk-panel');
    expect(readFileSync(join(root, 'app.js'), 'utf8')).not.toMatch(/from ["']react["']/);
  });
});
