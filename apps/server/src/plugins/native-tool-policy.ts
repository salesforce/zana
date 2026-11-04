import { harnessFamilyOf, parseProfile } from '@zana-ai/zcc-domain/launch-provider';
import {
  normalizeNativeToolPolicyReason,
  NativeToolPolicyDecisionSchema,
  type NativeToolPolicyDecision,
  type NativeToolPolicyRequest
} from '@zana-ai/zcc-contracts/runtime';
import { redactToolInput } from '@zana-ai/zcc-host-daemon/harness/claude/hooks';
import { canonicalThreadProviderId } from '../services/threads/thread-provider-catalog.js';
import type { PluginService } from './plugin-service.js';

/**
 * The provider id a tool policy sees for a launch profile: one id per harness
 * family, so a resume or unrestricted launch reads the same as its base
 * profile. Unknown profiles pass through unchanged.
 */
export function toolPolicyProviderId(profile: string): string {
  const launchProfile = parseProfile(profile);
  return canonicalThreadProviderId((launchProfile ? harnessFamilyOf(launchProfile) : null) ?? profile);
}

/**
 * Decide one native tool call (OBL-004) from a PTY Electron-main owns. Main
 * asserted the identity from its live session record; this only asks the
 * plugins, with the input redacted, and returns a decision whose deny reason
 * every CLI can use. No plugin service (not created yet, or stopped) is a
 * deny. A rejection propagates: the runtime boundary answers an error, and
 * main's hook route then fails closed.
 */
export async function decideMainOwnedToolPolicy(
  plugins: Pick<PluginService, 'decideToolPolicy'> | undefined,
  request: NativeToolPolicyRequest,
  resolvedProviderId?: string
): Promise<NativeToolPolicyDecision> {
  if (!plugins) return { action: 'deny', reason: 'plugin service is unavailable' };
  const decision = await plugins.decideToolPolicy({
    invocationId: request.invocationId,
    // A PTY with no bound thread keeps its session id here, as before, so existing
    // handlers still key on something stable; `surface: "pty"` says it is not a thread.
    threadId: request.threadId ?? request.sessionId!,
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    surface: request.sessionId ? 'pty' : 'modern',
    projectId: request.projectId,
    providerId: resolvedProviderId ?? toolPolicyProviderId(request.profile),
    toolName: request.toolName,
    input: redactToolInput(request.input)
  });
  const parsed = NativeToolPolicyDecisionSchema.safeParse(decision);
  if (parsed.success && parsed.data.action === 'allow') return parsed.data;
  if (decision?.action === 'deny') return {
    action: 'deny', reason: normalizeNativeToolPolicyReason(decision.reason, 'denied by plugin tool policy')
  };
  return { action: 'deny', reason: 'plugin tool policy returned an invalid decision' };
}
