import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeInjectedSkillRootManifest } from '../../plugins/injected-skill-roots.js';
import { injectedSkillNameFromId, isInjectedSkillId, listInjectedSkillEntries } from './injected-skill-entries.js';
import { skillPolicyPath } from './skill-policy.js';

let dataDir: string;
let pluginRoot: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'injected-entries-'));
  pluginRoot = join(dataDir, 'plugin-skills');
  skill(join(dataDir, 'skills-generated'), 'plugin-commands', 'description: "Run plugin commands"');
  skill(pluginRoot, 'gus-work', 'description: Work items');
  skill(pluginRoot, 'gus-slash', 'description: Slash only\ndisable-model-invocation: true');
  skill(pluginRoot, 'gus-plain', '', false);
  mkdirSync(join(pluginRoot, 'empty-dir'));
  mkdirSync(join(pluginRoot, '.hidden'));
  writeFileSync(join(pluginRoot, 'README.md'), 'not a skill');
  const target = join(dataDir, 'linked-target');
  skill(dataDir, 'linked-target', 'description: Linked');
  symlinkSync(target, join(pluginRoot, 'gus-linked'));
  writeInjectedSkillRootManifest(dataDir, [pluginRoot], { [pluginRoot]: 'gus' });
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

function skill(root: string, name: string, head: string, fenced = true) {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, 'SKILL.md'), fenced ? `---\nname: ${name}\n${head}\n---\nbody` : 'plain body');
}

it('parses injected ids', () => {
  expect(isInjectedSkillId('zcc:gus/gus-work')).toBe(true);
  expect(isInjectedSkillId('user:gus-work')).toBe(false);
  expect(injectedSkillNameFromId('zcc:gus/gus-work')).toBe('gus-work');
  expect(injectedSkillNameFromId('zcc:gus/../x')).toBeNull();
  expect(injectedSkillNameFromId('zcc:/gus-work')).toBeNull();
  expect(injectedSkillNameFromId('zcc:gus-work')).toBeNull();
  expect(injectedSkillNameFromId('user:gus-work')).toBeNull();
});

it('lists every injected skill as an all-harness row, on by default', () => {
  const rows = listInjectedSkillEntries(dataDir, 'host-1');
  expect(rows.map((row) => row.id)).toEqual([
    'zcc:built-in/plugin-commands',
    'zcc:gus/gus-linked',
    'zcc:gus/gus-plain',
    'zcc:gus/gus-slash',
    'zcc:gus/gus-work'
  ]);
  const work = rows.find((row) => row.name === 'gus-work')!;
  expect(work).toMatchObject({
    tool: 'zcc',
    allHarnesses: true,
    source: 'plugin',
    pluginName: 'gus',
    hostId: 'host-1',
    revealable: false,
    description: 'Work items',
    enabled: true,
    toggle: { supported: true, enabled: true, state: 'on', states: ['on', 'manual', 'off'] }
  });
  expect(rows[0].description).toBe('Run plugin commands');
  expect(rows.find((row) => row.name === 'gus-plain')).not.toHaveProperty('description');
  expect(rows.find((row) => row.name === 'gus-slash')!.toggle).toMatchObject({ state: 'manual', states: ['manual', 'off'] });
  expect(listInjectedSkillEntries(dataDir)[0]).not.toHaveProperty('hostId');
});

it('applies the stored policy', () => {
  writeFileSync(skillPolicyPath(dataDir), JSON.stringify({ version: 1, skills: { 'gus-work': 'manual', 'gus-slash': 'off' } }));
  const rows = listInjectedSkillEntries(dataDir);
  expect(rows.find((row) => row.name === 'gus-work')!.toggle.state).toBe('manual');
  const off = rows.find((row) => row.name === 'gus-slash')!;
  expect(off).toMatchObject({ enabled: false, toggle: { state: 'off', enabled: false } });
});

it('falls back to the built-in owner without a readable manifest', () => {
  writeFileSync(join(dataDir, 'injected-skill-roots.json'), JSON.stringify({ directoryRoots: [pluginRoot], rootOwners: [] }));
  expect(listInjectedSkillEntries(dataDir).every((row) => row.pluginName === 'built-in')).toBe(true);
  writeFileSync(join(dataDir, 'injected-skill-roots.json'), '{');
  const names = listInjectedSkillEntries(dataDir).map((row) => row.name);
  expect(names).toContain('plugin-commands');
  expect(names).not.toContain('gus-work');
});
