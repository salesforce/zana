import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  disabledSkillNames,
  readHooks,
  setSkillEnabled,
  setManyEnabled
} from './skill-settings.js';
let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'skill-settings-'));
  vi.stubEnv('ZCC_CLAUDE_HOME', home);
  vi.stubEnv('CLAUDE_CONFIG_DIR', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});
it('serializes concurrent writes and preserves unrelated settings', async () => {
  await mkdir(join(home, '.claude'));
  await writeFile(join(home, '.claude/settings.json'), JSON.stringify({ hooks: { value: 1 } }));
  await Promise.all([setSkillEnabled('a', false), setSkillEnabled('b', true)]);
  expect(JSON.parse(await readFile(join(home, '.claude/settings.json'), 'utf8'))).toEqual({
    hooks: { value: 1 },
    skillOverrides: { a: 'off', b: 'on' }
  });
  expect(await readHooks()).toEqual({ value: 1 });
  expect(await readdir(join(home, '.claude'))).toEqual(['settings.json']);
});
it('migrates legacy overrides idempotently and honors custom home-relative config', async () => {
  vi.stubEnv('CLAUDE_CONFIG_DIR', '~/custom');
  await mkdir(join(home, 'custom'));
  await writeFile(
    join(home, 'custom/settings.json'),
    JSON.stringify({ disabledSkills: ['a', 12, 'b'], skillOverrides: { b: 'off', c: 'on' } })
  );
  expect(await disabledSkillNames()).toEqual(new Set(['a', 'b']));
  expect(await disabledSkillNames()).toEqual(new Set(['a', 'b']));
  await setManyEnabled([{ name: 'a', enabled: true }]);
  expect(await disabledSkillNames()).toEqual(new Set(['b']));
  expect(
    JSON.parse(await readFile(join(home, 'custom/settings.json'), 'utf8')).disabledSkills
  ).toBeUndefined();
});
it('handles absent, malformed, empty, and nonobject overrides without losing later writes', async () => {
  expect(await disabledSkillNames()).toEqual(new Set());
  expect(await readHooks()).toBeNull();
  await setManyEnabled([]);
  await setSkillEnabled('created', false);
  const path = join(home, '.claude/settings.json');
  for (const raw of [
    'bad json',
    'null',
    '[]',
    JSON.stringify({ skillOverrides: null }),
    JSON.stringify({ disabledSkills: [] }),
    JSON.stringify({ disabledSkills: true })
  ]) {
    await writeFile(path, raw);
    expect(await disabledSkillNames()).toEqual(new Set());
  }
  await setSkillEnabled('after', false);
  expect(await disabledSkillNames()).toEqual(new Set(['after']));
});

it('recovers malformed overrides during legacy migration', async () => {
  await mkdir(join(home, '.claude'));
  await writeFile(
    join(home, '.claude/settings.json'),
    JSON.stringify({ disabledSkills: ['old'], skillOverrides: 7 })
  );
  expect(await disabledSkillNames()).toEqual(new Set(['old']));
});
