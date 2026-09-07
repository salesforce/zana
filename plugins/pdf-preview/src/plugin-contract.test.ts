import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import app from '../app.js';
import plugin from '../server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('pdf-preview plugin contract', () => {
  it('derives a stable id and claims pdf files', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };
    expect(derivePluginId(pkg.name)).toBe('pdf-preview');
    expect(readPluginManifest(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).branding.icon).toBe(
      'FileText'
    );
    const set = collectTestPluginApp(app, 'pdf-preview');
    expect(set.fileOpeners[0]?.id).toBe('pdf');
    expect(set.fileOpeners[0]?.extensions).toEqual(['pdf']);
    expect(set.fileOpeners[0]?.title).toBe('PDF viewer');
  });

  it('loads without registering server surfaces', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'pdf-preview' });
    await plugin(zcc);
    expect(harness.cli).toBeNull();
    expect(harness.httpRoutes).toEqual([]);
  });
});
