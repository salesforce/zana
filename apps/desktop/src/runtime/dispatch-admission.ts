import {
  DispatchAdmissionMainDecisionSchema,
  type DispatchAdmissionMainDecision,
  type DispatchAdmissionMainRequest
} from '@zana-ai/zcc-contracts/runtime';
import {
  DISPATCH_ADMISSION_PATH,
  NATIVE_TOOL_POLICY_PROOF_HEADER,
  signNativeToolPolicyRequest
} from '@zana-ai/zcc-server/http/native-tool-policy-proof';
import type { ProductRouteToolPolicyDeps } from './native-tool-policy.js';

export type DispatchAdmissionDecider = (request: DispatchAdmissionMainRequest) => Promise<unknown>;

/** The product server's admission route, for when no runtime supervisor runs (electron-vite dev). */
export function productRouteDispatchAdmissionDecider(deps: ProductRouteToolPolicyDeps): DispatchAdmissionDecider {
  return async (request) => {
    const body = JSON.stringify(request);
    const response = await (deps.fetch ?? fetch)(new URL(DISPATCH_ADMISSION_PATH, deps.serverUrl()), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [NATIVE_TOOL_POLICY_PROOF_HEADER]: signNativeToolPolicyRequest(deps.credential(), body)
      },
      body,
      signal: AbortSignal.timeout(deps.timeoutMs ?? 12_000)
    });
    if (!response.ok) throw new Error(`product server answered HTTP ${response.status}`);
    return await response.json();
  };
}

export interface MainDispatchAdmissionDeps {
  /** The supervised runtime channel, or null when none runs. */
  supervised(): DispatchAdmissionDecider | null;
  /** The signed product route, or null outside electron-vite dev. */
  productRoute(): DispatchAdmissionDecider | null;
  log(message: string): void;
}

export type MainDispatchRefusal = { code: 'DISPATCH_REJECTED' | 'DISPATCH_WAITING'; message: string };

/**
 * Ask plugin dispatch admission before main forwards PTY input. Returns null to
 * proceed, or the refusal. Fails closed: no channel, a transport error, or a
 * reply of an unknown shape refuses. A PTY cannot hold input for a later
 * override, so a wait refuses too.
 */
export function createMainDispatchAdmission(deps: MainDispatchAdmissionDeps) {
  return async (request: DispatchAdmissionMainRequest): Promise<MainDispatchRefusal | null> => {
    const decide = deps.supervised() ?? deps.productRoute();
    if (!decide) return { code: 'DISPATCH_REJECTED', message: 'Plugin dispatch admission unavailable' };
    let decision: DispatchAdmissionMainDecision;
    try {
      const parsed = DispatchAdmissionMainDecisionSchema.safeParse(await decide(request));
      if (!parsed.success) {
        deps.log('dispatch admission returned an invalid decision; refusing');
        return { code: 'DISPATCH_REJECTED', message: 'Plugin dispatch admission unavailable' };
      }
      decision = parsed.data;
    } catch (error) {
      deps.log(`dispatch admission failed; refusing: ${String(error)}`);
      return { code: 'DISPATCH_REJECTED', message: 'Plugin dispatch admission unavailable' };
    }
    if (decision.action === 'proceed') return null;
    return decision.action === 'reject'
      ? { code: 'DISPATCH_REJECTED', message: decision.message }
      : { code: 'DISPATCH_WAITING', message: decision.reason };
  };
}

/** Who produced a launch's opening text, from the principal main bound to it. */
export function dispatchOriginForPrincipal(principal: { kind: string; id: string }): DispatchAdmissionMainRequest['origin'] {
  if (principal.kind === 'interactive-user' || principal.id === 'control-plane:operator') return 'user';
  if (principal.id.startsWith('control-plane:orchestrator:')) return 'agent';
  return 'system';
}

/** Job Team slots dispatch through their own entry; every other launch is an initial prompt. */
export function dispatchEntryForPrincipal(principal: { kind: string }): 'initial' | 'job-team-dispatch' {
  return principal.kind === 'team' ? 'job-team-dispatch' : 'initial';
}
