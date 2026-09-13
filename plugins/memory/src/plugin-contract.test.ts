import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import { discoverPluginSkillNames } from '@zana-ai/zcc-server/plugins/plugin-skills';
import plugin from '../server.mjs';
import app from '../app.js';
import { createMemorySqlite } from './test-db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('memory plugin contract', () => {
  it('ships a skill, settings section, CLI, and catalog instructions', async () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };
    expect(derivePluginId(pkg.name)).toBe('memory');
    const manifest = readPluginManifest(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
    expect(manifest.skillsRootPaths).toEqual(['skills']);
    expect(discoverPluginSkillNames(root, manifest.skillsRootPaths)).toEqual(['memory']);
    expect(readFileSync(join(root, 'skills/memory/SKILL.md'), 'utf8')).toContain('zcc memory');
    const set = collectTestPluginApp(app, 'memory');
    expect(set.settingsSections[0]?.id).toBe('memory');
    expect(set.settingsSections[0]?.title).toBe('Memory');
    const { zcc, harness } = createFakePluginHost({
      pluginId: 'memory',
      database: createMemorySqlite()
    });
    await plugin(zcc);
    expect(harness.cli?.name).toBe('memory');
    expect(harness.agentTools).toEqual([]);
    expect(harness.extraInstructionProviders).toHaveLength(1);
    const instructions = harness.extraInstructionProviders[0]!({ threadId: 't1', projectId: 'p1' });
    expect(instructions).toContain('Memory index');
    const help = await harness.runCli(['--help']);
    expect(help.stdout).toContain('zcc memory add');
    expect(help.stdout).toContain('zcc memory history');
  });
});
