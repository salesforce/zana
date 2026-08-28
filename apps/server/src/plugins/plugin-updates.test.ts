import { describe, expect, it, vi } from 'vitest';
import { PLUGIN_UPDATE_CHECK_INTERVAL_MS, startPluginUpdateSweep } from './plugin-updates.js';

describe('plugin update sweep', () => {
  it('checks on a six-hour interval', () => {
    const checkUpdates = vi.fn(async () => []);
    const timers: Array<{ id: number; fn: () => void; ms: number }> = [];
    let nextId = 1;
    const sweep = startPluginUpdateSweep({
      checkUpdates,
      setIntervalFn: ((fn: () => void, ms: number) => {
        const id = nextId++;
        timers.push({ id, fn, ms });
        return id as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
      clearIntervalFn: ((id: ReturnType<typeof setInterval>) => {
        const index = timers.findIndex((row) => row.id === (id as unknown as number));
        if (index >= 0) timers.splice(index, 1);
      }) as typeof clearInterval
    });
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(PLUGIN_UPDATE_CHECK_INTERVAL_MS);
    expect(PLUGIN_UPDATE_CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    expect(checkUpdates).not.toHaveBeenCalled();
    timers[0]?.fn();
    expect(checkUpdates).toHaveBeenCalledTimes(1);
    sweep.stop();
    expect(timers).toHaveLength(0);
  });
});
