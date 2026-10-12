import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import app from '../app.tsx';
import plugin from '../server.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('provider-claude-code plugin', () => {
  it('derives a stable id', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const manifest = readPluginManifest(pkg);
    expect(derivePluginId(pkg.name)).toBe('provider-claude-code');
    expect(manifest.serverEntry).toBe('./server.mjs');
    expect(manifest.appEntry).toBe('./app.tsx');
    expect(manifest.hostEntry).toBe('./src/host.ts');
    expect(manifest.extra.threadProvider).toBe(true);
  });

  it('registers the Claude Code thread provider', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'provider-claude-code' });
    await plugin(zcc);
    expect(harness.providers).toMatchObject([
      {
        id: 'claude-code',
        displayName: 'Claude Code',
        composerActions: ['plan'],
        capabilities: { fork: 'checkpoint', permissionModes: ['accept-edits', 'auto', 'full'] }
      }
    ]);
    expect(harness.settings.memoryEnabled?.type).toBe('boolean');
    expect(harness.settings.idleQueryReleaseEnabled?.type).toBe('boolean');
    await harness.dispose();
  });

  it('keeps the runtime server.mjs registration in lockstep with server.ts', async () => {
    const retained = await import(pathToFileURL(join(root, 'server.mjs')).href);
    const typedHost = createFakePluginHost({ pluginId: 'provider-claude-code' });
    const runtimeHost = createFakePluginHost({ pluginId: 'provider-claude-code' });
    await plugin(typedHost.zcc);
    await retained.default(runtimeHost.zcc);
    expect(typedHost.harness.providers.map((row) => row.id)).toEqual(['claude-code']);
    expect(runtimeHost.harness.providers.map((row) => row.id)).toEqual(
      typedHost.harness.providers.map((row) => row.id)
    );
    await typedHost.harness.dispose();
    await runtimeHost.harness.dispose();
  });

  it('registers a Claude Code provider icon', () => {
    const set = collectTestPluginApp(app, 'provider-claude-code');
    expect(set.providerIcons.map((row) => row.providerId)).toEqual(['claude-code']);
    expect(existsSync(join(root, 'icons', 'claude-code.svg'))).toBe(true);
  });
});
