import { describe, expect, it } from 'vitest';
import { LaunchSpawnError } from '@zana-ai/zcc-server/services/launch/coordinator';
import { isPreSpawnRefusal, launchFailure } from '../launch-pre-spawn.js';

describe('isPreSpawnRefusal', () => {
  it('is true only for preSpawn === true', () => {
    expect(isPreSpawnRefusal(Object.assign(new Error('x'), { preSpawn: true }))).toBe(true);
  });
  it.each([[new Error('x')], [Object.assign(new Error('x'), { preSpawn: false })], [Object.assign(new Error('x'), { preSpawn: 'true' })], [null], [undefined], ['str'], [42]])(
    'is false for %s',
    (value) => expect(isPreSpawnRefusal(value)).toBe(false)
  );
});

describe('launchFailure', () => {
  it('returns the error unchanged before a spawn was attempted', () => {
    const error = new Error('x');
    expect(launchFailure(false, error)).toBe(error);
  });
  it('returns a pre-spawn refusal unchanged even after the spawn flag was set', () => {
    const error = Object.assign(new Error('missing mcp'), { preSpawn: true });
    expect(launchFailure(true, error)).toBe(error);
  });
  it('wraps other errors as LAUNCH_UNCONFIRMED', () => {
    const wrapped = launchFailure(true, new Error('boom')) as LaunchSpawnError;
    expect(wrapped).toBeInstanceOf(LaunchSpawnError);
    expect(wrapped.code).toBe('LAUNCH_UNCONFIRMED');
    expect(wrapped.message).toBe('boom');
  });
  it('stringifies non-Error values', () => {
    expect((launchFailure(true, 'oops') as LaunchSpawnError).message).toBe('oops');
  });
});
