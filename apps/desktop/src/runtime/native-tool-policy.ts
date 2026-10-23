import type { NativeToolPolicyRequest } from '@zana-ai/zcc-contracts/runtime';
import {
  NATIVE_TOOL_POLICY_PATH,
  NATIVE_TOOL_POLICY_PROOF_HEADER,
  signNativeToolPolicyRequest
} from '@zana-ai/zcc-server/http/native-tool-policy-proof';
import type { NativeToolPolicyHookDeps } from '@zana-ai/zcc-server/plugins/native-tool-hook';

export {
  NATIVE_TOOL_INPUT_TOO_LARGE,
  createNativeToolPolicyHook,
  parseNativeToolHookEvent,
  type NativeToolHookCall,
  type NativeToolPolicyHookDeps,
  type NativeToolPolicySession
} from '@zana-ai/zcc-server/plugins/native-tool-hook';

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
