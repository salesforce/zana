import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import app from '../app.tsx';
import plugin from '../server.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('provider-pi plugin', () => {
  it('derives a stable id', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const manifest = readPluginManifest(pkg);
    expect(derivePluginId(pkg.name)).toBe('provider-pi');
    expect(manifest.serverEntry).toBe('./server.mjs');
    expect(manifest.appEntry).toBe('./app.tsx');
    expect(manifest.extra.threadProvider).toBe(true);
  });

  it('registers the Pi thread provider', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'provider-pi' });
    await plugin(zcc);
    expect(harness.providers).toMatchObject([{ id: 'pi', displayName: 'Pi' }]);
    await harness.dispose();
  });

  it('registers a Pi provider icon', () => {
    const set = collectTestPluginApp(app, 'provider-pi');
    expect(set.providerIcons[0]?.providerId).toBe('pi');
  });
});
