import { safePackPluginSession } from '../../plugins/plugin-agent-tools.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { mergeHostSessionTooling, type PackedSessionTooling } from './host-session-tools.js';

/**
 * Plugin tools plus host SHARE DynamicTools. Conversation threads do not
 * inherit the PTY zcc-inbox MCP server — do not attach that URL here.
 * Pack host tools (preview_file, browser_*, inbox_*, …) instead.
 */
export async function packConversationSessionTooling(
  ctx: ProductHttpContext,
  args: { threadId: string; projectId: string }
): Promise<PackedSessionTooling> {
  const packed = await safePackPluginSession(
    ctx.plugins
      ? () => ctx.plugins!.sessionTools({ threadId: args.threadId, projectId: args.projectId })
      : undefined
  );
  return mergeHostSessionTooling(packed);
}
