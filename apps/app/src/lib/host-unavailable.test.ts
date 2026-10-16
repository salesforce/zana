import { describe, expect, it } from 'vitest';
import { isHostUnavailableError } from './host-unavailable.js';

describe('isHostUnavailableError', () => {
  it('matches only the host-unavailable code', () => {
    expect(isHostUnavailableError(Object.assign(new Error('host h1 is not connected'), { code: 'host-unavailable' }))).toBe(true);
    expect(isHostUnavailableError(Object.assign(new Error('boom'), { code: 'host-error' }))).toBe(false);
    expect(isHostUnavailableError(new Error('host h1 is not connected'))).toBe(false);
    expect(isHostUnavailableError(null)).toBe(false);
    expect(isHostUnavailableError('host-unavailable')).toBe(false);
  });
});
