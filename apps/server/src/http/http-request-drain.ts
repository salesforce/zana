import type { IncomingMessage, ServerResponse } from 'node:http';

/** Socket shutdown does not wait for async handlers or their disk cleanup. */
export function createHttpRequestDrain(handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
  const pending = new Set<Promise<void>>();
  let disposed = false;
  return {
    handle(request: IncomingMessage, response: ServerResponse): void {
      if (disposed) { response.writeHead(503).end(); return; }
      const work = handler(request, response).catch(error => {
        console.warn(`[zcc] http handler failed (${request.method ?? '?'} ${(request.url ?? '').split('?')[0]}): ${error instanceof Error ? error.message : String(error)}`);
        response.destroy();
      });
      pending.add(work);
      void work.then(() => pending.delete(work));
    },
    dispose(): void { disposed = true; },
    async whenIdle(): Promise<void> { while (pending.size) await Promise.all(pending); }
  };
}
