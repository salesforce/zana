import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

const { adapter } = vi.hoisted(() => ({
  adapter: {
    refreshSkillCatalog: vi.fn(async () => undefined),
    reapIdleProviderSessions: vi.fn(async () => ({ reapedSessions: [] })),
    dispose: vi.fn()
  }
}));

vi.mock('./agent-runtime-adapter.js', () => ({
  createAgentRuntimeAdapter: () => adapter
}));

import {
  IDLE_PROVIDER_SESSION_REAP_AFTER_MS,
  createRuntimeManager,
  idleReapAfterMsFromConfig
} from './runtime-manager.js';

const config = (threadSessionReleaseMinutes: unknown) =>
  () => ({ threadSessionReleaseMinutes }) as unknown as AppConfig;

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('idleReapAfterMsFromConfig', () => {
  it('uses the 30 minute default when the setting is absent, invalid or unreadable', () => {
    expect(IDLE_PROVIDER_SESSION_REAP_AFTER_MS).toBe(30 * 60 * 1000);
    expect(idleReapAfterMsFromConfig()).toBe(IDLE_PROVIDER_SESSION_REAP_AFTER_MS);
    expect(idleReapAfterMsFromConfig(config(undefined))).toBe(IDLE_PROVIDER_SESSION_REAP_AFTER_MS);
    expect(idleReapAfterMsFromConfig(config('60'))).toBe(IDLE_PROVIDER_SESSION_REAP_AFTER_MS);
    expect(idleReapAfterMsFromConfig(config(Number.NaN))).toBe(IDLE_PROVIDER_SESSION_REAP_AFTER_MS);
    expect(idleReapAfterMsFromConfig(() => { throw new Error('EACCES'); })).toBe(IDLE_PROVIDER_SESSION_REAP_AFTER_MS);
  });

  it('turns minutes into milliseconds, clamps them, and reads 0 or less as never', () => {
    expect(idleReapAfterMsFromConfig(config(120))).toBe(120 * 60 * 1000);
    expect(idleReapAfterMsFromConfig(config(1))).toBe(5 * 60 * 1000);
    expect(idleReapAfterMsFromConfig(config(99999))).toBe(1440 * 60 * 1000);
    expect(idleReapAfterMsFromConfig(config(0))).toBeNull();
    expect(idleReapAfterMsFromConfig(config(-5))).toBeNull();
  });
});

describe('idle sweep', () => {
  it('reads the setting on every sweep and skips release when it is never', () => {
    vi.useFakeTimers();
    let minutes = 60;
    const manager = createRuntimeManager({
      emit: () => undefined,
      idleReapIntervalMs: 1000,
      loadConfig: () => ({ threadSessionReleaseMinutes: minutes }) as AppConfig
    });

    vi.advanceTimersByTime(1000);
    expect(adapter.reapIdleProviderSessions).toHaveBeenLastCalledWith(
      expect.objectContaining({ idleForMs: 60 * 60 * 1000, providerSessionReapingEnabled: true })
    );

    minutes = 0;
    vi.advanceTimersByTime(1000);
    expect(adapter.reapIdleProviderSessions).toHaveBeenCalledTimes(1);
    expect(adapter.refreshSkillCatalog).toHaveBeenCalledTimes(2);
    manager.dispose();
  });

  it('lets an explicit idleReapAfterMs override the setting', () => {
    vi.useFakeTimers();
    const manager = createRuntimeManager({
      emit: () => undefined,
      idleReapIntervalMs: 1000,
      idleReapAfterMs: 5,
      loadConfig: () => ({ threadSessionReleaseMinutes: 0 }) as AppConfig
    });
    vi.advanceTimersByTime(1000);
    expect(adapter.reapIdleProviderSessions).toHaveBeenCalledWith(expect.objectContaining({ idleForMs: 5 }));
    manager.dispose();
  });
});
