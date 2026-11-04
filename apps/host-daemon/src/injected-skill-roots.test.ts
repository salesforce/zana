import { mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  expandDirectoryRootsToRuntimeSkillRoots,
  hashInjectedSkillCatalog,
  loadRuntimeSkillRoots,
  readInjectedSkillDirectoryRoots,
  readInjectedSkillPolicy,
  resolveAutomatedSkillSelection,
  withModelInvocationDisabled
} from './injected-skill-roots.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('injected skill roots', () => {
  it('reads generated skills and the written manifest', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-injected-skills-'));
    dirs.push(dataDir);
    mkdirSync(join(dataDir, 'skills-generated', 'plugin-commands'), { recursive: true });
    writeFileSync(join(dataDir, 'skills-generated', 'plugin-commands', 'SKILL.md'), '---\nname: plugin-commands\n---\n');
    const extra = mkdtempSync(join(tmpdir(), 'zcc-skill-extra-'));
    dirs.push(extra);
    mkdirSync(join(extra, 'hello'), { recursive: true });
    writeFileSync(join(extra, 'hello', 'SKILL.md'), '---\nname: hello\ndescription: Say hello from a plugin.\n---\n');
    writeFileSync(
      join(dataDir, 'injected-skill-roots.json'),
      JSON.stringify({ directoryRoots: [extra] })
    );
    const roots = readInjectedSkillDirectoryRoots(dataDir);
    expect(roots).toEqual(expect.arrayContaining([join(dataDir, 'skills-generated'), extra]));
  });

  it('expands a skill directory into every provider', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-skill-root-'));
    dirs.push(root);
    mkdirSync(join(root, 'hello'), { recursive: true });
    writeFileSync(
      join(root, 'hello', 'SKILL.md'),
      '---\nname: hello\ndescription: Greet the operator.\n---\n# Hello\n'
    );
    const expanded = expandDirectoryRootsToRuntimeSkillRoots([root]);
    expect(expanded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'claude-code', localPluginPath: root }),
        expect.objectContaining({ providerId: 'codex', skillDirectoryRootPath: root }),
        expect.objectContaining({ providerId: 'pi', skillDirectoryRootPath: root }),
        expect.objectContaining({
          providerId: 'acp',
          skillDirectoryRootPath: root,
          skills: [{ name: 'hello', description: 'Greet the operator.' }]
        })
      ])
    );
  });

  it('loadRuntimeSkillRoots is empty when dataDir has no skills', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-no-skills-'));
    dirs.push(dataDir);
    expect(loadRuntimeSkillRoots(dataDir, [])).toEqual([]);
  });

  it('hashes the injected skill catalog', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-hash-skills-'));
    dirs.push(dataDir);
    const empty = hashInjectedSkillCatalog(dataDir);
    mkdirSync(join(dataDir, 'skills-generated', 'hello'), { recursive: true });
    writeFileSync(join(dataDir, 'skills-generated', 'hello', 'SKILL.md'), '---\ndescription: Hi\n---\n');
    const withSkill = hashInjectedSkillCatalog(dataDir);
    expect(withSkill).not.toBe(empty);
    expect(hashInjectedSkillCatalog(dataDir)).toBe(withSkill);
  });

  it('reads only valid manual/off policy entries', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-skill-policy-'));
    dirs.push(dataDir);
    expect(readInjectedSkillPolicy(dataDir).size).toBe(0);
    writeFileSync(join(dataDir, 'skill-policy.json'), '{bad');
    expect(readInjectedSkillPolicy(dataDir).size).toBe(0);
    writeFileSync(join(dataDir, 'skill-policy.json'), JSON.stringify({ skills: ['a'] }));
    expect(readInjectedSkillPolicy(dataDir).size).toBe(0);
    writeFileSync(join(dataDir, 'skill-policy.json'), JSON.stringify({
      version: 1,
      skills: { a: 'manual', b: 'off', c: 'on', '../x': 'off', d: 7 }
    }));
    expect([...readInjectedSkillPolicy(dataDir)]).toEqual([['a', 'manual'], ['b', 'off']]);
  });

  it('pins disable-model-invocation in SKILL.md frontmatter', () => {
    expect(withModelInvocationDisabled('---\nname: a\n---\nbody')).toBe('---\nname: a\ndisable-model-invocation: true\n---\nbody');
    expect(withModelInvocationDisabled('---\r\nname: a\r\ndisable-model-invocation: false\r\n---\r\nbody'))
      .toBe('---\r\nname: a\r\ndisable-model-invocation: true\r\n---\r\nbody');
    expect(withModelInvocationDisabled('no frontmatter')).toBe('---\ndisable-model-invocation: true\n---\nno frontmatter');
  });

  it('keeps author-manual skills out of the ACP listing and rehashes on policy change', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-injected-manual-'));
    dirs.push(dataDir);
    const root = join(dataDir, 'skills-generated');
    mkdirSync(join(root, 'auto'), { recursive: true });
    mkdirSync(join(root, 'slash'), { recursive: true });
    writeFileSync(join(root, 'auto', 'SKILL.md'), '---\nname: auto\n---\n');
    writeFileSync(join(root, 'slash', 'SKILL.md'), '---\nname: slash\ndisable-model-invocation: true\n---\n');
    const acp = expandDirectoryRootsToRuntimeSkillRoots([root]).find((row) => row.providerId === 'acp');
    expect(acp && 'skills' in acp ? acp.skills?.map((skill) => skill.name) : []).toEqual(['auto']);
    const before = hashInjectedSkillCatalog(dataDir);
    writeFileSync(join(dataDir, 'skill-policy.json'), JSON.stringify({ version: 1, skills: { auto: 'off' } }));
    expect(hashInjectedSkillCatalog(dataDir)).not.toBe(before);
  });

  it('resolves only authorized builtin symlinks and skips dangling ones', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-builtin-symlinks-'));
    dirs.push(dataDir);
    const root = join(dataDir, 'skills-generated');
    const builtin = mkdtempSync(join(tmpdir(), 'zcc-builtin-target-'));
    const unlisted = mkdtempSync(join(tmpdir(), 'zcc-unlisted-target-'));
    dirs.push(builtin, unlisted);
    writeFileSync(join(builtin, 'SKILL.md'), '---\ndescription: Built in.\n---\n');
    writeFileSync(join(unlisted, 'SKILL.md'), '---\ndescription: Unlisted.\n---\n');
    mkdirSync(root, { recursive: true });
    symlinkSync(builtin, join(root, 'authorized'));
    symlinkSync(unlisted, join(root, 'unlisted'));
    symlinkSync(join(dataDir, 'missing'), join(root, 'dangling'));
    writeFileSync(join(dataDir, 'injected-skill-roots.json'), JSON.stringify({
      directoryRoots: [], builtinSkillTargets: [realpathSync(builtin)]
    }));

    expect(resolveAutomatedSkillSelection(dataDir, { skillIds: ['zcc:built-in/authorized'] }))
      .toEqual(new Map([[root, new Set(['authorized'])]]));
    expect(() => resolveAutomatedSkillSelection(dataDir, { skillIds: ['zcc:built-in/unlisted'] }))
      .toThrow('Unknown automated skill id');
    expect(() => resolveAutomatedSkillSelection(dataDir, { skillIds: ['zcc:built-in/dangling'] }))
      .toThrow('Unknown automated skill id');
  });

  it('rejects automated selections with more than 64 ids or duplicate ids', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-automated-selection-'));
    dirs.push(dataDir);
    expect(() => resolveAutomatedSkillSelection(dataDir, {
      skillIds: Array.from({ length: 65 }, (_, index) => `zcc:built-in/skill-${index}`)
    })).toThrow('Too many automated skill ids');
    expect(() => resolveAutomatedSkillSelection(dataDir, {
      skillIds: ['zcc:built-in/duplicate', 'zcc:built-in/duplicate']
    })).toThrow('Automated skill ids must be unique');
  });

  it('uses string root owners and ignores non-string owners', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-root-owners-'));
    dirs.push(dataDir);
    const custom = join(dataDir, 'custom');
    const fallback = join(dataDir, 'fallback');
    mkdirSync(join(custom, 'owned'), { recursive: true });
    mkdirSync(join(fallback, 'default'), { recursive: true });
    writeFileSync(join(custom, 'owned', 'SKILL.md'), '---\nname: owned\n---\n');
    writeFileSync(join(fallback, 'default', 'SKILL.md'), '---\nname: default\n---\n');
    writeFileSync(join(dataDir, 'injected-skill-roots.json'), JSON.stringify({
      directoryRoots: [custom, fallback],
      rootOwners: { [custom]: 'custom-owner', [fallback]: 7 }
    }));

    expect(resolveAutomatedSkillSelection(dataDir, {
      skillIds: ['zcc:custom-owner/owned', 'zcc:built-in/default']
    })).toEqual(new Map([
      [custom, new Set(['owned'])],
      [fallback, new Set(['default'])]
    ]));
  });

  it('skips a symlink when no builtin allowlist is supplied', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-untrusted-symlink-'));
    const target = mkdtempSync(join(tmpdir(), 'zcc-untrusted-target-'));
    dirs.push(root, target);
    writeFileSync(join(target, 'SKILL.md'), '---\ndescription: Untrusted.\n---\n');
    symlinkSync(target, join(root, 'untrusted'));

    const acp = expandDirectoryRootsToRuntimeSkillRoots([root]).find((row) => row.providerId === 'acp');
    expect(acp && 'skills' in acp ? acp.skills : []).toEqual([]);
  });
});
