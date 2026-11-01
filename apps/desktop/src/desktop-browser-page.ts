import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import type { DesktopBrowserEvaluateRequest } from '@zana-ai/zcc-desktop-contract';
const LIMIT = 131072;
/** One bridge per native page, no listener per evaluation; page destruction releases it. */
export function createBrowserPageEvaluator() {
  const bridges = new WeakMap<
    WebContents,
    { prefix: string; busy: boolean; send: (data: unknown) => void }
  >();
  return async (
    page: WebContents,
    request: DesktopBrowserEvaluateRequest,
    send: (data: unknown) => void,
  ): Promise<unknown> => {
    if (page.isDestroyed()) throw new Error('Browser page closed');
    let bridge = bridges.get(page);
    if (!bridge) {
      bridge = { prefix: `zcc-page-${randomUUID()}:`, busy: false, send };
      bridges.set(page, bridge);
      const current = bridge;
      let start = Date.now(),
        count = 0;
      const listener = (
        _event: unknown,
        _level: unknown,
        rawMessage?: string,
      ) => {
        const message =
          typeof _level === 'object' && _level !== null && 'message' in _level
            ? (_level as { message: unknown }).message
            : rawMessage;
        if (
          typeof message !== 'string' ||
          !message.startsWith(current.prefix) ||
          message.length > LIMIT
        )
          return;
        if (Date.now() - start > 1000) {
          start = Date.now();
          count = 0;
        }
        if (++count > 100) return;
        try {
          current.send(JSON.parse(message.slice(current.prefix.length)));
        } catch {
          /* Untrusted page message. */
        }
      };
      page.on('console-message', listener);
      page.once('destroyed', () => {
        page.removeListener('console-message', listener);
        bridges.delete(page);
      });
    }
    bridge.send = send;
    if (bridge.busy) throw new Error('Browser page is busy');
    bridge.busy = true;
    const script = `(async () => { const bridge={postMessage(data){const value=JSON.stringify(data);if(value && value.length<120000)console.info(${JSON.stringify(bridge.prefix)}+value);}};const value=await (${request.expression});const result=JSON.stringify(value ?? null);if(result.length>${LIMIT})throw new Error('Page result too large');return result;})()`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    try {
      const execution =
        request.world === 'main'
          ? page.executeJavaScript(script)
          : page.executeJavaScriptInIsolatedWorld(999, [{ code: script }]);
      started = true;
      // Hold the concurrency slot until the actual execution ends, even after a timeout.
      void execution
        .finally(() => {
          bridge!.busy = false;
        })
        .catch(() => {});
      const result = await Promise.race([
        execution,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Browser page timed out')),
            5000,
          );
        }),
      ]);
      if (typeof result !== 'string' || result.length > LIMIT)
        throw new Error('Invalid page result');
      return JSON.parse(result);
    } finally {
      if (!started) bridge.busy = false;
      if (timer) clearTimeout(timer);
    }
  };
}
