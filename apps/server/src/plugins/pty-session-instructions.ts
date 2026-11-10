import type { PtySessionInstructionsMainRequest, PtySessionInstructionsReply } from '@zana-ai/zcc-contracts/runtime';
import type { PluginService } from './plugin-service.js';
import { toolPolicyProviderId } from './native-tool-policy.js';

/**
 * The plugin guidance for a PTY Electron-main is about to spawn. Main asserted
 * the identity from its launch plan. A PTY with no bound thread keeps its
 * session id as `threadId` (as native tool policy requests do). Guidance is
 * additive: no plugin service, or a failure, answers empty so the launch goes
 * ahead without it.
 */
export async function resolveMainOwnedPtyInstructions(
  plugins: Pick<PluginService, 'sessionInstructions'> | undefined,
  request: PtySessionInstructionsMainRequest
): Promise<PtySessionInstructionsReply> {
  if (!plugins) return { instructions: '' };
  try {
    const instructions = await plugins.sessionInstructions({
      surface: 'pty',
      sessionId: request.sessionId,
      threadId: request.threadId ?? request.sessionId,
      projectId: request.projectId,
      harness: toolPolicyProviderId(request.profile)
    });
    return { instructions };
  } catch (error) {
    console.error('[plugins] pty session instructions failed', error);
    return { instructions: '' };
  }
}
