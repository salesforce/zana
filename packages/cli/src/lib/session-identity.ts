import { productRequest, type ProductHttpDeps } from './product-http.js';

/** The caller's project/thread as far as it is known. */
export interface CallerIdentity {
  projectId?: string;
  threadId?: string;
}

interface SessionSelfBody {
  projectId?: unknown;
  threadId?: unknown;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function identityFromEnv(env: NodeJS.ProcessEnv): CallerIdentity {
  const projectId = nonEmpty(env.ZCC_PROJECT_ID) ?? nonEmpty(env.BB_PROJECT_ID);
  const threadId = nonEmpty(env.ZCC_THREAD_ID) ?? nonEmpty(env.BB_THREAD_ID);
  return { ...(projectId ? { projectId } : {}), ...(threadId ? { threadId } : {}) };
}

/**
 * Resolve the calling session's project and thread. The environment is a hint
 * main stamped at spawn; when it lacks either value and the process holds a
 * session id and token, the authenticated `GET /api/v1/sessions/self` lookup
 * fills the gap. Environment values always win, so a lookup can never override
 * what the spawn context already said. Lookup failures leave the environment
 * answer untouched; the server still authorizes every later call by token.
 */
export async function resolveCallerIdentity(deps?: ProductHttpDeps): Promise<CallerIdentity> {
  const env = process.env;
  const fromEnv = identityFromEnv(env);
  const wantsLookup = !fromEnv.projectId || !fromEnv.threadId;
  if (!wantsLookup || !nonEmpty(env.ZCC_SESSION_ID) || !nonEmpty(env.ZCC_SESSION_TOKEN)) return fromEnv;
  // `productRequest` presents the session id and token as the caller headers.
  const looked = await productRequest<SessionSelfBody>('GET', '/api/v1/sessions/self', { deps });
  if (!looked.ok || !looked.data || typeof looked.data !== 'object') return fromEnv;
  const projectId = fromEnv.projectId ?? (typeof looked.data.projectId === 'string' ? looked.data.projectId : undefined);
  const threadId = fromEnv.threadId ?? (typeof looked.data.threadId === 'string' ? looked.data.threadId : undefined);
  return { ...(projectId ? { projectId } : {}), ...(threadId ? { threadId } : {}) };
}
