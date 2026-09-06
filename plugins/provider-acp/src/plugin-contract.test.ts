import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import app from '../app.tsx';
import plugin from '../server.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ACP_PROVIDER_IDS = ['acp-cursor', 'acp-opencode', 'acp-omp', 'acp-grok', 'acp-hermes-agent'] as const;

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

  it('registers Cursor, OpenCode, and extra ACP thread providers', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'provider-acp' });
    await plugin(zcc);
    expect(harness.providers.map((row) => row.id)).toEqual([...ACP_PROVIDER_IDS]);
    expect(harness.providers.find((row) => row.id === 'acp-cursor')).toMatchObject({
      displayName: 'Cursor',
      composerActions: [],
      capabilities: { fork: 'tip', permissionModes: ['accept-edits', 'full'] }
    });
    expect(harness.providers.find((row) => row.id === 'acp-opencode')).toMatchObject({
      displayName: 'OpenCode',
      visibility: 'installed',
      composerActions: [],
      capabilities: { fork: 'tip', permissionModes: ['accept-edits', 'full'] }
    });
    expect(harness.providers.find((row) => row.id === 'acp-omp')).toMatchObject({
      displayName: 'OMP',
      visibility: 'installed'
    });
    expect(harness.providers.find((row) => row.id === 'acp-grok')).toMatchObject({
      displayName: 'Grok Build',
      visibility: 'installed'
    });
    expect(harness.settings.customAgents).toMatchObject({ type: 'string', multiline: true });
    await harness.dispose();
  });

  it('keeps the runtime server.mjs registration in lockstep with server.ts', () => {
    const idsFrom = (src: string) =>
      [...src.matchAll(/experimental_registerProvider\(\{\s*id:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
    const tsIds = idsFrom(readFileSync(join(root, 'server.ts'), 'utf8'));
    const mjsIds = idsFrom(readFileSync(join(root, 'server.mjs'), 'utf8'));
    expect(tsIds).toEqual([...ACP_PROVIDER_IDS]);
    expect(mjsIds).toEqual(tsIds);
  });

  it('registers Cursor and OpenCode provider icons', () => {
    const set = collectTestPluginApp(app, 'provider-acp');
    expect(set.providerIcons.map((row) => row.providerId)).toEqual([...ACP_PROVIDER_IDS]);
    const compiled = readFileSync(join(root, 'app.js'), 'utf8');
    for (const file of ['cursor.svg', 'opencode.svg', 'omp.svg', 'grok.svg', 'hermes.svg']) {
      expect(existsSync(join(root, 'icons', file))).toBe(true);
    }
    for (const id of ACP_PROVIDER_IDS) {
      expect(compiled).toContain(`providerId:"${id}"`);
    }
  });
});
