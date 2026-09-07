import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import plugin from '../server.js';
import app from '../app.tsx';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('side-chat plugin', () => {
  it('derives a stable id', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(derivePluginId(pkg.name)).toBe('side-chat');
    expect(readPluginManifest(pkg).appEntry).toBe('./app.tsx');
    expect(readPluginManifest(pkg).serverEntry).toBe('./server.ts');
  });

  it('loads against the fake host without configuring every agent', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'side-chat' });
    await plugin(zcc);
    expect(harness.agentConfigurers).toHaveLength(0);
    expect(harness.schedules.some((row) => row.name === 'empty-fork-cleanup')).toBe(true);
  });

  it('registers its app slots', () => {
    const set = collectTestPluginApp(app, 'side-chat');
    expect(set.messageActions[0]?.id).toBe('reply-in-side-chat');
    expect(set.threadPanelActions[0]?.id).toBe('side-chat');
    expect(set.threadPanelActions[0]?.layout).toBe('flush');
  });
});
