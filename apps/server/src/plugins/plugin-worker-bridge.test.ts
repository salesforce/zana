import { MessageChannel } from 'node:worker_threads';
import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';
import { PLUGIN_INTERACTION_MAX_TIMEOUT_MS } from '@zana-ai/zcc-domain/thread-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginWorkerBridge } from './plugin-worker-bridge';
const closes: (() => void)[] = [];
afterEach(() => { closes.splice(0).forEach(close => close()); });
function pair() { const ports = new MessageChannel(); const a = createPluginWorkerBridge(ports.port1, 'server'), b = createPluginWorkerBridge(ports.port2, 'plugin'); closes.push(() => { a.dispose(); b.dispose(); ports.port1.close(); ports.port2.close(); }); return { a, b, ports }; }
it('roundtrips callbacks, bound methods, types, undefined and exceptions', async () => {
  const { a, b } = pair(); const object = { n: 3, async echo(input: unknown) { return { n: this.n, input }; }, async fail() { throw Object.assign(new Error('no'), { code: 'E_NO' }); } };
  const decoded = b.decode(a.encode(object)); const data = { bytes: new Uint8Array([1, 2]), date: new Date(0), value: 4n, missing: undefined };
  expect(await decoded.echo(data)).toEqual({ n: 3, input: data }); await expect(decoded.fail()).rejects.toMatchObject({ message: 'no', code: 'E_NO' });
  for (let i = 0; i < 4200; i++) a.encode(object); // stable bound methods never exhaust the registry
});
it('forwards live cancellation and rejects pending calls on disposal', async () => {
  const { a, b } = pair(); const controller = new AbortController(); const signal = b.decode(a.encode(controller.signal)); controller.abort();
  await new Promise(resolve => setTimeout(resolve, 10)); expect(signal.aborted).toBe(true);
  const remote = a.decode(b.encode(() => new Promise(() => {}))); const pending = remote(); a.dispose(); await expect(pending).rejects.toThrow('stopped');
  await expect(remote()).rejects.toThrow('stopped');
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

it('observes actual Promise returns and releases their temporary callback slots', async () => {
  const { a, b } = pair();
  const sync = a.decode(b.encode(() => 7));
  expect(await sync.__zccPluginInvokeObserved()).toEqual({ asynchronous: false, value: 7 });
  const lazy = a.decode(b.encode(() => Promise.resolve('lazy')));
  for (let i = 0; i < 4200; i++) {
    const result = await lazy.__zccPluginInvokeObserved();
    expect(result.asynchronous).toBe(true);
    expect(await result.value()).toBe('lazy');
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

describe('host-owned invocation correlation', () => {
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('restores concurrent host scopes after worker awaits without trusting request fields', async () => {
    const { a, b } = pair();
    const scopes = new AsyncLocalStorage<string>();
    const read = b.decode(a.encode(async (_forged: unknown) => scopes.getStore()));
    const finish: Array<() => void> = [];
    const execute = a.decode(b.encode(async () => {
      await new Promise<void>(resolve => finish.push(resolve));
      return read({ threadId: 'forged', invocationId: 'forged', context: 'forged' });
    }));
    const first = scopes.run('host-one', () => execute());
    const second = scopes.run('host-two', () => execute());
    await flush();
    finish[1]!(); expect(await second).toBe('host-two');
    finish[0]!(); expect(await first).toBe('host-one');
    expect(await read({ threadId: 'host-one' })).toBeUndefined();
  });

  it.each(['success', 'failure', 'abort', 'timeout'] as const)('revokes correlation after %s and refuses forged or absent correlations', async outcome => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { a, b, ports } = pair();
    const scopes = new AsyncLocalStorage<string>();
    const readScope = vi.fn(async () => scopes.getStore());
    const wire = a.encode(readScope, 'sdk.readScope');
    const read = b.decode(wire);
    let correlation: string | undefined;
    ports.port2.on('message', message => { if (message.kind === 'call') correlation = message.context; });
    let late!: () => Promise<unknown>;
    let finish!: () => void;
    const execute = a.decode(b.encode(async () => {
      late = () => read();
      await new Promise<void>((resolve, reject) => { finish = outcome === 'failure' ? () => reject(new Error('failed')) : resolve; });
      return read();
    }));
    const controller = new AbortController();
    const result = scopes.run('host-scope', () => execute({ signal: controller.signal }));
    const rejected = outcome === 'success' ? undefined : expect(result).rejects.toThrow();
    await flush();
    expect(correlation).toMatch(/^[a-f0-9-]{36}$/);
    // A random or missing capability cannot restore an otherwise live scope.
    for (const context of [undefined, 'forged']) {
      ports.port2.postMessage({ kind: 'call', id: 999, fn: wire.id, args: [], context });
      await flush();
      await expect(readScope.mock.results.at(-1)?.value).resolves.toBeUndefined();
    }
    if (outcome === 'abort') controller.abort();
    else if (outcome === 'timeout') vi.advanceTimersByTime(PLUGIN_INTERACTION_MAX_TIMEOUT_MS + 60_001);
    else finish();
    if (rejected) await rejected; else expect(await result).toBe('host-scope');
    expect(await late()).toBeUndefined();
    ports.port2.postMessage({ kind: 'call', id: 1000, fn: wire.id, args: [], context: correlation });
    await flush();
    await expect(readScope.mock.results.at(-1)?.value).resolves.toBeUndefined();
  });

  it('destroys captured resources on disposal and encode/post errors', async () => {
    const destroy = vi.spyOn(AsyncResource.prototype, 'emitDestroy');
    const { a, b } = pair();
    const execute = a.decode(b.encode(async () => new Promise(() => {})));
    const pending = execute();
    const rejected = expect(pending).rejects.toThrow('stopped');
    a.dispose(); await rejected;
    expect(destroy).toHaveBeenCalledTimes(1);
    a.dispose(); expect(destroy).toHaveBeenCalledTimes(1);

    const port: any = { on() {}, off() {}, postMessage() { throw new Error('disconnected'); } };
    const bridge = createPluginWorkerBridge(port, 'server'); closes.push(() => bridge.dispose());
    const remote = bridge.decode({ __zcc_plugin_wire: 'function', side: 'plugin', id: 1, async: true });
    await expect(remote()).rejects.toThrow('disconnected');
    expect(destroy).toHaveBeenCalledTimes(2);
    const cyclic: any = {}; cyclic.self = cyclic;
    await expect(remote(cyclic)).rejects.toThrow('Cyclic');
    expect(destroy).toHaveBeenCalledTimes(3);
    bridge.dispose(); expect(destroy).toHaveBeenCalledTimes(3);
  });

  it('extends only approval API deadlines, leaving ordinary calls at two minutes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { a, b } = pair();
    const hang = async () => new Promise(() => {});
    const ui = b.decode(a.encode({ ui: { requestToolApproval: hang, requestApproval: hang, experimental_requestApproval: hang, other: hang } })).ui;
    const approvalCalls = [ui.requestToolApproval(), ui.requestApproval(), ui.experimental_requestApproval()];
    const failures = approvalCalls.map(call => expect(call).rejects.toThrow('timed out'));
    let settled = false; void Promise.all(approvalCalls).catch(() => { settled = true; });
    const plain = expect(ui.other()).rejects.toThrow('timed out');
    await flush(); vi.advanceTimersByTime(120_001); await plain; await flush();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(180_000); await Promise.all(failures);
    expect(settled).toBe(true);
  });
});
