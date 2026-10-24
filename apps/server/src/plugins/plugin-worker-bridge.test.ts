import { MessageChannel, Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PLUGIN_INTERACTION_MAX_TIMEOUT_MS } from '@zana-ai/zcc-domain/thread-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginPeerCommit, createPluginWorkerBridge, PEER_WORKER_COMMIT_TIMEOUT_MS } from './plugin-worker-bridge';
const closes: (() => void)[] = [];
afterEach(() => { closes.splice(0).forEach(close => close()); });
function pair() { const ports = new MessageChannel(); const a = createPluginWorkerBridge(ports.port1, 'server'), b = createPluginWorkerBridge(ports.port2, 'plugin'); closes.push(() => { a.dispose(); b.dispose(); ports.port1.close(); ports.port2.close(); }); return { a, b }; }
it('roundtrips callbacks, bound methods, types, undefined and exceptions', async () => {
  const { a, b } = pair(); const object = { n: 3, async echo(input: unknown) { return { n: this.n, input }; }, async fail() { throw Object.assign(new Error('no'), { code: 'E_NO' }); } };
  const decoded = b.decode(a.encode(object)); const data = { bytes: new Uint8Array([1, 2]), date: new Date(0), value: 4n, missing: undefined };
  expect(await decoded.echo(data)).toEqual({ n: 3, input: data }); await expect(decoded.fail()).rejects.toMatchObject({ message: 'no', code: 'E_NO' });
  for (let i = 0; i < 4200; i++) a.encode(object); // stable bound methods never exhaust the registry
});
it('forwards live cancellation and rejects pending calls on disposal', async () => {
  const { a, b } = pair(); const controller = new AbortController(); const signal = b.decode(a.encode(controller.signal)); controller.abort();
  await new Promise(resolve => setTimeout(resolve, 10)); expect(signal.aborted).toBe(true);
  const remote = a.decode(b.encode(() => new Promise(() => {}))); expect(a.isBusy()).toBe(false);
  const pending = remote(); expect(a.isBusy()).toBe(true); a.dispose(); await expect(pending).rejects.toThrow('stopped'); expect(a.isBusy()).toBe(false);
  await expect(remote()).rejects.toThrow('stopped');
});

it('releases receiver slots for requests cancelled before signal encoding', async () => {
  const { a, b } = pair();
  for (let i = 0; i < 4201; i++) {
    const cancelled = AbortSignal.abort(new Error('cancelled before dispatch'));
    expect(b.decode(a.encode(cancelled)).aborted).toBe(true);
  }
  const controller = new AbortController();
  const live = b.decode(a.encode(controller.signal));
  expect(live.aborted).toBe(false);
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(live.aborted).toBe(true);
});
it('rejects cyclic, overly deep and oversized collections', () => {
  const { a } = pair(); const cyclic: any = {}; cyclic.self = cyclic; expect(() => a.encode(cyclic)).toThrow('Cyclic');
  let nested: any = {}; for (let i = 0; i < 34; i++) nested = { nested }; expect(() => a.encode(nested)).toThrow('nesting');
  expect(() => a.encode(Array(100001).fill(0))).toThrow('array'); expect(() => a.encode(Object.fromEntries(Array.from({ length: 10001 }, (_, i) => [i, 0])))).toThrow('object');
});

it('supports synchronous worker-side responses and refuses reuse after a deadline', () => {
  const listeners = new Set<Function>(); let response: any = { value: 7 };
  const port: any = { on(_name: string, fn: Function) { listeners.add(fn); }, off(_name: string, fn: Function) { listeners.delete(fn); }, postMessage(message: any) {
    if (message.kind !== 'call') return;
    const bytes = Buffer.from(JSON.stringify(response)); new Uint8Array(message.shared, 8, bytes.length).set(bytes); const header = new Int32Array(message.shared, 0, 2); Atomics.store(header, 1, bytes.length); Atomics.store(header, 0, 1);
  } };
  const bridge = createPluginWorkerBridge(port, 'plugin'); closes.push(() => bridge.dispose()); const fn = bridge.decode({ __zcc_plugin_wire: 'function', side: 'server', id: 1, async: false });
  expect(fn()).toBe(7); response = { error: { message: 'bad API' } }; expect(() => fn()).toThrow('bad API');
});
it('releases signal slots after cancellation and rejects a raw oversized reply', async () => {
  const { a, b } = pair(); for (let i = 0; i < 1100; i++) { const controller = new AbortController(); a.encode(controller.signal); controller.abort(); }
  const fn = a.decode(b.encode(() => 'x'.repeat(4 * 1024 * 1024 + 1))); await expect(fn()).rejects.toThrow('byte limit');
});
it('bounds unconsumed async service continuations and releases them on teardown', () => {
  const { a } = pair();
  const wire = (id: number) => ({ __zcc_plugin_wire: 'function', side: 'plugin', id, async: true, once: true });
  for (let id = 0; id < 4096; id++) a.decode(wire(id));
  expect(a.isBusy()).toBe(true); expect(() => a.decode(wire(4096))).toThrow('result limit');
  expect(() => a.decode(wire(0))).not.toThrow(); a.dispose(); expect(a.isBusy()).toBe(false);
});

it('observes actual Promise returns and releases their temporary callback slots', async () => {
  const { a, b } = pair();
  const sync = a.decode(b.encode(() => 7));
  expect(await sync.__zccPluginInvokeObserved()).toEqual({ asynchronous: false, value: 7 });
  const lazy = a.decode(b.encode(() => Promise.resolve('lazy')));
  for (let i = 0; i < 4200; i++) {
    const result = await lazy.__zccPluginInvokeObserved();
    expect(result.asynchronous).toBe(true);
    expect(a.isBusy()).toBe(true);
    expect(await result.value()).toBe('lazy');
    expect(a.isBusy()).toBe(false);
  }
  const failing = a.decode(b.encode(() => Promise.reject(Error('rejected'))));
  const result = await failing.__zccPluginInvokeObserved();
  await expect(result.value()).rejects.toThrow('rejected');
});

describe('caller-owned calls', () => {
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  afterEach(() => { vi.useRealTimers(); });

  it('releases per-call signals that never abort once their call settles', async () => {
    const { a, b } = pair();
    const tool = a.decode(b.encode({ async execute(_input: unknown, ctx: { signal: AbortSignal }) { return ctx.signal.aborted; } }));
    for (let i = 0; i < 1100; i++) {
      expect(await tool.execute({}, { threadId: 't', signal: new AbortController().signal })).toBe(false);
    }
  });

  it('keeps a shared signal live until the last call carrying it settles', async () => {
    const { a, b } = pair();
    const seen: AbortSignal[] = []; const finish: Array<() => void> = [];
    const remote = a.decode(b.encode((options: { signal: AbortSignal }) => new Promise<void>(resolve => { seen.push(options.signal); finish.push(resolve); })));
    const controller = new AbortController();
    const first = remote({ signal: controller.signal }); const second = remote({ signal: controller.signal });
    await flush();
    expect(seen[0]).toBe(seen[1]);
    finish[0]!(); await first;
    controller.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    expect(seen[1]!.aborted).toBe(true);
    // Re-encoding the signal after its slot was released registers it afresh.
    const later = new AbortController();
    const third = remote({ signal: later.signal }); await flush(); finish[1]!(); finish.splice(0, 2);
    later.abort(); await expect(third).rejects.toMatchObject({ name: 'AbortError' }); await flush();
    expect(seen[2]!.aborted).toBe(true);
  });

  it('bounds signal-owned calls by the interaction ceiling rather than the plain RPC deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { a, b } = pair();
    const hang = a.decode(b.encode(() => new Promise(() => {})));
    const plain = hang(); const owned = hang({}, { signal: new AbortController().signal });
    const plainResult = expect(plain).rejects.toThrow('timed out');
    let ownedSettled = false; void owned.catch(() => { ownedSettled = true; });
    await flush();
    vi.advanceTimersByTime(120_001);
    await plainResult; await flush();
    expect(ownedSettled).toBe(false);
    vi.advanceTimersByTime(PLUGIN_INTERACTION_MAX_TIMEOUT_MS + 60_000);
    await expect(owned).rejects.toThrow('timed out');
  });

  it('rejects a signal-owned call as soon as its caller aborts, with the abort reason when one is given', async () => {
    const { a, b } = pair();
    let remoteSignal: AbortSignal | undefined;
    const hang = a.decode(b.encode((options: { signal: AbortSignal }) => { remoteSignal = options.signal; return new Promise(() => {}); }));
    const controller = new AbortController();
    const call = hang({ signal: controller.signal }); await flush();
    controller.abort(new Error('round-trip closed'));
    await expect(call).rejects.toThrow('round-trip closed'); await flush();
    expect(remoteSignal?.aborted).toBe(true);
    // An already-aborted signal does not own the call; the remote sees it aborted.
    const settled = a.decode(b.encode((options: { signal: AbortSignal }) => options.signal.aborted));
    expect(await settled({ signal: AbortSignal.abort() })).toBe(true);
  });

  it('releases signals and the abort listener when encoding the call fails', async () => {
    const { a, b } = pair();
    const remote = a.decode(b.encode(() => 'ok'));
    const controller = new AbortController(); const cyclic: any = { signal: controller.signal }; cyclic.self = cyclic;
    await expect(remote(cyclic)).rejects.toThrow('Cyclic');
    for (let i = 0; i < 1100; i++) {
      const once: any = { signal: new AbortController().signal }; once.self = once;
      await expect(remote(once)).rejects.toThrow('Cyclic');
    }
    expect(await remote({ signal: controller.signal })).toBe('ok');
  });
});

function gate() {
  const result = new SharedArrayBuffer(16);
  Atomics.store(new BigInt64Array(result, 8), 0, BigInt(Date.now() + 1000));
  return result;
}
function fencedPair() {
  let server!: (message: any) => void, plugin!: (message: any) => void;
  // Test-only direct synchronous delivery emulates the worker's blocked host preflight.
  const aPort: any = { on(_name: string, fn: any) { server = fn; }, off() {}, postMessage(message: any) { setImmediate(() => plugin(message)); } };
  const bPort: any = { on(_name: string, fn: any) { plugin = fn; }, off() {}, postMessage(message: any) {
    if (message.shared) server(message); else setImmediate(() => server(message));
  } };
  const execute = vi.fn(callback => callback());
  const a = createPluginWorkerBridge(aPort, 'server', { terminate: async () => {} });
  const b = createPluginWorkerBridge(bPort, 'plugin', { commitSync: execute });
  closes.push(() => { a.dispose(); b.dispose(); });
  return { a, b, execute };
}
function preflight(word: SharedArrayBuffer) {
  return () => { if (Atomics.compareExchange(new Int32Array(word), 0, 0, 1) !== 0) throw Error('inactive'); };
}
it('uses host identity, not forged observation properties, for worker fences', async () => {
  const { a, b, execute } = fencedPair();
  const sync = vi.fn(async callback => callback());
  const worker = vi.fn(async observe => { const word = gate(); return (await observe(word, preflight(word))).value; });
  const commit = createPluginPeerCommit({ commitSync: sync, commitWorkerSync: worker } as never, new AbortController().signal);
  const wire = a.encode({ commitSync: commit });
  expect(wire.commitSync.async).toBe(true); // Worker must not block while waiting for its own callback.
  const remote = a.decode(b.encode(() => 'applied'));
  expect(await commit(remote)).toBe('applied');
  expect(worker).toHaveBeenCalledOnce(); expect(execute).toHaveBeenCalledOnce(); expect(sync).not.toHaveBeenCalled();
  const forged = Object.assign(() => 'local', { __zccPluginInvokeObserved: () => ({ asynchronous: false, value: 'fake' }) });
  expect(await commit(forged)).toBe('local'); expect(sync).toHaveBeenCalledOnce();
});

it.each(['cancelled', 'expired', 'async'] as const)('rejects %s worker callback before invoking', async mode => {
  const { a, b } = fencedPair();
  const called = vi.fn();
  const callback = mode === 'async' ? async () => called() : () => called();
  const remote = a.decode(b.encode(callback));
  const commit = createPluginPeerCommit({ commitWorkerSync: async observe => {
    const word = gate();
    if (mode === 'cancelled') Atomics.store(new Int32Array(word), 0, 2);
    if (mode === 'expired') Atomics.store(new BigInt64Array(word, 8), 0, 0n);
    return (await observe(word, preflight(word))).value;
  } } as never, new AbortController().signal);
  await expect(commit(remote)).rejects.toThrow(mode === 'async' ? 'synchronous' : 'active');
  expect(called).not.toHaveBeenCalled();
});

it.each(['promise', 'thenable', 'callable thenable'])('rolls back a plain callback returning %s before stopping its async continuation', async kind => {
  const state = new SharedArrayBuffer(16);
  const worker = new Worker(`
    const { workerData } = require('node:worker_threads');
    require(workerData.tsx);
    const { createPluginWorkerBridge } = require(workerData.bridge);
    const state = new Int32Array(workerData.state);
    let listener;
    const port = {
      on(_name, fn) { listener = fn; }, off() {},
      postMessage(message) {
        if (message.shared) {
          Atomics.store(new Int32Array(message.gate || word), 0, 1);
          const bytes = Buffer.from(JSON.stringify({ value: undefined }));
          new Uint8Array(message.shared, 8, bytes.length).set(bytes);
          const header = new Int32Array(message.shared);
          Atomics.store(header, 1, bytes.length); Atomics.store(header, 0, 1);
        }
      }
    };
    const bridge = createPluginWorkerBridge(port, 'plugin', { commitSync(callback) {
      Atomics.store(state, 0, 1);
      try { const value = callback(); Atomics.store(state, 1, 1); return value; }
      catch (error) { Atomics.store(state, 0, 0); Atomics.store(state, 2, 1); throw error; }
    } });
    const callback = function () {
      Promise.resolve().then(() => Atomics.store(state, 3, 1));
      if (workerData.kind === 'promise') return Promise.resolve(42);
      if (workerData.kind === 'thenable') return { then(resolve) { resolve(42); } };
      return Object.assign(function () {}, { then(resolve) { resolve(42); } });
    };
    if (callback.constructor.name !== 'Function') throw Error('wrong callback kind');
    const wire = bridge.encode(callback);
    const word = new SharedArrayBuffer(16);
    Atomics.store(new BigInt64Array(word, 8), 0, BigInt(Date.now() + 1000));
    listener({ kind: 'call', id: 1, fn: wire.id, args: [], gate: word,
      preflight: { __zcc_plugin_wire: 'function', side: 'server', id: 2, async: false } });
    setTimeout(() => process.exit(0), 50);
  `, { eval: true, workerData: {
    tsx: createRequire(import.meta.url).resolve('tsx/cjs'),
    bridge: fileURLToPath(new URL('./plugin-worker-bridge.ts', import.meta.url)), state, kind
  } });
  closes.push(() => { void worker.terminate(); });
  const exit = await new Promise<number>((resolve, reject) => { worker.once('exit', resolve); worker.once('error', reject); });
  expect(Array.from(new Int32Array(state))).toEqual([0, 0, 1, 0]);
  expect(exit).toBe(1);
});

it('rejects thenable results inside an injected transaction', async () => {
  const { a, b, execute } = fencedPair();
  let rolledBack = false;
  execute.mockImplementation(callback => {
    try { return callback(); }
    catch (error) { rolledBack = true; throw error; }
  });
  const remote = a.decode(b.encode(() => ({ then() {} })));
  const commit = createPluginPeerCommit({ commitWorkerSync: async observe => {
    const word = gate(); return (await observe(word, preflight(word))).value;
  } } as never, new AbortController().signal);
  await expect(commit(remote)).rejects.toThrow('synchronous callback');
  expect(rolledBack).toBe(true);
  expect(a.activeCommits).toBe(0);
});

it('waits for worker termination before releasing a timed-out running fence', async () => {
  let listener!: (message: any) => void, finish!: () => void;
  const terminated = new Promise<void>(resolve => { finish = resolve; });
  const terminate = vi.fn(() => terminated);
  const port: any = { on(_name: string, fn: any) { listener = fn; }, off() {}, postMessage(message: any) {
    if (message.gate) Atomics.compareExchange(new Int32Array(message.gate), 0, 0, 1);
  } };
  const a = createPluginWorkerBridge(port, 'server', { terminate }); closes.push(() => a.dispose());
  const remote = a.decode({ __zcc_plugin_wire: 'function', side: 'plugin', id: 1 });
  const commit = createPluginPeerCommit({ commitWorkerSync: async observe => (await observe(gate())).value } as never, new AbortController().signal);
  let settled = false;
  const operation = commit(remote).finally(() => { settled = true; });
  const rejected = expect(operation).rejects.toThrow('timed out');
  await new Promise(resolve => setTimeout(resolve, PEER_WORKER_COMMIT_TIMEOUT_MS + 100));
  expect(terminate).toHaveBeenCalledOnce(); expect(settled).toBe(false);
  finish(); await rejected;
  // Late result cannot resurrect timed-out operation.
  listener({ kind: 'reply', id: 1, value: 1 });
});

it('cancels queued fenced calls on disposal without terminating worker', async () => {
  const terminate = vi.fn(async () => {});
  const port: any = { on() {}, off() {}, postMessage() {} };
  const a = createPluginWorkerBridge(port, 'server', { terminate });
  const remote = a.decode({ __zcc_plugin_wire: 'function', side: 'plugin', id: 1 });
  const word = gate();
  const commit = createPluginPeerCommit({ commitWorkerSync: async observe => (await observe(word, preflight(word))).value } as never, new AbortController().signal);
  const pending = commit(remote); a.dispose();
  await expect(pending).rejects.toThrow('stopped');
  expect(Atomics.load(new Int32Array(word), 0)).toBe(2); expect(terminate).not.toHaveBeenCalled();
});

it.each(['reject', 'throw'])('faults fail-closed and settles running commits when termination fails by %s', async mode => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  closes.push(() => logged.mockRestore());
  const terminate = vi.fn(() => { if (mode === 'throw') throw Error('cannot prove stopped'); return Promise.reject(Error('cannot prove stopped')); });
  let commitCall: any;
  const port: any = { on() {}, off() {}, postMessage(message: any) {
    if (message.gate) { commitCall = message; Atomics.compareExchange(new Int32Array(message.gate), 0, 0, 1); }
  } };
  const a = createPluginWorkerBridge(port, 'server', { terminate });
  closes.push(() => a.dispose());
  a.encode({ pluginId: 'fixture-plugin' });
  const remote = a.decode({ __zcc_plugin_wire: 'function', side: 'plugin', id: 1 });
  const commit = createPluginPeerCommit({ commitWorkerSync: async observe => (await observe(gate(), () => {})).value } as never, new AbortController().signal);
  const unrelated = remote().catch((error: Error) => error);
  let failure: any;
  void commit(remote).catch(error => { failure = error; });
  expect(a.activeCommits).toBe(1);
  a.dispose(); await new Promise(resolve => setImmediate(resolve));
  expect(failure).toMatchObject({ code: 'PLUGIN_TERMINATION_FAILED', message: expect.stringContaining('cannot prove stopped') });
  expect(a.activeCommits).toBe(0);
  expect(a.fault).toBe(failure);
  await expect(unrelated).resolves.toMatchObject({ message: 'Plugin runtime stopped' });
  expect(Atomics.load(new Int32Array(commitCall.gate), 0)).toBe(2);
  expect(logged).toHaveBeenCalledWith('[plugin-worker-bridge] Worker termination failed', {
    pluginId: 'fixture-plugin', callId: commitCall.id, functionId: 1, cause: expect.any(Error)
  });
  await expect(remote()).rejects.toBe(failure);
  expect(terminate).toHaveBeenCalledOnce();
});

it.each(['success', 'error', 'cancel'])('releases request method and one-shot callback slots after %s', async outcome => {
  const { a, b } = fencedPair();
  const lease = { commitWorkerSync: async observe => {
    const word = gate();
    return (await observe(word, preflight(word))).value;
  } } as never;
  const lifetime = new AbortController(), signal = new AbortController();
  const request = b.decode(a.encode({ commitSync: createPluginPeerCommit(lease, signal.signal, lifetime.signal) }));
  expect(a.retainedFunctions).toBe(1);
  const before = b.retainedFunctions;
  if (outcome === 'cancel') signal.abort(new Error('cancelled'));
  const operation = request.commitSync(() => { if (outcome === 'error') throw Error('failed'); return 42; });
  if (outcome === 'success') { expect(await operation).toBe(42); expect(await request.commitSync(() => 43)).toBe(43); }
  else await expect(operation).rejects.toThrow(outcome === 'error' ? 'failed' : 'cancelled');
  await new Promise(resolve => setImmediate(resolve));
  expect(b.retainedFunctions).toBe(before);
  lifetime.abort(); expect(a.retainedFunctions).toBe(0);
});

it('preserves the worker commit error when lease failure aborts its caller before the handler replies', async () => {
  const { a, b } = fencedPair();
  const controller = new AbortController();
  const error = Object.assign(new Error('commit rejected'), { name: 'CommitError', code: 'E_COMMIT' });
  const commitSync = createPluginPeerCommit({ commitWorkerSync: async observe => {
    const word = gate();
    try { return (await observe(word, preflight(word))).value; }
    catch (cause) { controller.abort(); throw cause; }
  } } as never, controller.signal);
  const handler = a.decode(b.encode(async (request: any) => request.commitSync(() => { throw error; })));
  await expect(handler({ signal: controller.signal, commitSync })).rejects.toMatchObject({
    message: error.message, name: error.name, code: error.code
  });
  expect(controller.signal.aborted).toBe(true);
  expect(a.activeCommits).toBe(0);
});

it('clears a handled worker commit failure before later caller cancellation', async () => {
  const { a, b } = fencedPair();
  const controller = new AbortController();
  const commitSync = createPluginPeerCommit({ commitWorkerSync: async observe => {
    const word = gate();
    try { return (await observe(word, preflight(word))).value; }
    catch { return 'handled'; }
  } } as never, controller.signal);
  const handler = a.decode(b.encode(async (request: any) => request.commitSync(() => { throw Error('old commit error'); })));
  expect(await handler({ signal: controller.signal, commitSync })).toBe('handled');
  const hang = a.decode(b.encode(() => new Promise(() => {})));
  const later = hang({ signal: controller.signal });
  controller.abort();
  await expect(later).rejects.toMatchObject({ name: 'AbortError', message: 'This operation was aborted' });
  expect(a.activeCommits).toBe(0);
});

describe('caller abort during a running peer commit', () => {
  afterEach(() => { vi.useRealTimers(); });

  it.each(['reply', 'timeout', 'dispose', 'termination failure'] as const)('preserves the lease and watchdog fence after caller abort with %s', async outcome => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    closes.push(() => logged.mockRestore());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let listener!: (message: any) => void, commitCall: any;
    let finish!: () => void, fail!: (error: Error) => void;
    const terminated = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const terminate = vi.fn(() => terminated);
    let commit!: ReturnType<typeof createPluginPeerCommit>, remote: any, operation!: Promise<unknown>;
    let released = false;
    const port: any = { on(_name: string, fn: any) { listener = fn; }, off() {}, postMessage(message: any) {
      if (message.gate) {
        commitCall = message;
        // Emulate trusted preflight admission, with worker still running and no reply.
        a.decode(message.preflight)();
      } else if (message.kind === 'call' && message.fn === 1) {
        operation = commit(remote);
        void operation.then(value => listener({ kind: 'reply', id: message.id, value }), error =>
          listener({ kind: 'reply', id: message.id, error: { message: error.message } }));
      }
    } };
    const a = createPluginWorkerBridge(port, 'server', { terminate }); closes.push(() => a.dispose());
    remote = a.decode({ __zcc_plugin_wire: 'function', side: 'plugin', id: 2 });
    const controller = new AbortController(), word = gate();
    commit = createPluginPeerCommit({ commitWorkerSync: async observe => {
      try { return (await observe(word, preflight(word))).value; }
      finally { released = true; }
    } } as never, controller.signal);
    const request = a.decode({ __zcc_plugin_wire: 'function', side: 'plugin', id: 1 });
    const call = request({ signal: controller.signal });
    expect(Atomics.load(new Int32Array(word), 0)).toBe(1);
    expect(a.activeCommits).toBe(1);
    controller.abort(new Error('caller cancelled'));
    await expect(call).rejects.toThrow('caller cancelled');
    expect(released).toBe(false); expect(a.activeCommits).toBe(1);
    expect(terminate).not.toHaveBeenCalled();

    if (outcome === 'reply') {
      listener({ kind: 'reply', id: commitCall.id, value: { asynchronous: false, value: 42 } });
      expect(await operation).toBe(42);
      expect(released).toBe(true); expect(a.activeCommits).toBe(0);
      expect(terminate).not.toHaveBeenCalled();
    } else {
      const rejected = expect(operation).rejects.toThrow(outcome === 'termination failure' ? 'cannot prove stopped' : outcome === 'dispose' ? 'stopped' : 'timed out');
      if (outcome === 'dispose') a.dispose();
      else vi.advanceTimersByTime(PEER_WORKER_COMMIT_TIMEOUT_MS);
      expect(terminate).toHaveBeenCalledOnce();
      expect(released).toBe(false); expect(a.activeCommits).toBe(1);
      expect(a.retainedFunctions).toBe(0); // Preflight retired on cancellation.
      listener({ kind: 'reply', id: commitCall.id, value: { asynchronous: false, value: 99 } });
      await Promise.resolve();
      expect(released).toBe(false); expect(a.activeCommits).toBe(1);
      if (outcome !== 'termination failure') {
        finish(); await rejected;
        expect(released).toBe(true); expect(a.activeCommits).toBe(0);
      } else {
        fail(new Error('cannot prove stopped')); await rejected;
        a.dispose();
        expect(a.fault).toMatchObject({ code: 'PLUGIN_TERMINATION_FAILED' });
        expect(Atomics.load(new Int32Array(word), 0)).toBe(2);
        expect(released).toBe(true); expect(a.activeCommits).toBe(0);
        expect(terminate).toHaveBeenCalledOnce();
      }
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});
