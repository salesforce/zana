import {
  PtySessionInstructionsReplySchema,
  type PtySessionInstructionsMainRequest
} from '@zana-ai/zcc-contracts/runtime';
import {
  NATIVE_TOOL_POLICY_PROOF_HEADER,
  PTY_SESSION_INSTRUCTIONS_PATH,
  signNativeToolPolicyRequest
} from '@zana-ai/zcc-server/http/native-tool-policy-proof';
import type { ProductRouteToolPolicyDeps } from './native-tool-policy.js';

export type PtySessionInstructionsSource = (request: PtySessionInstructionsMainRequest) => Promise<unknown>;

export const PTY_SESSION_INSTRUCTIONS_DEFAULT_TIMEOUT_MS = 5_000;

/** The product server's route, for when no runtime supervisor runs (electron-vite dev). */
export function productRoutePtySessionInstructions(deps: ProductRouteToolPolicyDeps): PtySessionInstructionsSource {
  return async (request) => {
    const body = JSON.stringify(request);
    const response = await (deps.fetch ?? fetch)(new URL(PTY_SESSION_INSTRUCTIONS_PATH, deps.serverUrl()), {
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

export interface PtySessionInstructionsDeps {
  /** The supervised runtime channel, or null when none runs. */
  supervised(): PtySessionInstructionsSource | null;
  /** The signed product route, or null outside electron-vite dev. */
  productRoute(): PtySessionInstructionsSource | null;
  log(message: string): void;
  /** A slow plugin host must delay a launch by no more than this. */
  timeoutMs?: number;
}

/**
 * Ask plugins for the guidance one PTY launch carries. Guidance is additive, so
 * every failure (no channel, timeout, transport error, a reply of an unknown
 * shape) is logged and answers empty: the session still starts.
 */
export function createPtySessionInstructionsResolver(deps: PtySessionInstructionsDeps) {
  const timeoutMs = deps.timeoutMs ?? PTY_SESSION_INSTRUCTIONS_DEFAULT_TIMEOUT_MS;
  return async (request: PtySessionInstructionsMainRequest): Promise<string> => {
    const source = deps.supervised() ?? deps.productRoute();
    if (!source) return '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([
        source(request),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
        })
      ]);
      const parsed = PtySessionInstructionsReplySchema.safeParse(reply);
      if (!parsed.success) {
        deps.log('plugin session instructions returned an invalid reply; launching without them');
        return '';
      }
      return parsed.data.instructions.trim();
    } catch (error) {
      deps.log(`plugin session instructions failed; launching without them: ${String(error)}`);
      return '';
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
