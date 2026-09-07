import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';

export const REPLY_SEED_PREFIX =
  'Replying to this earlier message in the conversation:\n\n';

/** Archive-eligible age for an empty (never-replied-to) hidden fork. */
export const EMPTY_FORK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Rows the cleanup sweep reads per query, so its memory stays flat. */
export const EMPTY_FORK_SWEEP_PAGE_SIZE = 100;

/**
 * KV prefix marking a fork the sweep already found user work in. Messages never
 * disappear, so that verdict is permanent — without it every hour re-reads the
 * full event list of every side chat anyone has actually used.
 */
const KEPT_FORK_KEY_PREFIX = 'kept-fork:';

export interface SideChatEventRowLike {
  type: string;
  payload?: unknown;
}

interface SideChatForkCandidate {
  originKind?: string | null;
  originPluginId?: string | null;
  visibility?: string;
  archivedAt?: number | null;
  createdAt?: number;
}

export function resolveReplySeedText(anchorText: string): string | null {
  const anchor = anchorText.trim();
  return anchor.length > 0 ? anchor : null;
}

/** Whether events.list shows a real (visible) user turn, not an agent-only seed. */
export function eventsContainUserMessage(events: readonly SideChatEventRowLike[]): boolean {
  return events.some((row) => {
    if (row.type !== 'client/turn/requested') return false;
    const payload = row.payload;
    if (!payload || typeof payload !== 'object') return false;
    const input = (payload as { input?: unknown }).input;
    if (!Array.isArray(input)) return false;
    return input.some((part) => {
      if (!part || typeof part !== 'object') return false;
      const record = part as { visibility?: unknown; type?: unknown; text?: unknown };
      if (record.visibility === 'agent-only') return false;
      if (record.type === 'text') {
        return typeof record.text === 'string' && record.text.trim().length > 0;
      }
      return true;
    });
  });
}

function isSessionUnavailableError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code: unknown }).code === 'fork_source_session_unavailable'
  );
}

function isOwnLiveHiddenFork(thread: SideChatForkCandidate, pluginId: string): boolean {
  return (
    thread.originKind === 'fork'
    && thread.originPluginId === pluginId
    && thread.visibility === 'hidden'
    && thread.archivedAt == null
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export default async function plugin(zcc: ZccPluginApi): Promise<void> {
  zcc.rpc.method('createSideChat', async (raw) => {
    const args = asRecord(raw) ?? {};
    const sourceThreadId = requiredString(args.sourceThreadId);
    if (!sourceThreadId) throw new Error('sourceThreadId is required');
    const sourceSeqEnd = typeof args.sourceSeqEnd === 'number' && Number.isInteger(args.sourceSeqEnd) && args.sourceSeqEnd >= 0
      ? args.sourceSeqEnd
      : undefined;
    const anchorText = typeof args.anchorText === 'string' ? args.anchorText : '';
    const seedText = resolveReplySeedText(anchorText);
    const forkArgs = {
      sourceThreadId,
      visibility: 'hidden' as const,
      workspace: 'reuse' as const,
      ...(seedText !== null
        ? {
            agentContextSeed: [
              {
                type: 'text' as const,
                text: `${REPLY_SEED_PREFIX}${seedText}`,
                mentions: [],
                visibility: 'agent-only' as const
              }
            ]
          }
        : {})
    };
    try {
      const fork = await zcc.sdk.threads.fork({
        ...forkArgs,
        ...(sourceSeqEnd !== undefined ? { sourceSeqEnd } : {})
      });
      return { threadId: fork.id };
    } catch (error) {
      if (sourceSeqEnd === undefined || !isSessionUnavailableError(error)) {
        throw error;
      }
      const fork = await zcc.sdk.threads.fork(forkArgs);
      return { threadId: fork.id };
    }
  });

  zcc.rpc.method('sendToMain', async (raw) => {
    const args = asRecord(raw) ?? {};
    const sourceThreadId = requiredString(args.sourceThreadId);
    const senderThreadId = requiredString(args.senderThreadId);
    const text = requiredString(args.text);
    if (!sourceThreadId) throw new Error('sourceThreadId is required');
    if (!senderThreadId) throw new Error('senderThreadId is required');
    if (!text) throw new Error('text is required');
    await zcc.sdk.threads.queuedMessages.create({
      threadId: sourceThreadId,
      input: [{ type: 'text', text, mentions: [] }],
      senderThreadId
    });
    return { ok: true as const };
  });

  zcc.background.schedule('empty-fork-cleanup', '13 * * * *', async () => {
    const now = Date.now();
    const keptKeys = new Set(await zcc.storage.kv.list(KEPT_FORK_KEY_PREFIX));
    const stillLive = new Set<string>();
    let offset = 0;
    for (;;) {
      const page = await zcc.sdk.threads.list({
        includeHidden: true,
        originKind: 'fork',
        originPluginId: zcc.pluginId,
        archived: false,
        limit: EMPTY_FORK_SWEEP_PAGE_SIZE,
        offset
      });
      if (page.length === 0) break;
      let retained = 0;
      for (const thread of page) {
        if (!isOwnLiveHiddenFork(thread, zcc.pluginId)) {
          retained += 1;
          continue;
        }
        if (now - (thread.createdAt ?? 0) <= EMPTY_FORK_MAX_AGE_MS) {
          retained += 1;
          continue;
        }
        const keptKey = `${KEPT_FORK_KEY_PREFIX}${thread.id}`;
        if (keptKeys.has(keptKey)) {
          stillLive.add(keptKey);
          retained += 1;
          continue;
        }
        const outcome = await sweepEmptyFork(thread.id, thread.createdAt ?? 0);
        if (outcome === 'archived') continue;
        if (outcome === 'kept') {
          await zcc.storage.kv.set(keptKey, true);
          stillLive.add(keptKey);
        }
        retained += 1;
      }
      if (page.length < EMPTY_FORK_SWEEP_PAGE_SIZE) break;
      offset += retained;
    }
    for (const key of keptKeys) {
      if (!stillLive.has(key)) await zcc.storage.kv.delete(key);
    }
  });

  async function sweepEmptyFork(
    threadId: string,
    createdAt: number
  ): Promise<'archived' | 'kept' | 'skipped'> {
    try {
      const events = await zcc.sdk.threads.events.list({ threadId });
      if (eventsContainUserMessage(events)) return 'kept';
    } catch (error) {
      zcc.log.warn(
        `empty-fork sweep skipped ${threadId} (event read failed: ${
          error instanceof Error ? error.message : String(error)
        })`
      );
      return 'skipped';
    }
    try {
      const queued = await zcc.sdk.threads.queuedMessages.list({ threadId });
      if (queued.length > 0) return 'kept';
    } catch (error) {
      zcc.log.warn(
        `empty-fork sweep skipped ${threadId} (queued-message read failed: ${
          error instanceof Error ? error.message : String(error)
        })`
      );
      return 'skipped';
    }
    try {
      await zcc.sdk.threads.archive({ threadId });
      zcc.log.info(
        `empty-fork sweep archived ${threadId} (no user messages, ` +
          `created ${new Date(createdAt).toISOString()})`
      );
      return 'archived';
    } catch (error) {
      zcc.log.warn(
        `empty-fork sweep failed to archive ${threadId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return 'skipped';
    }
  }
}
