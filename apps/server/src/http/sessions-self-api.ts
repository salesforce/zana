import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifySessionControlCredential } from '@zana-ai/zcc-host-daemon/control-credential';
import { headerValue } from './browser-request-guard.js';
import { sendJson } from './json.js';
import type { ProductHttpContext } from './product-context.js';

export const SESSIONS_SELF_PATH = '/api/v1/sessions/self';
/** Same headers the `zcc` CLI already sends on every product request. */
export const SESSION_ID_HEADER = 'x-zcc-caller-session-id';
export const SESSION_CREDENTIAL_HEADER = 'x-zcc-caller-credential';

/** What a session may learn about itself. */
export interface SessionSelf {
  sessionId: string;
  threadId?: string;
  projectId: string;
  environmentId?: string;
}

function bearerToken(request: IncomingMessage): string | undefined {
  const raw = headerValue(request.headers, 'authorization');
  const match = raw ? /^Bearer ([^\s]+)$/u.exec(raw) : null;
  return match?.[1] ?? headerValue(request.headers, SESSION_CREDENTIAL_HEADER) ?? undefined;
}

/**
 * Authenticated self-lookup for a PTY session. The caller names its session id
 * and proves it with the session token main minted; the answer is always that
 * session's own record, so a token for one session can never read another.
 * Every authentication failure is the same 401 so the route is not an oracle for
 * which session ids exist.
 */
export async function handleSessionsSelfApi(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext,
  path: string,
  method: string
): Promise<boolean> {
  if (path !== SESSIONS_SELF_PATH || method !== 'GET') return false;
  const token = bearerToken(request);
  const sessionId = headerValue(request.headers, SESSION_ID_HEADER);
  if (!token || !sessionId || !verifySessionControlCredential(sessionId, token)) {
    sendJson(response, 401, { error: 'invalid session credential' });
    return true;
  }
  const record = ctx.terminalSessions.get(sessionId);
  if (!record || record.status === 'exited') {
    sendJson(response, 404, { error: 'session is not live' });
    return true;
  }
  const self: SessionSelf = {
    sessionId: record.id,
    ...(record.threadId ? { threadId: record.threadId } : {}),
    projectId: record.projectId,
    ...(record.workspaceEnvironmentId ? { environmentId: record.workspaceEnvironmentId } : {})
  };
  sendJson(response, 200, self);
  return true;
}
