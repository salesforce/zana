import { describe, expect, it } from 'vitest';
import { e2eIdleReapOverrides } from './e2e-idle-reap.js';

describe('e2eIdleReapOverrides', () => {
  it('ignores the timing variables outside an isolated E2E home', () => {
    expect(e2eIdleReapOverrides({
      ZCC_E2E_IDLE_REAP_INTERVAL_MS: '500',
      ZCC_E2E_IDLE_REAP_AFTER_MS: '1000'
    })).toEqual({});
  });

  it('reads both values inside an E2E home', () => {
    expect(e2eIdleReapOverrides({
      ZCC_E2E_HOME: '/tmp/home',
      ZCC_E2E_IDLE_REAP_INTERVAL_MS: '500',
      ZCC_E2E_IDLE_REAP_AFTER_MS: '1000'
    })).toEqual({ idleReapIntervalMs: 500, idleReapAfterMs: 1000 });
  });

  it('keeps each value independent', () => {
    expect(e2eIdleReapOverrides({ ZCC_E2E_HOME: '/h', ZCC_E2E_IDLE_REAP_AFTER_MS: '2000' }))
      .toEqual({ idleReapAfterMs: 2000 });
    expect(e2eIdleReapOverrides({ ZCC_E2E_HOME: '/h', ZCC_E2E_IDLE_REAP_INTERVAL_MS: '300' }))
      .toEqual({ idleReapIntervalMs: 300 });
  });

  it.each(['', '0', '-5', '1.5', 'abc', '1e3', '99999999999999999999'])(
    'rejects invalid value %j',
    (raw) => {
      expect(e2eIdleReapOverrides({
        ZCC_E2E_HOME: '/h',
        ZCC_E2E_IDLE_REAP_INTERVAL_MS: raw,
        ZCC_E2E_IDLE_REAP_AFTER_MS: raw
      })).toEqual({});
    }
  );

  it('returns nothing when no variables are set', () => {
    expect(e2eIdleReapOverrides({ ZCC_E2E_HOME: '/h' })).toEqual({});
  });
});
