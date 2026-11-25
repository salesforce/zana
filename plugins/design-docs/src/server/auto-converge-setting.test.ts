import { describe, expect, it, vi } from 'vitest';
import { AUTO_CONVERGE_KEY, createAutoConvergeSetting } from './auto-converge-setting.js';

function kvOf(initial?: unknown) {
  const values = new Map<string, unknown>(initial === undefined ? [] : [[AUTO_CONVERGE_KEY, initial]]);
  return { values, get: async <T,>(key: string) => values.get(key) as T | undefined, set: async (key: string, value: unknown) => { values.set(key, value); } };
}

describe('auto converge setting', () => {
  it('defaults off when nothing is stored', async () => {
    const setting = createAutoConvergeSetting(kvOf(), vi.fn());
    expect(await setting.get()).toBe(false);
    expect(setting.enabled()).toBe(false);
  });
  it('loads a stored true and treats other stored values as off', async () => {
    expect(await createAutoConvergeSetting(kvOf(true), vi.fn()).get()).toBe(true);
    expect(await createAutoConvergeSetting(kvOf('true'), vi.fn()).get()).toBe(false);
  });
  it('persists and applies a change immediately', async () => {
    const kv = kvOf();
    const setting = createAutoConvergeSetting(kv, vi.fn());
    expect(await setting.set(true)).toBe(true);
    expect(setting.enabled()).toBe(true);
    expect(kv.values.get(AUTO_CONVERGE_KEY)).toBe(true);
  });
  it('rejects a non-boolean and does not write', async () => {
    const kv = kvOf();
    const setting = createAutoConvergeSetting(kv, vi.fn());
    await expect(setting.set('yes' as never)).rejects.toThrow(/boolean/);
    expect(kv.values.size).toBe(0);
  });
  it('fails closed and warns when the stored value cannot be read', async () => {
    const warn = vi.fn();
    const setting = createAutoConvergeSetting({ get: async () => { throw new Error('disk gone'); }, set: async () => undefined }, warn);
    await setting.ready;
    expect(setting.enabled()).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk gone'));
  });
  it('keeps a value saved before a slow load finishes', async () => {
    let release!: (value: unknown) => void;
    const kv = { get: () => new Promise<never>((resolve) => { release = resolve as never; }), set: async () => undefined };
    const setting = createAutoConvergeSetting(kv as never, vi.fn());
    await setting.set(true);
    release(false);
    await setting.ready;
    expect(setting.enabled()).toBe(true);
  });
  describe('migration from the old global setting', () => {
    it('copies a legacy true once when KV has no value', async () => {
      const kv = kvOf();
      const setting = createAutoConvergeSetting(kv, vi.fn(), async () => true);
      expect(await setting.get()).toBe(true);
      expect(kv.values.get(AUTO_CONVERGE_KEY)).toBe(true);
    });
    it('ignores a legacy false', async () => {
      const kv = kvOf();
      expect(await createAutoConvergeSetting(kv, vi.fn(), async () => false).get()).toBe(false);
      expect(kv.values.size).toBe(0);
    });
    it('lets an existing KV value win, including an explicit off', async () => {
      const legacy = vi.fn(async () => true);
      expect(await createAutoConvergeSetting(kvOf(false), vi.fn(), legacy).get()).toBe(false);
      expect(legacy).not.toHaveBeenCalled();
    });
    it('does not overwrite a choice made while the legacy read is pending', async () => {
      const kv = kvOf();
      let release!: (value: boolean) => void;
      const setting = createAutoConvergeSetting(kv, vi.fn(), () => new Promise<boolean>((resolve) => { release = resolve; }));
      await vi.waitFor(() => expect(release).toBeDefined());
      await setting.set(false);
      release(true);
      await setting.ready;
      expect(kv.values.get(AUTO_CONVERGE_KEY)).toBe(false);
      expect(setting.enabled()).toBe(false);
    });
    it('fails closed and warns when the legacy read fails', async () => {
      const warn = vi.fn();
      const setting = createAutoConvergeSetting(kvOf(), warn, async () => { throw new Error('legacy gone'); });
      expect(await setting.get()).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('legacy gone'));
    });
  });
});
