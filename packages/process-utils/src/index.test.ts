import { describe, expect, it } from 'vitest';
import { buildChildEnv } from './index.js';

describe('buildChildEnv', () => {
  it('includes PATH/HOME but excludes secrets', () => {
    const env = buildChildEnv({
      PATH: '/usr/bin',
      HOME: '/home/me',
      SF_ACCESS_TOKEN: 'super-secret',
      AWS_SECRET_ACCESS_KEY: 'also-secret',
      GITHUB_TOKEN: 'ghp_xxx'
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/me');
    expect(env.SF_ACCESS_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  it('copies only allowlisted keys that are actually set', () => {
    expect(Object.keys(buildChildEnv({ PATH: '/bin' }))).toEqual(['PATH']);
  });

  it('returns a fresh object, never the live process.env', () => {
    expect(buildChildEnv()).not.toBe(process.env);
  });
});
