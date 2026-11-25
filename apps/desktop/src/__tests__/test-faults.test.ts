import { afterEach, describe, expect, it, vi } from 'vitest';
import { testFaultActive, testNoTurnWarnWindowMs, testVisibilityWindowMs, workerSpawnFaultFor } from '../test-faults.js';

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

describe('workerSpawnFaultFor', () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = { ZCC_TEST_FAULT: 'worker-spawn-throw' };

  it('is gated off in a production build', () => {
    expect(workerSpawnFaultFor('0:persona:1', env)).toBe(false);
    vi.stubGlobal('__ZCC_TEST_FAULTS__', false);
    expect(workerSpawnFaultFor('0:persona:1', env)).toBe(false);
  });

  it('selects exactly the second seat of each persona row', () => {
    vi.stubGlobal('__ZCC_TEST_FAULTS__', true);
    expect(['0:p:0', '0:p:1', '0:p:2', '1:q:0', '1:q:1', 'orchestrator:o'].map((id) => workerSpawnFaultFor(id, env)))
      .toEqual([false, true, false, false, true, false]);
  });

  it('ignores a different or absent fault name', () => {
    vi.stubGlobal('__ZCC_TEST_FAULTS__', true);
    expect(workerSpawnFaultFor('0:p:1', { ZCC_TEST_FAULT: 'launch-complete-throw' })).toBe(false);
    expect(workerSpawnFaultFor('0:p:1', {})).toBe(false);
  });
});

describe('testNoTurnWarnWindowMs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is never read in a production build', () => {
    expect(testNoTurnWarnWindowMs({ ZCC_TEST_NO_TURN_WARN_MS: '500' })).toBeUndefined();
    vi.stubGlobal('__ZCC_TEST_FAULTS__', false);
    expect(testNoTurnWarnWindowMs({ ZCC_TEST_NO_TURN_WARN_MS: '500' })).toBeUndefined();
  });

  it('returns a bounded positive integer in an enabled build', () => {
    vi.stubGlobal('__ZCC_TEST_FAULTS__', true);
    expect(testNoTurnWarnWindowMs({ ZCC_TEST_NO_TURN_WARN_MS: '500' })).toBe(500);
    expect(testNoTurnWarnWindowMs({ ZCC_TEST_NO_TURN_WARN_MS: '600000' })).toBe(600_000);
  });

  it.each([undefined, '', '0', '-5', '1.5', 'abc', '600001', '1e3'])('rejects %s', (raw) => {
    vi.stubGlobal('__ZCC_TEST_FAULTS__', true);
    expect(testNoTurnWarnWindowMs(raw === undefined ? {} : { ZCC_TEST_NO_TURN_WARN_MS: raw })).toBeUndefined();
  });
});

describe('testVisibilityWindowMs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is never read in a production build', () => {
    expect(testVisibilityWindowMs('IDLE', { ZCC_TEST_IDLE_NOTICE_MS: '500' })).toBeUndefined();
    vi.stubGlobal('__ZCC_TEST_FAULTS__', false);
    expect(testVisibilityWindowMs('BLOCKER', { ZCC_TEST_BLOCKER_NOTICE_MS: '500' })).toBeUndefined();
  });

  it('reads the variable of the named window in an enabled build', () => {
    vi.stubGlobal('__ZCC_TEST_FAULTS__', true);
    const env = { ZCC_TEST_IDLE_NOTICE_MS: '1', ZCC_TEST_HEARTBEAT_NOTICE_MS: '3000', ZCC_TEST_BLOCKER_NOTICE_MS: '600000' };
    expect(testVisibilityWindowMs('IDLE', env)).toBe(1);
    expect(testVisibilityWindowMs('HEARTBEAT', env)).toBe(3000);
    expect(testVisibilityWindowMs('BLOCKER', env)).toBe(600_000);
    expect(testVisibilityWindowMs('IDLE', { ZCC_TEST_HEARTBEAT_NOTICE_MS: '5' })).toBeUndefined();
  });

  it.each([undefined, '', '0', '-5', '1.5', 'abc', '600001'])('rejects %s', (raw) => {
    vi.stubGlobal('__ZCC_TEST_FAULTS__', true);
    expect(testVisibilityWindowMs('IDLE', raw === undefined ? {} : { ZCC_TEST_IDLE_NOTICE_MS: raw })).toBeUndefined();
  });
});
