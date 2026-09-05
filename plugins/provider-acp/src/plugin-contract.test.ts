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

describe('provider-acp plugin', () => {
  it('derives a stable id', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const manifest = readPluginManifest(pkg);
    expect(derivePluginId(pkg.name)).toBe('provider-acp');
    expect(manifest.serverEntry).toBe('./server.mjs');
    expect(manifest.appEntry).toBe('./app.tsx');
    expect(manifest.hostEntry).toBe('./src/bridge/bridge.ts');
    expect(manifest.extra.threadProvider).toBe(true);
  });

  it('registers Cursor and OpenCode thread providers', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'provider-acp' });
    await plugin(zcc);
    expect(harness.providers.map((row) => row.id)).toEqual(['acp-cursor', 'acp-opencode']);
    await harness.dispose();
  });

  it('registers Cursor and OpenCode provider icons', () => {
    const set = collectTestPluginApp(app, 'provider-acp');
    expect(set.providerIcons.map((row) => row.providerId)).toEqual(['acp-cursor', 'acp-opencode']);
  });
});
