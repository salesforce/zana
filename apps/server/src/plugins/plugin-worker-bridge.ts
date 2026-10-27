import type { MessagePort, Worker } from 'node:worker_threads';
import { isMainThread } from 'node:worker_threads';
import { PLUGIN_INTERACTION_MAX_TIMEOUT_MS } from '@zana-ai/zcc-domain/thread-runtime';
import type { PeerGrantLease } from '../services/peers/pair-store.js';

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

export const PEER_WORKER_COMMIT_TIMEOUT_MS = 10_000;
// Supported 24MiB Design Docs can exceed 5s when a full test suite contends for CPU. Keep the
// synchronous VM fence below the caller's 10s commit deadline so a wedged plugin stays bounded.
export const PEER_WORKER_EXECUTION_TIMEOUT_MS = 8_000;
type Observation = { asynchronous: boolean; value: any };
const workerCommits = new WeakMap<Function, { observe(gate: SharedArrayBuffer, preflight: () => void): Promise<Observation>; release(): void }>();
const hostCommitFunctions = new WeakMap<Function, AbortSignal>();
const peerCommitFailures = new WeakMap<AbortSignal, Error>();

/** Only host-created proxies qualify. Plugin properties and renderer flags cannot opt in. */
export function createPluginPeerCommit(lease: PeerGrantLease, signal: AbortSignal, lifetime = signal): PeerGrantLease['commitSync'] {
  const fenced: PeerGrantLease['commitSync'] = commit => {
    const observed = workerCommits.get(commit);
    let failure: Error | undefined;
    const operation = signal.aborted || lifetime.aborted ? Promise.reject(signal.reason ?? new Error('Peer request finished'))
      : observed ? lease.commitWorkerSync(async (gate, preflight) => {
        try { return await observed.observe(gate, preflight); }
        catch (error) {
          // Lease failure aborts the caller before the handler's error reply arrives.
          failure = error as Error; peerCommitFailures.set(signal, failure);
          throw error;
        }
      }, signal)
        : lease.commitSync(commit.constructor.name === 'AsyncFunction' ? commit : () => { signal.throwIfAborted(); return commit(); });
    return operation.finally(() => {
      if (failure && peerCommitFailures.get(signal) === failure) peerCommitFailures.delete(signal);
      observed?.release();
    });
  };
  hostCommitFunctions.set(fenced, lifetime);
  return fenced;
}

/** Function ids belong to this authenticated runtime only; no method/path comes from a renderer. */
export function createPluginWorkerBridge(port: Port, side: 'server' | 'plugin', options?: {
  terminate?: () => Promise<unknown>;
  commitSync?: (callback: () => any) => any;
  /** Throws to refuse a new outbound call (e.g. while the plugin is being updated). */
  admitCall?: () => void;
}) {
  let nextId = 0;
  let stopped = false;
  let fault: Error | undefined;
  let pluginId: string | undefined;
  let committing = false;
  let activeCommits = 0;
  const functions = new Map<number, (...args: any[]) => any>();
  const boundMethods = new WeakMap<object, Map<Function, Function>>();
  const functionIds = new WeakMap<Function, number>();
  const temporaryFunctions = new WeakSet<Function>();
  const temporaryIds = new Set<number>();
  const removeFunctionListeners = new Map<number, () => void>();
  const signals = new Map<number, AbortController>();
  const signalIds = new WeakMap<AbortSignal, number>();
  const removeSignalListeners = new Map<number, () => void>();
  // Live signals encoded into in-flight calls. A signal's slot (here and on the
  // remote side) is released once the last call carrying it settles, so per-call
  // signals that never abort do not exhaust the signal limit.
  const signalRefs = new Map<number, number>();
  let collectedSignals: number[] | null = null;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; cancel(error: Error): void }>();
  // Observed async service results cross the bridge in two calls. Keep their
  // one-shot continuation admitted across the gap between those calls.
  const remoteResults = new Set<number>();
  const shared = side === 'plugin' ? new SharedArrayBuffer(SYNC_BYTES) : undefined;

  function encode(value: any, path = '', depth = 0, seen = new Set<object>()): Wire {
    if (side === 'server' && depth === 0 && typeof value?.pluginId === 'string') pluginId = value.pluginId;
    if (typeof value === 'string' && value.length > 4 * 1024 * 1024) throw new Error('Plugin string exceeds the byte limit');
    if (depth > 32) throw new Error('Plugin value exceeds the nesting limit');
    if (typeof value === 'function') {
      let id = functionIds.get(value);
      if (id === undefined || !functions.has(id)) {
        if (functions.size >= MAX_FUNCTIONS) throw new Error('Plugin callback limit exceeded');
        id = ++nextId; functions.set(id, value); functionIds.set(value, id);
        if (temporaryFunctions.has(value)) temporaryIds.add(id);
        const lifetime = hostCommitFunctions.get(value);
        if (lifetime) {
          const functionId = id;
          const release = () => releaseFunction(functionId);
          lifetime.addEventListener('abort', release, { once: true });
          removeFunctionListeners.set(id, () => lifetime.removeEventListener('abort', release));
          if (lifetime.aborted) release();
        }
      }
      const async = side === 'plugin' || hostCommitFunctions.has(value) || value.__zccPluginOnce === true || value.constructor?.name === 'AsyncFunction' || /^(sdk|host|storage\.kv)(\.|$)/.test(path);
      return { [TAG]: 'function', side, id, async, once: value.__zccPluginOnce === true || temporaryFunctions.has(value), peerCommit: hostCommitFunctions.has(value) };
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
          const lifetime = hostCommitFunctions.get(item);
          if (lifetime) hostCommitFunctions.set(bound as Function, lifetime);
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
      if (value.once) {
        if (remoteResults.size >= MAX_FUNCTIONS && !remoteResults.has(value.id)) throw new Error('Plugin pending service result limit exceeded');
        remoteResults.add(value.id);
      }
      const invokeResult = (args: any[], observe = false) => {
        const result = invoke(value.id, args, observe);
        return value.once ? result.finally(() => remoteResults.delete(value.id)) : result;
      };
      const remote = (...args: any[]) => {
        if (side === 'plugin' && value.peerCommit) {
          if (typeof args[0] !== 'function') return Promise.reject(new Error('Peer commit requires a callback'));
          // Each call owns a disposable slot; the request's commit method remains reusable.
          const callback = args[0].bind(undefined);
          temporaryFunctions.add(callback);
          return invoke(value.id, [callback]).finally(() => {
            const id = functionIds.get(callback); if (id !== undefined) releaseFunction(id);
          });
        }
        return side === 'plugin' && !value.async ? invokeSync(value.id, args) : invokeResult(args);
      };
      Object.defineProperty(remote, '__zccPluginInvokeObserved', { value: (...args: any[]) => invokeResult(args, true) });
      Object.defineProperty(remote, '__zccPluginOnce', { value: value.once });
      if (side === 'server' && options?.terminate) workerCommits.set(remote, {
        // A fenced commit is invoked directly rather than through invokeResult, so it settles its own
        // one-shot admission slot; release covers a commit that was never observed.
        observe: (gate, preflight) => invoke(value.id, [], true, gate, preflight).finally(() => remoteResults.delete(value.id)),
        release: () => { remoteResults.delete(value.id); if (!stopped) port.postMessage({ kind: 'release-function', id: value.id }, []); }
      });
      return remote;
    }
    if (value[TAG] === 'signal') {
      // A signal already cancelled at serialization time has no future abort event.
      // Return it without reserving a receiver slot that could never be released.
      if (value.aborted) {
        const existing = signals.get(value.id);
        existing?.abort();
        signals.delete(value.id);
        return existing?.signal ?? AbortSignal.abort();
      }
      let controller = signals.get(value.id);
      if (!controller) { if (signals.size >= 1024) throw new Error('Plugin signal limit exceeded'); controller = new AbortController(); signals.set(value.id, controller); }
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
  // `status` rides along (4xx only) so a thrown `{ status: 404 }` still classifies as an expected error host-side.
  function errorValue(error: any) { return { message: error?.message ?? String(error), code: error?.code, name: error?.name, ...(typeof error?.status === 'number' ? { status: error.status } : {}) }; }
  function errorFrom(error: any): Error { return Object.assign(new Error(error.message), { code: error.code, name: error.name ?? 'Error' }, typeof error.status === 'number' ? { status: error.status } : {}); }
  function releaseFunction(id: number) {
    const callback = functions.get(id);
    if (callback) functionIds.delete(callback);
    functions.delete(id); temporaryIds.delete(id);
    removeFunctionListeners.get(id)?.(); removeFunctionListeners.delete(id);
  }

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

  function invoke(fn: number, args: any[], observe = false, gate?: SharedArrayBuffer, preflight?: () => void): Promise<any> {
    if (committing) throw new Error('Plugin commit callback cannot call host APIs');
    try { options?.admitCall?.(); } catch (error) { return Promise.reject(error); }
    if (stopped) return Promise.reject(fault ?? new Error('Plugin runtime stopped'));
    if (pending.size >= MAX_PENDING) return Promise.reject(new Error('Plugin runtime is busy'));
    const id = ++nextId;
    const owner = callerSignal(args);
    return new Promise((resolve, reject) => {
      if (gate) activeCommits++;
      let carried: number[] = [];
      let settled = false;
      let finished = false;
      const finishCall = (run: () => void) => { if (finished) return; finished = true; if (gate) activeCommits--; run(); };
      const settle = (finish: () => void) => {
        if (settled) return;
        settled = true; pending.delete(id); clearTimeout(timer); owner?.removeEventListener('abort', onAbort);
        if (preflight) releaseFunction(functionIds.get(preflight)!);
        // An observed call replies before the remote work ends, so its signals stay live.
        if (!observe) releaseSignals(carried);
        finish();
      };
      // Detach replies immediately, but keep the watchdog exemption until quiescence.
      const cancel = (error: Error) => settle(() => rejectFenced(gate, error => finishCall(() => reject(error)), error, id, fn));
      const onAbort = () => cancel(peerCommitFailures.get(owner!) ?? abortError(owner!));
      const timer = setTimeout(() => cancel(new Error('Plugin callback timed out')), gate ? PEER_WORKER_COMMIT_TIMEOUT_MS : owner ? SIGNALLED_CALL_TIMEOUT_MS : CALL_TIMEOUT_MS);
      pending.set(id, { resolve: value => settle(() => finishCall(() => resolve(value))), reject: error => settle(() => finishCall(() => reject(error))), cancel });
      try {
        const outer = collectedSignals;
        collectedSignals = [];
        let wire: Wire;
        let preflightWire: Wire;
        try { wire = encode(args); if (gate) preflightWire = encode(preflight); }
        finally {
          carried = collectedSignals; collectedSignals = outer;
          for (const signalId of carried) signalRefs.set(signalId, (signalRefs.get(signalId) ?? 0) + 1);
        }
        owner?.addEventListener('abort', onAbort, { once: true });
        port.postMessage({ kind: 'call', id, fn, args: wire, observe, ...(gate ? { gate, preflight: preflightWire } : {}) }, []);
      } catch (error) { cancel(error as Error); }
    });
  }
  function rejectFenced(gate: SharedArrayBuffer | undefined, reject: (error: Error) => void, error: Error, callId: number, functionId: number) {
    // Never release an executing lease while its worker can still write SQLite.
    if (gate && Atomics.compareExchange(new Int32Array(gate), 0, 0, 2) === 1) {
      const failed = (cause: unknown) => {
        // Quiescence is unproven: invalidate admission permanently, never report success.
        Atomics.store(new Int32Array(gate), 0, 2);
        fault ??= Object.assign(new Error(`Plugin worker termination failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }), { code: 'PLUGIN_TERMINATION_FAILED' });
        stopped = true;
        console.error('[plugin-worker-bridge] Worker termination failed', { pluginId, callId, functionId, cause });
        reject(fault);
        for (const call of [...pending.values()]) call.cancel(fault);
      };
      try { void options!.terminate!().then(() => reject(error), failed); }
      catch (cause) { failed(cause); }
    } else { reject(error); }
  }
  function invokeSync(fn: number, args: any[]): any {
    if (committing) throw new Error('Plugin commit callback cannot call host APIs');
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
    if (message.kind === 'release-function') { if (temporaryIds.has(message.id)) releaseFunction(message.id); return; }
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
      if (Reflect.get(callback, '__zccPluginOnce') || temporaryIds.has(message.fn)) releaseFunction(message.fn);
      let result;
      if (message.gate) {
        if (side !== 'plugin' || !options?.commitSync || !(message.gate instanceof SharedArrayBuffer) || message.gate.byteLength !== 16) throw new Error('Invalid plugin commit fence');
        const gate = new Int32Array(message.gate);
        if (Date.now() >= Number(Atomics.load(new BigInt64Array(message.gate, 8), 0)) || Atomics.load(gate, 0) !== 0) throw new Error('peer grant lease no longer active');
        if (callback.constructor.name === 'AsyncFunction') throw new Error('peer commit fence requires synchronous callback');
        // Trusted host preflight claims admission after checking live enrollment under the lease.
        decode(message.preflight)();
        if (Atomics.load(gate, 0) !== 1) throw new Error('peer grant lease no longer active');
        // No await or message roundtrip between admission and the worker-local transaction.
        committing = true;
        let asyncInvalid = false;
        try { result = options.commitSync(() => {
          const value = callback(...decode(message.args));
          if (value && typeof value.then === 'function') {
            asyncInvalid = true;
            throw new Error('peer commit fence requires synchronous callback');
          }
          return value;
        }); }
        finally {
          committing = false;
          if (asyncInvalid) {
            // Rollback has finished; exit before a rejected continuation gets another turn.
            port.postMessage({ kind: 'failure', message: 'peer commit fence requires synchronous callback' }, []);
            if (!isMainThread) process.exit(1);
          }
        }
      } else { result = callback(...decode(message.args)); }
      if (message.observe) {
        if (result && typeof result.then === 'function') {
          const promise = Promise.resolve(result); void promise.catch(() => {});
          const follow = () => promise; Object.defineProperty(follow, '__zccPluginOnce', { value: true });
          reply({ asynchronous: true, value: follow });
        } else { reply({ asynchronous: false, value: result }); }
        return;
      }
      if (message.shared && !(result && typeof result.then === 'function')) reply(result);
      else Promise.resolve(result).then(value => reply(value), error => reply(undefined, error));
    } catch (error) { reply(undefined, error); }
  };
  port.on('message', onMessage);
  return {
    encode, decode,
    get fault() { return fault; },
    get activeCommits() { return activeCommits; },
    get retainedFunctions() { return functions.size; },
    isBusy: () => pending.size > 0 || remoteResults.size > 0,
    dispose(error = new Error('Plugin runtime stopped')) {
      stopped = true; port.off('message', onMessage);
      remoteResults.clear();
      for (const call of [...pending.values()]) call.cancel(error);
      pending.clear(); functions.clear();
      temporaryIds.clear();
      for (const remove of removeFunctionListeners.values()) remove();
      removeFunctionListeners.clear();
      for (const remove of removeSignalListeners.values()) remove();
      removeSignalListeners.clear(); signalRefs.clear();
      for (const controller of signals.values()) controller.abort();
      signals.clear();
    }
  };
}
