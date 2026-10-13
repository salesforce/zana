import { harnessFamilyOf, parseProfile } from '@zana-ai/zcc-domain/launch-provider';
import {
  normalizeNativeToolPolicyReason,
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
  request: NativeToolPolicyRequest
): Promise<NativeToolPolicyDecision> {
  if (!plugins) return { action: 'deny', reason: 'plugin service is unavailable' };
  const decision = await plugins.decideToolPolicy({
    invocationId: request.invocationId,
    threadId: request.threadId,
    projectId: request.projectId,
    providerId: toolPolicyProviderId(request.profile),
    toolName: request.toolName,
    input: redactToolInput(request.input)
  });
  return decision.action === 'deny'
    ? { action: 'deny', reason: normalizeNativeToolPolicyReason(decision.reason, 'denied by plugin tool policy') }
    : { action: 'allow' };
}
