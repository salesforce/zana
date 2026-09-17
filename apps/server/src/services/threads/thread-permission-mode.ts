import type { ConversationThreadRow } from '@zana-ai/zcc-db';
import type { PermissionMode } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { clampPermissionModeToHost } from '../hosts/permission-ceiling.js';
import { readLastThreadExecution } from './thread-last-execution.js';
import { permissionModeForLaunchProfile } from './thread-provider-catalog.js';

/** Follow-ups and resumes inherit the saved choice, subject to the host ceiling. */
export function threadPermissionMode(
  ctx: Pick<ProductHttpContext, 'db'>,
  thread: Pick<ConversationThreadRow, 'id' | 'hostId' | 'providerId'>,
  requested?: PermissionMode
): PermissionMode {
  const mode = requested
    ?? readLastThreadExecution(ctx, thread.id).permissionMode
    ?? permissionModeForLaunchProfile(thread.providerId);
  return clampPermissionModeToHost(ctx.db, thread.hostId, mode) ?? 'accept-edits';
}
