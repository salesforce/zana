/**
 * Wrap up before closing, for conversation threads (issue #537). When "Close
 * with follow-up" is used with the experiment on, the thread is sent the wrap-up
 * instructions as one more message, and a background job waits for the turn to
 * end. The close request returns at once: a wrap-up can take up to 15 minutes
 * and must not depend on the renderer's request.
 *
 * Same shape as {@link WrapUpCloseService} for CLI agents: every collaborator is
 * injected, one job per thread, every gate is re-checked when a timer fires, and
 * the hub subscription and every timer are released on every path.
 *
 * Rules:
 *  - The job subscribes to thread updates BEFORE it sends, and counts only an
 *    `active` edge seen after the send, once its own queued message has left
 *    the queue: only the turn that message started is the wrap-up.
 *  - A pending interaction before the send means the thread already waits on the
 *    user: nothing is sent, the inbox says so, the thread stays open.
 *  - An offline host, other messages already queued ahead, a send that throws,
 *    or any other failure while starting, falls back to today's close path.
 *  - Before every record and archive the thread is re-read from the store: it
 *    must still be open (not archived or deleted), at rest, not asking, and the
 *    user must not have written since the wrap-up request.
 *  - Outcome after the send, whichever comes first: a pending interaction that
 *    lasts 5 s or a question in the summary (kept open, inbox note), a rest that
 *    lasts 5 s (summary, inbox, archive), the user writing in the thread, even
 *    while the summary is being written (kept open, no record), an error turn
 *    of the wrap-up itself, or 15 minutes (kept open).
 *  - A failed summary still leaves a record (today's last-turn note, else a
 *    one-line note) and archives: a failed courtesy never blocks the close.
 *  - A job that ends before its wrap-up message was sent from the queue removes
 *    that message, so it cannot wrap the agent up later with nobody watching.
 *  - A thread archived or deleted by someone else ends the job with no record.
 *  - The hub listener catches everything and never throws.
 */

import { getConversationThread, listDeferredThreadMessages } from '@zana-ai/zcc-db';
import { CLOSE_WRAP_UP_TIMEOUT_MINUTES, resolveCloseWrapUpInstructions } from '@zana-ai/zcc-domain/product';
import type { ProductHttpContext } from '../../http/product-context.js';
import type { CloseRecordHow, KeptOpenReason, SessionCloseNote, SummarizeForCloseResult } from '../followups/close-summary.js';
import { conversationDigest } from './conversation-digest.js';
import { dropDeferredConversationMessage, parseDeferredSendPayload } from './conversation-deferred-messages.js';
import { archiveConversation, sendConversationTurn } from './conversation-lifecycle.js';
import { conversationMessageTexts } from './conversation-timeline.js';

/** A rest or a pending interaction must last this long before it counts. */
export const WRAP_UP_SETTLE_MS = 5_000;
/** A thread still busy this long after the request is left running. */
export const WRAP_UP_TIMEOUT_MS = CLOSE_WRAP_UP_TIMEOUT_MINUTES * 60_000;

/** The slice of the `threads:updated` payload the job reads. */
interface ThreadUpdate {
  id?: string;
  status?: string;
  hasPendingInteraction?: boolean;
  archivedAt?: number | null;
}

/** How a close request starts: `fallback` means today's close path must run instead. */
export type ThreadWrapUpStart = 'wrapping-up' | 'kept-open' | 'fallback';

export interface ThreadWrapUpHost {
  instructions: () => string;
  hasPendingInteraction: (threadId: string) => boolean;
  hostOnline: (thread: ThreadWrapUpTarget) => boolean;
  getStatus: (threadId: string) => string | undefined;
  send: (threadId: string, text: string) => Promise<unknown>;
  subscribe: (listener: (payload: unknown) => void) => () => void;
  messages: (threadId: string) => Array<{ seq: number; role: 'user' | 'assistant'; text: string }>;
  digest: (threadId: string) => string;
  summarizeForClose: (projectId: string, threadId: string, opts: { digest: string; title: string }) => Promise<SummarizeForCloseResult>;
  recordClose: (projectId: string, threadId: string, title: string, note: SessionCloseNote, how: CloseRecordHow) => Promise<unknown>;
  recordKeptOpen: (projectId: string, threadId: string, title: string, reason: KeptOpenReason, note?: SessionCloseNote) => Promise<unknown>;
  /** Today's last-turn record, for when the whole-thread summary failed. */
  recordLastTurn: (projectId: string, threadId: string, title: string, lastTurn: string) => Promise<{ summarized: number }>;
  /** The thread's queued sends, oldest first: `queued`, then `dispatching` while being sent, or `failed`. */
  queuedSends: (threadId: string) => Array<{ id: string; text?: string; status: string }>;
  dropQueuedSend: (threadId: string, id: string) => void;
  /** The thread still exists and is not archived (read from the store, not from an update). */
  isOpen: (threadId: string) => boolean;
  archive: (threadId: string) => Promise<unknown>;
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer: (handle: NodeJS.Timeout) => void;
  log: (line: string) => void;
}

export interface ThreadWrapUpTarget {
  id: string;
  projectId: string;
  hostId: string;
  title?: string | null;
}

const isActive = (status: string | undefined) => status === 'active' || status === 'starting';

class Job {
  private unsubscribe: (() => void) | undefined;
  private rest: NodeJS.Timeout | undefined;
  private block: NodeJS.Timeout | undefined;
  private timeout: NodeJS.Timeout | undefined;
  private armed = false;
  private sent = false;
  /** Our own queued row, when the send was queued behind a running turn; undefined when it went straight in. */
  private ownRowId: string | undefined;
  private needIdle = false;
  private edge = false;
  private done = false;
  private seqBeforeSend = 0;
  private readonly title: string;
  private readonly instructions: string;

  constructor(
    private readonly host: ThreadWrapUpHost,
    private readonly thread: ThreadWrapUpTarget,
    private readonly onDone: () => void
  ) {
    this.title = thread.title?.trim() || 'Untitled agent';
    this.instructions = host.instructions();
  }

  async start(): Promise<ThreadWrapUpStart> {
    const { host, thread } = this;
    try {
      if (host.hasPendingInteraction(thread.id)) {
        await this.keepOpen('asks-you');
        return 'kept-open';
      }
      // Offline host, or other messages already queued ahead: the next turn would not be the wrap-up's.
      if (!host.hostOnline(thread) || host.queuedSends(thread.id).length > 0) {
        this.finish();
        return 'fallback';
      }
      this.unsubscribe = host.subscribe((payload) => this.onUpdate(payload));
      this.timeout = host.setTimer(() => void this.keepOpen('timeout'), WRAP_UP_TIMEOUT_MS);
      this.seqBeforeSend = Math.max(0, ...host.messages(thread.id).map((m) => m.seq));
      this.needIdle = isActive(host.getStatus(thread.id));
      this.armed = true;
      this.sent = true;
      await host.send(thread.id, this.instructions);
    } catch (err) {
      host.log(`[thread-wrap-up] thread=${thread.id.slice(0, 8)} could not start: ${err instanceof Error ? err.message : String(err)}`);
      this.finish();
      return 'fallback';
    }
    // The message is sent: from here on a failure is logged, never a fallback (that would archive mid wrap-up).
    try {
      // Nothing was queued before ours, so a queued row with our text is our own message: track it by id.
      this.ownRowId = host.queuedSends(thread.id).find((row) => row.text === this.instructions.trim())?.id;
      // Re-read once: an update during the send was judged before our row was known.
      this.onUpdate({ id: thread.id, status: host.getStatus(thread.id), hasPendingInteraction: host.hasPendingInteraction(thread.id) });
    } catch (err) {
      host.log(`[thread-wrap-up] thread=${thread.id.slice(0, 8)} could not re-read after the send: ${err instanceof Error ? err.message : String(err)}`);
    }
    return 'wrapping-up';
  }

  dispose(): void {
    this.finish();
  }

  private onUpdate(payload: unknown): void {
    try {
      const view = payload as ThreadUpdate | null;
      if (this.done || !this.armed || !view || view.id !== this.thread.id) return;
      if (view.archivedAt != null) return this.finish(); // someone else archived it: nothing left to do
      if (view.status === 'error') {
        // Our own turn failed: it began, or our queued row has been taken out of the queue to be sent.
        if (this.edge || this.ownRowLeftQueue()) {
          void this.keepOpen('turn-error');
          return;
        }
        // The turn our row is queued behind failed: the queue drains only on idle, so it would never run.
        if (this.needIdle && this.wrapUpStillQueued()) {
          void this.closeAfterQueuedError();
          return;
        }
        // Otherwise it is an error left over from before the send.
      }
      this.watchPending(view.hasPendingInteraction === true);
      if (!this.edge) {
        if (this.needIdle) this.needIdle = isActive(view.status);
        // Only the turn our own message started counts: while it is still queued, this is someone else's turn.
        else if (view.status === 'active' && !this.wrapUpStillQueued()) this.edge = true;
        return;
      }
      if (view.status === 'idle' && view.hasPendingInteraction !== true) {
        this.rest ??= this.host.setTimer(() => void this.onRest(), WRAP_UP_SETTLE_MS);
      } else {
        this.clear('rest');
      }
    } catch (err) {
      this.host.log(`[thread-wrap-up] listener failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private watchPending(pending: boolean): void {
    if (!pending) return this.clear('block');
    this.block ??= this.host.setTimer(() => void this.onBlocked(), WRAP_UP_SETTLE_MS);
  }

  private clear(which: 'rest' | 'block'): void {
    const handle = this[which];
    if (handle) this.host.clearTimer(handle);
    this[which] = undefined;
  }

  /** The rest lasted: re-check, then summarise and close (or keep open). A throw ends the job, never leaves it stuck. */
  private async onRest(): Promise<void> {
    this.rest = undefined;
    try {
      await this.closeAfterRest();
    } catch (err) {
      this.host.log(`[thread-wrap-up] thread=${this.thread.id.slice(0, 8)} close failed: ${err instanceof Error ? err.message : String(err)}`);
      this.finish();
    }
  }

  private async closeAfterRest(): Promise<void> {
    const { host, thread } = this;
    if (this.done || host.getStatus(thread.id) !== 'idle' || host.hasPendingInteraction(thread.id)) return;
    if (host.queuedSends(thread.id).length > 0) return; // more queued work runs first; archiving would delete it
    if (this.userWroteAfterWrapUp()) return this.finish(); // the user took over: keep it open, no record
    this.stop();
    const note = await this.summarize();
    // The summary takes a while: the user may have written meanwhile, or the job may have been disposed.
    if (!this.stillResting()) return this.finish();
    if (note?.asksUser) {
      await host.recordKeptOpen(thread.projectId, thread.id, this.title, 'asks-you', note);
    } else {
      if (note) await host.recordClose(thread.projectId, thread.id, this.title, note, 'wrapped');
      else await this.recordWithoutSummary();
      if (!this.stillResting()) return this.finish();
      await host.archive(thread.id);
    }
    this.finish();
  }

  /** The turn the wrap-up was queued behind failed: drop the queued wrap-up and close the way today's path does. */
  private async closeAfterQueuedError(): Promise<void> {
    const { host, thread } = this;
    this.stop();
    try {
      this.dropUnsentWrapUp();
      if (!this.closableAfterError()) return this.finish();
      const lastTurn = this.lastAssistantText();
      if (lastTurn) await host.recordLastTurn(thread.projectId, thread.id, this.title, lastTurn);
      // The record write takes a moment: re-check before the archive, the person may have written meanwhile.
      if (!this.closableAfterError()) return this.finish();
      await host.archive(thread.id);
    } catch (err) {
      host.log(`[thread-wrap-up] thread=${thread.id.slice(0, 8)} close after the earlier error failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.finish();
  }

  /** Still ours to close after the earlier error: open, not running or asking, and the user has not written. */
  private closableAfterError(): boolean {
    const { host, thread } = this;
    return (
      host.isOpen(thread.id) &&
      !isActive(host.getStatus(thread.id)) &&
      !host.hasPendingInteraction(thread.id) &&
      host.queuedSends(thread.id).length === 0 &&
      !host.messages(thread.id).some((m) => m.role === 'user' && m.seq > this.seqBeforeSend)
    );
  }

  /** Our own queued row, if it still exists. */
  private ownRow(): { id: string; status: string } | undefined {
    return this.ownRowId ? this.host.queuedSends(this.thread.id).find((row) => row.id === this.ownRowId) : undefined;
  }

  /** Our own wrap-up message is still waiting in the thread's queue. */
  private wrapUpStillQueued(): boolean {
    return this.ownRow()?.status === 'queued';
  }

  /** Our own queued message has been taken out of the queue: being sent, sent, or failed. */
  private ownRowLeftQueue(): boolean {
    return this.ownRowId !== undefined && !this.wrapUpStillQueued();
  }

  private lastAssistantText(): string {
    return [...this.host.messages(this.thread.id)].reverse().find((m) => m.role === 'assistant' && m.text.trim())?.text.trim() ?? '';
  }

  /** Still ours to close: not disposed or archived, resting, nothing pending, and the user has not written. */
  private stillResting(): boolean {
    const { host, thread } = this;
    return (
      !this.done &&
      host.isOpen(thread.id) &&
      host.getStatus(thread.id) === 'idle' &&
      !host.hasPendingInteraction(thread.id) &&
      host.queuedSends(thread.id).length === 0 &&
      !this.userWroteAfterWrapUp()
    );
  }

  /** The whole-thread summary failed: still leave a record, from today's last-turn note or a one-line note. */
  private async recordWithoutSummary(): Promise<void> {
    const { host, thread } = this;
    const lastTurn = this.lastAssistantText();
    if (lastTurn) {
      const paper = await host.recordLastTurn(thread.projectId, thread.id, this.title, lastTurn);
      if (paper.summarized > 0) return;
    }
    await host.recordClose(
      thread.projectId,
      thread.id,
      this.title,
      { body: 'The summary could not be written.', unfinished: false, asksUser: false },
      'wrapped'
    );
  }

  /** The thread waits on the user: record what we know and keep it open. */
  private async onBlocked(): Promise<void> {
    this.block = undefined;
    try {
      if (this.done || !this.host.hasPendingInteraction(this.thread.id)) return;
      this.stop();
      const note = await this.summarize();
      // Answered while the summary ran: the thread is the person's again, so write nothing.
      if (this.done || !this.host.isOpen(this.thread.id) || !this.host.hasPendingInteraction(this.thread.id)) return this.finish();
      await this.keepOpen('asks-you', note);
    } catch (err) {
      this.host.log(`[thread-wrap-up] thread=${this.thread.id.slice(0, 8)} could not record the question: ${err instanceof Error ? err.message : String(err)}`);
      this.finish();
    }
  }

  private userWroteAfterWrapUp(): boolean {
    // The first user message after the send is the wrap-up itself, however the provider stored its text.
    return this.host.messages(this.thread.id).filter((m) => m.role === 'user' && m.seq > this.seqBeforeSend).length > 1;
  }

  /** Summary of the whole thread, or undefined when it failed (the close goes on without it). */
  private async summarize(): Promise<SessionCloseNote | undefined> {
    try {
      const res = await this.host.summarizeForClose(this.thread.projectId, this.thread.id, {
        digest: this.host.digest(this.thread.id),
        title: this.title
      });
      return res.ok ? res.note : undefined;
    } catch (err) {
      this.host.log(`[thread-wrap-up] summary failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  /** Stop watching: the outcome is being written. */
  private stop(): void {
    this.armed = false;
    this.clear('rest');
    this.clear('block');
    if (this.timeout) this.host.clearTimer(this.timeout);
    this.timeout = undefined;
  }

  private async keepOpen(reason: KeptOpenReason, note?: SessionCloseNote): Promise<void> {
    if (this.done) return;
    this.stop();
    if (!this.host.isOpen(this.thread.id)) return this.finish(); // deleted or archived meanwhile
    try {
      await this.host.recordKeptOpen(this.thread.projectId, this.thread.id, this.title, reason, note);
    } catch (err) {
      this.host.log(`[thread-wrap-up] thread=${this.thread.id.slice(0, 8)} record failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.finish();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.stop();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.dropUnsentWrapUp();
    this.onDone();
  }

  /** Ended before the wrap-up turn began: take its message out of the queue, so it is not sent later with nobody watching. */
  private dropUnsentWrapUp(): void {
    if (!this.sent || this.edge || !this.ownRowId) return;
    try {
      // Only our own row, by id: a person's message with the same text is never touched. A row being sent is left alone.
      const row = this.ownRow();
      if (row && row.status !== 'dispatching') this.host.dropQueuedSend(this.thread.id, row.id);
    } catch (err) {
      this.host.log(`[thread-wrap-up] thread=${this.thread.id.slice(0, 8)} could not drop the queued wrap-up: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** One wrap-up job per thread id. */
export class ThreadWrapUpRegistry {
  private jobs = new Map<string, { job: Job; start: Promise<ThreadWrapUpStart> }>();

  constructor(private readonly host: ThreadWrapUpHost) {}

  isWrappingUp(threadId: string): boolean {
    return this.jobs.has(threadId);
  }

  /**
   * Start the wrap-up, or join the one already running (nothing is sent twice).
   * Resolves `fallback` when the caller must use today's close path, and
   * `kept-open` when the thread already waits on the user and was left open.
   * A joiner gets the first request's answer, except `fallback`: the first
   * caller already runs today's close, so the joiner reports `wrapping-up`.
   */
  async request(thread: ThreadWrapUpTarget): Promise<ThreadWrapUpStart> {
    const running = this.jobs.get(thread.id);
    if (running) {
      const first = await running.start;
      return first === 'fallback' ? 'wrapping-up' : first;
    }
    let job: Job | undefined;
    try {
      const created = new Job(this.host, thread, () => {
        if (this.jobs.get(thread.id)?.job === created) this.jobs.delete(thread.id);
      });
      job = created;
      // Registered before start() runs, so a synchronous finish inside it removes the entry again.
      const entry = { job: created, start: Promise.resolve<ThreadWrapUpStart>('wrapping-up') };
      this.jobs.set(thread.id, entry);
      entry.start = created.start();
      return await entry.start;
    } catch (err) {
      this.host.log(`[thread-wrap-up] thread=${thread.id.slice(0, 8)} request failed: ${err instanceof Error ? err.message : String(err)}`);
      job?.dispose();
      return 'fallback';
    }
  }

  dispose(): void {
    for (const { job } of [...this.jobs.values()]) job.dispose();
  }
}

/** The text of a queued send, or undefined for anything that is not a plain text send. */
export function deferredText(row: Parameters<typeof parseDeferredSendPayload>[0]): string | undefined {
  try {
    const input = parseDeferredSendPayload(row).input;
    if (!Array.isArray(input)) return undefined;
    return input.flatMap((part: { type?: string; text?: string }) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])).join('\n').trim();
  } catch {
    return undefined;
  }
}

const registries = new WeakMap<ProductHttpContext, ThreadWrapUpRegistry>();

/** The per-server registry, wired to the real thread, hub and close-summary services. */
export function threadWrapUps(ctx: ProductHttpContext): ThreadWrapUpRegistry {
  let registry = registries.get(ctx);
  if (!registry) {
    registry = new ThreadWrapUpRegistry({
      instructions: () => resolveCloseWrapUpInstructions(ctx.config.getConfig()),
      hasPendingInteraction: (id) => ctx.pendingInteractions.hasPendingThreadInteraction(id),
      hostOnline: (thread) => ctx.hostHub.connectedHostIds?.().includes(thread.hostId) === true,
      getStatus: (id) => getConversationThread(ctx.db, id)?.status,
      send: (id, text) => sendConversationTurn(ctx, id, [{ type: 'text', text, mentions: [] }], 'queue-if-active'),
      subscribe: (listener) => ctx.hub.subscribe('threads:updated', listener),
      messages: (id) => conversationMessageTexts(ctx, id),
      digest: (id) => conversationDigest(ctx, id),
      summarizeForClose: (projectId, id, opts) => ctx.closeSummary.summarizeForClose(projectId, id, opts),
      recordClose: (...args) => ctx.closeSummary.recordClose(...args),
      recordKeptOpen: (...args) => ctx.closeSummary.recordKeptOpen(...args),
      recordLastTurn: (projectId, id, title, lastTurn) =>
        ctx.closeSummary.summarizeAndFollowUpFromLastTurn(projectId, { sessionId: id, title, lastTurn }),
      queuedSends: (id) =>
        listDeferredThreadMessages(ctx.db, id).map((row) => ({ id: row.id, text: deferredText(row), status: row.status })),
      dropQueuedSend: (id, itemId) => dropDeferredConversationMessage(ctx, id, itemId),
      isOpen: (id) => {
        const row = getConversationThread(ctx.db, id);
        return !!row && row.archivedAt == null;
      },
      archive: (id) => archiveConversation(ctx, id),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle),
      log: (line) => console.warn(line)
    });
    registries.set(ctx, registry);
  }
  return registry;
}

/** Release every job's subscription and timers; called from `ctx.dispose`. */
export function disposeThreadWrapUps(ctx: ProductHttpContext): void {
  registries.get(ctx)?.dispose();
  registries.delete(ctx);
}
