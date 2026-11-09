import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTimeoutScale, scaleTimeout } from './test-timeout-scale.mjs';

// REQ-1, REQ-2: pure helper behaviour.
describe('parseTimeoutScale', () => {
  it('REQ-1: unset or empty means 1', () => {
    expect(parseTimeoutScale(undefined)).toBe(1);
    expect(parseTimeoutScale('')).toBe(1);
  });
  it('REQ-2: 1 to 5 are accepted', () => {
    for (const n of [1, 2, 3, 4, 5]) expect(parseTimeoutScale(String(n))).toBe(n);
  });
  it('REQ-2: anything else means 1', () => {
    for (const raw of ['0', '-2', '6', '100', 'abc', 'NaN', 'Infinity', ' ']) expect(parseTimeoutScale(raw)).toBe(1);
  });
});

describe('scaleTimeout', () => {
  it('REQ-1: unset keeps the base value', () => expect(scaleTimeout(20_000, undefined)).toBe(20_000));
  it('REQ-2: multiplies by 2 to 5', () => {
    expect(scaleTimeout(20_000, '3')).toBe(60_000);
    expect(scaleTimeout(600, '5')).toBe(3_000);
  });
  it('REQ-2: invalid values keep the base value', () => {
    for (const raw of ['0', '-1', '9', 'x']) expect(scaleTimeout(20_000, raw)).toBe(20_000);
  });
});

// REQ-1, REQ-2: the real vitest config honours the env var.
describe('vitest.config timeouts', () => {
  const original = process.env.ZANA_TEST_TIMEOUT_SCALE;
  afterEach(() => {
    if (original === undefined) delete process.env.ZANA_TEST_TIMEOUT_SCALE; else process.env.ZANA_TEST_TIMEOUT_SCALE = original;
  });
  async function timeouts(raw: string | undefined) {
    if (raw === undefined) delete process.env.ZANA_TEST_TIMEOUT_SCALE; else process.env.ZANA_TEST_TIMEOUT_SCALE = raw;
    vi.resetModules();
    const { default: config } = await import('../vitest.config');
    return { test: config.test?.testTimeout, hook: config.test?.hookTimeout };
  }
  it('REQ-1: unset gives 20000 and 20000', async () => {
    expect(await timeouts(undefined)).toEqual({ test: 20_000, hook: 20_000 });
  });
  it.each([2, 3, 4, 5])('REQ-2: scale %i multiplies both', async (n) => {
    expect(await timeouts(String(n))).toEqual({ test: 20_000 * n, hook: 20_000 * n });
  });
  it.each(['0', '-3', '6', 'fast', ''])('REQ-2: invalid %j gives today\'s values', async (raw) => {
    expect(await timeouts(raw)).toEqual({ test: 20_000, hook: 20_000 });
  });
});
