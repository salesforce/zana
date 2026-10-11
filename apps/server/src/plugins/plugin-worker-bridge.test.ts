import { MessageChannel } from 'node:worker_threads';
import { PLUGIN_INTERACTION_MAX_TIMEOUT_MS } from '@zana-ai/zcc-domain/thread-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginWorkerBridge } from './plugin-worker-bridge';
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
