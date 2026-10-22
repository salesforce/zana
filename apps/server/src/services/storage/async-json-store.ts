import { Worker } from 'node:worker_threads';
import { rm } from 'node:fs/promises';

export const JSON_STORE_MAX_BYTES = 8 * 1024 * 1024;
const source = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const { dirname } = require('node:path');
const { randomUUID } = require('node:crypto');
let store;
let chain = Promise.resolve();
async function load() {
  if (store) return store;
  try {
    const info = await fs.stat(workerData.file);
    if (info.size > 64 * 1024 * 1024) throw Error('Existing storage exceeds the migration read limit');
    const parsed = JSON.parse(await fs.readFile(workerData.file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Invalid storage document');
    store = Object.assign(Object.create(null), parsed);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    store = Object.create(null);
  }
  return store;
}
async function run({ op, key, value }) {
  if (op === 'flush') return;
  if (op === 'clear') { await fs.rm(workerData.file, { force: true }); store = Object.create(null); return; }
  const current = await load();
  if (op === 'get') return current[key];
  if (op === 'list') return Object.keys(current).filter(k => !key || k.startsWith(key));
  if (typeof key !== 'string' || key.length > 256) throw Error('Storage key exceeds 256 characters');
  const next = Object.assign(Object.create(null), current);
  if (op === 'delete') delete next[key];
  else if (op === 'set') {
    const encoded = JSON.stringify(value);
    if (encoded !== undefined && Buffer.byteLength(encoded) > 1024 * 1024) throw Error('Storage value exceeds 1 MiB');
    next[key] = value;
  } else throw Error('Unknown storage operation');
  const encoded = JSON.stringify(next);
  // Existing large stores stay readable and can be reduced without data loss.
  const previousBytes = Buffer.byteLength(JSON.stringify(current));
  if ((Buffer.byteLength(encoded) > workerData.maxBytes || Object.keys(next).length > 10000) && Buffer.byteLength(encoded) >= previousBytes)
    throw Error('Storage quota exceeded; remove existing values before adding more');
  await fs.mkdir(dirname(workerData.file), { recursive: true, mode: 0o700 });
  const tmp = workerData.file + '.' + randomUUID() + '.tmp';
  parentPort.postMessage({ tmp });
  try {
    await fs.writeFile(tmp, encoded, { mode: 0o600, flag: 'wx' });
    await fs.rename(tmp, workerData.file);
    store = next;
  } finally { await fs.rm(tmp, { force: true }).catch(() => {}); parentPort.postMessage({ cleared: tmp }); }
}
parentPort.on('message', message => {
  chain = chain.then(async () => {
    try { parentPort.postMessage({ id: message.id, value: await run(message) }); }
    catch (error) { parentPort.postMessage({ id: message.id, error: error.message }); }
  });
});`;

// Cap aggregate JSON work as well as each namespace's backlog.
let activeWorkers = 0;
const workerWaiters: (() => void)[] = [];
function releaseWorkerSlot() { const next = workerWaiters.shift(); if (next) next(); else activeWorkers--; }
async function acquireWorkerSlot(): Promise<void> {
  if (activeWorkers < 4) { activeWorkers++; return; }
  if (workerWaiters.length >= 128) throw new Error('Storage worker capacity exceeded');
  await new Promise<void>((resolve, reject) => {
    const ready = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { const index = workerWaiters.indexOf(ready); if (index >= 0) workerWaiters.splice(index, 1); reject(new Error('Storage worker queue timed out')); }, 10_000);
    workerWaiters.push(ready);
  });
}

/** Each trusted namespace has one serialized writer; JSON and I/O run off the caller's loop. */
export class AsyncJsonStore {
  private worker?: Worker;
  private nextId = 0;
  private admitted = 0;
  private starting?: Promise<void>;
  private idle?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private stopping: Promise<void>;
  private readonly temporary = new Set<string>();
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly file: string, private readonly maxBytes = JSON_STORE_MAX_BYTES, barrier = Promise.resolve()) { this.stopping = barrier; }

  get<T>(key: string): Promise<T | undefined> { return this.call('get', key) as Promise<T | undefined>; }
  async set(key: string, value: unknown): Promise<void> { await this.call('set', key, value); }
  async delete(key: string): Promise<void> { await this.call('delete', key); }
  list(prefix?: string): Promise<string[]> { return this.call('list', prefix) as Promise<string[]>; }
  async clear(): Promise<void> { await this.call('clear'); }
  async flush(): Promise<void> { await this.call('flush'); }

  private async call(op: string, key?: string, value?: unknown): Promise<unknown> {
    if (this.disposed) throw new Error('Storage is disposed');
    if (this.admitted >= 32) throw new Error('Storage is busy');
    this.admitted++;
    try {
    await this.stopping;
    if (this.disposed) return Promise.reject(new Error('Storage is disposed'));
    if (this.pending.size >= 32) return Promise.reject(new Error('Storage is busy'));
    clearTimeout(this.idle);
    if (!this.worker) {
      this.starting ??= this.startWorker().finally(() => { this.starting = undefined; });
      await this.starting;
      if (this.disposed) throw new Error('Storage is disposed');
    }
    const worker = this.worker!;
    const id = ++this.nextId;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(worker, new Error('Storage operation timed out')), 10_000);
      this.pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, op, key, value }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error as Error); }
    });
      } finally { this.admitted--; }
  }

  private async startWorker(): Promise<void> {
      await acquireWorkerSlot();
      if (this.disposed) { releaseWorkerSlot(); throw new Error('Storage is disposed'); }
      let worker: Worker;
      try {
      worker = new Worker(source, { eval: true, workerData: { file: this.file, maxBytes: this.maxBytes }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
      } catch (error) { releaseWorkerSlot(); throw error; }
      worker.once('exit', releaseWorkerSlot);
      this.worker = worker;
      worker.unref();
      worker.on('message', (result: { id: number; value?: unknown; error?: string; tmp?: string; cleared?: string }) => {
        if (result.tmp) { this.temporary.add(result.tmp); return; }
        if (result.cleared) { this.temporary.delete(result.cleared); return; }
        const call = this.pending.get(result.id);
        if (!call) return;
        clearTimeout(call.timer); this.pending.delete(result.id);
        if (result.error) call.reject(new Error(result.error)); else call.resolve(result.value);
        if (!this.pending.size) this.idle = setTimeout(() => { if (this.worker === worker) { this.stopWorker(worker); } }, 1000);
        this.idle?.unref();
      });
      worker.on('error', error => this.fail(worker, error instanceof Error ? error : new Error(String(error))));
      worker.on('exit', () => this.fail(worker, new Error('Storage worker stopped')));
    }

  private fail(worker: Worker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = undefined; clearTimeout(this.idle);
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(error); }
    this.pending.clear(); this.stopWorker(worker);
  }
  private stopWorker(worker: Worker): void {
    if (this.worker === worker) this.worker = undefined;
    this.stopping = worker.terminate().then(async () => {
      await Promise.all([...this.temporary].map(file => rm(file, { force: true }).catch(() => {})));
      this.temporary.clear();
    });
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    await this.starting?.catch(() => {});
    if (this.worker) this.fail(this.worker, new Error('Storage is disposed'));
    clearTimeout(this.idle);
    await this.stopping;
  }
}

const stores = new Map<string, { store: AsyncJsonStore; refs: number; closing?: Promise<void> }>();
/** Hot reload may overlap generations: both must share the same writer. */
export function openAsyncJsonStore(file: string) {
  let entry = stores.get(file);
  if (!entry || entry.closing) { entry = { store: new AsyncJsonStore(file, JSON_STORE_MAX_BYTES, entry?.closing), refs: 0 }; stores.set(file, entry); }
  entry.refs++;
  const core = entry;
  let live = true;
  const assertLive = () => { if (!live) throw new Error('Storage lease is disposed'); };
  return {
    get: <T>(key: string) => { assertLive(); return core.store.get<T>(key); },
    set: (key: string, value: unknown) => { assertLive(); return core.store.set(key, value); },
    delete: (key: string) => { assertLive(); return core.store.delete(key); },
    list: (prefix?: string) => { assertLive(); return core.store.list(prefix); },
    clear: () => { assertLive(); return core.store.clear(); },
    dispose: async (options: { drain?: boolean } = {}) => {
      if (!live) return; live = false;
      if (--core.refs === 0) {
        core.closing = (async () => { try { if (options.drain) await core.store.flush(); } finally { await core.store.dispose(); } })();
        try { await core.closing; } finally { if (stores.get(file) === core) stores.delete(file); }
      }
    }
  };
}
