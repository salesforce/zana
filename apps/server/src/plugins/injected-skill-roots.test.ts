import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  builtinSkillsRootPath,
  collectPluginSkillDirectoryRoots,
  readInjectedSkillDirectoryRoots,
  writeInjectedSkillRootManifest
} from './injected-skill-roots.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('builtinSkillsRootPath', () => {
  it('resolves the shipped builtin-skills tree that contains zcc-plugin-authoring', () => {
    const root = builtinSkillsRootPath();
    const skill = join(root, 'zcc-plugin-authoring', 'SKILL.md');
    expect(existsSync(skill), `expected ${skill} to exist`).toBe(true);
    expect(readFileSync(skill, 'utf8')).toMatch(/^---\nname: zcc-plugin-authoring\n/);
    expect(existsSync(join(root, 'zcc-cli', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'zcc-inbox', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'harness-authoring', 'SKILL.md'))).toBe(false);
  });
});

describe('injected skill root manifest', () => {
  it('includes the builtin tree when writing and reading the manifest', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-injected-server-'));
    dirs.push(dataDir);
    const extra = mkdtempSync(join(tmpdir(), 'zcc-skill-extra-'));
    dirs.push(extra);
    mkdirSync(join(extra, 'hello'), { recursive: true });
    writeFileSync(join(extra, 'hello', 'SKILL.md'), '---\nname: hello\n---\n');
    writeInjectedSkillRootManifest(dataDir, [builtinSkillsRootPath(), extra]);
    const roots = readInjectedSkillDirectoryRoots(dataDir);
    expect(roots).toEqual(expect.arrayContaining([builtinSkillsRootPath(), extra]));
  });

  it('collectPluginSkillDirectoryRoots skips missing relatives', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-plugin-root-'));
    dirs.push(root);
    mkdirSync(join(root, 'skills', 'greet'), { recursive: true });
    writeFileSync(join(root, 'skills', 'greet', 'SKILL.md'), '---\nname: greet\n---\n');
    const collected = collectPluginSkillDirectoryRoots({
      rootDir: root,
      relativeRoots: ['skills', 'missing'],
      extraRoots: ['/no/such/root']
    });
    expect(collected).toHaveLength(1);
    expect(collected[0]).toBe(join(realpathSync(root), 'skills'));
  });
});
