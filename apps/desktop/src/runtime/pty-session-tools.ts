import { randomUUID } from 'node:crypto';
import {
  PtySessionToolCallReplySchema,
  PtySessionToolsReplySchema,
  type PtySessionToolCallMainRequest,
  type PtySessionToolCallReply,
  type PtySessionToolsMainRequest,
  type PtySessionToolsReply
} from '@zana-ai/zcc-contracts/runtime';
import {
  NATIVE_TOOL_POLICY_PROOF_HEADER,
  PTY_SESSION_TOOLS_PATH,
  PTY_SESSION_TOOL_CALL_PATH,
  signNativeToolPolicyRequest
} from '@zana-ai/zcc-server/http/native-tool-policy-proof';
import type { ProductRouteToolPolicyDeps } from './native-tool-policy.js';

export const PTY_SESSION_TOOLS_LIST_TIMEOUT_MS = 5_000;
/** Covers the policy decision (a person may be asked) and the plugin's own run. */
export const PTY_SESSION_TOOL_CALL_TIMEOUT_MS = 290_000;

export type PtySessionToolsSource = (request: PtySessionToolsMainRequest) => Promise<unknown>;
export type PtySessionToolCallSource = (request: PtySessionToolCallMainRequest) => Promise<unknown>;

function productRoutePost(deps: ProductRouteToolPolicyDeps, path: string, timeoutMs: number) {
  return async (request: unknown): Promise<unknown> => {
    const body = JSON.stringify(request);
    const response = await (deps.fetch ?? fetch)(new URL(path, deps.serverUrl()), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [NATIVE_TOOL_POLICY_PROOF_HEADER]: signNativeToolPolicyRequest(deps.credential(), body)
      },
      body,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`product server answered HTTP ${response.status}`);
    return await response.json();
  };
}

/** The product server's list route, for when no runtime supervisor runs (electron-vite dev). */
export function productRoutePtySessionTools(deps: ProductRouteToolPolicyDeps): PtySessionToolsSource {
  return productRoutePost(deps, PTY_SESSION_TOOLS_PATH, deps.timeoutMs ?? PTY_SESSION_TOOLS_LIST_TIMEOUT_MS);
}

/** The product server's call route, for when no runtime supervisor runs (electron-vite dev). */
export function productRoutePtySessionToolCall(deps: ProductRouteToolPolicyDeps): PtySessionToolCallSource {
  return productRoutePost(deps, PTY_SESSION_TOOL_CALL_PATH, deps.timeoutMs ?? PTY_SESSION_TOOL_CALL_TIMEOUT_MS);
}

/** The live PTY record fields main asserts as the identity of a tool list or call. */
export interface PtySessionToolsSession {
  readonly id: string;
  readonly projectId: string;
  readonly profile: string;
  readonly status: string;
  readonly threadId?: string;
}

export interface PtySessionToolsDeps {
  /** Main's live PTY record for a session, or null. */
  getSession(sessionId: string): PtySessionToolsSession | null;
  listSource(): PtySessionToolsSource | null;
  callSource(): PtySessionToolCallSource | null;
  log(message: string): void;
  listTimeoutMs?: number;
  callTimeoutMs?: number;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    })
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

function denied(name: string, reason: string): PtySessionToolCallReply {
  return { success: false, contentItems: [{ type: 'inputText', text: `Tool "${name}" denied: ${reason}` }] };
}

/**
 * Plugin tools for the PTY sessions main owns, behind the per-session zcc-inbox
 * route. Identity comes from the LIVE session record, never the URL or the
 * agent. Listing is additive (any failure lists nothing); a call fails closed:
 * an unknown or exited session, no channel, a timeout, a transport error, or a
 * reply of an unknown shape all answer a denial. Arguments are never logged.
 */
export function createPtySessionTools(deps: PtySessionToolsDeps) {
  const live = (projectId: string, sessionId: string) => {
    const session = deps.getSession(sessionId);
    return session && session.status !== 'exited' && session.projectId === projectId && session.profile !== 'shell'
      ? session : null;
  };
  const identity = (session: PtySessionToolsSession) => ({
    sessionId: session.id,
    ...(session.threadId ? { threadId: session.threadId } : {}),
    projectId: session.projectId,
    profile: session.profile
  });
  return {
    async list(projectId: string, sessionId: string): Promise<PtySessionToolsReply['tools']> {
      const session = live(projectId, sessionId);
      const source = deps.listSource();
      if (!session || !source) return [];
      try {
        const reply = await withTimeout(source(identity(session)), deps.listTimeoutMs ?? PTY_SESSION_TOOLS_LIST_TIMEOUT_MS);
        const parsed = PtySessionToolsReplySchema.safeParse(reply);
        if (!parsed.success) {
          deps.log('plugin session tools returned an invalid reply; listing none');
          return [];
        }
        return parsed.data.tools;
      } catch (error) {
        deps.log(`plugin session tools failed; listing none: ${String(error)}`);
        return [];
      }
    },
    async call(projectId: string, sessionId: string, name: string, args: Record<string, unknown>): Promise<PtySessionToolCallReply> {
      const session = live(projectId, sessionId);
      if (!session) return denied(name, 'the terminal session is not live');
      const source = deps.callSource();
      if (!source) return denied(name, 'plugin host is unavailable');
      try {
        const reply = await withTimeout(
          source({ ...identity(session), invocationId: randomUUID(), name, arguments: args }),
          deps.callTimeoutMs ?? PTY_SESSION_TOOL_CALL_TIMEOUT_MS
        );
        const parsed = PtySessionToolCallReplySchema.safeParse(reply);
        if (!parsed.success) return denied(name, 'plugin host returned an invalid reply');
        return parsed.data;
      } catch (error) {
        deps.log(`plugin session tool call failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}`);
        return denied(name, 'plugin host unavailable');
      }
    }
  };
}
