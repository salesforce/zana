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

describe('provider-codex plugin', () => {
  it('derives a stable id', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const manifest = readPluginManifest(pkg);
    expect(derivePluginId(pkg.name)).toBe('provider-codex');
    expect(manifest.serverEntry).toBe('./server.mjs');
    expect(manifest.appEntry).toBe('./app.tsx');
    expect(manifest.hostEntry).toBe('./src/bridge/bridge.ts');
    expect(manifest.extra.threadProvider).toBe(true);
  });

  it('registers the Codex thread provider', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'provider-codex' });
    await plugin(zcc);
    expect(harness.providers).toMatchObject([
      {
        id: 'codex',
        displayName: 'Codex',
        composerActions: ['plan', 'goal'],
        capabilities: { fork: 'checkpoint', permissionModes: ['accept-edits', 'auto', 'full'] }
      }
    ]);
    expect(harness.settings.memoryEnabled?.type).toBe('boolean');
    expect(harness.settings.subagentsDisabled?.type).toBe('boolean');
    await harness.dispose();
  });

  it('keeps the runtime server.mjs registration in lockstep with server.ts', () => {
    const idsFrom = (src: string) =>
      [...src.matchAll(/experimental_registerProvider\(\{\s*id:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
    const tsIds = idsFrom(readFileSync(join(root, 'server.ts'), 'utf8'));
    const mjsIds = idsFrom(readFileSync(join(root, 'server.mjs'), 'utf8'));
    expect(tsIds).toEqual(['codex']);
    expect(mjsIds).toEqual(tsIds);
  });

  it('registers a Codex provider icon', () => {
    const set = collectTestPluginApp(app, 'provider-codex');
    expect(set.providerIcons.map((row) => row.providerId)).toEqual(['codex']);
    expect(existsSync(join(root, 'icons', 'codex.svg'))).toBe(true);
  });
});
