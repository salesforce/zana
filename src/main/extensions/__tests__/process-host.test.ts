import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ExtensionProcessHost,
  type ChildEndpoint,
  type HostStorage,
  type BrokerCapabilities,
  type PersonaTeamRegistryLike
} from '../process-host.js';
import { ModuleRouter } from '../module-router.js';
import type { ChildToHost, HostToChild } from '../host-protocol.js';
import type { HostLaunchSpec } from '../../../shared/module-main.js';

/**
 * A mock child endpoint that lets a test drive the child side of the protocol:
 * it captures host→child messages and can inject child→host messages. No real
 * utilityProcess — this exercises the host's RPC routing, timeout, teardown, and
 * crash-isolation logic, which is the unit-testable surface of P3-A.
 */
class MockEndpoint implements ChildEndpoint {
  sent: HostToChild[] = [];
  private msgListener?: (m: ChildToHost) => void;
  private exitListener?: (code: number | null) => void;
  killed = false;

  postMessage(msg: HostToChild): void {
    this.sent.push(msg);
  }
  onMessage(listener: (m: ChildToHost) => void): void {
    this.msgListener = listener;
  }
  onExit(listener: (code: number | null) => void): void {
    this.exitListener = listener;
  }
  kill(): void {
    this.killed = true;
  }

  // ---- test drivers (the "child") ----
  emit(msg: ChildToHost): void {
    this.msgListener?.(msg);
  }
  crash(code: number | null = 1): void {
    this.exitListener?.(code);
  }
  /** The last `call` the host sent, for replying by callId. */
  lastCall(): Extract<HostToChild, { type: 'call' }> {
    const call = [...this.sent].reverse().find((m) => m.type === 'call');
    if (!call) throw new Error('no call sent');
    return call as Extract<HostToChild, { type: 'call' }>;
  }
}

function makeHost(opts?: {
  storage?: HostStorage;
  caps?: BrokerCapabilities;
  registry?: PersonaTeamRegistryLike;
  listInstalledExtensions?: () => Array<{ id: string; repository?: string }>;
  callTimeoutMs?: number;
  teardownTimeoutMs?: number;
  setupTimeoutMs?: number;
  lifecycleTimeoutMs?: number;
}) {
  const endpoints = new Map<string, MockEndpoint>();
  const storage: HostStorage =
    opts?.storage ??
    (() => {
      const data = new Map<string, unknown>();
      return {
        get: (id, key) => data.get(`${id}:${key}`),
        set: (id, key, value) => data.set(`${id}:${key}`, value)
      };
    })();
  const host = new ExtensionProcessHost({
    spawn: (_entry, moduleId) => {
      const ep = new MockEndpoint();
      endpoints.set(moduleId, ep);
      return ep;
    },
    storage,
    caps: opts?.caps,
    registry: opts?.registry,
    listInstalledExtensions: opts?.listInstalledExtensions,
    log: () => {},
    callTimeoutMs: opts?.callTimeoutMs ?? 1000,
    teardownTimeoutMs: opts?.teardownTimeoutMs ?? 50,
    setupTimeoutMs: opts?.setupTimeoutMs ?? 1000,
    lifecycleTimeoutMs: opts?.lifecycleTimeoutMs
  });
  return { host, endpoints, storage };
}

/** Spawn + report ready in one helper. Returns the mock endpoint. */
async function spawnReady(host: ExtensionProcessHost, endpoints: Map<string, MockEndpoint>, id: string) {
  const p = host.spawn({ moduleId: id, entryPath: `/x/${id}/main.js` });
  const ep = endpoints.get(id)!;
  ep.emit({ type: 'ready', moduleId: id, capabilities: ['ping'] });
  expect(await p).toBe(true);
  return ep;
}

describe('ExtensionProcessHost', () => {
  beforeEach(() => vi.useRealTimers());

  it('spawn sends init then resolves true on ready; lists the id as live', async () => {
    const { host, endpoints } = makeHost();
    const ep = await spawnReady(host, endpoints, 'alpha');
    expect(ep.sent[0]).toEqual({ type: 'init', entryPath: '/x/alpha/main.js', moduleId: 'alpha' });
    expect(host.has('alpha')).toBe(true);
    expect([...host.liveModuleIds()]).toEqual(['alpha']);
  });

  it('spawn resolves false on setup-error and drops the child (not live, killed)', async () => {
    const { host, endpoints } = makeHost();
    const p = host.spawn({ moduleId: 'bad', entryPath: '/x/bad/main.js' });
    const ep = endpoints.get('bad')!;
    ep.emit({ type: 'setup-error', moduleId: 'bad', error: 'boom' });
    expect(await p).toBe(false);
    expect(ep.killed).toBe(true);
    expect(host.has('bad')).toBe(false);
    expect([...host.liveModuleIds()]).toEqual([]);
  });

  it('spawn resolves false when the spawn factory throws (boot isolation)', async () => {
    const host = new ExtensionProcessHost({
      spawn: () => {
        throw new Error('fork failed');
      },
      storage: { get: () => undefined, set: () => {} },
      log: () => {}
    });
    expect(await host.spawn({ moduleId: 'z', entryPath: '/x' })).toBe(false);
    expect(host.has('z')).toBe(false);
  });

  it('dispatch round-trips a call → result by callId', async () => {
    const { host, endpoints } = makeHost();
    const ep = await spawnReady(host, endpoints, 'alpha');
    const callP = host.dispatch('alpha', 'ping', [1, 2]);
    const call = ep.lastCall();
    expect(call).toMatchObject({ type: 'call', capability: 'ping', args: [1, 2] });
    ep.emit({ type: 'result', callId: call.callId, ok: true, result: 'pong' });
    expect(await callP).toBe('pong');
  });

  it('dispatch rejects with the child error on ok:false', async () => {
    const { host, endpoints } = makeHost();
    const ep = await spawnReady(host, endpoints, 'alpha');
    const callP = host.dispatch('alpha', 'ping', []);
    const call = ep.lastCall();
    ep.emit({ type: 'result', callId: call.callId, ok: false, error: 'capability blew up' });
    await expect(callP).rejects.toThrow('capability blew up');
  });

  it('dispatch rejects unknown / not-ready modules', async () => {
    const { host, endpoints } = makeHost();
    await expect(host.dispatch('nope', 'x', [])).rejects.toThrow('Unknown module: nope');
    // Spawned but not ready yet → "not ready".
    host.spawn({ moduleId: 'pending', entryPath: '/x' });
    await expect(host.dispatch('pending', 'x', [])).rejects.toThrow('Module not ready');
    endpoints.get('pending')!.emit({ type: 'ready', moduleId: 'pending', capabilities: [] });
  });

  it('dispatch rejects on timeout without wedging (fake timers)', async () => {
    vi.useFakeTimers();
    const { host, endpoints } = makeHost({ callTimeoutMs: 100 });
    const p = host.spawn({ moduleId: 'slow', entryPath: '/x' });
    endpoints.get('slow')!.emit({ type: 'ready', moduleId: 'slow', capabilities: [] });
    await p;
    const callP = host.dispatch('slow', 'hang', []);
    const assertion = expect(callP).rejects.toThrow('Capability timed out: slow.hang');
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    vi.useRealTimers();
  });

  it('a child crash rejects every in-flight call and isolates the module', async () => {
    const { host, endpoints } = makeHost();
    const ep = await spawnReady(host, endpoints, 'alpha');
    const a = host.dispatch('alpha', 'one', []);
    const b = host.dispatch('alpha', 'two', []);
    ep.crash(139);
    await expect(a).rejects.toThrow('Extension alpha exited (code 139)');
    await expect(b).rejects.toThrow('exited (code 139)');
    // No longer live, but the crash is recorded so a later dispatch gives a
    // clear message (router keeps routing it here, not "Unknown module").
    expect([...host.liveModuleIds()]).not.toContain('alpha');
    expect(host.has('alpha')).toBe(true);
    await expect(host.dispatch('alpha', 'ping', [])).rejects.toThrow(
      'Extension alpha crashed — relaunch to retry'
    );
    // A fresh spawn clears the crash record.
    const ep2 = await spawnReady(host, endpoints, 'alpha');
    const reP = host.dispatch('alpha', 'ping', []);
    ep2.emit({ type: 'result', callId: ep2.lastCall().callId, ok: true, result: 'back' });
    expect(await reP).toBe('back');
    // Sibling unaffected: a second extension still dispatches fine.
    const epb = await spawnReady(host, endpoints, 'beta');
    const cP = host.dispatch('beta', 'ping', []);
    epb.emit({ type: 'result', callId: epb.lastCall().callId, ok: true, result: 'ok' });
    expect(await cP).toBe('ok');
  });

  it('teardown sends a teardown RPC then kills, and drops the module', async () => {
    const { host, endpoints } = makeHost();
    const ep = await spawnReady(host, endpoints, 'alpha');
    const tdP = host.teardown('alpha');
    const td = ep.sent.find((m) => m.type === 'teardown') as Extract<HostToChild, { type: 'teardown' }>;
    expect(td).toBeTruthy();
    ep.emit({ type: 'result', callId: td.callId, ok: true });
    await tdP;
    expect(ep.killed).toBe(true);
    expect(host.has('alpha')).toBe(false);
  });

  it('respawning a LIVE child tears the old one down and routes to the fresh one (hot-reload core)', async () => {
    // This is the foundation of the whole hot-reload feature: when the watcher
    // (or Reload) re-syncs a CHANGED but still-healthy extension, runDiskSync
    // calls spawn() again for the same id. spawn() must tear the old child down
    // first (so no stale process lingers / holds files) and stand up a fresh one
    // — which, in the real host, means a fresh import() of the new code on disk.
    const { host, endpoints } = makeHost();
    const oldEp = await spawnReady(host, endpoints, 'alpha');
    expect(oldEp.killed).toBe(false);

    // Re-spawn the same id. spawn() FIRST awaits teardown of the live child,
    // which sends a teardown RPC and waits for the reply (or its timeout); only
    // then does the spawn factory mint the new endpoint. So reply to the old
    // child's teardown to let the respawn proceed promptly.
    const p = host.spawn({ moduleId: 'alpha', entryPath: '/x/alpha/main.js' });
    const td = oldEp.sent.find((m) => m.type === 'teardown') as Extract<
      HostToChild,
      { type: 'teardown' }
    >;
    expect(td).toBeTruthy(); // old child was asked to tear down BEFORE the new spawn
    oldEp.emit({ type: 'result', callId: td.callId, ok: true });

    // Wait for the spawn factory to mint the fresh endpoint (replacing the map
    // entry), then drive it to ready.
    let newEp = endpoints.get('alpha')!;
    for (let i = 0; i < 20 && newEp === oldEp; i++) {
      await Promise.resolve();
      newEp = endpoints.get('alpha')!;
    }
    expect(newEp).not.toBe(oldEp); // a distinct child for the respawn
    expect(oldEp.killed).toBe(true); // previous child killed — no lingering proc

    newEp.emit({ type: 'ready', moduleId: 'alpha', capabilities: ['ping'] });
    expect(await p).toBe(true);
    expect([...host.liveModuleIds()]).toEqual(['alpha']);

    // Dispatch now round-trips against the FRESH endpoint — proving routing
    // points at the new child, not the torn-down one.
    const call = host.dispatch('alpha', 'ping', []);
    newEp.emit({ type: 'result', callId: newEp.lastCall().callId, ok: true, result: 'fresh' });
    expect(await call).toBe('fresh');
  });

  it('broker storage.get/set is keyed by the AUTHENTICATED id, ignoring any payload id', async () => {
    const data = new Map<string, unknown>();
    const storage: HostStorage = {
      get: (id, key) => data.get(`${id}:${key}`),
      set: (id, key, value) => data.set(`${id}:${key}`, value)
    };
    const { host, endpoints } = makeHost({ storage });
    const ep = await spawnReady(host, endpoints, 'alpha');

    // Child sets a key — host stores it under 'alpha' (the bound id).
    ep.emit({ type: 'broker', reqId: 1, method: 'storage.set', args: ['k', 'v'] });
    expect(data.get('alpha:k')).toBe('v');
    const setReply = ep.sent.find(
      (m) => m.type === 'broker-result'
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(setReply).toMatchObject({ type: 'broker-result', reqId: 1, ok: true });

    // Child reads it back — host serves from 'alpha' namespace.
    ep.emit({ type: 'broker', reqId: 2, method: 'storage.get', args: ['k'] });
    const getReply = ep.sent
      .filter((m) => m.type === 'broker-result')
      .find((m) => (m as { reqId: number }).reqId === 2) as Extract<
      HostToChild,
      { type: 'broker-result' }
    >;
    expect(getReply).toMatchObject({ ok: true, result: 'v' });
    // Nothing was ever written to a sibling namespace.
    expect(data.has('beta:k')).toBe(false);
  });

  it('returns only the host-provided installed extension catalogue', async () => {
    const listInstalledExtensions = vi.fn(() => [{ id: 'gus' }]);
    const { host, endpoints } = makeHost({ listInstalledExtensions });
    const ep = await spawnReady(host, endpoints, 'alpha');

    ep.emit({ type: 'broker', reqId: 1, method: 'extensions.listInstalled', args: [] });

    expect(listInstalledExtensions).toHaveBeenCalledOnce();
    expect(ep.sent.at(-1)).toMatchObject({
      type: 'broker-result',
      reqId: 1,
      ok: true,
      result: [{ id: 'gus' }]
    });
  });
});

describe('ExtensionProcessHost — install/uninstall lifecycle hooks', () => {
  /** Reply to the lifecycle RPC the host just posted, by callId. */
  function replyLifecycle(ep: MockEndpoint, ok = true, error?: string) {
    const msg = [...ep.sent].reverse().find((m) => m.type === 'lifecycle') as
      | Extract<HostToChild, { type: 'lifecycle' }>
      | undefined;
    if (!msg) throw new Error('no lifecycle message sent');
    ep.emit({ type: 'result', callId: msg.callId, ok, error });
    return msg;
  }

  it('markPendingInstall → fires onInstall exactly once on the next ready', async () => {
    const { host, endpoints } = makeHost();
    host.markPendingInstall('alpha');
    const ep = await spawnReady(host, endpoints, 'alpha');
    // ready consumed the mark and posted a lifecycle:onInstall.
    const life = ep.sent.find((m) => m.type === 'lifecycle') as Extract<
      HostToChild,
      { type: 'lifecycle' }
    >;
    expect(life).toMatchObject({ type: 'lifecycle', hook: 'onInstall' });
    replyLifecycle(ep);

    // A subsequent respawn (hot-reload) must NOT re-fire it — mark is consumed.
    const p = host.spawn({ moduleId: 'alpha', entryPath: '/x/alpha/main.js' });
    const td = ep.sent.find((m) => m.type === 'teardown') as Extract<
      HostToChild,
      { type: 'teardown' }
    >;
    ep.emit({ type: 'result', callId: td.callId, ok: true });
    let newEp = endpoints.get('alpha')!;
    for (let i = 0; i < 20 && newEp === ep; i++) {
      await Promise.resolve();
      newEp = endpoints.get('alpha')!;
    }
    newEp.emit({ type: 'ready', moduleId: 'alpha', capabilities: [] });
    await p;
    expect(newEp.sent.some((m) => m.type === 'lifecycle')).toBe(false);
  });

  it('an ordinary spawn (no mark) never fires onInstall', async () => {
    const { host, endpoints } = makeHost();
    const ep = await spawnReady(host, endpoints, 'alpha');
    expect(ep.sent.some((m) => m.type === 'lifecycle')).toBe(false);
  });

  it('a pending mark survives a reinstall-over-running (teardown-first) respawn', async () => {
    // spawn() tears the live child down first; the mark must NOT be cleared by
    // that teardown, so the FRESH child's ready still fires onInstall.
    const { host, endpoints } = makeHost();
    const oldEp = await spawnReady(host, endpoints, 'alpha'); // live, no mark yet
    expect(oldEp.sent.some((m) => m.type === 'lifecycle')).toBe(false);

    host.markPendingInstall('alpha'); // reinstall marks the running id
    const p = host.spawn({ moduleId: 'alpha', entryPath: '/x/alpha/main.js' });
    const td = oldEp.sent.find((m) => m.type === 'teardown') as Extract<
      HostToChild,
      { type: 'teardown' }
    >;
    oldEp.emit({ type: 'result', callId: td.callId, ok: true });
    let newEp = endpoints.get('alpha')!;
    for (let i = 0; i < 20 && newEp === oldEp; i++) {
      await Promise.resolve();
      newEp = endpoints.get('alpha')!;
    }
    newEp.emit({ type: 'ready', moduleId: 'alpha', capabilities: [] });
    await p;
    expect(newEp.sent.some((m) => m.type === 'lifecycle' && m.hook === 'onInstall')).toBe(true);
  });

  it('a mark cleared by a crash-before-ready does NOT leak to a later unrelated spawn', async () => {
    // Regression (QA high-sev #5): install 'alpha', but its child crashes before
    // reaching ready (setup-error / segfault) so the mark is never consumed. A
    // LATER spawn of the same id that is NOT an install (e.g. reinstall of a
    // different ext reusing the id, or a plain boot) must not inherit the stale
    // mark and spuriously fire onInstall.
    const { host, endpoints } = makeHost();
    host.markPendingInstall('alpha');
    const p = host.spawn({ moduleId: 'alpha', entryPath: '/x/alpha/main.js' });
    const ep = endpoints.get('alpha')!;
    ep.crash(1); // died before ready — onChildExit must clear the mark
    expect(await p).toBe(false);

    // A fresh, unmarked spawn of the same id.
    const ep2 = await spawnReady(host, endpoints, 'alpha');
    expect(ep2.sent.some((m) => m.type === 'lifecycle')).toBe(false);
  });

  it('a mark cleared by a setup TIMEOUT does NOT leak to a later unrelated spawn', async () => {
    // Same leak, via the give-up-on-timeout path (killAndForget bypasses
    // onChildExit, so the timeout handler clears the mark itself).
    const { host, endpoints } = makeHost({ setupTimeoutMs: 10 });
    host.markPendingInstall('beta');
    const p = host.spawn({ moduleId: 'beta', entryPath: '/x/beta/main.js' });
    // Never emit ready → the setup timer fires and gives up.
    expect(await p).toBe(false);

    const ep2 = await spawnReady(host, endpoints, 'beta');
    expect(ep2.sent.some((m) => m.type === 'lifecycle')).toBe(false);
  });

  it('dispatchLifecycle(onUninstall) posts the hook and resolves true on ok', async () => {
    const { host, endpoints } = makeHost();
    const ep = await spawnReady(host, endpoints, 'alpha');
    const p = host.dispatchLifecycle('alpha', 'onUninstall');
    const life = ep.sent.find((m) => m.type === 'lifecycle') as Extract<
      HostToChild,
      { type: 'lifecycle' }
    >;
    expect(life).toMatchObject({ hook: 'onUninstall' });
    ep.emit({ type: 'result', callId: life.callId, ok: true });
    expect(await p).toBe(true);
  });

  it('dispatchLifecycle resolves false (never rejects) for a dead/unknown child', async () => {
    const { host } = makeHost();
    expect(await host.dispatchLifecycle('ghost', 'onUninstall')).toBe(false);
  });

  it('a throwing hook (ok:false) resolves false, not a rejection', async () => {
    const { host, endpoints } = makeHost();
    const ep = await spawnReady(host, endpoints, 'alpha');
    const p = host.dispatchLifecycle('alpha', 'onUninstall');
    const life = ep.sent.find((m) => m.type === 'lifecycle') as Extract<
      HostToChild,
      { type: 'lifecycle' }
    >;
    ep.emit({ type: 'result', callId: life.callId, ok: false, error: 'hook blew up' });
    expect(await p).toBe(false);
  });

  it('a hook that never replies resolves false on the deadline (fake timers)', async () => {
    vi.useFakeTimers();
    const { host, endpoints } = makeHost({ lifecycleTimeoutMs: 100 });
    const pRdy = host.spawn({ moduleId: 'slow', entryPath: '/x' });
    endpoints.get('slow')!.emit({ type: 'ready', moduleId: 'slow', capabilities: [] });
    await pRdy;
    const p = host.dispatchLifecycle('slow', 'onUninstall');
    await vi.advanceTimersByTimeAsync(150);
    expect(await p).toBe(false);
    vi.useRealTimers();
  });
});

describe('ModuleRouter (built-in vs child routing)', () => {
  function fakeBuiltins() {
    const live = new Set<string>(['gus', 'zana']);
    return {
      dispatch: vi.fn(async (id: string) => `builtin:${id}`),
      storageGet: vi.fn((id: string, key: string) => `bg:${id}:${key}`),
      storageSet: vi.fn(),
      storageClear: vi.fn(),
      liveModuleIds: vi.fn(() => new Set(live)),
      teardown: vi.fn(async () => {})
    };
  }

  it('routes a disk-ext id to the process host and a built-in id in-process', async () => {
    const { host, endpoints } = makeHost();
    await spawnReady(host, endpoints, 'diskext');
    const builtins = fakeBuiltins();
    const router = new ModuleRouter(builtins, host);

    // Built-in id → in-process host.
    expect(await router.dispatch('gus', 'cap', [])).toBe('builtin:gus');
    expect(builtins.dispatch).toHaveBeenCalledWith('gus', 'cap', []);

    // Disk-ext id → child RPC.
    const dP = router.dispatch('diskext', 'ping', []);
    const ep = endpoints.get('diskext')!;
    ep.emit({ type: 'result', callId: ep.lastCall().callId, ok: true, result: 'child!' });
    expect(await dP).toBe('child!');
    // Built-in host was NOT consulted for the disk-ext call.
    expect(builtins.dispatch).toHaveBeenCalledTimes(1);
  });

  it('liveModuleIds unions both hosts; teardown routes to the owner', async () => {
    const { host, endpoints } = makeHost();
    await spawnReady(host, endpoints, 'diskext');
    const builtins = fakeBuiltins();
    const router = new ModuleRouter(builtins, host);

    expect([...router.liveModuleIds()].sort()).toEqual(['diskext', 'gus', 'zana']);

    await router.teardown('diskext');
    expect(host.has('diskext')).toBe(false);
    expect(builtins.teardown).not.toHaveBeenCalled();

    await router.teardown('gus');
    expect(builtins.teardown).toHaveBeenCalledWith('gus');
  });
});

describe('ExtensionProcessHost — brokered caps routing (P3-B)', () => {
  it('routes a broker exec request to caps with the AUTHENTICATED id, replies ok', async () => {
    const calls: Array<{ id: string; bin: string }> = [];
    const caps: BrokerCapabilities = {
      exec: async (id, req) => {
        calls.push({ id, bin: req.bin });
        return { stdout: 'out', stderr: '', code: 0 };
      },
      readFile: async () => '',
      writeFile: async () => {},
      rm: async () => {},
      readdir: async () => [],
      stat: async () => ({ size: 0, mtimeMs: 0, isFile: true, isDirectory: false }),
      exists: async () => false,
      fetch: async () => ({ status: 200, ok: true, headers: {}, body: '' }),
      mcp: async () => null,
      mcpInitWorkspace: async () => ({ created: false }),
      mcpIsWorkspaceInitialized: async () => true,
      llm: async () => ({ ok: true, text: '', ms: 0 }),
      streamOpen: async () => 'sub-1',
      streamClose: async () => {}
    };
    const { host, endpoints } = makeHost({ caps });
    const ep = await spawnReady(host, endpoints, 'alpha');
    // Child posts a broker exec; the host gates+performs and replies broker-result.
    ep.emit({ type: 'broker', reqId: 7, method: 'exec', args: [{ bin: 'sf', args: ['--version'] }] });
    await new Promise((r) => setTimeout(r, 0)); // let the async op settle
    // The performer saw the bound id 'alpha', never a payload-supplied id.
    expect(calls).toEqual([{ id: 'alpha', bin: 'sf' }]);
    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 7
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(reply).toMatchObject({ ok: true, result: { stdout: 'out', code: 0 } });
  });

  it('a caps throw (PermissionDenied) comes back as ok:false', async () => {
    const caps: BrokerCapabilities = {
      exec: async () => {
        throw new Error('PermissionDenied: alpha lacks "exec" (bin=rm)');
      },
      readFile: async () => '',
      writeFile: async () => {},
      rm: async () => {},
      readdir: async () => [],
      stat: async () => ({ size: 0, mtimeMs: 0, isFile: true, isDirectory: false }),
      exists: async () => false,
      fetch: async () => ({ status: 200, ok: true, headers: {}, body: '' }),
      mcp: async () => null,
      mcpInitWorkspace: async () => ({ created: false }),
      mcpIsWorkspaceInitialized: async () => true,
      llm: async () => ({ ok: true, text: '', ms: 0 }),
      streamOpen: async () => 'sub-1',
      streamClose: async () => {}
    };
    const { host, endpoints } = makeHost({ caps });
    const ep = await spawnReady(host, endpoints, 'alpha');
    ep.emit({ type: 'broker', reqId: 9, method: 'exec', args: [{ bin: 'rm' }] });
    await new Promise((r) => setTimeout(r, 0));
    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 9
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/PermissionDenied/);
  });

  it('routes a broker fs.rm request through the protocol layer to caps.rm', async () => {
    const calls: Array<{ id: string; path: string }> = [];
    const caps: BrokerCapabilities = {
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      readFile: async () => '',
      writeFile: async () => {},
      rm: async (id, path) => {
        calls.push({ id, path });
      },
      readdir: async () => [],
      stat: async () => ({ size: 0, mtimeMs: 0, isFile: true, isDirectory: false }),
      exists: async () => false,
      fetch: async () => ({ status: 200, ok: true, headers: {}, body: '' }),
      mcp: async () => null,
      mcpInitWorkspace: async () => ({ created: false }),
      mcpIsWorkspaceInitialized: async () => true,
      llm: async () => ({ ok: true, text: '', ms: 0 }),
      streamOpen: async () => 'sub-1',
      streamClose: async () => {}
    };
    const { host, endpoints } = makeHost({ caps });
    const ep = await spawnReady(host, endpoints, 'beta');
    // Child posts a broker fs.rm request; host dispatches to caps.rm with authenticated id.
    ep.emit({ type: 'broker', reqId: 10, method: 'fs.rm', args: ['/test/file.txt'] });
    await new Promise((r) => setTimeout(r, 0));
    // The caps.rm saw the authenticated id 'beta' and the path.
    expect(calls).toEqual([{ id: 'beta', path: '/test/file.txt' }]);
    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 10
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(reply.ok).toBe(true);
  });

  it('routes emit (W1-3) over the protocol layer to caps.emit', async () => {
    const calls: Array<{ id: string; topic: string; payload: unknown }> = [];
    const caps: Partial<BrokerCapabilities> = {
      exec: async () => ({ stdout: '', stderr: '', code: 0, signal: null }),
      emit: (id, topic, payload) => {
        calls.push({ id, topic, payload });
      }
    };
    const { host, endpoints } = makeHost({ caps: caps as BrokerCapabilities });
    const ep = await spawnReady(host, endpoints, 'gamma');
    // Child posts a broker emit request; host dispatches to caps.emit with authenticated id.
    ep.emit({ type: 'broker', reqId: 11, method: 'emit', args: ['myTopic', { data: 'test' }] });
    await new Promise((r) => setTimeout(r, 0));
    // The caps.emit saw the authenticated id 'gamma', the topic, and the payload.
    expect(calls).toEqual([{ id: 'gamma', topic: 'myTopic', payload: { data: 'test' } }]);
    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 11
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(reply.ok).toBe(true);
  });

  it('emit degrades gracefully when no caps.emit (test mock)', async () => {
    const caps: Partial<BrokerCapabilities> = {
      exec: async () => ({ stdout: '', stderr: '', code: 0, signal: null })
      // No emit capability
    };
    const { host, endpoints } = makeHost({ caps: caps as BrokerCapabilities });
    const ep = await spawnReady(host, endpoints, 'delta');
    ep.emit({ type: 'broker', reqId: 12, method: 'emit', args: ['topic', { data: 'x' }] });
    await new Promise((r) => setTimeout(r, 0));
    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 12
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    // Degrades to ok:true with undefined result (no-op)
    expect(reply.ok).toBe(true);
  });

  it('a broker cap request with no caps performer is denied', async () => {
    const { host, endpoints } = makeHost(); // no caps
    const ep = await spawnReady(host, endpoints, 'alpha');
    ep.emit({ type: 'broker', reqId: 3, method: 'fs.readFile', args: ['/x'] });
    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 3
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/PermissionDenied|unavailable/);
  });

  // W1-4 trust inversion: the host must dispatch every `host.*` command with the
  // AUTHENTICATED id (state.moduleId, the id bound to the child's port), NEVER a
  // value carried in the broker payload. A child forging a sibling's id in `args`
  // must not cause the host to act as that sibling — the id is not read from args.
  it('host.* commands are dispatched with the AUTHENTICATED id, never a payload-forged one', async () => {
    const toasts: Array<{ id: string; message: string }> = [];
    const navs: Array<{ id: string; target: string }> = [];
    const selects: Array<{ id: string; projectId: string | null }> = [];
    const launches: Array<{ id: string; spec: HostLaunchSpec }> = [];
    const caps: Partial<BrokerCapabilities> = {
      exec: async () => ({ stdout: '', stderr: '', code: 0, signal: null }),
      hostToast: (id, message) => {
        toasts.push({ id, message });
      },
      hostNavigate: (id, target) => {
        navs.push({ id, target });
      },
      hostSelectProject: (id, projectId) => {
        selects.push({ id, projectId });
      },
      hostRequestLaunch: async (id, spec) => {
        launches.push({ id, spec });
        return { parked: true, requestId: 'req-1' };
      }
    };
    const { host, endpoints } = makeHost({ caps: caps as BrokerCapabilities });
    const ep = await spawnReady(host, endpoints, 'alpha');

    // Every payload carries a FORGED sibling id — the host must ignore it. The
    // command args are positional (message / target / projectId / spec); none of
    // the four commands reads an id from args, so 'evil-sibling' can never leak in.
    ep.emit({ type: 'broker', reqId: 20, method: 'host.toast', args: ['hi', 'info'] });
    ep.emit({ type: 'broker', reqId: 21, method: 'host.navigate', args: ['inbox'] });
    ep.emit({ type: 'broker', reqId: 22, method: 'host.selectProject', args: ['proj-42'] });
    ep.emit({
      type: 'broker',
      reqId: 23,
      method: 'host.requestLaunch',
      // A spec that (uselessly) tries to smuggle a sibling id — the host stamps
      // the launch with `id` (state.moduleId), so this field is inert.
      args: [{ projectId: 'proj-42', moduleId: 'evil-sibling' } as unknown as HostLaunchSpec]
    });
    await new Promise((r) => setTimeout(r, 0));

    // All four performers saw 'alpha' — the bound id — not 'evil-sibling'.
    expect(toasts).toEqual([{ id: 'alpha', message: 'hi' }]);
    expect(navs).toEqual([{ id: 'alpha', target: 'inbox' }]);
    expect(selects).toEqual([{ id: 'alpha', projectId: 'proj-42' }]);
    expect(launches).toHaveLength(1);
    expect(launches[0].id).toBe('alpha');
    expect(launches[0].spec.projectId).toBe('proj-42');

    // toast/navigate/selectProject reply ok immediately (fire-and-forget);
    // requestLaunch resolves the host's {parked, requestId} verdict.
    for (const reqId of [20, 21, 22]) {
      const reply = ep.sent.find(
        (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === reqId
      ) as Extract<HostToChild, { type: 'broker-result' }>;
      expect(reply).toMatchObject({ ok: true });
    }
    const launchReply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 23
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(launchReply).toMatchObject({ ok: true, result: { parked: true, requestId: 'req-1' } });
  });

  it('host.requestLaunch is denied when the shell launch bridge is absent', async () => {
    const caps: Partial<BrokerCapabilities> = {
      exec: async () => ({ stdout: '', stderr: '', code: 0, signal: null })
      // No hostRequestLaunch performer.
    };
    const { host, endpoints } = makeHost({ caps: caps as BrokerCapabilities });
    const ep = await spawnReady(host, endpoints, 'alpha');
    ep.emit({
      type: 'broker',
      reqId: 24,
      method: 'host.requestLaunch',
      args: [{ projectId: 'proj-42' } as HostLaunchSpec]
    });
    await new Promise((r) => setTimeout(r, 0));
    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 24
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/bridge unavailable/);
  });

  // W1-5 main-reachable host UX. confirm/alert are ROUND-TRIP (unlike the
  // fire-and-forget toast/navigate): the performer resolves the human's answer,
  // and the host relays it back as the broker-result — with the AUTHENTICATED id.
  it('host.confirm / host.alert round-trip the answer with the authenticated id', async () => {
    const confirms: Array<{ id: string; spec: unknown }> = [];
    const alerts: Array<{ id: string; spec: unknown }> = [];
    const caps: Partial<BrokerCapabilities> = {
      exec: async () => ({ stdout: '', stderr: '', code: 0, signal: null }),
      hostConfirm: async (id, spec) => {
        confirms.push({ id, spec });
        return true;
      },
      hostAlert: async (id, spec) => {
        alerts.push({ id, spec });
        return 'act-1';
      }
    };
    const { host, endpoints } = makeHost({ caps: caps as BrokerCapabilities });
    const ep = await spawnReady(host, endpoints, 'alpha');

    ep.emit({ type: 'broker', reqId: 30, method: 'host.confirm', args: [{ title: 'Sure?' }] });
    ep.emit({ type: 'broker', reqId: 31, method: 'host.alert', args: [{ title: 'Done', actions: [{ id: 'act-1', label: 'View' }] }] });
    await new Promise((r) => setTimeout(r, 0));

    // Performers saw the bound id 'alpha'.
    expect(confirms).toEqual([{ id: 'alpha', spec: { title: 'Sure?' } }]);
    expect(alerts[0].id).toBe('alpha');

    const confirmReply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 30
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(confirmReply).toMatchObject({ ok: true, result: true });
    const alertReply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 31
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(alertReply).toMatchObject({ ok: true, result: 'act-1' });
  });

  it('host.confirm / host.alert fail CLOSED (false / null) when the bridge is absent', async () => {
    const caps: Partial<BrokerCapabilities> = {
      exec: async () => ({ stdout: '', stderr: '', code: 0, signal: null })
      // No hostConfirm / hostAlert performer.
    };
    const { host, endpoints } = makeHost({ caps: caps as BrokerCapabilities });
    const ep = await spawnReady(host, endpoints, 'alpha');
    ep.emit({ type: 'broker', reqId: 32, method: 'host.confirm', args: [{ title: 'x' }] });
    ep.emit({ type: 'broker', reqId: 33, method: 'host.alert', args: [{ title: 'x' }] });
    await new Promise((r) => setTimeout(r, 0));
    const confirmReply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 32
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    // Degraded to the fail-closed value — resolved OK (not a rejection), so the
    // child's `await host.confirm(...)` sees `false`, never a hang or throw.
    expect(confirmReply).toMatchObject({ ok: true, result: false });
    const alertReply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 33
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(alertReply).toMatchObject({ ok: true, result: null });
  });

  // Phase B: `ctx.inbox.push`. Like the other brokered caps, the performer is
  // invoked with the AUTHENTICATED id (state.moduleId), never a payload value.
  it('routes a broker inbox.push request to caps.inboxPush with the AUTHENTICATED id', async () => {
    const pushes: Array<{ id: string; input: unknown }> = [];
    const caps: Partial<BrokerCapabilities> = {
      exec: async () => ({ stdout: '', stderr: '', code: 0, signal: null }),
      inboxPush: async (id, input) => {
        pushes.push({ id, input });
        return { id: 'entry-9' };
      }
    };
    const { host, endpoints } = makeHost({ caps: caps as BrokerCapabilities });
    const ep = await spawnReady(host, endpoints, 'alpha');

    // The args carry a FORGED sibling id in the payload — the performer must
    // still be invoked with the bound 'alpha', never 'evil-sibling'.
    ep.emit({
      type: 'broker',
      reqId: 40,
      method: 'inbox.push',
      args: [{ projectId: 'proj-1', comments: 'hi', moduleId: 'evil-sibling' }]
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(pushes).toHaveLength(1);
    expect(pushes[0].id).toBe('alpha');
    expect(pushes[0].input).toMatchObject({ projectId: 'proj-1', comments: 'hi' });

    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 40
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(reply).toMatchObject({ ok: true, result: { id: 'entry-9' } });
  });

  it('inbox.push is denied when the inbox bridge is absent', async () => {
    const caps: Partial<BrokerCapabilities> = {
      exec: async () => ({ stdout: '', stderr: '', code: 0, signal: null })
      // No inboxPush performer.
    };
    const { host, endpoints } = makeHost({ caps: caps as BrokerCapabilities });
    const ep = await spawnReady(host, endpoints, 'alpha');
    ep.emit({ type: 'broker', reqId: 41, method: 'inbox.push', args: [{ projectId: 'proj-1' }] });
    await new Promise((r) => setTimeout(r, 0));
    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 41
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/bridge unavailable/);
  });

  it('a caps.inboxPush throw (unknown projectId) comes back as ok:false', async () => {
    const caps: Partial<BrokerCapabilities> = {
      exec: async () => ({ stdout: '', stderr: '', code: 0, signal: null }),
      inboxPush: async () => {
        throw new Error('inbox push rejected: unknown projectId proj-ghost');
      }
    };
    const { host, endpoints } = makeHost({ caps: caps as BrokerCapabilities });
    const ep = await spawnReady(host, endpoints, 'alpha');
    ep.emit({ type: 'broker', reqId: 42, method: 'inbox.push', args: [{ projectId: 'proj-ghost' }] });
    await new Promise((r) => setTimeout(r, 0));
    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 42
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/unknown projectId/);
  });
});

describe('ExtensionProcessHost — persona/team registry broker routing', () => {
  /** A spying registry mock implementing the injected slice. */
  function makeRegistry() {
    const calls: Array<{ method: string; id: string; arg: unknown }> = [];
    const cleared: string[] = [];
    const registry: PersonaTeamRegistryLike = {
      setPersonas: (id, raw) => {
        calls.push({ method: 'setPersonas', id, arg: raw });
        return raw.map((p, i) => ({ id: `ext:${id}:p${i}`, name: p.name }));
      },
      setTeams: (id, raw) => {
        calls.push({ method: 'setTeams', id, arg: raw });
        return raw.map((t) => ({ id: `ext:${id}:${t.name}`, name: t.name, slots: [] }));
      },
      clearModule: (id) => cleared.push(id)
    };
    return { registry, calls, cleared };
  }

  it('routes personas.register to setPersonas with the AUTHENTICATED id — child cannot override it', async () => {
    const { registry, calls } = makeRegistry();
    const { host, endpoints } = makeHost({ registry });
    const ep = await spawnReady(host, endpoints, 'alpha');
    // The child sends only the persona INPUT; the host supplies state.moduleId.
    ep.emit({
      type: 'broker',
      reqId: 5,
      method: 'personas.register',
      args: [[{ id: 'rev', name: 'Reviewer' }]]
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([
      { method: 'setPersonas', id: 'alpha', arg: [{ id: 'rev', name: 'Reviewer' }] }
    ]);
    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 5
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(reply.ok).toBe(true);
    expect(reply.result).toEqual([{ id: 'ext:alpha:p0', name: 'Reviewer' }]);
  });

  it('routes teams.register to setTeams with the authenticated id', async () => {
    const { registry, calls } = makeRegistry();
    const { host, endpoints } = makeHost({ registry });
    const ep = await spawnReady(host, endpoints, 'alpha');
    ep.emit({
      type: 'broker',
      reqId: 6,
      method: 'teams.register',
      args: [[{ name: 'Squad', slots: [] }]]
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls[0]).toMatchObject({ method: 'setTeams', id: 'alpha' });
  });

  it('personas.clear routes to clearModule with the authenticated id', async () => {
    const { registry, cleared } = makeRegistry();
    const { host, endpoints } = makeHost({ registry });
    const ep = await spawnReady(host, endpoints, 'alpha');
    ep.emit({ type: 'broker', reqId: 8, method: 'personas.clear', args: [] });
    await new Promise((r) => setTimeout(r, 0));
    expect(cleared).toContain('alpha');
  });

  it('a personas.register with no registry injected is denied (deny-by-default)', async () => {
    const { host, endpoints } = makeHost(); // no registry
    const ep = await spawnReady(host, endpoints, 'alpha');
    ep.emit({ type: 'broker', reqId: 2, method: 'personas.register', args: [[]] });
    const reply = ep.sent.find(
      (m) => m.type === 'broker-result' && (m as { reqId: number }).reqId === 2
    ) as Extract<HostToChild, { type: 'broker-result' }>;
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(/unavailable/);
  });

  it('teardown clears the module registrations', async () => {
    const { registry, cleared } = makeRegistry();
    const { host, endpoints } = makeHost({ registry });
    await spawnReady(host, endpoints, 'alpha');
    await host.teardown('alpha');
    expect(cleared).toContain('alpha');
  });

  it('a crash (onChildExit) clears the module registrations — no zombie personas', async () => {
    const { registry, cleared } = makeRegistry();
    const { host, endpoints } = makeHost({ registry });
    const ep = await spawnReady(host, endpoints, 'alpha');
    ep.crash(139); // segfault-style unsolicited exit
    expect(cleared).toContain('alpha');
  });
});
