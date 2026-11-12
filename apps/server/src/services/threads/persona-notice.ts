import { appendConversationThreadEvent } from '@zana-ai/zcc-db';
import { threadScope } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { PERSONA_MCP_ALLOWLIST_OPERATION } from './persona-mcp-allowlist.js';

/**
 * Surface a persona launch notice as a visible, non-fatal `system/operation` timeline event.
 * Never blocks the launch: any failure to record it is swallowed.
 */
export function emitPersonaNotice(
  ctx: ProductHttpContext,
  threadId: string,
  operation: string,
  message: string | undefined
): void {
  if (!message) return;
  try {
    const stored = appendConversationThreadEvent(ctx.db, {
      threadId,
      type: 'system/operation',
      payload: {
        type: 'system/operation',
        threadId,
        scope: threadScope(),
        operation,
        status: 'warning',
        message,
        operationId: `${operation.replace(/_/g, '-')}:${threadId}`
      }
    });
    ctx.hub.emit('threads:event', {
      threadId: stored.threadId,
      sequence: stored.sequence,
      kind: 'thread.event',
      type: stored.type,
      payload: stored.payload
    });
  } catch (error) {
    // Advisory only: never fail the launch, but leave a trace that the notice was not recorded.
    console.warn(`[zcc] ${operation} notice not recorded for thread ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Persona-MCP-allowlist notice (`persona_mcp_allowlist`). */
export function emitPersonaMcpNotice(ctx: ProductHttpContext, threadId: string, message: string | undefined): void {
  emitPersonaNotice(ctx, threadId, PERSONA_MCP_ALLOWLIST_OPERATION, message);
}
