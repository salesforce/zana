import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import plugin from '../server.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('harness-cursor plugin', () => {
  it('derives a stable id and declares a pty planner', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const manifest = readPluginManifest(pkg);
    expect(derivePluginId(pkg.name)).toBe('harness-cursor');
    expect(manifest.serverEntry).toBe('./server.mjs');
    expect(manifest.ptyEntry).toBe('./pty.ts');
    expect(manifest.extra.ptyHarness).toBe(true);
  });

  it('registers the Cursor CLI Agent family', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'harness-cursor' });
    await plugin(zcc);
    expect(harness.ptyHarnesses).toMatchObject([
      { id: 'cursor', displayName: 'Cursor', enableConfigKey: 'harnessCursorEnabled' }
    ]);
    await harness.dispose();
  });
});
