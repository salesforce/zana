import { ControlError } from './errors.js';
import type { ProductHttpClient } from './http.js';
import type {
  InteractionPolicy,
  PendingInteraction,
  ThreadRecord,
  ThreadWaitUntil
} from './types.js';

export interface WaitDump {
  thread?: ThreadRecord;
  interactions: PendingInteraction[];
  events: unknown[];
  health?: unknown;
}

export function threadIsQuiet(row: ThreadRecord, until: ThreadWaitUntil): boolean {
  const status = row.status ?? '';
  if (until === 'error') return status === 'error';
  if (until === 'needs_you') return false;
  if (status === 'error') return false;
  if (until === 'idle' || until === 'quiet') {
    if (status !== 'idle') return false;
    if (until === 'idle') return true;
    return (row.activity?.activeBackgroundCommandCount ?? 0) === 0;
  }
  return false;
}

export async function listInteractions(
  http: ProductHttpClient,
  threadId: string
): Promise<PendingInteraction[]> {
  try {
    const data = await http.request<unknown>(
      'GET',
      `/api/v1/threads/${encodeURIComponent(threadId)}/interactions`
    );
    if (Array.isArray(data)) return data as PendingInteraction[];
    if (data && typeof data === 'object' && Array.isArray((data as { interactions?: unknown }).interactions)) {
      return (data as { interactions: PendingInteraction[] }).interactions;
    }
    return [];
  } catch (error) {
    if (error instanceof ControlError && error.code === 'NOT_FOUND') return [];
    throw error;
  }
}

async function resolvePending(
  http: ProductHttpClient,
  threadId: string,
  interactions: PendingInteraction[],
  policy: InteractionPolicy
): Promise<void> {
  const body = policy === 'deny'
    ? { decision: 'deny' as const }
    : { decision: 'allow_once' as const, grantedPermissions: null };
  for (const item of interactions) {
    if (!item.id) continue;
    try {
      await http.request(
        'POST',
        `/api/v1/threads/${encodeURIComponent(threadId)}/interactions/${encodeURIComponent(item.id)}/resolve`,
        { body }
      );
    } catch (error) {
      const prompt = item.prompt ?? item.title ?? item.id;
      throw new ControlError(
        'INTERACTION',
        `thread ${threadId} interaction could not be ${policy === 'deny' ? 'denied' : 'approved'}: ${prompt}`,
        { details: { interaction: item, cause: error instanceof ControlError ? error.message : String(error) } }
      );
    }
  }
}

async function dumpThread(http: ProductHttpClient, threadId: string, thread?: ThreadRecord): Promise<WaitDump> {
  let events: unknown[] = [];
  try {
    const listed = await http.request<{ events?: unknown[] } | unknown[]>(
      'GET',
      `/api/v1/threads/${encodeURIComponent(threadId)}/events`
    );
    events = Array.isArray(listed)
      ? listed
      : Array.isArray((listed as { events?: unknown[] }).events)
        ? (listed as { events: unknown[] }).events
        : [];
  } catch {
    events = [];
  }
  let health: unknown;
  try {
    health = await http.request('GET', '/api/v1/health');
  } catch {
    health = undefined;
  }
  return {
    thread,
    interactions: await listInteractions(http, threadId).catch(() => []),
    events: events.slice(-20),
    health
  };
}

export async function waitForThreadStatus(
  http: ProductHttpClient,
  threadId: string,
  opts: {
    until: ThreadWaitUntil;
    timeoutMs: number;
    onInteraction?: InteractionPolicy;
  }
): Promise<ThreadRecord> {
  const deadline = http.nowMs() + opts.timeoutMs;
  const policy = opts.onInteraction ?? 'fail';
  while (http.nowMs() < deadline) {
    let row: ThreadRecord | undefined;
    try {
      const shown = await http.request<{ thread: ThreadRecord }>(
        'GET',
        `/api/v1/threads/${encodeURIComponent(threadId)}`
      );
      row = shown.thread;
    } catch (error) {
      if (error instanceof ControlError && (error.status ?? 0) >= 500) {
        row = undefined;
      } else {
        throw error;
      }
    }
    if (row?.status === 'error' && opts.until !== 'error') {
      throw new ControlError(
        'UNHEALTHY',
        `thread ${threadId} entered error state`,
        { details: await dumpThread(http, threadId, row) }
      );
    }
    const interactions = await listInteractions(http, threadId);
    if (opts.until === 'needs_you' && interactions.length > 0) {
      return row ?? { id: threadId, status: 'waiting' };
    }
    if (interactions.length > 0 && opts.until !== 'needs_you') {
      if (policy === 'fail') {
        const prompt = interactions.map((item) => item.prompt ?? item.title ?? item.id).join('; ');
        throw new ControlError(
          'INTERACTION',
          `thread ${threadId} is waiting for an interaction: ${prompt}`,
          { details: await dumpThread(http, threadId, row) }
        );
      }
      await resolvePending(http, threadId, interactions, policy);
    }
    if (row && threadIsQuiet(row, opts.until === 'needs_you' ? 'idle' : opts.until)) {
      if (opts.until === 'needs_you') {
        await http.sleep(200);
        continue;
      }
      return row;
    }
    await http.sleep(250);
  }
  const last = await http.request<{ thread: ThreadRecord }>(
    'GET',
    `/api/v1/threads/${encodeURIComponent(threadId)}`
  ).catch(() => null);
  throw new ControlError(
    'TIMEOUT',
    `timed out waiting for thread ${threadId}`,
    { details: await dumpThread(http, threadId, last?.thread) }
  );
}

export async function waitForThreadEvent(
  http: ProductHttpClient,
  threadId: string,
  query: { type: string; afterSeq?: number; waitMs?: number }
): Promise<unknown> {
  try {
    return await http.request(
      'GET',
      `/api/v1/threads/${encodeURIComponent(threadId)}/events/wait`,
      {
        query: {
          type: query.type,
          afterSeq: query.afterSeq !== undefined ? String(query.afterSeq) : undefined,
          waitMs: query.waitMs !== undefined ? String(query.waitMs) : undefined
        }
      }
    );
  } catch (error) {
    if (error instanceof ControlError && (error.status === 404 || error.code === 'NOT_FOUND')) {
      return null;
    }
    throw error;
  }
}
