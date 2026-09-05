import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import app from '../app.tsx';
import plugin from '../server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('plugin-guide plugin', () => {
  it('derives a stable id', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const manifest = readPluginManifest(pkg);
    expect(derivePluginId(pkg.name)).toBe('plugin-guide');
    expect(manifest.appEntry).toBe('./app.js');
    expect(manifest.serverEntry).toBe('./server.mjs');
  });

  it('loads against the fake host', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'plugin-guide' });
    await plugin(zcc);
    await harness.dispose();
  });

  it('registers an extensions-placed Plugin Guide panel', () => {
    const set = collectTestPluginApp(app, 'plugin-guide');
    expect(set.navPanels[0]).toMatchObject({
      id: 'plugin-guide',
      title: 'Plugin Guide',
      icon: 'Puzzle',
      path: 'plugin-guide',
      placement: 'extensions'
    });
  });
});
