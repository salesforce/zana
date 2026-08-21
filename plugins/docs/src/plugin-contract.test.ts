import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import { discoverPluginSkillNames } from '@zana-ai/zcc-server/plugins/plugin-skills';

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

  it('is the only shipped docs plugin (no bundled-extensions copy)', () => {
    expect(existsSync(join(root, '../../bundled-extensions/docs'))).toBe(false);
  });
});
