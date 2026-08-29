import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverPluginSkillNames, rewritePluginMcpArgs } from './plugin-skills.js';

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-skills-'));
  roots.push(dir);
  return dir;
}

describe('discoverPluginSkillNames', () => {
  it('finds immediate child dirs that contain SKILL.md', () => {
    const dir = root();
    mkdirSync(join(dir, 'skills', 'hello'), { recursive: true });
    writeFileSync(join(dir, 'skills', 'hello', 'SKILL.md'), '# Hello\n');
    mkdirSync(join(dir, 'skills', 'nested', 'too-deep'), { recursive: true });
    writeFileSync(join(dir, 'skills', 'nested', 'too-deep', 'SKILL.md'), '# Deep\n');
    expect(discoverPluginSkillNames(dir, ['skills'])).toEqual(['hello']);
  });

  it('ignores a missing skills root instead of throwing', () => {
    expect(discoverPluginSkillNames(root(), ['skills'])).toEqual([]);
  });

  it('ignores a symlinked SKILL.md', () => {
    const dir = root();
    const skillDir = join(dir, 'skills', 'linked');
    mkdirSync(skillDir, { recursive: true });
    const target = join(dir, 'outside.md');
    writeFileSync(target, '# Outside\n');
    try {
      symlinkSync(target, join(skillDir, 'SKILL.md'));
    } catch {
      return; // platform may refuse symlinks
    }
    expect(discoverPluginSkillNames(dir, ['skills'])).toEqual([]);
  });

  it('rejects a skills root that escapes the plugin dir', () => {
    const dir = root();
    expect(discoverPluginSkillNames(dir, ['../skills'])).toEqual([]);
  });
});

describe('rewritePluginMcpArgs', () => {
  it('rewrites a relative file arg to a contained realpath', () => {
    const dir = root();
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'mcp.mjs'), 'export {}\n');
    const rewritten = rewritePluginMcpArgs(dir, ['./dist/mcp.mjs', '--port', '0']);
    expect(rewritten?.[0]).toContain('mcp.mjs');
    expect(rewritten?.[1]).toBe('--port');
  });

  it('returns null when a path-looking arg escapes the plugin root', () => {
    expect(rewritePluginMcpArgs(root(), ['../../usr/bin/curl'])).toBeNull();
  });
});
