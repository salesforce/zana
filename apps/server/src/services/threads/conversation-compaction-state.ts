import { listConversationThreadEventsWindow } from '@zana-ai/zcc-db';
import type { ThreadEvent } from '@zana-ai/zcc-domain/thread-runtime';
import { parseCompactionLifecycleEvent } from '@zana-ai/zcc-thread-view';
import type { ProductHttpContext } from '../../http/product-context.js';
import { HOST_RECOVERY_TURN_SCAN_CAP } from './conversation-host-recovery.js';

export function isManualCompactionActive(ctx: Pick<ProductHttpContext, 'db'>, threadId: string): boolean {
  const rows = listConversationThreadEventsWindow(ctx.db, threadId, { limit: HOST_RECOVERY_TURN_SCAN_CAP });
  const open = new Set<string>();
  for (const row of rows) {
    const payload = row.payload;
    if (!payload || typeof payload !== 'object') continue;
    const event = (payload as { type?: unknown }).type
      ? payload as ThreadEvent
      : (payload as { event?: ThreadEvent }).event;
    if (!event || typeof event !== 'object' || !('type' in event)) continue;
    const parsed = parseCompactionLifecycleEvent(event as ThreadEvent, {
      id: row.id,
      seq: row.sequence,
      createdAt: row.createdAt
    }, undefined);
    if (!parsed) continue;
    if (parsed.kind === 'begin') open.add(parsed.key);
    else open.delete(parsed.key);
  }
  return open.size > 0;
}
