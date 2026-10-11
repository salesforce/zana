import {
  getActivePendingInteractionForThread,
  getConversationThread,
  listConversationThreadEventsWindow,
  type ConversationThreadRow,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import {
  levelAllowsKind,
  normalizeNotificationDefaults,
  quietestAncestorCap,
  resolveThreadNotifications,
  type NotificationLevel,
  type NotificationSource,
  type OwnNotificationLevel,
  type PushNotificationKind,
  type ThreadNotificationState
} from '@zana-ai/zcc-domain';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { createNotificationLevelStore } from './level-store.js';
import { buildPushPreview } from './previews.js';

/** A spawn chain this deep is not real; bound the walk (and any parent cycle). */
const MAX_ANCESTOR_DEPTH = 32;
/** Completed items to scan, newest first, for the last assistant reply. */
const REPLY_SCAN_LIMIT = 40;

type NotificationConfig = Pick<
  AppConfig,
  'notificationDefaultLevel' | 'notificationChildLevel' | 'notificationPreviews'
>;

export interface NotificationServiceDeps {
  db: ZccDatabase;
  getConfig(): NotificationConfig;
  maxOverrides?: number;
}

export interface NotificationVerdict {
  send: boolean;
  level: NotificationLevel;
  source: NotificationSource;
  /** Why nothing is sent. */
  reason?: 'level' | 'archived';
  /** Readable text, present only when sending with previews enabled. */
  title?: string;
  body?: string;
}

function lastAgentReply(db: ZccDatabase, threadId: string): string | undefined {
  const rows = listConversationThreadEventsWindow(db, threadId, {
    limit: REPLY_SCAN_LIMIT,
    type: 'item/completed'
  });
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const payload = rows[i]!.payload;
    const item =
      payload && typeof payload === 'object' ? (payload as { item?: unknown }).item : undefined;
    if (!item || typeof item !== 'object') continue;
    const { type, text } = item as { type?: unknown; text?: unknown };
    if (type === 'agentMessage' && typeof text === 'string' && text.trim()) return text;
  }
  return undefined;
}

export function createNotificationService(deps: NotificationServiceDeps) {
  const { db, getConfig } = deps;
  const store = createNotificationLevelStore(db, { maxOverrides: deps.maxOverrides });

  function ancestorIds(thread: ConversationThreadRow): string[] {
    const seen = new Set([thread.id]);
    const ids: string[] = [];
    let next = thread.parentThreadId;
    while (next && ids.length < MAX_ANCESTOR_DEPTH && !seen.has(next)) {
      const parent = getConversationThread(db, next);
      if (!parent) break;
      seen.add(next);
      ids.push(next);
      next = parent.parentThreadId;
    }
    return ids;
  }

  function state(thread: ConversationThreadRow): ThreadNotificationState {
    const ancestors = ancestorIds(thread);
    const levels = store.ownLevels([thread.id, ...ancestors]);
    const defaults = normalizeNotificationDefaults(getConfig());
    const resolved = resolveThreadNotifications(
      {
        own: levels.get(thread.id) ?? 'inherit',
        ancestorCap: quietestAncestorCap(ancestors.map((threadId) => ({ threadId, own: levels.get(threadId) })))
      },
      thread,
      defaults
    );
    return { threadId: thread.id, ...resolved, ...defaults };
  }

  return {
    /** Null when the thread is not registered. */
    get(threadId: string): ThreadNotificationState | null {
      const thread = getConversationThread(db, threadId);
      return thread ? state(thread) : null;
    },

    /** Null when the thread is not registered; throws `NotificationLimitError` past the cap. */
    set(threadId: string, level: OwnNotificationLevel): ThreadNotificationState | null {
      const thread = getConversationThread(db, threadId);
      if (!thread) return null;
      store.setOwn(thread.id, level);
      return state(thread);
    },

    /**
     * Decide whether `kind` on this thread should reach the phone and, when
     * previews are on, what it should say. Null when the thread is not registered.
     */
    verdict(threadId: string, kind: PushNotificationKind): NotificationVerdict | null {
      const thread = getConversationThread(db, threadId);
      if (!thread) return null;
      const { effective, source } = state(thread);
      if (thread.archivedAt !== null) return { send: false, level: effective, source, reason: 'archived' };
      if (!levelAllowsKind(effective, kind)) return { send: false, level: effective, source, reason: 'level' };
      if (getConfig().notificationPreviews === false) return { send: true, level: effective, source };
      const preview = buildPushPreview(kind, thread, {
        pendingPayload:
          kind === 'pending-interaction' ? getActivePendingInteractionForThread(db, thread.id)?.payload : undefined,
        lastReply: kind === 'turn-finished' ? lastAgentReply(db, thread.id) : undefined
      });
      return { send: true, level: effective, source, ...preview };
    }
  };
}

export type { ThreadNotificationState };
export type NotificationService = ReturnType<typeof createNotificationService>;
