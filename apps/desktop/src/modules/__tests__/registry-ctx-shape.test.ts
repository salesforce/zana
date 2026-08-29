/**
 * A7 — built-in ctx-shape regression fence.
 *
 * Proves `MainModuleHost.setupAll` (registry.ts) hands every built-in module a
 * ctx carrying the trusted built-in member set (`storage`/`log`/`exec`/`fetch`),
 * and that A1's additive optional `resolveProjectRoot` rides along without
 * breaking the generic dispatch bus.
 *
 * `resolveProjectRoot` is asserted as present-or-undefined and never required —
 * green both before A3 wires it in and after. The integration exercises
 * the module ONLY through the generic `host.dispatch(moduleId, ...)` bus (Rule 6:
 * core never branches on a concrete extension id).
 */
import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os';

// registry.ts imports electron's `app`/`shell`; mock them so it loads under
// vitest (mirrors teardown-and-fetch-hardening.test.ts).
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return tmpdir();
      throw new Error(`Unexpected getPath('${name}')`);
    }
  },
  shell: { openExternal: vi.fn() }
}));

import { MainModuleHost } from '../registry.js';
import type { MainModule } from '@zana-ai/zcc-extension-sdk/main';
import type { MainModuleContext } from '@zana-ai/zcc-extension-sdk/main';

describe('A7: MainModuleHost ctx shape (registry.ts setupAll)', () => {
  it('hands each module a ctx with the trusted built-in member set', async () => {
    const host = new MainModuleHost({ log: () => {} });
    let captured: MainModuleContext | undefined;
    const probe: MainModule = {
      id: 'probe',
      async setup(ctx) {
        captured = ctx;
        return {};
      }
    };

    await host.setupAll([probe]);

    expect(captured).toBeDefined();
    expect(typeof captured!.exec).toBe('function');
    expect(typeof captured!.fetch).toBe('function');
    expect(captured!.storage).toBeDefined();
    expect(typeof captured!.log).toBe('function');
    // A1/A3 forward-compat: present-as-function OR undefined — never asserted
    // defined, so this stays green pre- and post-A3.
    expect(
      captured!.resolveProjectRoot === undefined ||
        typeof captured!.resolveProjectRoot === 'function'
    ).toBe(true);
    // summarizeSession: additive optional cap — present
    // as a function OR undefined, never required, so this stays green whether or
    // not the host was given the dep.
    expect(
      captured!.summarizeSession === undefined ||
        typeof captured!.summarizeSession === 'function'
    ).toBe(true);
  });

  it('forwards ctx.summarizeSession when the host was given the dep', async () => {
    const summarizeSession = vi.fn(async () => ({ ok: true, text: 'did a thing' }));
    const host = new MainModuleHost({ log: () => {}, summarizeSession });
    let captured: MainModuleContext | undefined;
    const probe: MainModule = {
      id: 'probe',
      async setup(ctx) {
        captured = ctx;
        return {};
      }
    };

    await host.setupAll([probe]);

    expect(typeof captured!.summarizeSession).toBe('function');
    await captured!.summarizeSession!('S1', { scope: 'lastTurn' });
    expect(summarizeSession).toHaveBeenCalledWith('S1', { scope: 'lastTurn' });
  });

  it('a module set up through the real host gets working caps via the generic bus', async () => {
    const host = new MainModuleHost({ log: () => {} });
    const probe: MainModule = {
      id: 'probe',
      async setup() {
        return { ping: async () => ({ ok: true }) };
      }
    };
    await host.setupAll([probe]);

    await expect(host.dispatch('probe', 'ping', [])).resolves.toEqual({ ok: true });
    await expect(host.teardownAll()).resolves.toBeUndefined();
  });
});
