import type { MessagePort, Worker } from 'node:worker_threads';
import { PLUGIN_INTERACTION_MAX_TIMEOUT_MS } from '@zana-ai/zcc-domain/thread-runtime';

type Wire = any;
type Port = Pick<MessagePort | Worker, 'postMessage' | 'on' | 'off'>;
const TAG = '__zcc_plugin_wire';
const MAX_PENDING = 64;
const MAX_FUNCTIONS = 4096;
const SYNC_BYTES = 16 * 1024 * 1024;
const CALL_TIMEOUT_MS = 120_000;
// A call carrying a live AbortSignal belongs to its caller and may wait on a person
// (a tool asking a question), so it is bounded by that signal and the longest
// interaction a plugin may open instead of the plain RPC deadline.
const SIGNALLED_CALL_TIMEOUT_MS = PLUGIN_INTERACTION_MAX_TIMEOUT_MS + 60_000;

/** The first live signal passed directly or as an options/context field. */
function callerSignal(args: readonly unknown[]): AbortSignal | undefined {
  for (const arg of args) {
    if (arg instanceof AbortSignal) return arg.aborted ? undefined : arg;
    if (!arg || typeof arg !== 'object' || Array.isArray(arg)) continue;
    const signal = (arg as { signal?: unknown }).signal;
    if (signal instanceof AbortSignal && !signal.aborted) return signal;
  }
  return undefined;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return Object.assign(new Error('Plugin call aborted'), { name: 'AbortError' });
}

/** Function ids belong to this authenticated runtime only; no method/path comes from a renderer. */
export function createPluginWorkerBridge(port: Port, side: 'server' | 'plugin') {
  let nextId = 0;
  let stopped = false;
  const functions = new Map<number, (...args: any[]) => any>();
  const boundMethods = new WeakMap<object, Map<Function, Function>>();
  const functionIds = new WeakMap<Function, number>();
  const signals = new Map<number, AbortController>();
  const signalIds = new WeakMap<AbortSignal, number>();
  const removeSignalListeners = new Map<number, () => void>();
  // Live signals encoded into in-flight calls. A signal's slot (here and on the
  // remote side) is released once the last call carrying it settles, so per-call
  // signals that never abort do not exhaust the signal limit.
  const signalRefs = new Map<number, number>();
  let collectedSignals: number[] | null = null;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const shared = side === 'plugin' ? new SharedArrayBuffer(SYNC_BYTES) : undefined;

  function encode(value: any, path = '', depth = 0, seen = new Set<object>()): Wire {
    if (typeof value === 'string' && value.length > 4 * 1024 * 1024) throw new Error('Plugin string exceeds the byte limit');
    if (depth > 32) throw new Error('Plugin value exceeds the nesting limit');
    if (typeof value === 'function') {
      let id = functionIds.get(value);
      if (id === undefined) {
        if (functions.size >= MAX_FUNCTIONS) throw new Error('Plugin callback limit exceeded');
        id = ++nextId; functions.set(id, value); functionIds.set(value, id);
      }
      const async = side === 'plugin' || value.__zccPluginOnce === true || value.constructor?.name === 'AsyncFunction' || /^(sdk|host|storage\.kv)(\.|$)/.test(path);
      return { [TAG]: 'function', side, id, async, once: value.__zccPluginOnce === true };
    }
    if (typeof value === 'bigint') return { [TAG]: 'bigint', value: String(value) };
    if (!value || typeof value !== 'object') return value;
    if (value instanceof AbortSignal) {
      let id = signalIds.get(value);
      if (id === undefined) {
        if (signalIds && removeSignalListeners.size >= 1024) throw new Error('Plugin signal limit exceeded');
        id = ++nextId; signalIds.set(value, id);
        const signalId = id;
        const onAbort = () => { removeSignalListeners.delete(signalId); if (!stopped) port.postMessage({ kind: 'abort', id: signalId }, []); };
        value.addEventListener('abort', onAbort, { once: true });
        if (!value.aborted) removeSignalListeners.set(id, () => { value.removeEventListener('abort', onAbort); signalIds.delete(value); });
      }
      if (removeSignalListeners.has(id)) collectedSignals?.push(id);
      return { [TAG]: 'signal', id, aborted: value.aborted };
    }
    if (value instanceof Uint8Array) return { [TAG]: 'bytes', value: Buffer.from(value).toString('base64') };
    if (value instanceof Date) return { [TAG]: 'date', value: value.toISOString() };
    if (seen.has(value)) throw new Error('Cyclic plugin values are unsupported');
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        if (value.length > 100_000) throw new Error('Plugin array exceeds the limit');
        return value.map(item => encode(item, path, depth + 1, seen));
      }
      const out: Record<string, Wire> = Object.create(null);
      const entries = Object.entries(value);
      if (entries.length > 10_000) throw new Error('Plugin object exceeds the limit');
      for (const [key, item] of entries) {
        let bound = item;
        if (typeof item === 'function') {
          let methods = boundMethods.get(value); if (!methods) { methods = new Map(); boundMethods.set(value, methods); }
          bound = methods.get(item); if (!bound) { bound = item.bind(value); if (Reflect.get(item, '__zccPluginOnce')) Object.defineProperty(bound, '__zccPluginOnce', { value: true }); methods.set(item, bound as Function); }
        }
        out[key] = encode(bound, path ? `${path}.${key}` : key, depth + 1, seen);
      }
      return out;
    } finally { seen.delete(value); }
  }

  function decode(value: Wire, depth = 0): any {
    if (depth > 32) throw new Error('Plugin value exceeds the nesting limit');
    if (typeof value === 'string' && value.length > 4 * 1024 * 1024) throw new Error('Plugin string exceeds the byte limit');
    if (!value || typeof value !== 'object') return value;
    if (value[TAG] === 'function') {
      if (value.side === side) return functions.get(value.id);
      const remote = (...args: any[]) => side === 'plugin' && !value.async ? invokeSync(value.id, args) : invoke(value.id, args);
      Object.defineProperty(remote, '__zccPluginInvokeObserved', { value: (...args: any[]) => invoke(value.id, args, true) });
      Object.defineProperty(remote, '__zccPluginOnce', { value: value.once });
      return remote;
    }
    if (value[TAG] === 'signal') {
      let controller = signals.get(value.id);
      if (!controller) { if (signals.size >= 1024) throw new Error('Plugin signal limit exceeded'); controller = new AbortController(); signals.set(value.id, controller); }
      if (value.aborted) controller.abort();
      return controller.signal;
    }
    if (value[TAG] === 'bytes') return new Uint8Array(Buffer.from(value.value, 'base64'));
    if (value[TAG] === 'date') return new Date(value.value);
    if (value[TAG] === 'bigint') return BigInt(value.value);
    if (Array.isArray(value)) { if (value.length > 100_000) throw new Error('Plugin array exceeds the limit'); return value.map(item => decode(item, depth + 1)); }
    const result: Record<string, any> = Object.create(null);
    const entries = Object.entries(value); if (entries.length > 10_000) throw new Error('Plugin object exceeds the limit');
    for (const [key, item] of entries) result[key] = decode(item, depth + 1);
    return result;
  }
  function errorValue(error: any) { return { message: error?.message ?? String(error), code: error?.code, name: error?.name }; }
  function errorFrom(error: any): Error { return Object.assign(new Error(error.message), { code: error.code, name: error.name ?? 'Error' }); }

  function releaseSignals(ids: readonly number[]) {
    for (const id of ids) {
      const refs = (signalRefs.get(id) ?? 1) - 1;
      if (refs > 0) { signalRefs.set(id, refs); continue; }
      signalRefs.delete(id);
      const remove = removeSignalListeners.get(id);
      if (!remove) continue; // aborted: the abort message already freed the remote slot
      removeSignalListeners.delete(id); remove();
      if (!stopped) port.postMessage({ kind: 'release', id }, []);
    }
  }

  function invoke(fn: number, args: any[], observe = false): Promise<any> {
    if (stopped) return Promise.reject(new Error('Plugin runtime stopped'));
    if (pending.size >= MAX_PENDING) return Promise.reject(new Error('Plugin runtime is busy'));
    const id = ++nextId;
    const owner = callerSignal(args);
    return new Promise((resolve, reject) => {
      let carried: number[] = [];
      let settled = false;
      const settle = (finish: () => void) => {
        if (settled) return;
        settled = true; pending.delete(id); clearTimeout(timer); owner?.removeEventListener('abort', onAbort);
        // An observed call replies before the remote work ends, so its signals stay live.
        if (!observe) releaseSignals(carried);
        finish();
      };
      const onAbort = () => settle(() => reject(abortError(owner!)));
      const timer = setTimeout(() => settle(() => reject(new Error('Plugin callback timed out'))), owner ? SIGNALLED_CALL_TIMEOUT_MS : CALL_TIMEOUT_MS);
      pending.set(id, { resolve: value => settle(() => resolve(value)), reject: error => settle(() => reject(error)) });
      try {
        const outer = collectedSignals;
        collectedSignals = [];
        let wire: Wire;
        try { wire = encode(args); }
        finally {
          carried = collectedSignals; collectedSignals = outer;
          for (const signalId of carried) signalRefs.set(signalId, (signalRefs.get(signalId) ?? 0) + 1);
        }
        owner?.addEventListener('abort', onAbort, { once: true });
        port.postMessage({ kind: 'call', id, fn, args: wire, observe }, []);
      } catch (error) { settle(() => reject(error as Error)); }
    });
  }
  function invokeSync(fn: number, args: any[]): any {
    if (stopped || !shared) throw new Error('Plugin runtime stopped');
    const header = new Int32Array(shared, 0, 2);
    Atomics.store(header, 0, 0);
    port.postMessage({ kind: 'api-wait', waiting: true }, []);
    try {
    port.postMessage({ kind: 'call', fn, args: encode(args), shared }, []);
    if (Atomics.wait(header, 0, 0, 10_000) === 'timed-out') { stopped = true; throw new Error('Plugin API call timed out'); }
    const bytes = new Uint8Array(shared, 8, Atomics.load(header, 1));
    const result = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (result.error) throw errorFrom(result.error);
    return decode(result.value);
    } finally { port.postMessage({ kind: 'api-wait', waiting: false }, []); }
  }

  const onMessage = (message: any) => {
    if (!message || typeof message !== 'object') return;
    if (message.kind === 'abort') { signals.get(message.id)?.abort(); signals.delete(message.id); return; }
    if (message.kind === 'release') { signals.delete(message.id); return; }
    if (message.kind === 'reply') {
      const call = pending.get(message.id); if (!call) return;
      try { if (message.error) call.reject(errorFrom(message.error)); else call.resolve(decode(message.value)); } catch (error) { call.reject(error as Error); }
      return;
    }
    if (message.kind !== 'call' || stopped) return;
    if (message.shared && (!(message.shared instanceof SharedArrayBuffer) || message.shared.byteLength < 8 || message.shared.byteLength > SYNC_BYTES)) return;
    const reply = (value?: any, error?: any) => {
      if (stopped) return;
      let result: any;
      try { result = error ? { error: errorValue(error) } : { value: encode(value) }; }
      catch (cause) { result = { error: errorValue(cause) }; }
      if (message.shared) {
        const header = new Int32Array(message.shared, 0, 2);
        let bytes = Buffer.from(JSON.stringify(result));
        if (bytes.length > message.shared.byteLength - 8) bytes = Buffer.from(JSON.stringify({ error: { message: 'Plugin response exceeds the byte limit' } }));
        new Uint8Array(message.shared, 8, bytes.length).set(bytes);
        Atomics.store(header, 1, bytes.length); Atomics.store(header, 0, 1); Atomics.notify(header, 0);
      } else { port.postMessage({ kind: 'reply', id: message.id, ...result }, []); }
    };
    const callback = functions.get(message.fn);
    if (!callback) { reply(undefined, new Error('Unknown plugin callback')); return; }
    try {
      if (Reflect.get(callback, '__zccPluginOnce')) functions.delete(message.fn);
      const result = callback(...decode(message.args));
      if (message.observe) {
        if (result && typeof result.then === 'function') {
          const promise = Promise.resolve(result); void promise.catch(() => {});
          const follow = () => promise; Object.defineProperty(follow, '__zccPluginOnce', { value: true });
          reply({ asynchronous: true, value: follow });
        } else { reply({ asynchronous: false, value: result }); }
        return;
      }
      Promise.resolve(result).then(value => reply(value), error => reply(undefined, error));
    } catch (error) { reply(undefined, error); }
  };
  port.on('message', onMessage);
  return {
    encode, decode,
    dispose(error = new Error('Plugin runtime stopped')) {
      stopped = true; port.off('message', onMessage);
      for (const call of [...pending.values()]) call.reject(error);
      pending.clear(); functions.clear();
      for (const remove of removeSignalListeners.values()) remove();
      removeSignalListeners.clear(); signalRefs.clear();
      for (const controller of signals.values()) controller.abort();
      signals.clear();
    }
  };
}
