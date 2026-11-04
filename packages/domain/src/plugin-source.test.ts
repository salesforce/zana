import { describe, expect, it } from 'vitest';
import { parsePluginSource } from './plugin-source.js';

describe('parsePluginSource', () => {
  it('parses path, builtin, npm, git, and catalog specs', () => {
    expect(parsePluginSource('./plugins/tasks')).toEqual({ kind: 'path', path: './plugins/tasks' });
    expect(parsePluginSource('path:/tmp/x')).toEqual({ kind: 'path', path: '/tmp/x' });
    expect(parsePluginSource('builtin:docs')).toEqual({ kind: 'builtin', name: 'docs' });
    expect(parsePluginSource('npm:@zana/tasks@^1.0.0')).toEqual({
      kind: 'npm',
      name: '@zana/tasks',
      spec: '^1.0.0',
      specKind: 'range'
    });
    expect(parsePluginSource('git:https://example.com/repo.git@semver:^1.0.0')).toMatchObject({
      kind: 'git',
      selector: { kind: 'range', range: '^1.0.0' }
    });
    expect(parsePluginSource('tasks@official')).toEqual({
      kind: 'catalog',
      marketplace: 'official',
      entryId: 'tasks'
    });
  });

  it('rejects empty input', () => {
    expect(() => parsePluginSource('  ')).toThrow(/empty/);
  });

  it('preserves SSH user names, credentials, monorepo paths and tag prefixes', () => {
    expect(parsePluginSource('git:git@example.test:org/repo.git')).toMatchObject({ url: 'git@example.test:org/repo.git', spec: 'HEAD' });
    expect(parsePluginSource('git:ssh://git@example.test/org/repo.git@main')).toMatchObject({ url: 'ssh://git@example.test/org/repo.git', selector: { ref: 'main' } });
    expect(parsePluginSource('git:https://user:token@example.test/repo.git')).toMatchObject({ url: 'https://user:token@example.test/repo.git', spec: 'HEAD' });
    expect(parsePluginSource('git:https://example.test/repo@semver:^1.0.0-beta.1#subdir=plugins%2Fnotes&tagPrefix=notes-')).toMatchObject({
      subdir: 'plugins/notes', selector: { kind: 'range', range: '^1.0.0-beta.1', tagPrefix: 'notes-' }
    });
    expect(() => parsePluginSource('git:https://example.test/repo@main#tagPrefix=x')).toThrow(/requires/);
    expect(() => parsePluginSource('git:https://example.test/repo#unknown=x')).toThrow(/unknown/);
    expect(parsePluginSource('npm:notes@^1.0.0-beta.1')).toMatchObject({ specKind: 'range' });
  });
});
