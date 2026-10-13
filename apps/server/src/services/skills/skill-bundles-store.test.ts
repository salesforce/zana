import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const mocks = vi.hoisted(() => ({ dataDir: '', skills: vi.fn() }));
vi.mock('../../electron-data-dir.js', () => ({ electronZccDataDir: () => mocks.dataDir }));
vi.mock('./skills.js', () => ({ listSkills: (...args: unknown[]) => mocks.skills(...args) }));
import { SkillBundlesStore } from './skill-bundles-store.js';
import { writeInjectedSkillRootManifest } from '../../plugins/injected-skill-roots.js';
import { readSkillPolicy } from './skill-policy.js';

const claude = (name: string, extra = {}) => ({
  id: `user:${name}`,
  name,
  tool: 'claude-code',
  toolLabel: 'Claude Code',
  source: 'user',
  path: `/home/.claude/skills/${name}`,
  enabled: true,
  toggle: { supported: true, enabled: true },
  ...extra
});
let home: string;
let store: SkillBundlesStore;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'skill-bundles-'));
  mocks.dataDir = join(home, 'zcc');
  vi.stubEnv('ZCC_CLAUDE_HOME', home);
  vi.stubEnv('CLAUDE_CONFIG_DIR', '');
  const root = join(home, 'plugin-skills');
  for (const [name, head] of [['gus-work', ''], ['gus-slash', 'disable-model-invocation: true\n'], ['gus-extra', '']]) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\n${head}---\n`);
  }
  writeInjectedSkillRootManifest(mocks.dataDir, [root], { [root]: 'gus' });
  mocks.skills.mockReset().mockResolvedValue([
    claude('mine'),
    claude('other'),
    claude('from-plugin', { id: 'plugin:x/from-plugin', source: 'plugin', toggle: { supported: false, enabled: true } })
  ]);
  store = new SkillBundlesStore();
});
afterEach(() => {
  store.stop();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});
const overrides = () =>
  JSON.parse(readFileSync(join(home, '.claude/settings.json'), 'utf8')).skillOverrides as Record<string, string>;

it('additive apply turns listed Claude and injected skills on and counts unresolvable ids as skipped', async () => {
  const bundle = store.create({
    name: 'Focus',
    skillIds: ['user:mine', 'zcc:gus/gus-work', 'zcc:gus/gus-slash', 'plugin:x/from-plugin', 'user:gone']
  });
  await store.apply(bundle.id, 'exclusive');
  const result = await store.apply(bundle.id, 'additive');
  expect(result).toEqual({ ok: true, applied: 3, skippedPlugin: 2 });
  expect(overrides()).toEqual({ mine: 'on', other: 'off' });
  // gus-slash is author-pinned manual: "on" lands as manual.
  expect([...readSkillPolicy(mocks.dataDir)]).toEqual([
    ['gus-extra', 'off'],
    ['gus-slash', 'manual']
  ]);
});

it('exclusive apply turns everything else off', async () => {
  const bundle = store.create({ name: 'Only', skillIds: ['zcc:gus/gus-work'] });
  const result = await store.apply(bundle.id, 'exclusive');
  expect(result).toMatchObject({ ok: true, applied: 5, skippedPlugin: 0 });
  expect(overrides()).toEqual({ mine: 'off', other: 'off' });
  expect(Object.fromEntries(readSkillPolicy(mocks.dataDir))).toEqual({ 'gus-extra': 'off', 'gus-slash': 'off' });
});

it('reports a missing bundle', async () => {
  expect(await store.apply('nope', 'additive')).toMatchObject({ ok: false, applied: 0 });
});
