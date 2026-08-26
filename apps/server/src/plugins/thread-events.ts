import type { PluginThreadEvent } from '@zana-ai/zcc-plugin-sdk/server';
import type { ProductHttpContext } from '../http/product-context.js';

/** Fan thread lifecycle out to live plugins. Failures must not wedge the thread. */
export function emitPluginThreadEvent(ctx: ProductHttpContext, event: PluginThreadEvent): void {
  void ctx.plugins?.emitThreadEvent(event).catch((error) => {
    console.error('[plugins] emitThreadEvent failed', error);
  });
}
