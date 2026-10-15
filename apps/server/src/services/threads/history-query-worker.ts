import { Worker } from 'node:worker_threads';
import { sqliteWorkerConfiguration } from '@zana-ai/zcc-db';

const source = `
const { parentPort, workerData } = require('node:worker_threads');
let db;
try {
  const Sqlite = require(workerData.modulePath);
  db = new Sqlite(workerData.file, { readonly: true, fileMustExist: true, nativeBinding: workerData.nativeBinding, timeout: 25 });
  parentPort.postMessage({ rows: db.prepare(workerData.sql).all(...workerData.params) });
} catch (error) { parentPort.postMessage({ error: error.message }); }
finally { if (db) db.close(); }
`;
let active = 0;
function releaseSlot() { const next = queue.shift(); if (next) next(); else active--; }
const queue: (() => void)[] = [];

export async function historyQueryWorker<T>(file: string, sql: string, params: unknown[]): Promise<T[]> {
  if (active >= 2) {
    if (queue.length >= 16) throw new Error('History search is busy');
    await new Promise<void>((resolve, reject) => {
      const ready = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        const index = queue.indexOf(ready); if (index >= 0) queue.splice(index, 1);
        reject(new Error('History search queue timed out'));
      }, 5000);
      queue.push(ready);
    });
  }
  else active++;
  return new Promise<T[]>((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(source, { eval: true, workerData: { ...sqliteWorkerConfiguration(), file, sql, params }, resourceLimits: { maxOldGenerationSizeMb: 64 } }); }
    catch (error) { releaseSlot(); reject(error); return; }
    let settled = false;
    const settle = (error?: Error, rows?: T[]) => {
      if (settled) return; settled = true; clearTimeout(timer);
      releaseSlot();
      if (error) reject(error); else resolve(rows ?? []);
      void worker.terminate();
    };
    const timer = setTimeout(() => settle(new Error('History search timed out')), 5000);
    worker.once('message', (reply: { rows?: T[]; error?: string }) => settle(reply.error ? new Error(reply.error) : undefined, reply.rows));
    worker.once('error', error => settle(error instanceof Error ? error : new Error(String(error))));
    worker.once('exit', () => settle(new Error('History search worker stopped')));
  });
}
