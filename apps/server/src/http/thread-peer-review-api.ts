import type { IncomingMessage, ServerResponse } from 'node:http';
import { getConversationThread, isThreadQueueAutoSendPaused } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from './product-context.js';
import { headerValue } from './browser-request-guard.js';
import { sendJson } from './json.js';
import { readJsonBody } from './json.js';
import { ThreadCreateError } from './thread-create.js';
import { listPeerReviews, peerCommunicationEnabled, reviewPeerMessage } from '../services/threads/thread-peer-review.js';

export async function handleThreadPeerReviewApi(request: IncomingMessage, response: ServerResponse, ctx: ProductHttpContext, path: string, method: string): Promise<boolean> {
  const match = /^\/api\/v1\/threads\/([a-zA-Z0-9_-]{1,128})\/peer-messages(?:\/([a-zA-Z0-9_-]{1,128})(\/send)?)?$/u.exec(path);
  if (!match) return false;
  const [, threadId, id, send] = match;
  const thread = getConversationThread(ctx.db, threadId);
  if (!thread || thread.visibility !== 'visible' || thread.archivedAt !== null) { sendJson(response, 404, { error: 'unknown-thread' }); return true; }
  try {
    if (!id && method === 'GET') {
      sendJson(response, 200, { ok: true, enabled: peerCommunicationEnabled(ctx), paused: isThreadQueueAutoSendPaused(ctx.db, threadId),
        items: listPeerReviews(ctx, threadId).map(item => ({ id: item.id, text: item.body, updatedAt: item.revision, status: item.status,
          from: item.sender.displayName, senderThreadId: item.sender.kind === 'thread' ? item.sender.sessionId : null,
          to: item.recipient.displayName, recipientKind: item.recipient.kind })) });
      return true;
    }
    if (id && (method === 'DELETE' && !send || method === 'POST' && send)) {
      if (send) {
        const caller = headerValue(request.headers, 'x-zcc-ui-send-surface') === 'mobile' ? 'mobile-ui' : 'desktop-ui';
        if (!ctx.verifyUiSend(headerValue(request.headers, 'x-zcc-ui-send-proof'), threadId, id, caller)) {
          sendJson(response, 403, { error: 'invalid_caller_credential', message: 'Peer delivery requires a verified user confirmation.' }); return true;
        }
      }
      const body = await readJsonBody(request, 4096) as { confirmed?: unknown; expectedUpdatedAt?: unknown };
      if (!Number.isSafeInteger(body.expectedUpdatedAt) || send && body.confirmed !== true) {
        sendJson(response, 400, { error: 'invalid_peer_review' }); return true;
      }
      await reviewPeerMessage(ctx, threadId, id, Number(body.expectedUpdatedAt), send ? 'deliver' : 'discard');
      sendJson(response, 200, { ok: true }); return true;
    }
    sendJson(response, 405, { error: 'method not allowed' });
  } catch (error) {
    sendJson(response, error instanceof ThreadCreateError ? error.status : 500, {
      error: error instanceof ThreadCreateError ? error.code : 'peer_review_failed', message: error instanceof Error ? error.message : 'Peer review failed' });
  }
  return true;
}
