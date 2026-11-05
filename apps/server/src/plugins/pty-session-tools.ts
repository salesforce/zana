import { createHash } from 'node:crypto';
import {
  PTY_SESSION_TOOLS_MAX,
  PTY_SESSION_TOOL_DESCRIPTION_MAX_CHARS,
  PTY_SESSION_TOOL_IMAGES_MAX,
  PTY_SESSION_TOOL_NAME_MAX_CHARS,
  PTY_SESSION_TOOL_RESULT_MAX_CHARS,
  PtySessionToolCallReplySchema,
  type PtySessionToolCallMainRequest,
  type PtySessionToolCallReply,
  type PtySessionToolsMainRequest,
  type PtySessionToolsReply
} from '@zana-ai/zcc-contracts/runtime';
import type { PluginAgentConfigureContext } from '@zana-ai/zcc-plugin-sdk/server';
import type { PluginService } from './plugin-service.js';
import { decideMainOwnedToolPolicy, toolPolicyProviderId } from './native-tool-policy.js';

/** Ceiling on the plugin's own run after policy allowed it; the caller's channel budget is larger. */
export const PTY_SESSION_TOOL_EXECUTE_TIMEOUT_MS = 240_000;
const TOOL_NAME = /^[A-Za-z0-9_.-]+$/;
const MAX_IMAGE_URL_CHARS = 8 * 1024 * 1024;
const TRUNCATED_MARK = '\n[truncated]';

type PtyToolPlugins = Pick<PluginService, 'ptySessionTools' | 'invokePtySessionTool' | 'decideToolPolicy'>;

function failure(text: string): PtySessionToolCallReply {
  return { success: false, contentItems: [{ type: 'inputText', text }] };
}

/**
 * Main asserted the identity from its live session record. A PTY with no bound
 * thread keeps its session id as `threadId` (as native tool policy requests do).
 */
function configureContext(request: PtySessionToolsMainRequest): PluginAgentConfigureContext {
  return {
    surface: 'pty',
    sessionId: request.sessionId,
    threadId: request.threadId ?? request.sessionId,
    projectId: request.projectId,
    project: { id: request.projectId },
    provider: { id: toolPolicyProviderId(request.profile) }
  } as PluginAgentConfigureContext;
}

function objectSchema(schema: unknown): Record<string, unknown> {
  return schema !== null && typeof schema === 'object' && !Array.isArray(schema)
    && (schema as { type?: unknown }).type === 'object'
    ? schema as Record<string, unknown>
    : { type: 'object' };
}

/**
 * The plugin tools one live PTY session may use, same selection Modern gets
 * (live plugins, each plugin's `configure()` choice) and no host-contributed
 * tools. Discovery is additive: no plugin service or a failure answers empty.
 */
export async function listMainOwnedPtyTools(
  plugins: Pick<PluginService, 'ptySessionTools'> | undefined,
  request: PtySessionToolsMainRequest
): Promise<PtySessionToolsReply> {
  if (!plugins) return { tools: [] };
  try {
    const session = await plugins.ptySessionTools(configureContext(request));
    const tools: PtySessionToolsReply['tools'] = [];
    for (const tool of session.tools) {
      if (tools.length >= PTY_SESSION_TOOLS_MAX) break;
      if (tool.name.length > PTY_SESSION_TOOL_NAME_MAX_CHARS || !TOOL_NAME.test(tool.name)) continue;
      tools.push({
        name: tool.name,
        description: tool.description.slice(0, PTY_SESSION_TOOL_DESCRIPTION_MAX_CHARS),
        inputSchema: objectSchema(tool.inputSchema)
      });
    }
    return { tools };
  } catch (error) {
    console.error('[plugins] pty session tools failed', error instanceof Error ? error.message : String(error));
    return { tools: [] };
  }
}

function capReply(reply: PtySessionToolCallReply): PtySessionToolCallReply {
  let images = 0;
  const contentItems: PtySessionToolCallReply['contentItems'] = [];
  for (const item of reply.contentItems) {
    if (item.type === 'inputText') {
      contentItems.push({ type: 'inputText', text: item.text.length > PTY_SESSION_TOOL_RESULT_MAX_CHARS
        ? `${item.text.slice(0, PTY_SESSION_TOOL_RESULT_MAX_CHARS - TRUNCATED_MARK.length)}${TRUNCATED_MARK}` : item.text });
    } else if (images < PTY_SESSION_TOOL_IMAGES_MAX && item.imageUrl.length <= MAX_IMAGE_URL_CHARS) {
      images++;
      contentItems.push(item);
    }
  }
  return { success: reply.success, contentItems };
}

/**
 * One plugin tool call from a live PTY session. Order is fixed: the tool must be
 * in the session's own list (so a `configure()` choice binds calls as well as
 * discovery), then the main-owned tool policy with `surface: 'pty'`, then the
 * plugin. Every failure on the way answers a denial or error, never a pass.
 * Arguments and results are never logged.
 */
export async function callMainOwnedPtyTool(
  plugins: PtyToolPlugins | undefined,
  request: PtySessionToolCallMainRequest
): Promise<PtySessionToolCallReply> {
  if (!plugins) return failure(`Tool "${request.name}" denied: plugin service is unavailable`);
  try {
    const session = await plugins.ptySessionTools(configureContext(request));
    if (!session.tools.some((tool) => tool.name === request.name)) return failure(`Unsupported tool: ${request.name}`);
    const decision = await decideMainOwnedToolPolicy(plugins, {
      invocationId: createHash('sha256').update(JSON.stringify([request.sessionId, request.invocationId, request.name])).digest('hex'),
      sessionId: request.sessionId,
      ...(request.threadId ? { threadId: request.threadId } : {}),
      projectId: request.projectId,
      profile: request.profile,
      toolName: request.name,
      input: request.arguments
    });
    if (decision.action === 'deny') return failure(`Tool "${request.name}" denied: ${decision.reason}`);
  } catch {
    return failure(`Tool "${request.name}" denied: tool policy unavailable`);
  }
  try {
    const result = await plugins.invokePtySessionTool({
      name: request.name,
      input: request.arguments,
      ctx: {
        threadId: request.threadId ?? request.sessionId,
        projectId: request.projectId,
        desktopPresentation: true,
        signal: AbortSignal.timeout(PTY_SESSION_TOOL_EXECUTE_TIMEOUT_MS)
      }
    });
    const parsed = PtySessionToolCallReplySchema.safeParse(capReply(result as PtySessionToolCallReply));
    return parsed.success ? parsed.data : failure(`Tool "${request.name}" failed: invalid result`);
  } catch (error) {
    return failure(`Tool "${request.name}" failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
