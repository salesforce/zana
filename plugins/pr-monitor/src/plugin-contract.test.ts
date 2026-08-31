import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import plugin from '../server.ts';

vi.mock('../src/app/styles.css', () => ({ default: '.prm-panel{}' }));

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('pr-monitor plugin contract', () => {
  it('derives id pr-monitor and registers a nav panel with a badge accessory', async () => {
    const manifest = readPluginManifest(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
    expect(derivePluginId(manifest.packageName)).toBe('pr-monitor');
    expect(manifest.name).toBe('PR Monitor');
    expect(manifest.appEntry).toBe('./app.js');
    expect(manifest.serverEntry).toBe('./server.mjs');

    const { default: app } = await import('../app.tsx');
    const set = collectTestPluginApp(app, 'pr-monitor');
    expect(set.navPanels).toHaveLength(1);
    expect(set.navPanels[0]?.title).toBe('PR Monitor');
    expect(set.navPanels[0]?.icon).toBe('GitPullRequest');
    expect(typeof set.navPanels[0]?.experimental_sidebarAccessory).toBe('function');
    expect(set.commandPaletteActions).toHaveLength(1);
    expect(set.commandPaletteActions[0]?.id).toBe('open');
    expect(set.commandPaletteActions[0]?.title).toBe('Open PR Monitor');

    const appJs = readFileSync(join(root, 'app.js'), 'utf8');
    expect(appJs).toContain('__ZCC_HOST_REACT__');
    expect(appJs).toContain('prm-panel');
    expect(appJs).not.toMatch(/from ["']react["']/);
    expect(appJs).not.toMatch(/from ["']react\/jsx-runtime["']/);
    expect(existsSync(join(root, 'server.mjs'))).toBe(true);
    expect(readFileSync(join(root, 'server.mjs'), 'utf8')).toMatch(/\bas default\b/);
  });

  it('registers RPC methods used by the panel', async () => {
    const { zcc, harness } = createFakePluginHost({
      pluginId: 'pr-monitor',
      listProjects: async () => [{ id: 'p1', name: 'Alpha' }],
      pushInbox: async () => ({ id: 'inb-1' })
    });
    const exec = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'offline' }));
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-prm-contract-'));
    dirs.push(dataDir);
    await plugin(zcc, { exec, startBackground: false, dataDir });
    expect(harness.rpc.has('listPrs')).toBe(true);
    expect(harness.rpc.has('pollAll')).toBe(true);
    expect(harness.rpc.has('storageGet')).toBe(true);
    expect(harness.rpc.has('badge')).toBe(true);
    await expect(harness.callRpc('listProjects')).resolves.toEqual([{ id: 'p1', name: 'Alpha' }]);
    await harness.dispose();
  });
});
