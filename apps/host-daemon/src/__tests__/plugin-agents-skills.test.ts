import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, symlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLUGIN_SKILL_MARKER,
  PLUGIN_SKILLS_PER_PLUGIN_MAX,
  pluginAgentsSkillDirName,
  pluginAgentsSkillsRoot,
  reconcilePluginAgentsSkills
} from '../plugin-agents-skills.js';

let home: string;
let root: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agents-skills-home-'));
  root = pluginAgentsSkillsRoot(home);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const entry = (pluginId: string, skillName: string, content = `# ${skillName}\n`) => ({ pluginId, skillName, content });

describe('reconcilePluginAgentsSkills', () => {
  it('writes namespaced owned entries for desired skills', async () => {
    const r = await reconcilePluginAgentsSkills({ entries: [entry('Acme.Docs', 'Hello World')], homeDir: home });
    const name = pluginAgentsSkillDirName('Acme.Docs', 'Hello World');
    expect(name).toBe('plugin-acme.docs-hello-world');
    expect(r.written).toEqual([name]);
    expect(readFileSync(join(root, name, 'SKILL.md'), 'utf8')).toBe('# Hello World\n');
    expect(existsSync(join(root, name, PLUGIN_SKILL_MARKER))).toBe(true);
  });

  it('is idempotent and updates changed content', async () => {
    await reconcilePluginAgentsSkills({ entries: [entry('p', 's', 'a')], homeDir: home });
    expect((await reconcilePluginAgentsSkills({ entries: [entry('p', 's', 'a')], homeDir: home })).written).toEqual([]);
    expect((await reconcilePluginAgentsSkills({ entries: [entry('p', 's', 'b')], homeDir: home })).written).toEqual(['plugin-p-s']);
    expect(readFileSync(join(root, 'plugin-p-s', 'SKILL.md'), 'utf8')).toBe('b');
  });

  it('removes owned entries on disable/uninstall/boot (absent from desired) and dropped skills', async () => {
    await reconcilePluginAgentsSkills({ entries: [entry('a', 'one'), entry('a', 'two'), entry('b', 'x')], homeDir: home });
    const r1 = await reconcilePluginAgentsSkills({ entries: [entry('a', 'one'), entry('b', 'x')], homeDir: home });
    expect(r1.removed).toEqual(['plugin-a-two']);
    const r2 = await reconcilePluginAgentsSkills({ entries: [], homeDir: home });
    expect(r2.removed.sort()).toEqual(['plugin-a-one', 'plugin-b-x']);
    expect(readdirSync(root)).toEqual([]);
  });

  it('never touches non-Zana entries, even with a plugin- name', async () => {
    mkdirSync(join(root, 'plugin-a-one'), { recursive: true });
    writeFileSync(join(root, 'plugin-a-one', 'SKILL.md'), 'user');
    mkdirSync(join(root, 'my-skill'), { recursive: true });
    writeFileSync(join(root, 'my-skill', 'SKILL.md'), 'mine');
    writeFileSync(join(root, 'loose.md'), 'x');
    const target = mkdtempSync(join(tmpdir(), 'agents-skills-target-'));
    writeFileSync(join(target, PLUGIN_SKILL_MARKER), 'zana-plugin-skill/v1\nx\n');
    writeFileSync(join(target, 'keep.txt'), 'keep');
    symlinkSync(target, join(root, 'plugin-link-s'));
    const log = vi.fn();
    const r = await reconcilePluginAgentsSkills({ entries: [entry('a', 'one')], homeDir: home, log });
    expect(r.written).toEqual([]);
    expect(log).toHaveBeenCalled();
    await reconcilePluginAgentsSkills({ entries: [], homeDir: home });
    expect(readFileSync(join(root, 'plugin-a-one', 'SKILL.md'), 'utf8')).toBe('user');
    expect(readFileSync(join(root, 'my-skill', 'SKILL.md'), 'utf8')).toBe('mine');
    expect(existsSync(join(root, 'loose.md'))).toBe(true);
    expect(existsSync(join(target, 'keep.txt'))).toBe(true);
    expect(existsSync(join(root, 'plugin-link-s'))).toBe(true);
    rmSync(target, { recursive: true, force: true });
  });

  it('caps skills per plugin and dedupes colliding names', async () => {
    const many = Array.from({ length: PLUGIN_SKILLS_PER_PLUGIN_MAX + 5 }, (_, i) => entry('p', `s${i}`));
    const r = await reconcilePluginAgentsSkills({ entries: [...many, entry('p', 'S0', 'dup')], homeDir: home });
    expect(r.written).toHaveLength(PLUGIN_SKILLS_PER_PLUGIN_MAX);
  });

  it('serializes concurrent reconciles', async () => {
    await Promise.all([
      reconcilePluginAgentsSkills({ entries: [entry('p', 'a')], homeDir: home }),
      reconcilePluginAgentsSkills({ entries: [entry('p', 'b')], homeDir: home }),
      reconcilePluginAgentsSkills({ entries: [entry('p', 'c')], homeDir: home })
    ]);
    expect(readdirSync(root)).toEqual(['plugin-p-c']);
  });

  it('does not create the root when nothing is desired', async () => {
    await reconcilePluginAgentsSkills({ entries: [], homeDir: home });
    expect(existsSync(root)).toBe(false);
  });
});
