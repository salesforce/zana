import { STUDIO_RPC } from '../../../lib/studio-contract.js';

type Reply = { ok?: boolean; error?: string; jobId?: string; status?: string; result?: unknown } & Record<string, unknown>;
export class SuiteStoppedError extends Error {
  constructor() { super('Suite stopped. Completed cases were saved. Remaining cases were not run.'); this.name = 'SuiteStoppedError'; }
}
/** Polling can end with the view; the server run remains available through its handle. */
export async function runSuiteJob(call: (method: string, args: Record<string, unknown>) => Promise<Reply>, input: Record<string, unknown>, signal: AbortSignal, onJob: (id: string | null) => void): Promise<Reply> {
  const started = await call(STUDIO_RPC.suiteStart, { ...input, requestId: crypto.randomUUID() });
  signal.throwIfAborted();
  if (started.ok === false || !started.jobId) throw Error(started.error || 'Studio did not return a suite run handle.');
  const jobId = started.jobId;
  onJob(jobId);
  try {
    while (!signal.aborted) {
      const reply = await call(STUDIO_RPC.suiteResult, { jobId });
      signal.throwIfAborted();
      if (reply.ok !== false && reply.status === 'stopped') throw new SuiteStoppedError();
      if (reply.ok === false || reply.status === 'failed') throw Error(reply.error || 'Could not recover this suite. Check saved results before retrying.');
      if (reply.status === 'completed') return reply.result as Reply;
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, 1000);
        signal.addEventListener('abort', finish, { once: true });
        if (signal.aborted) finish();
      });
    }
    throw Error('The view closed. The suite continues in Studio.');
  } finally { if (!signal.aborted) onJob(null); }
}
