import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  builtinSkillsRootPath,
  collectPluginSkillDirectoryRoots,
  discoverSkillsInRoot,
  readInjectedSkillDirectoryRoots,
  selectBuiltinSkillDirectoryRoots,
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
    expect(existsSync(join(root, 'zcc-preview', 'SKILL.md'))).toBe(true);
    expect(discoverSkillsInRoot(root)).toContainEqual({
      name: 'zana-ui-proposals',
      description: expect.stringContaining('interactive UI proposals')
    });
    const browser = readFileSync(join(root, 'zcc-browser', 'SKILL.md'), 'utf8');
    expect(browser).toMatch(/^---\nname: zcc-browser\n/);
    expect(browser).toContain('zcc browser create');
    expect(browser).toContain('--reveal');
    expect(browser).toContain('have been retired');
    expect(browser).toContain('Do not silently switch to an external browser');
    expect(readFileSync(join(root, 'zcc-preview', 'SKILL.md'), 'utf8')).toMatch(/^---\nname: zcc-preview\n/);
    expect(existsSync(join(root, 'zcc-terminal', 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(root, 'zcc-terminal', 'SKILL.md'), 'utf8')).toMatch(/^---\nname: zcc-terminal\n/);
    expect(existsSync(join(root, 'harness-authoring', 'SKILL.md'))).toBe(false);
  });
});

describe('injected skill root manifest', () => {
  it('does not fall back to builtin skills when the manifest lists empty roots', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-injected-empty-'));
    dirs.push(dataDir);
    writeInjectedSkillRootManifest(dataDir, []);
    expect(readInjectedSkillDirectoryRoots(dataDir)).not.toContain(builtinSkillsRootPath());
  });

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

describe('selectBuiltinSkillDirectoryRoots', () => {
  it('returns the full builtin tree by default', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-injected-filter-'));
    dirs.push(dataDir);
    expect(selectBuiltinSkillDirectoryRoots({ dataDir })).toEqual([builtinSkillsRootPath()]);
  });

  it('omits builtin skills when the master switch is off', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-injected-off-'));
    dirs.push(dataDir);
    expect(selectBuiltinSkillDirectoryRoots({
      dataDir,
      injectBundledSkills: false
    })).toEqual([]);
  });

  it.each(['zcc-cli', 'zana-ui-proposals'])('stages only enabled skills when %s is opted out', (disabledSkill) => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-injected-partial-'));
    dirs.push(dataDir);
    const roots = selectBuiltinSkillDirectoryRoots({
      dataDir,
      disabledBundledSkills: [disabledSkill]
    });
    expect(roots).toHaveLength(1);
    expect(roots[0]).not.toBe(builtinSkillsRootPath());
    expect(existsSync(join(roots[0]!, 'zcc-inbox', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(roots[0]!, disabledSkill, 'SKILL.md'))).toBe(false);
    writeInjectedSkillRootManifest(dataDir, roots);
    const manifest = JSON.parse(readFileSync(join(dataDir, 'injected-skill-roots.json'), 'utf8'));
    expect(manifest.builtinSkillTargets).toContain(realpathSync(join(builtinSkillsRootPath(), 'zcc-inbox')));
    expect(manifest.builtinSkillTargets).not.toContain(realpathSync(join(builtinSkillsRootPath(), disabledSkill)));
  });

  it('lists the same slugs as BUNDLED_PRODUCT_SKILL_IDS', async () => {
    const { BUNDLED_PRODUCT_SKILL_IDS } = await import('@zana-ai/zcc-domain');
    const names = discoverSkillsInRoot(builtinSkillsRootPath()).map((skill) => skill.name).sort();
    expect(names).toEqual([...BUNDLED_PRODUCT_SKILL_IDS].slice().sort());
  });
});
