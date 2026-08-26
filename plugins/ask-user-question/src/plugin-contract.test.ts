import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import { discoverPluginSkillNames } from '@zana-ai/zcc-server/plugins/plugin-skills';
import plugin from '../server.mjs';
import app from '../app.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('ask-user-question plugin', () => {
  it('derives a stable id and ships a skill', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };
    expect(derivePluginId(pkg.name)).toBe('ask-user-question');
    const manifest = readPluginManifest(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
    expect(discoverPluginSkillNames(root, manifest.skillsRootPaths)).toEqual(['ask-user-question']);
    expect(readFileSync(join(root, 'skills/ask-user-question/SKILL.md'), 'utf8')).toContain(
      'pendingInteraction'
    );
  });

  it('registers ask_user_question and a matching pendingInteraction', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'ask-user-question' });
    await plugin(zcc);
    expect(harness.agentTools[0]?.name).toBe('ask_user_question');
    const set = collectTestPluginApp(app, 'ask-user-question');
    expect(set.pendingInteractions[0]?.id).toBe('ask-user-question');
  });
});
