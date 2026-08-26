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

describe('custom-instructions plugin', () => {
  it('derives a stable id', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };
    expect(derivePluginId(pkg.name)).toBe('custom-instructions');
    expect(readPluginManifest(pkg).appEntry).toBe('./app.js');
  });

  it('contributes last-write-wins instructions from settings', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'custom-instructions' });
    await plugin(zcc);
    expect(harness.extraInstructions).toEqual([]);
    harness.setSettings({ instructions: 'Always prefer small diffs.' });
    expect(harness.extraInstructions).toEqual(['Always prefer small diffs.']);
    harness.setSettings({ instructions: 'Be terse.' });
    expect(harness.extraInstructions).toEqual(['Be terse.']);
  });

  it('registers a Settings section', () => {
    const set = collectTestPluginApp(app, 'custom-instructions');
    expect(set.settingsSections[0]?.id).toBe('custom-instructions');
  });
});
