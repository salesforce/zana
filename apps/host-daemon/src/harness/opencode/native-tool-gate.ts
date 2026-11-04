/**
 * The OpenCode native tool veto. OpenCode runs every tool through its plugin
 * `tool.execute.before` hook before the tool body, and a throw from that hook
 * stops the call. The hook is independent of OpenCode's permission rules, so
 * an allow-everything permission setting (including one a managed install
 * layers on top of our config) does not bypass it.
 *
 * The module is written per session to a host-owned `0600` file and named in
 * the session's config `plugin` list. It posts the pending call to main's
 * identity-bearing native-tool route (the same route the Claude and Codex
 * relays use) and lets the call run only on the route's exact allow reply.
 * Every other outcome — a refused connection, timeout, non-2xx, malformed
 * body, or a deny — blocks the call, so the gate is fail-closed.
 */
import { pathToFileURL } from 'node:url';

/** Bound on one policy exchange; the route's own bound is shorter. */
export const OPENCODE_GATE_TIMEOUT_MS = 8000;
/** The reason shown when the route cannot be reached or answers anything unexpected. */
export const OPENCODE_GATE_UNREACHABLE = 'native tool policy unreachable';

/** ES module source for the gate plugin; `nativeToolUrl` is embedded as a JSON string literal. */
export function openCodeNativeToolGateSource(nativeToolUrl: string): string {
  return `// Native tool policy gate. Generated per session; do not edit.
const POLICY_URL = ${JSON.stringify(nativeToolUrl)};
const TIMEOUT_MS = ${OPENCODE_GATE_TIMEOUT_MS};
const UNREACHABLE = ${JSON.stringify(OPENCODE_GATE_UNREACHABLE)};

async function decide(input, output) {
  const response = await fetch(POLICY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: input.tool,
      tool_use_id: input.callID,
      tool_input: output && typeof output.args === 'object' && output.args !== null && !Array.isArray(output.args) ? output.args : {}
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) return { allow: false, reason: UNREACHABLE };
  const reply = await response.json();
  const decision = reply && reply.hookSpecificOutput;
  if (decision && decision.permissionDecision === 'allow') return { allow: true };
  if (decision && decision.permissionDecision === 'deny' && typeof decision.permissionDecisionReason === 'string' && decision.permissionDecisionReason) {
    return { allow: false, reason: decision.permissionDecisionReason };
  }
  return { allow: false, reason: UNREACHABLE };
}

export default async function nativeToolGate() {
  return {
    'tool.execute.before': async (input, output) => {
      let verdict;
      try {
        verdict = await decide(input, output);
      } catch {
        verdict = { allow: false, reason: UNREACHABLE };
      }
      if (!verdict.allow) throw new Error('Blocked by tool policy: ' + verdict.reason);
    }
  };
}
`;
}

/** Add the gate module to a config document's `plugin` list; the document is returned unchanged if it is not JSON. */
export function mergeOpenCodeGatePlugin(configJson: string, gatePath: string): string {
  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>;
    const existing = Array.isArray(parsed.plugin) ? parsed.plugin : [];
    return JSON.stringify({ ...parsed, plugin: [...existing, pathToFileURL(gatePath).href] });
  } catch {
    return configJson;
  }
}
