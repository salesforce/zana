import type { IncomingMessage } from 'node:http';

export const HOOK_BODY_CAP = 1024 * 1024;
const MAX_READERS = 32;
let readers = 0;

/** Bound hook payloads, simultaneous buffers and slow senders; null means ignore. */
export function readHookBody(req: IncomingMessage): Promise<string | null> {
  if (readers >= MAX_READERS) {
    req.resume();
    return Promise.resolve(null);
  }
  readers += 1;
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let done = false;
    const finish = (body: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onError);
      readers -= 1;
      if (body === null) req.resume();
      resolve(body);
    };
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > HOOK_BODY_CAP) finish(null);
      else chunks.push(chunk);
    };
    const onEnd = () => finish(Buffer.concat(chunks).toString('utf8'));
    const onError = () => finish(null);
    const timer = setTimeout(() => finish(null), 5_000);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onError);
  });
}
