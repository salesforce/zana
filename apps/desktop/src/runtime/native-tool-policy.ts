import { createHash } from 'node:crypto';
import {
  NativeToolPolicyDecisionSchema,
  nativeToolPolicyInputFits,
  type NativeToolPolicyRequest
} from '@zana-ai/zcc-contracts/runtime';
import {
  NATIVE_TOOL_POLICY_PATH,
  NATIVE_TOOL_POLICY_PROOF_HEADER,
  signNativeToolPolicyRequest
} from '@zana-ai/zcc-server/http/native-tool-policy-proof';

/** The deny for a tool input over the runtime contract's limit; plugins are never asked. */
export const NATIVE_TOOL_INPUT_TOO_LARGE = 'tool input is larger than the 256 KiB native tool policy limit';

/** The live PTY session fields main asserts as a tool call's identity. */
export interface NativeToolPolicySession {
  readonly id: string;
  readonly projectId: string;
  readonly profile: string;
  readonly status: string;
}

export interface NativeToolPolicyHookDeps {
  /** Main's live PTY record for the URL's session, or null. */
  getSession(sessionId: string): NativeToolPolicySession | null;
  /** The plugin policy, or null when none is reachable: the call then fails closed. */
  decider(): ((request: NativeToolPolicyRequest) => Promise<unknown>) | null;
  /** Bounded diagnostics; never carries the tool input. */
  log?(message: string): void;
}

export interface NativeToolHookCall {
  readonly invocationId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
}

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Parse one PreToolUse event into the call a policy judges, or null (deny).
 * Claude Code's PreToolUse carries no `turn_id`; Codex's does, and a present
 * but malformed one is refused. One key formula serves both: it binds the
 * session and the call's whole content, so an identical retry replays its
 * decision while a body reusing a real `tool_use_id` with other content gets
 * a fresh one. `tool_input` must be an object (absent or null reads as `{}`)
 * so a policy never judges less than the key binds. Every other body key —
 * `session_id`, `cwd`, `transcript_path`, any forged identity — is ignored.
 */
export function parseNativeToolHookEvent(sessionId: string, body: string): NativeToolHookCall | null {
  try {
    const event: unknown = JSON.parse(body);
    if (!isObject(event)) return null;
    const turnId = event.turn_id ?? null;
    const toolUseId = event.tool_use_id;
    const toolName = event.tool_name;
    const input = event.tool_input ?? {};
    if ((turnId !== null && !validId(turnId)) || !validId(toolUseId) || !validId(toolName) || !isObject(input)) return null;
    const invocationId = createHash('sha256')
      .update(JSON.stringify([sessionId, turnId, toolUseId, toolName, input]))
      .digest('hex');
    return { invocationId, toolName, input };
  } catch {
    // Unparseable, or too deeply nested to re-serialise.
    return null;
  }
}

/**
 * Main's `/hook/nativetool/:projectId/:sessionId` handler (OBL-004). Main owns
 * these PTYs, so it asserts the call's identity from the LIVE session record,
 * never the agent-supplied body, and asks the plugin policy over the server
 * runtime channel: the product HTTP route only knows product-registered
 * terminals. Null — unknown or exited session, a project the session is not
 * in, no policy, a malformed event, a failed or invalid reply — makes the
 * route deny. Input over the contract's limit is denied with its own reason.
 */
export function createNativeToolPolicyHook(deps: NativeToolPolicyHookDeps) {
  return async (projectId: string, sessionId: string, body: string): Promise<{ decision: 'allow' | 'deny'; reason: string } | null> => {
    const session = deps.getSession(sessionId);
    if (!session || session.status === 'exited' || session.projectId !== projectId) return null;
    const decide = deps.decider();
    if (!decide) return null;
    const call = parseNativeToolHookEvent(session.id, body);
    if (!call) return null;
    if (!nativeToolPolicyInputFits(call.input)) return { decision: 'deny', reason: NATIVE_TOOL_INPUT_TOO_LARGE };
    let reply: unknown;
    try {
      reply = await decide({
        invocationId: call.invocationId,
        threadId: session.id,
        projectId: session.projectId,
        profile: session.profile,
        toolName: call.toolName,
        input: call.input
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      deps.log?.(`decision failed for session ${session.id.slice(0, 8)}: ${message.slice(0, 200)}`);
      return null;
    }
    const decision = NativeToolPolicyDecisionSchema.safeParse(reply);
    if (!decision.success) {
      deps.log?.(`invalid decision for session ${session.id.slice(0, 8)}`);
      return null;
    }
    // The relays match on a non-empty reason, so an allow keeps a fixed one.
    return decision.data.action === 'deny'
      ? { decision: 'deny', reason: decision.data.reason }
      : { decision: 'allow', reason: 'allowed' };
  };
}

/**
 * The supervised runtime channel as a hook decider. It reads the supervisor
 * per call, so a hook wired before the runtime starts (or in dev, where none
 * ever starts) moves on to the next decider instead of capturing a stale null.
 */
export function supervisorToolPolicyDecider(
  getSupervisor: () => { decideToolPolicy(request: NativeToolPolicyRequest): Promise<unknown> } | null
): NativeToolPolicyHookDeps['decider'] {
  return () => {
    const supervisor = getSupervisor();
    return supervisor ? (request) => supervisor.decideToolPolicy(request) : null;
  };
}

export interface ProductRouteToolPolicyDeps {
  /** The product server's base URL. */
  serverUrl(): string;
  /** The product-server credential main shares with the server; PTY children never hold it. */
  credential(): string;
  fetch?: typeof fetch;
  /** Below the relays' `curl -m 5`, so a hung server still reaches the agent as this route's deny. */
  timeoutMs?: number;
}

/**
 * The product server's native tool policy route as a hook decider, for when
 * no runtime supervisor runs: in `pnpm dev` the product server is its own
 * process. It sends the runtime channel's strict request, signed with the
 * product-server credential so the server knows main asserted the identity.
 */
export function productRouteToolPolicyDecider(deps: ProductRouteToolPolicyDeps): (request: NativeToolPolicyRequest) => Promise<unknown> {
  return async (request) => {
    const body = JSON.stringify(request);
    const response = await (deps.fetch ?? fetch)(new URL(NATIVE_TOOL_POLICY_PATH, deps.serverUrl()), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [NATIVE_TOOL_POLICY_PROOF_HEADER]: signNativeToolPolicyRequest(deps.credential(), body)
      },
      body,
      signal: AbortSignal.timeout(deps.timeoutMs ?? 4_000)
    });
    if (!response.ok) throw new Error(`product server answered HTTP ${response.status}`);
    return await response.json();
  };
}

/** The first decider available per call: the supervised runtime channel, then the product route. */
export function firstToolPolicyDecider(...deciders: NativeToolPolicyHookDeps['decider'][]): NativeToolPolicyHookDeps['decider'] {
  return () => {
    for (const decider of deciders) {
      const decide = decider();
      if (decide) return decide;
    }
    return null;
  };
}

/** Main-process sink for the hook's bounded diagnostics. */
export function warnNativeToolPolicy(message: string): void {
  console.warn(`[native-tool-policy] ${message}`);
}
