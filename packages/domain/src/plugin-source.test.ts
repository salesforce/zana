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
});
