import { describe, expect, it } from 'vitest';
import { redactRuntimeLog } from '@zana-ai/zcc-process-utils';
import { FORWARDED_ENV_MARKER, MachineEnvironment } from './machine-environment.js';

const token = 'ghp_example_not_a_real_token';

function make(initial: NodeJS.ProcessEnv = {}) {
  const target: NodeJS.ProcessEnv = { ...initial };
  return { target, env: new MachineEnvironment(target) };
}

describe('MachineEnvironment', () => {
  it('applies entries to the target and reports names only', () => {
    const { target, env } = make();
    const result = env.replace([{ name: 'GH_TOKEN', value: token }]);
    expect(target.GH_TOKEN).toBe(token);
    expect(result).toEqual({ applied: ['GH_TOKEN'], skipped: [] });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('never overrides a value the user set on the machine, and reports it as skipped', () => {
    const { target, env } = make({ GH_TOKEN: 'user-token' });
    const result = env.replace([{ name: 'GH_TOKEN', value: token }, { name: 'OTHER', value: 'x' }]);
    expect(target.GH_TOKEN).toBe('user-token');
    expect(target.OTHER).toBe('x');
    expect(result).toEqual({ applied: ['OTHER'], skipped: ['GH_TOKEN'] });
  });

  it('treats an empty user value as unset', () => {
    const { target, env } = make({ GH_TOKEN: '' });
    expect(env.replace([{ name: 'GH_TOKEN', value: token }]).applied).toEqual(['GH_TOKEN']);
    expect(target.GH_TOKEN).toBe(token);
  });

  it('applies a group atomically: one user-owned name skips the whole group', () => {
    const { target, env } = make({ GIT_AUTHOR_EMAIL: 'me@example.com' });
    const result = env.replace([
      { name: 'GIT_AUTHOR_NAME', value: 'octocat', group: 'identity' },
      { name: 'GIT_AUTHOR_EMAIL', value: 'o@example.com', group: 'identity' },
      { name: 'GH_TOKEN', value: token }
    ]);
    expect(target.GIT_AUTHOR_NAME).toBeUndefined();
    expect(target.GIT_AUTHOR_EMAIL).toBe('me@example.com');
    expect(target.GH_TOKEN).toBe(token);
    expect(result.applied).toEqual(['GH_TOKEN']);
    expect(result.skipped).toEqual(['GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_NAME']);
  });

  it('applies a requires-gated entry only when the required name resolves, from the user or from this push', () => {
    const gated = { name: 'GIT_CONFIG_COUNT', value: '1', group: 'git', requires: ['GH_TOKEN'] };
    const none = make();
    expect(none.env.replace([gated])).toEqual({ applied: [], skipped: ['GIT_CONFIG_COUNT'] });
    expect(none.target.GIT_CONFIG_COUNT).toBeUndefined();

    const user = make({ GH_TOKEN: 'user-token' });
    expect(user.env.replace([gated]).applied).toEqual(['GIT_CONFIG_COUNT']);

    const pushed = make();
    expect(pushed.env.replace([gated, { name: 'GH_TOKEN', value: token }]).applied)
      .toEqual(['GH_TOKEN', 'GIT_CONFIG_COUNT']);
  });

  it('replace is a full replacement: dropped names are removed and the user env is restored', () => {
    const { target, env } = make({ KEEP: 'mine' });
    env.replace([{ name: 'GH_TOKEN', value: token }, { name: 'A', value: '1' }]);
    env.replace([{ name: 'A', value: '2' }]);
    expect(target.GH_TOKEN).toBeUndefined();
    expect(target.A).toBe('2');
    expect(target.KEEP).toBe('mine');
    env.replace([]);
    expect(target.A).toBeUndefined();
    expect(target.KEEP).toBe('mine');
  });

  it('picks up a name the user defines between pushes instead of clobbering it', () => {
    const { target, env } = make();
    env.replace([{ name: 'GH_TOKEN', value: token }]);
    delete target.GH_TOKEN;
    target.GH_TOKEN = 'defined-later-by-user';
    env.replace([{ name: 'GH_TOKEN', value: 'new-server-token' }]);
    expect(target.GH_TOKEN).toBe('defined-later-by-user');
    env.clear();
    expect(target.GH_TOKEN).toBe('defined-later-by-user');
  });

  it('clear removes everything it applied and the marker, leaving user values alone', () => {
    const { target, env } = make({ KEEP: 'mine' });
    env.replace([{ name: 'GH_TOKEN', value: token }]);
    expect(target[FORWARDED_ENV_MARKER]).toBe('GH_TOKEN');
    env.clear();
    expect(target.GH_TOKEN).toBeUndefined();
    expect(target[FORWARDED_ENV_MARKER]).toBeUndefined();
    expect(target.KEEP).toBe('mine');
    expect(env.names()).toEqual([]);
  });

  it('is idempotent for identical input', () => {
    const { target, env } = make();
    const entries = [{ name: 'GH_TOKEN', value: token }];
    expect(env.replace(entries)).toEqual(env.replace(entries));
    expect(target.GH_TOKEN).toBe(token);
  });

  it('keeps the last entry when a name is repeated', () => {
    const { target, env } = make();
    env.replace([{ name: 'A', value: '1' }, { name: 'A', value: '2' }]);
    expect(target.A).toBe('2');
  });

  it('scrubs forwarded values inherited from a predecessor daemon (self-update restart)', () => {
    const inherited = { GH_TOKEN: token, GIT_AUTHOR_NAME: 'octocat', [FORWARDED_ENV_MARKER]: 'GH_TOKEN,GIT_AUTHOR_NAME', KEEP: 'mine' };
    const { target } = make(inherited);
    expect(target.GH_TOKEN).toBeUndefined();
    expect(target.GIT_AUTHOR_NAME).toBeUndefined();
    expect(target[FORWARDED_ENV_MARKER]).toBeUndefined();
    expect(target.KEEP).toBe('mine');
  });

  it('ignores a malformed or hostile inherited marker', () => {
    const { target } = make({ [FORWARDED_ENV_MARKER]: 'PATH,not a name,,HOME,ZCC_SERVER_URL', PATH: '/bin', HOME: '/h', ZCC_SERVER_URL: 'u' });
    expect(target.PATH).toBe('/bin');
    expect(target.HOME).toBe('/h');
    expect(target.ZCC_SERVER_URL).toBe('u');
  });

  it('refuses forbidden names defensively even if the contract is bypassed', () => {
    const { target, env } = make({ PATH: '/bin' });
    const result = env.replace([{ name: 'PATH', value: '/evil' }, { name: 'LD_PRELOAD', value: '/evil.so' }]);
    expect(target.PATH).toBe('/bin');
    expect(target.LD_PRELOAD).toBeUndefined();
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(['LD_PRELOAD', 'PATH']);
  });

  it('keeps a forwarded token out of runtime logs, which redact by secret-looking variable name', () => {
    const { target, env } = make();
    env.replace([{ name: 'GH_TOKEN', value: token }]);
    const line = `spawn failed env=${token} args=--flag ${token}`;
    const redacted = redactRuntimeLog(line, target);
    expect(redacted).not.toContain(token);
    expect(redacted).toContain('[redacted]');
  });
});
