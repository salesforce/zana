import { startEnrolledHostDaemon, type EnrolledHostDaemon } from '@zana-ai/zcc-host-daemon/enroll-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';

const inflight = new WeakMap<ProductHttpContext, Promise<void>>();
const live = new WeakMap<ProductHttpContext, EnrolledHostDaemon>();

export function disposeLocalHostDaemon(ctx: ProductHttpContext): void {
  const daemon = live.get(ctx);
  live.delete(ctx);
  void daemon?.close();
}

export async function relaunchLocalHostDaemon(
  ctx: ProductHttpContext
): Promise<{ ok: true } | { ok: false; message: string }> {
  const previous = inflight.get(ctx);
  if (previous) await previous.catch(() => undefined);
  const work = (async () => {
    const current = live.get(ctx);
    live.delete(ctx);
    await current?.close().catch(() => undefined);
    const port = ctx.origins.serverPort;
    if (!port) throw new Error('product HTTP is not listening');
    const daemon = await startEnrolledHostDaemon({
      dataDir: ctx.dataDir,
      serverUrl: `http://127.0.0.1:${port}/`,
      token: ctx.enrollToken,
      stealLock: true
    });
    live.set(ctx, daemon);
  })();
  inflight.set(ctx, work);
  try {
    await work;
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not relaunch this machine'
    };
  } finally {
    if (inflight.get(ctx) === work) inflight.delete(ctx);
  }
}
