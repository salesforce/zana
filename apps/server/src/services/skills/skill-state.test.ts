import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applySkillStates } from './skill-state.js';
import { readSkillPolicy } from './skill-policy.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skill-state-'));
  vi.stubEnv('ZCC_CLAUDE_HOME', dir);
  vi.stubEnv('CLAUDE_CONFIG_DIR', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

it('routes injected ids to the ZCC policy and Claude ids to skillOverrides', async () => {
  const result = await applySkillStates(join(dir, 'data'), [
    { id: 'zcc:gus/gus-work', name: 'ignored', state: 'manual' },
    { id: 'user:mine', name: 'mine', state: 'off' },
    { id: 'project:proj/x', name: 'x', state: 'manual' }
  ]);
  expect(result).toEqual({ ok: true, applied: 3, rejected: 0 });
  expect([...readSkillPolicy(join(dir, 'data'))]).toEqual([['gus-work', 'manual']]);
  expect(JSON.parse(await readFile(join(dir, '.claude/settings.json'), 'utf8')).skillOverrides).toEqual({
    mine: 'off',
    x: 'user-invocable-only'
  });
});

it('rejects read-only, malformed and unknown updates', async () => {
  const result = await applySkillStates(join(dir, 'data'), [
    { id: 'plugin:foo@bar/x', name: 'x', state: 'off' },
    { id: 'codex:user:x', name: 'x', state: 'off' },
    { id: 'user:', name: 'x', state: 'off' },
    { id: 'user:x', name: '', state: 'off' },
    { id: 'zcc:gus/../x', name: 'x', state: 'off' },
    { id: 'user:x', name: 'x', state: 'maybe' as never },
    null as never,
    { id: 7 as never, name: 'x', state: 'off' }
  ]);
  expect(result).toEqual({ ok: false, applied: 0, rejected: 8 });
  expect(await applySkillStates(dir, 'nope' as never)).toEqual({ ok: true, applied: 0, rejected: 0 });
});
