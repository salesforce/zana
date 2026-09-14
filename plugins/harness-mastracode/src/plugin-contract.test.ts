import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import plugin from '../server.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('harness-mastracode plugin', () => {
  it('derives a stable id and declares a pty planner', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const manifest = readPluginManifest(pkg);
    expect(derivePluginId(pkg.name)).toBe('harness-mastracode');
    expect(manifest.serverEntry).toBe('./server.mjs');
    expect(manifest.ptyEntry).toBe('./pty.ts');
    expect(manifest.appEntry).toBeNull();
    expect(manifest.extra.ptyHarness).toBe(true);
  });

  it('registers the Mastra Code CLI Agent family', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'harness-mastracode' });
    await plugin(zcc);
    expect(harness.ptyHarnesses).toMatchObject([
      { id: 'mastracode', displayName: 'Mastra Code', enableConfigKey: 'harnessMastracodeEnabled' }
    ]);
    await harness.dispose();
  });
});
