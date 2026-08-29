import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  expandDirectoryRootsToRuntimeSkillRoots,
  hashInjectedSkillCatalog,
  loadRuntimeSkillRoots,
  readInjectedSkillDirectoryRoots
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
    expect(loadRuntimeSkillRoots(dataDir)).toEqual([]);
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
});
