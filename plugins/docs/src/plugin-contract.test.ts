import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { discoverPluginSkillNames } from '@zana-ai/zcc-server/plugins/plugin-skills';
import app from '../app.tsx';
import plugin from '../server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('docs plugin contract', () => {
  it('derives a stable id and ships the library-curator skill', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };
    expect(derivePluginId(pkg.name)).toBe('docs');
    const manifest = readPluginManifest(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
    expect(manifest.skillsRootPaths).toEqual(['skills']);
    expect(discoverPluginSkillNames(root, manifest.skillsRootPaths)).toEqual(['library-curator']);
    expect(manifest.projectTab?.label).toBe('Library');
    expect(manifest.projectTab?.global).toBe(true);
  });

  it('registers a compiled Docs rail + Library project tab under the renderer root', () => {
    const src = readFileSync(
      join(root, '../../apps/app/src/views/library/module.ts'),
      'utf8'
    );
    expect(src).toMatch(/id:\s*'docs'/);
    expect(src).toMatch(/title:\s*'Docs'/);
    expect(src).toMatch(/icon:\s*'Library'/);
    expect(src).toMatch(/label:\s*'Library'/);
    expect(src).toMatch(/global:\s*true/);
  });

  it('registers file opener, doc directive, and document panel without a navPanel', () => {
    const set = collectTestPluginApp(app, 'docs');
    expect(set.navPanels).toHaveLength(0);
    expect(set.threadPanelActions).toHaveLength(1);
    expect(set.threadPanelActions[0]?.id).toBe('document');
    expect(set.newThreadPanelActions).toHaveLength(0);
    expect(set.fileOpeners[0]?.extensions).toEqual(['md', 'mdx']);
    expect(set.messageDirectives[0]?.id).toBe('doc');
  });

  it('tells the curator skill to emit ::doc after library_write', () => {
    const skill = readFileSync(join(root, 'skills/library-curator/SKILL.md'), 'utf8');
    expect(skill).toMatch(/After every `library_write`/);
    expect(skill).toMatch(/library-relative/);
    expect(skill).toMatch(/Do not call `preview_file` for Library documents/);
  });

  it('searches and resolves Library documents from mention providers', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'docs' });
    harness.sdk.stub('library.list', async () => [
      { id: 'project:p1:findings/auth.md', relPath: 'findings/auth.md', title: 'Auth findings', scope: 'project', projectId: 'p1' }
    ]);
    harness.sdk.stub('library.read', async () => ({ ok: true, content: 'Use PKCE.' }));
    await plugin(zcc);
    expect(harness.mentionProviders[0]).toMatchObject({ id: 'note', label: 'Docs' });
    await expect(harness.mentionProviders[0]!.search({ query: 'auth', projectId: 'p1' })).resolves.toEqual([
      { id: 'project:p1:findings/auth.md', label: 'Auth findings' }
    ]);
    await expect(harness.mentionProviders[0]!.resolve('project:p1:findings/auth.md')).resolves.toMatchObject({
      context: expect.stringContaining('Use PKCE.')
    });
    await expect(harness.mentionProviders[0]!.resolve('missing')).rejects.toThrow(/unknown note/);
  });

  it('is the only shipped docs plugin (no bundled-extensions copy)', () => {
    expect(existsSync(join(root, '../../bundled-extensions/docs'))).toBe(false);
  });
});
