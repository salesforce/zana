import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import plugin from '../server.mjs';
import app from '../app.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('tasks plugin', () => {
  it('is official (stable id) and ships a skill', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(derivePluginId(pkg.name)).toBe('tasks');
    const manifest = readPluginManifest(pkg);
    expect(manifest.skillsRootPaths).toEqual(['skills']);
    expect(readFileSync(join(root, 'skills/tasks/SKILL.md'), 'utf8')).toContain('zcc tasks');
  });

  it('registers zcc tasks and lists/adds items', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'tasks' });
    await plugin(zcc);
    expect(harness.cli?.name).toBe('tasks');
    const added = await harness.callRpc('add', { title: 'Loop' });
    expect(added).toMatchObject({ title: 'Loop' });
    const listed = await harness.cli!.run(['list'], { pluginId: 'tasks', argv: ['list'] });
    expect(listed.stdout).toContain('Loop');
    expect(harness.mentionProviders[0]).toMatchObject({ id: 'task', label: 'Tasks' });
    await expect(harness.mentionProviders[0]!.search({ query: 'Loop' })).resolves.toEqual([
      expect.objectContaining({ label: 'Loop' })
    ]);
    const item = added as { id: string };
    await expect(harness.mentionProviders[0]!.resolve(item.id)).resolves.toMatchObject({
      context: expect.stringContaining('Loop')
    });
  });

  it('registers a Tasks nav panel, thread panel, and task directive', () => {
    const set = collectTestPluginApp(app, 'tasks');
    expect(set.navPanels[0]?.title).toBe('Tasks');
    expect(set.threadPanelActions[0]?.id).toBe('board');
    expect(set.messageDirectives[0]?.id).toBe('task');
  });
});
