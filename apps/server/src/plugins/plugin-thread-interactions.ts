import { getConversationThread } from '@zana-ai/zcc-db';
import {
  approvalPendingInteractionResolutionSchema,
  isApprovalPendingInteractionPayload,
  isPluginPendingInteraction,
  type PendingInteraction
} from '@zana-ai/zcc-domain/thread-runtime';
import {
  PluginThreadInteractionError,
  type PluginRelayedHumanActor,
  type PluginThreadInteraction,
  type PluginThreadInteractions
} from '@zana-ai/zcc-plugin-sdk/server';
import type { ProductHttpContext } from '../http/product-context.js';
import { ThreadCreateError } from '../http/thread-create.js';
import { capUtf8, redactPromptText } from './admission-prompt.js';

type Context = Pick<ProductHttpContext, 'db' | 'pendingInteractions'>;

function requiredId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) {
    throw new PluginThreadInteractionError('invalid_request', `${name} is required (1–256 characters)`, 400);
  }
  return value.trim();
}

function project(interaction: PendingInteraction): PluginThreadInteraction {
  const payload = interaction.payload;
  let summary: string;
  let tool: string | null = null;
  let subjectKind: string | null = null;
  let grantPermissions: PluginThreadInteraction['grantPermissions'] = null;
  let refusalReason: PluginThreadInteraction['refusalReason'] = 'unsupported_interaction';
  if (isApprovalPendingInteractionPayload(payload)) {
    refusalReason = null;
    const subject = payload.subject;
    subjectKind = subject.kind;
    switch (subject.kind) {
      case 'command':
        summary = subject.command;
        grantPermissions = subject.sessionGrant;
        break;
      case 'file_change':
        summary = subject.writeScope ? `File changes: ${subject.writeScope}` : 'File changes';
        grantPermissions = subject.sessionGrant;
        break;
      case 'permission_grant':
        tool = subject.toolName;
        summary = subject.toolName ? `Permission grant: ${subject.toolName}` : 'Permission grant';
        grantPermissions = subject.permissions;
        break;
      case 'tool_use':
        tool = subject.tool;
        summary = subject.presentation.title ?? subject.presentation.label.pending;
        break;
      case 'plan':
        summary = 'Review plan';
        break;
    }
  } else if (isPluginPendingInteraction(interaction)) {
    summary = interaction.payload.title;
    if (interaction.payload.requireHuman) refusalReason = 'native_confirmation_required';
  } else if (payload.kind === 'user_question') {
    summary = payload.questions.map(question => question.prompt).join('; ');
  } else {
    summary = payload.title;
  }
  // Bound work before redaction; never project arbitrary plugin data or tool arguments.
  const display = capUtf8(redactPromptText(summary.slice(0, 4096)), 1024);
  return {
    id: interaction.id,
    threadId: interaction.threadId,
    kind: payload.kind,
    subjectKind,
    summary: display.text,
    summaryTruncated: display.truncated || summary.length > 4096,
    tool: tool === null ? null : capUtf8(redactPromptText(tool.slice(0, 4096)), 256).text,
    allowedDecisions: isApprovalPendingInteractionPayload(payload) ? [...payload.availableDecisions] : [],
    grantPermissions,
    status: interaction.status,
    createdAt: interaction.createdAt,
    resolvedAt: interaction.resolvedAt,
    resolution: interaction.resolution && 'decision' in interaction.resolution ? interaction.resolution : null,
    refusalReason
  };
}

/** The plugin id is captured by the host, never taken from a request or thread metadata. */
export function createPluginThreadInteractions(pluginId: string, context?: Context): PluginThreadInteractions {
  function ownedThread(threadId: string): Context {
    if (!context?.pendingInteractions) {
      throw new PluginThreadInteractionError('unavailable', 'Thread interactions are not available in this runtime', 503);
    }
    const thread = getConversationThread(context.db, threadId);
    if (!thread) {
      throw new PluginThreadInteractionError('not_found', 'Thread not found', 404);
    }
    if (thread.originPluginId !== pluginId) {
      throw new PluginThreadInteractionError('forbidden', 'Thread interactions require a conversation created by this plugin', 403);
    }
    return context;
  }

  return {
    async list(args) {
      const threadId = requiredId(args?.threadId, 'threadId');
      const ctx = ownedThread(threadId);
      return ctx.pendingInteractions.listPendingThreadInteractions(threadId).map(project);
    },
    async resolve(args) {
      const threadId = requiredId(args?.threadId, 'threadId');
      const interactionId = requiredId(args?.interactionId, 'interactionId');
      const ctx = ownedThread(threadId);
      const supplied = args?.actor;
      if (!supplied || supplied.kind !== 'plugin-relayed-human'
        || typeof supplied.externalUser !== 'string' || !supplied.externalUser.trim()
        || supplied.externalUser.length > 256 || /[\x00-\x1f\x7f]/.test(supplied.externalUser)) {
        throw new PluginThreadInteractionError('invalid_request', 'An authenticated plugin-relayed-human actor with externalUser is required', 400);
      }
      if (supplied.pluginId !== pluginId) {
        throw new PluginThreadInteractionError('forbidden', 'Actor pluginId must match the calling plugin', 403);
      }
      // Copy only the supported attribution. In particular no caller can supply native attestation.
      const actor: PluginRelayedHumanActor = { kind: 'plugin-relayed-human', pluginId, externalUser: supplied.externalUser.trim() };
      try {
        const current = ctx.pendingInteractions.getThreadInteraction({ threadId, interactionId });
        const view = project(current);
        if (view.refusalReason) {
          throw new PluginThreadInteractionError(view.refusalReason,
            view.refusalReason === 'native_confirmation_required'
              ? 'This interaction requires confirmation in Zana on the desktop'
              : 'Only provider approval interactions can be resolved through this API', 403);
        }
        const parsed = approvalPendingInteractionResolutionSchema.safeParse(args.resolution);
        if (!parsed.success) {
          throw new PluginThreadInteractionError('invalid_request', 'Invalid approval resolution', 400);
        }
        return project(await ctx.pendingInteractions.resolvePendingInteraction({
          threadId, interactionId, resolution: parsed.data, actor
        }));
      } catch (error) {
        if (error instanceof ThreadCreateError) {
          const code = error.status === 404 ? 'not_found' : error.status === 409 ? 'conflict' : error.status === 400 ? 'invalid_request' : null;
          if (code) throw new PluginThreadInteractionError(code, error.message, error.status);
        }
        throw error;
      }
    }
  };
}
