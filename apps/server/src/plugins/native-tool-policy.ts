import { createHash } from 'node:crypto';
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
 * A native hook allow, remembered briefly so the same call arriving again
 * through the main-owned PTY tool route is not policy-evaluated twice (a
 * second pass could re-ask the human). One-shot, keyed on session + tool name
 * without the host's `mcp__zcc-inbox__` prefix + input hash (raw input, hashed in-process, never stored or sent). Absent record
 * means the caller evaluates normally, so Codex (whose hook cannot see MCP
 * calls) still gets its single evaluation.
 */
export const NATIVE_ALLOW_TTL_MS = 15_000;
const NATIVE_ALLOW_MAX = 256;
const HOST_MCP_PREFIX = /^mcp__zcc-inbox__/;
const nativeAllows = new Map<string, number>();

function nativeAllowKey(sessionId: string, toolName: string, input: unknown): string {
  // Only the host's own MCP route reaches the PTY tool endpoint, so only its
  // prefix is equivalent to the bare plugin tool name; any other server's tool
  // of the same name is a different tool and must not inherit the allow.
  const bare = toolName.replace(HOST_MCP_PREFIX, '');
  const digest = createHash('sha256').update(JSON.stringify(input) ?? '').digest('hex');
  return `${sessionId}\u0000${bare}\u0000${digest}`;
}

function recordNativeAllow(sessionId: string, toolName: string, input: unknown, now = Date.now()): void {
  for (const [key, expires] of nativeAllows) if (expires <= now) nativeAllows.delete(key);
  if (nativeAllows.size >= NATIVE_ALLOW_MAX) nativeAllows.delete(nativeAllows.keys().next().value as string);
  nativeAllows.set(nativeAllowKey(sessionId, toolName, input), now + NATIVE_ALLOW_TTL_MS);
}

/** True once per recorded native allow; consumes it. */
export function consumeNativeAllow(sessionId: string, toolName: string, input: unknown, now = Date.now()): boolean {
  const key = nativeAllowKey(sessionId, toolName, input);
  const expires = nativeAllows.get(key);
  if (expires === undefined) return false;
  nativeAllows.delete(key);
  return expires > now;
}

export function resetNativeAllowsForTest(): void { nativeAllows.clear(); }

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
  resolvedProviderId?: string,
  /** The PTY tool route consumes records; it must never leave one behind. */
  options: { recordAllow?: boolean } = {}
): Promise<NativeToolPolicyDecision> {
  if (!plugins) return { action: 'deny', reason: 'plugin service is unavailable' };
  if (!request.threadId && !request.sessionId) return { action: 'deny', reason: 'native tool call carries no thread or session identity' };
  const decision = await plugins.decideToolPolicy({
    invocationId: request.invocationId,
    // A PTY with no bound thread keeps its session id here, as before, so existing
    // handlers still key on something stable; `surface: "pty"` says it is not a thread.
    threadId: request.threadId ?? request.sessionId as string,
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    surface: request.sessionId ? 'pty' : 'modern',
    projectId: request.projectId,
    providerId: resolvedProviderId ?? toolPolicyProviderId(request.profile),
    toolName: request.toolName,
    input: redactToolInput(request.input)
  });
  const parsed = NativeToolPolicyDecisionSchema.safeParse(decision);
  if (parsed.success && parsed.data.action === 'allow') {
    if (request.sessionId && options.recordAllow !== false) recordNativeAllow(request.sessionId, request.toolName, request.input);
    return parsed.data;
  }
  if (decision?.action === 'deny') return {
    action: 'deny', reason: normalizeNativeToolPolicyReason(decision.reason, 'denied by plugin tool policy')
  };
  return { action: 'deny', reason: 'plugin tool policy returned an invalid decision' };
}
