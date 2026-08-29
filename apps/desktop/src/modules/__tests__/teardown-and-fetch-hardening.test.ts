/**
 * Regression coverage for the two 🔴 security re-review findings (native task #17):
 *
 *  - FINDING A: the shared manual-redirect helper + capped body reader extracted
 *    from broker-caps.ts, which the trusted built-in fetch now reuses (no
 *    duplicated, drift-prone copy). We assert the helper follows a Location,
 *    invokes the per-hop `onHop` callback when given one, and stops at the hop
 *    cap; and that readCappedText aborts a body past the cap mid-stream.
 *  - FINDING B: MainModuleHost.teardownAll() tears down every registered module
 *    and isolates a single throwing teardown so it can't block the rest.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// registry.ts imports electron's `app`/`shell`; mock them so it loads under
// vitest (mirrors the existing persona-store / scheduler tests' approach).
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return tmpdir();
      throw new Error(`Unexpected getPath('${name}')`);
    }
  },
  shell: { openExternal: vi.fn() }
}));

import {
  followManualRedirects,
  readCappedText,
  FETCH_MAX_REDIRECTS
} from '../../extensions/broker-caps.js';
import { MainModuleHost } from '../registry.js';
import { PersonaTeamRegistry } from '../../extensions/persona-team-registry.js';
import type { MainModule, MainModuleContext } from '@zana-ai/zcc-extension-sdk/main';

describe('followManualRedirects — shared redirect helper (Finding A)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function redirectTo(location: string) {
    return new Response(null, { status: 302, headers: { location } });
  }

  it('follows a Location to the final response', async () => {
    let calls = 0;
    globalThis.fetch = (async (input: string) => {
      calls++;
      if (String(input).includes('/start')) return redirectTo('https://b.example/end');
      return new Response('done', { status: 200 });
    }) as typeof fetch;

    const res = await followManualRedirects('https://a.example/start', undefined);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('done');
    expect(calls).toBe(2);
  });

  it('invokes onHop with the resolved host on every hop when provided', async () => {
    globalThis.fetch = (async (input: string) => {
      if (String(input).includes('a.example')) return redirectTo('https://b.example/end');
      return new Response('done', { status: 200 });
    }) as typeof fetch;

    const hops: string[] = [];
    await followManualRedirects('https://a.example/start', undefined, (host) => {
      hops.push(host);
    });
    // onHop fires before each request: the initial host AND the redirect target.
    expect(hops).toEqual(['a.example', 'b.example']);
  });

  it('stops at the hop cap and throws "too many redirects"', async () => {
    let calls = 0;
    // Always redirect → exceeds FETCH_MAX_REDIRECTS.
    globalThis.fetch = (async () => {
      calls++;
      return redirectTo('https://a.example/again');
    }) as typeof fetch;

    await expect(
      followManualRedirects('https://a.example/start', undefined)
    ).rejects.toThrow(/too many redirects/);
    // One request per hop, capped at FETCH_MAX_REDIRECTS + 1 (hops 0..MAX).
    expect(calls).toBe(FETCH_MAX_REDIRECTS + 1);
  });

  it('throws "too many redirects" via the onHop path too (caps regardless of hook)', async () => {
    globalThis.fetch = (async () => redirectTo('https://a.example/again')) as typeof fetch;
    const hops: string[] = [];
    await expect(
      followManualRedirects('https://a.example/start', undefined, (h) => hops.push(h))
    ).rejects.toThrow(/too many redirects/);
    expect(hops.length).toBe(FETCH_MAX_REDIRECTS + 1);
  });

  it('rejects an invalid url before any network call', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('x');
    }) as typeof fetch;
    await expect(followManualRedirects('not a url', undefined)).rejects.toThrow(/invalid url/);
    expect(called).toBe(false);
  });

  // Item 2 (#19): the built-in fetch wires a timeout AbortController whose signal
  // is threaded here. Assert the signal reaches the underlying fetch and that an
  // aborted signal surfaces (so a hung host can't stall main forever).
  it('forwards an AbortSignal to fetch and aborts when it fires', async () => {
    let seen: AbortSignal | undefined;
    globalThis.fetch = (async (_input: string, init?: { signal?: AbortSignal }) => {
      seen = init?.signal;
      // Simulate a host that never responds until the signal aborts.
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        );
      });
    }) as typeof fetch;

    const controller = new AbortController();
    const p = followManualRedirects('https://slow.example/x', undefined, undefined, controller.signal);
    controller.abort();
    await expect(p).rejects.toThrow(/abort/i);
    expect(seen).toBe(controller.signal);
  });

  it('passes no signal when none is given (broker path unchanged)', async () => {
    let seen: unknown = 'unset';
    globalThis.fetch = (async (_input: string, init?: { signal?: AbortSignal }) => {
      seen = init?.signal;
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
    await followManualRedirects('https://a.example/x', undefined);
    expect(seen).toBeUndefined();
  });
});

describe('readCappedText — streaming body cap (Finding A)', () => {
  it('aborts a body that exceeds the cap mid-stream', async () => {
    const chunk = new Uint8Array(1024); // 1 KiB chunks
    let sent = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 100) {
          controller.close();
          return;
        }
        sent++;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      }
    });
    const res = new Response(stream, { status: 200 });
    // Cap at 4 KiB; the 100 KiB stream blows past it.
    await expect(readCappedText(res, 4 * 1024)).rejects.toThrow(/exceeds 4096 bytes/);
    expect(cancelled).toBe(true);
  });

  it('returns the full body when under the cap', async () => {
    const res = new Response('hello world', { status: 200 });
    expect(await readCappedText(res, 1024)).toBe('hello world');
  });
});

describe('MainModuleHost.teardownAll (Finding B)', () => {
  function fakeModule(id: string, teardown?: () => void | Promise<void>): MainModule {
    return {
      id,
      setup: () => ({}),
      ...(teardown ? { teardown } : {})
    };
  }

  it('calls teardown on every registered module', async () => {
    const host = new MainModuleHost({ log: () => {} });
    const a = vi.fn();
    const b = vi.fn();
    await host.setupAll([fakeModule('a', a), fakeModule('b', b)]);

    await host.teardownAll();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    // All modules dropped → no longer live.
    expect(host.liveModuleIds().size).toBe(0);
  });

  it('tolerates one module throwing without skipping the others', async () => {
    const logs: string[] = [];
    const host = new MainModuleHost({ log: (m) => logs.push(m) });
    const before = vi.fn();
    const boom = vi.fn(() => {
      throw new Error('teardown blew up');
    });
    const after = vi.fn();
    await host.setupAll([
      fakeModule('before', before),
      fakeModule('boom', boom),
      fakeModule('after', after)
    ]);

    // Must not reject even though `boom` throws.
    await expect(host.teardownAll()).resolves.toBeUndefined();

    expect(before).toHaveBeenCalledTimes(1);
    expect(boom).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(host.liveModuleIds().size).toBe(0);
    // The throw was logged, not swallowed silently.
    expect(logs.some((m) => m.includes('teardown failed'))).toBe(true);
  });

  it('also tolerates an async (rejecting) teardown', async () => {
    const host = new MainModuleHost({ log: () => {} });
    const ok = vi.fn();
    const rejects = vi.fn(async () => {
      throw new Error('async teardown rejected');
    });
    await host.setupAll([fakeModule('ok', ok), fakeModule('rejects', rejects)]);

    await expect(host.teardownAll()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(rejects).toHaveBeenCalledTimes(1);
  });
});

// W1-6 — ctx.register disposables run on teardown, after the module's teardown().
describe('MainModuleHost — ctx.register auto-dispose (W1-6)', () => {
  it('runs registered disposables on teardown, AFTER the module teardown()', async () => {
    const host = new MainModuleHost({ log: () => {} });
    const order: string[] = [];
    const mod: MainModule = {
      id: 'w6',
      setup: (ctx: MainModuleContext) => {
        ctx.register(() => order.push('disposable-1'));
        ctx.register(() => order.push('disposable-2'));
        return {};
      },
      teardown: () => {
        order.push('teardown');
      }
    };
    await host.setupAll([mod]);
    expect(order).toEqual([]); // nothing runs at setup time

    await host.teardown('w6');
    // teardown() first, then disposables in registration order.
    expect(order).toEqual(['teardown', 'disposable-1', 'disposable-2']);
  });

  it('is idempotent — a disposable does not re-run on a second teardown', async () => {
    const host = new MainModuleHost({ log: () => {} });
    const ran = vi.fn();
    const mod: MainModule = {
      id: 'w6-idem',
      setup: (ctx: MainModuleContext) => {
        ctx.register(ran);
        return {};
      }
    };
    await host.setupAll([mod]);
    await host.teardown('w6-idem');
    await host.teardown('w6-idem'); // unknown now → no-op
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('still runs disposables when the module teardown() throws (isolated)', async () => {
    const logs: string[] = [];
    const host = new MainModuleHost({ log: (m) => logs.push(m) });
    const disposed = vi.fn();
    const mod: MainModule = {
      id: 'w6-throw',
      setup: (ctx: MainModuleContext) => {
        ctx.register(disposed);
        return {};
      },
      teardown: () => {
        throw new Error('teardown blew up');
      }
    };
    await host.setupAll([mod]);
    await expect(host.teardown('w6-throw')).resolves.toBeUndefined();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(logs.some((m) => m.includes('teardown failed'))).toBe(true);
  });

  it('isolates a throwing disposable so the rest still run', async () => {
    const logs: string[] = [];
    const host = new MainModuleHost({ log: (m) => logs.push(m) });
    const after = vi.fn();
    const mod: MainModule = {
      id: 'w6-d-throw',
      setup: (ctx: MainModuleContext) => {
        ctx.register(() => {
          throw new Error('disposable blew up');
        });
        ctx.register(after);
        return {};
      }
    };
    await host.setupAll([mod]);
    await host.teardown('w6-d-throw');
    expect(after).toHaveBeenCalledTimes(1);
    expect(logs.some((m) => m.includes('disposable failed'))).toBe(true);
  });

  it('teardownAll also drains ctx.register disposables', async () => {
    const host = new MainModuleHost({ log: () => {} });
    const d = vi.fn();
    const mod: MainModule = {
      id: 'w6-all',
      setup: (ctx: MainModuleContext) => {
        ctx.register(d);
        return {};
      }
    };
    await host.setupAll([mod]);
    await host.teardownAll();
    expect(d).toHaveBeenCalledTimes(1);
  });
});

describe('MainModuleHost — built-in persona/team ctx + teardown-clears', () => {
  it('hands a module ctx.personas/ctx.teams that stamp provenance from mod.id (Rule 6)', async () => {
    const registry = new PersonaTeamRegistry(() => []);
    const host = new MainModuleHost({ log: () => {}, registry });
    let captured: MainModuleContext | null = null;
    const mod: MainModule = {
      id: 'acme',
      setup: (ctx) => {
        captured = ctx;
        return {};
      }
    };
    await host.setupAll([mod]);
    expect(captured!.personas).toBeDefined();
    expect(captured!.teams).toBeDefined();

    // The module passes ONLY input; the host stamps {extensionId: 'acme'}.
    const accepted = await captured!.personas!.register([{ id: 'rev', name: 'Reviewer' }]);
    expect(accepted[0].id).toBe('ext:acme:rev');
    expect(accepted[0].source).toEqual({ extensionId: 'acme' });
    expect(registry.allPersonas()).toHaveLength(1);
  });

  it('teardown clears the module registrations (no zombie personas)', async () => {
    const registry = new PersonaTeamRegistry(() => []);
    const host = new MainModuleHost({ log: () => {}, registry });
    const mod: MainModule = {
      id: 'acme',
      setup: (ctx) => {
        void ctx.personas!.register([{ id: 'rev', name: 'Reviewer' }]);
        void ctx.teams!.register([{ name: 'Squad', slots: [] }]);
        return {};
      }
    };
    await host.setupAll([mod]);
    expect(registry.allPersonas().length).toBeGreaterThan(0);

    await host.teardown('acme');
    expect(registry.allPersonas()).toEqual([]);
    expect(registry.allTeams()).toEqual([]);
  });

  it('omits ctx.personas/ctx.teams when no registry is injected', async () => {
    const host = new MainModuleHost({ log: () => {} });
    let captured: MainModuleContext | null = null;
    await host.setupAll([
      {
        id: 'x',
        setup: (ctx) => {
          captured = ctx;
          return {};
        }
      }
    ]);
    expect(captured!.personas).toBeUndefined();
    expect(captured!.teams).toBeUndefined();
  });
});

describe('MainModuleHost.storageClear — uninstall storage purge', () => {
  const storeFile = (id: string) => join(tmpdir(), '.zcc', 'modules', `${id}.json`);

  it('drops the in-memory cache AND the backing <id>.json file', () => {
    const id = `purge-${randomBytes(4).toString('hex')}`;
    const host = new MainModuleHost({ log: () => {} });
    host.storageSet(id, 'k', 'v');
    expect(existsSync(storeFile(id))).toBe(true);
    expect(host.storageGet(id, 'k')).toBe('v');

    host.storageClear(id);

    // File gone, and a fresh read (new store) sees nothing — a reinstall of the
    // same id starts clean rather than inheriting the removed extension's state.
    expect(existsSync(storeFile(id))).toBe(false);
    expect(host.storageGet(id, 'k')).toBeUndefined();
  });

  it('is a safe no-op when the module wrote nothing (no file)', () => {
    const id = `empty-${randomBytes(4).toString('hex')}`;
    const host = new MainModuleHost({ log: () => {} });
    expect(() => host.storageClear(id)).not.toThrow();
    expect(existsSync(storeFile(id))).toBe(false);
  });
});
