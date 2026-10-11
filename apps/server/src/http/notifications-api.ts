import type { IncomingMessage, ServerResponse } from 'node:http';
import { isOwnNotificationLevel, isPushNotificationKind, PUSH_NOTIFICATION_KINDS } from '@zana-ai/zcc-domain';
import { NotificationLimitError } from '../services/notifications/level-store.js';
import { createNotificationService } from '../services/notifications/notification-service.js';
import type { ProductHttpContext } from './product-context.js';
import { readJsonBody, sendJson } from './json.js';

const ROUTE = /^\/api\/v1\/threads\/([^/]{1,128})\/(notification-level|notification-verdict)$/u;
/** `{ "level": "<name>" }` is all this endpoint accepts. */
const LEVEL_BODY_LIMIT = 2_048;

function unknownThread(res: ServerResponse): void {
  sendJson(res, 404, { error: 'unknown-thread', message: 'thread is not registered' });
}

/**
 * Per-thread notification level (`GET`/`PUT .../notification-level`) and the
 * push gate the desktop relay asks before it contacts Expo
 * (`GET .../notification-verdict?kind=`). The server owns every decision: the
 * renderer and the relay only forward a thread id and a level name.
 */
export async function handleNotificationsApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ProductHttpContext,
  path: string,
  method: string,
  requestUrl: URL
): Promise<boolean> {
  const match = ROUTE.exec(path);
  if (!match) return false;
  let threadId: string;
  try {
    threadId = decodeURIComponent(match[1]!);
  } catch {
    sendJson(res, 400, { error: 'invalid-thread-id', message: 'thread id is not valid' });
    return true;
  }
  const service = createNotificationService({ db: ctx.db, getConfig: () => ctx.config.getConfig() });

  if (match[2] === 'notification-verdict') {
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    const kind = requestUrl.searchParams.get('kind');
    if (!isPushNotificationKind(kind)) {
      sendJson(res, 400, { error: 'invalid-notification-kind', message: `kind must be one of ${PUSH_NOTIFICATION_KINDS.join(', ')}` });
      return true;
    }
    const verdict = service.verdict(threadId, kind);
    if (verdict) sendJson(res, 200, verdict);
    else unknownThread(res);
    return true;
  }

  if (method === 'GET') {
    const state = service.get(threadId);
    if (state) sendJson(res, 200, state);
    else unknownThread(res);
    return true;
  }
  if (method === 'PUT') {
    let level: unknown;
    try {
      level = ((await readJsonBody(req, LEVEL_BODY_LIMIT)) as { level?: unknown } | null)?.level;
    } catch {
      sendJson(res, 400, { error: 'invalid-notification-level', message: 'send a small JSON body: { "level": "<name>" }' });
      return true;
    }
    if (!isOwnNotificationLevel(level)) {
      sendJson(res, 400, { error: 'invalid-notification-level', message: 'level must be inherit, all, input-only or muted' });
      return true;
    }
    try {
      const state = service.set(threadId, level);
      if (state) sendJson(res, 200, state);
      else unknownThread(res);
    } catch (error) {
      if (!(error instanceof NotificationLimitError)) throw error;
      sendJson(res, 409, { error: 'notification-limit', message: error.message });
    }
    return true;
  }
  sendJson(res, 405, { error: 'Method not allowed' });
  return true;
}
