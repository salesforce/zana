import { afterEach, describe, expect, it, vi } from 'vitest';
import { testFaultActive } from '../test-faults.js';

describe('testFaultActive', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is off when the build did not enable test faults, even if the variable is set', () => {
    expect(testFaultActive('x', { ZCC_TEST_FAULT: 'x' })).toBe(false);
    vi.stubGlobal('__ZCC_TEST_FAULTS__', false);
    expect(testFaultActive('x', { ZCC_TEST_FAULT: 'x' })).toBe(false);
  });

  it('fires only for the named fault in an enabled build', () => {
    vi.stubGlobal('__ZCC_TEST_FAULTS__', true);
    expect(testFaultActive('x', { ZCC_TEST_FAULT: 'x' })).toBe(true);
    expect(testFaultActive('x', { ZCC_TEST_FAULT: 'y' })).toBe(false);
    expect(testFaultActive('x', {})).toBe(false);
  });
});
