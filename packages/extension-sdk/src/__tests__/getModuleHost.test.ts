/**
 * W1-7 — the non-React `getModuleHost()` accessor.
 *
 * Blesses the per-extension `host-holder.ts` hack into ONE SDK primitive: a
 * module-scoped host, primed by `activate({ host })` via `primeModuleHost`, read
 * lazily by non-React code (a store, a data seam) via `getModuleHost`. The
 * contract this locks:
 *   - returns `null` (NEVER throws) before priming — callers null-check;
 *   - `primeModuleHost` makes the live host observable;
 *   - `setModuleHostForTesting(null)` clears it so tests don't leak across each
 *     other (the accessor is a module singleton).
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { ModuleHost } from '../renderer.js';
import { getModuleHost, primeModuleHost, setModuleHostForTesting } from '../renderer.js';
import { createMockHost } from '../testing.js';

afterEach(() => {
  // The accessor is a module singleton — reset so one test can't leak a host
  // into the next (and so the "before priming" assertion is meaningful).
  setModuleHostForTesting(null);
});

describe('getModuleHost / primeModuleHost (W1-7)', () => {
  it('returns null before activate primes it — never throws', () => {
    expect(getModuleHost()).toBeNull();
  });

  it('returns the host primeModuleHost was given (the activate path)', () => {
    const host = createMockHost({ moduleId: 'w7-ext' });
    primeModuleHost(host);
    expect(getModuleHost()).toBe(host);
  });

  it('a later prime replaces the earlier host (single instance per extension)', () => {
    const first = createMockHost({ moduleId: 'first' });
    const second = createMockHost({ moduleId: 'second' });
    primeModuleHost(first);
    primeModuleHost(second);
    expect(getModuleHost()).toBe(second);
  });

  it('setModuleHostForTesting doubles as createMockHost injection + null reset', () => {
    const host = createMockHost();
    setModuleHostForTesting(host);
    expect(getModuleHost()).toBe(host);
    setModuleHostForTesting(null);
    expect(getModuleHost()).toBeNull();
  });
});
