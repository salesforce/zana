import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isPolicySkillName, readSkillPolicy, setSkillPolicyStates, skillPolicyPath } from './skill-policy.js';

let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'skill-policy-'));
});
afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

it('validates skill names', () => {
  expect(isPolicySkillName('gus-work.v2_x')).toBe(true);
  for (const bad of ['', '.hidden', '../x', 'a/b', '__proto__', 7, 'x'.repeat(129)]) {
    expect(isPolicySkillName(bad)).toBe(false);
  }
});

it('treats a missing or malformed policy as everything on', async () => {
  expect(readSkillPolicy(dataDir).size).toBe(0);
  await writeFile(skillPolicyPath(dataDir), 'not json');
  expect(readSkillPolicy(dataDir).size).toBe(0);
  await writeFile(skillPolicyPath(dataDir), JSON.stringify({ skills: ['x'] }));
  expect(readSkillPolicy(dataDir).size).toBe(0);
  await writeFile(skillPolicyPath(dataDir), JSON.stringify({ skills: { a: 'off', b: 'on', c: 'weird', 'd/e': 'off' } }));
  expect([...readSkillPolicy(dataDir)]).toEqual([['a', 'off']]);
});

it('stores only opt-outs, serializes concurrent writes and leaves no temp files', async () => {
  await Promise.all([
    setSkillPolicyStates(dataDir, [{ name: 'b', state: 'off' }]),
    setSkillPolicyStates(dataDir, [{ name: 'a', state: 'manual' }, { name: '../evil', state: 'off' }]),
    setSkillPolicyStates(dataDir, [{ name: 'c', state: 'off' }])
  ]);
  await setSkillPolicyStates(dataDir, [{ name: 'c', state: 'on' }]);
  expect(JSON.parse(await readFile(skillPolicyPath(dataDir), 'utf8'))).toEqual({
    version: 1,
    skills: { a: 'manual', b: 'off' }
  });
  expect(await readdir(dataDir)).toEqual(['skill-policy.json']);
});

it('skips the write when no update is valid', async () => {
  await setSkillPolicyStates(dataDir, [{ name: '__proto__', state: 'off' }]);
  expect(await readdir(dataDir)).toEqual([]);
});

it('creates the data directory on first write', async () => {
  const nested = join(dataDir, 'nested');
  await setSkillPolicyStates(nested, [{ name: 'a', state: 'off' }]);
  expect(readSkillPolicy(nested).get('a')).toBe('off');
});
