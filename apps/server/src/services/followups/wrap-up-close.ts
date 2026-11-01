/**
 * Wrap up before closing (issue #537) — when the user closes CLI agents with
 * "Close with follow-up" and the experiment is on, ask each resting local
 * Claude agent to summarise, self-learn and tidy up first, then write the inbox
 * record from the whole session and let the renderer close it.
 *
 * Same shape as {@link ApiErrorResumeService}: every collaborator is injected
 * (no Electron, timers via deps) and every gate is re-checked when a timer fires,
 * because the agent may have moved on during the wait.
 *
 * Safety:
 *  - Types only into a RESTING, local, Claude-family agent with no half-typed
 *    draft, never into a permission prompt (`blocked`) or while it works, and
 *    only ONE line (a TUI without bracketed paste submits each line).
 *  - Yields to the human: if `lastKeyInputAt` (real keys only, not mouse or
 *    focus reports) moved since the click, at any point until the record is written, the person typed, so we stop and keep
 *    the agent open. `reply()` never stamps it.
 *  - Every other session with a transcript (Codex, OpenCode, remote Claude, an
 *    agent at a prompt) is not typed into; it gets a record without a wrap-up.
 *  - A question or an unanswered prompt keeps the agent open; a failed summary
 *    never blocks the close the user asked for.
 *  - Every timer and pending entry is released on every path (Rule 3).
 */

import { CLOSE_WRAP_UP_TIMEOUT_MINUTES, isRestfulAgentState, type AgentState, type CloseFollowupFailure, type CloseFollowupKeptOpen } from '@zana-ai/zcc-domain/product';
import type {
  CloseRecordHow,
  CloseSummaryFailure,
  KeptOpenReason,
  SessionCloseNote,
  SummarizeForCloseResult
} from './close-summary.js';

/** A rest (or a block) must last this long before the turn counts as finished. */
export const SETTLE_MS = 5_000;
/** An agent still busy this long after the click is left running. */
export const TURN_TIMEOUT_MS = CLOSE_WRAP_UP_TIMEOUT_MINUTES * 60_000;
/** Summary calls in flight across the whole service. */
export const MAX_CONCURRENT_SUMMARIES = 5;
/**
 * Wrap-up turns running at once across the whole service. Every agent is
 * registered at the click (so typing, auto-close-idle and heartbeat already
 * see it); the rest wait in `queued` and are typed into as a slot frees.
 */
export const MAX_ACTIVE_WRAP_UPS = 4;

/** Collapse every whitespace run, newlines included, to one space: one line for a TUI prompt. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export interface WrapUpSession {
  projectId: string;
  profile: string;
  status: string;
  title: string;
  lastKeyInputAt?: number;
  draftPending?: boolean;
  /** A session whose harness runs on a remote host (no Stop hook, never typed into). */
  remote: boolean;
}

export interface WrapUpCloseDeps {
  /** The live instruction text (Settings value or the default). */
  getInstructions: () => string;
  getSession: (sessionId: string) => WrapUpSession | null;
  hasTranscript: (profile: string) => boolean;
  /** True for Claude-family profiles: the only ones that are typed into. */
  isTypeable: (profile: string) => boolean;
  getAgentState: (sessionId: string) => string;
  /** Type a line into the session (body + deferred CR). Returns false if gone. */
  reply: (sessionId: string, text: string) => boolean;
  markNeedsYou: (sessionId: string) => void;
  summarizeForClose: (projectId: string, sessionId: string) => Promise<SummarizeForCloseResult>;
  recordClose: (
    projectId: string,
    sessionId: string,
    title: string,
    note: SessionCloseNote,
    how: CloseRecordHow
  ) => Promise<{ summarized: 0 | 1; followedUp: 0 | 1; failures?: CloseSummaryFailure[] }>;
  recordKeptOpen: (
    projectId: string,
    sessionId: string,
    title: string,
    reason: KeptOpenReason,
    note?: SessionCloseNote
  ) => Promise<{ recorded: 0 | 1; failures?: CloseSummaryFailure[] }>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer: (handle: NodeJS.Timeout) => void;
  log: (line: string) => void;
}

export interface WrapUpCloseResult {
  summarized: number;
  followedUp: number;
  failures?: CloseFollowupFailure[];
  /** Agents that must stay open; absent ids (gone, skipped, closeable) are closed by the renderer. */
  keptOpen: CloseFollowupKeptOpen[];
}

interface Outcome {
  summarized: number;
  followedUp: number;
  failures: CloseSummaryFailure[];
  keptOpen?: CloseFollowupKeptOpen['reason'];
}

const EMPTY: Outcome = { summarized: 0, followedUp: 0, failures: [] };

/** `queued`: waiting for a wrap-up slot. `pre`: waiting for a working agent to rest. `sent`: typed, waiting for it to start. `active`: working on the wrap-up. `finishing`: summarising. */
type Phase = 'queued' | 'pre' | 'sent' | 'active' | 'finishing';

interface Active {
  projectId: string;
  phase: Phase;
  /** `lastKeyInputAt` when the click came; any change after it means a person typed. */
  keyAtClick: number | undefined;
  settle?: { timer: NodeJS.Timeout; kind: 'rest' | 'blocked' };
  timeout?: NodeJS.Timeout;
  settleOutcome: (outcome: Outcome) => void;
  promise: Promise<Outcome>;
  startedAt: number;
  /** Holds one of the {@link MAX_ACTIVE_WRAP_UPS} slots. */
  slot?: boolean;
}

export class WrapUpCloseService {
  private active = new Map<string, Active>();
  private summariesInFlight = 0;
  private summaryWaiters: Array<() => void> = [];
  private slotsInUse = 0;
  private waiting: Array<{ sessionId: string; entry: Active }> = [];

  constructor(private readonly deps: WrapUpCloseDeps) {}

  /** True from the click until the outcome: auto-close-idle must not close the agent meanwhile. */
  isWrappingUp(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  async run(projectId: string, sessionIds: string[]): Promise<WrapUpCloseResult> {
    const ids = [...new Set(sessionIds)];
    const outcomes = await Promise.all(ids.map((id) => this.wrapUp(projectId, id)));
    const result: WrapUpCloseResult = { summarized: 0, followedUp: 0, keptOpen: [] };
    const failures: CloseSummaryFailure[] = [];
    ids.forEach((sessionId, i) => {
      const o = outcomes[i];
      result.summarized += o.summarized;
      result.followedUp += o.followedUp;
      failures.push(...o.failures);
      if (o.keptOpen) result.keptOpen.push({ sessionId, reason: o.keptOpen });
    });
    if (failures.length) result.failures = failures;
    return result;
  }

  /** Feed every agent status change; drives the wrap-up of sessions in `run`. */
  observe(sessionId: string, state: AgentState | string): void {
    const entry = this.active.get(sessionId);
    if (!entry || entry.phase === 'finishing') return;
    const { deps } = this;
    const session = deps.getSession(sessionId);
    if (!session) return this.finish(sessionId, entry, EMPTY);
    if (session.lastKeyInputAt !== entry.keyAtClick) return this.finish(sessionId, entry, { ...EMPTY, keptOpen: 'typed' });
    if (entry.phase === 'queued') return; // nothing typed yet; it waits for a slot
    if (entry.phase === 'pre') {
      if (state === 'blocked') void this.settleAfter(sessionId, entry, this.summaryOutcome(sessionId, entry, 'waiting-on-prompt'));
      else if (isRestfulAgentState(state as AgentState)) this.send(sessionId, entry);
      return;
    }
    if (entry.phase === 'sent') {
      // The turn began: it shows as working, or goes straight to a prompt (the debounced status can skip "working").
      if (state !== 'working' && state !== 'blocked') return;
      entry.phase = 'active';
      if (state === 'working') return;
    }
    // active: a rest or a block must last SETTLE_MS; anything else restarts the wait.
    const kind = state === 'blocked' ? 'blocked' : isRestfulAgentState(state as AgentState) ? 'rest' : null;
    if (entry.settle && entry.settle.kind === kind) return;
    this.clearSettle(entry);
    if (kind) {
      entry.settle = { kind, timer: deps.setTimer(() => this.onSettle(sessionId, entry, kind), SETTLE_MS) };
    }
  }

  /** The pty exited: resolve that session as gone and release its timers. */
  forget(sessionId: string): void {
    const entry = this.active.get(sessionId);
    if (entry && entry.phase !== 'finishing') this.finish(sessionId, entry, EMPTY);
  }

  /** Claude's UserPromptSubmit hook: the wrap-up turn began, even if the debounced status never showed "working". */
  onTurnStarted(sessionId: string): void {
    const entry = this.active.get(sessionId);
    if (entry?.phase === 'sent') entry.phase = 'active';
  }

  /**
   * Claude's Stop hook: the turn ended. Settle on the current state, so a turn
   * that started and ended inside one status debounce still finishes. A Stop
   * before the wrap-up turn began (a late one from an earlier turn) is ignored.
   */
  onTurnFinished(sessionId: string): void {
    const entry = this.active.get(sessionId);
    if (entry?.phase !== 'active') return;
    this.observe(sessionId, this.deps.getAgentState(sessionId));
  }

  /**
   * Claude's StopFailure (an API error ended the turn): the wrap-up did not
   * finish, so the agent stays open and the inbox says the turn failed.
   */
  onTurnFailed(sessionId: string): void {
    const entry = this.active.get(sessionId);
    if (entry?.phase !== 'sent' && entry?.phase !== 'active') return;
    void this.settleAfter(sessionId, entry, this.turnErrorOutcome(sessionId, entry));
  }

  private wrapUp(projectId: string, sessionId: string): Promise<Outcome> {
    const existing = this.active.get(sessionId);
    // Already wrapping up: do not type again, await the same outcome (counted once).
    if (existing) return existing.promise.then((o) => ({ ...EMPTY, keptOpen: o.keptOpen }));
    const { deps } = this;
    const session = deps.getSession(sessionId);
    if (!session || session.projectId !== projectId || session.status === 'exited' || !deps.hasTranscript(session.profile)) {
      return Promise.resolve(EMPTY);
    }
    let settleOutcome!: (outcome: Outcome) => void;
    const promise = new Promise<Outcome>((resolve) => { settleOutcome = resolve; });
    const entry: Active = { projectId, phase: 'queued', keyAtClick: session.lastKeyInputAt, settleOutcome, promise, startedAt: deps.now() };
    // Registered at the click, before any slot is free: typing is measured from here, and
    // auto-close-idle and heartbeat already leave the agent alone (isWrappingUp).
    this.active.set(sessionId, entry);
    this.dispatch(sessionId, entry);
    return promise;
  }

  /** Decide what a registered session does now: a record without a wrap-up, a wrap-up turn, or wait for a slot. */
  private dispatch(sessionId: string, entry: Active): void {
    const { deps } = this;
    const session = deps.getSession(sessionId);
    if (!session) return this.finish(sessionId, entry, EMPTY);
    const state = deps.getAgentState(sessionId);
    if (!deps.isTypeable(session.profile) || session.remote || state === 'unknown') {
      void this.settleAfter(sessionId, entry, this.summaryOutcome(sessionId, entry, 'no-wrap-up'));
    } else if (state === 'blocked') {
      void this.settleAfter(sessionId, entry, this.summaryOutcome(sessionId, entry, 'waiting-on-prompt'));
    } else if (this.slotsInUse < MAX_ACTIVE_WRAP_UPS) {
      this.slotsInUse++;
      entry.slot = true;
      entry.phase = 'pre';
      entry.timeout = deps.setTimer(() => this.onTimeout(sessionId, entry), TURN_TIMEOUT_MS);
      if (isRestfulAgentState(state as AgentState)) this.send(sessionId, entry);
      // working: wait in `pre` until it rests (observe)
    } else {
      this.waiting.push({ sessionId, entry });
    }
  }

  /** A slot freed: start the next waiting wrap-up that is still registered. */
  private startWaiting(): void {
    while (this.slotsInUse < MAX_ACTIVE_WRAP_UPS && this.waiting.length > 0) {
      const { sessionId, entry } = this.waiting.shift()!;
      if (this.active.get(sessionId) === entry && entry.phase === 'queued') this.dispatch(sessionId, entry);
    }
  }

  /** Type the instructions into a resting agent, once, unless a draft or a key press says a person is there. */
  private send(sessionId: string, entry: Active): void {
    const { deps } = this;
    const session = deps.getSession(sessionId);
    if (!session) return this.finish(sessionId, entry, EMPTY);
    if (session.draftPending || session.lastKeyInputAt !== entry.keyAtClick) {
      return this.finish(sessionId, entry, { ...EMPTY, keptOpen: 'typed' });
    }
    if (!deps.reply(sessionId, oneLine(deps.getInstructions()))) {
      deps.log(`[wrap-up-close] session=${sessionId.slice(0, 8)} skip: reply failed`);
      return this.finish(sessionId, entry, EMPTY);
    }
    entry.phase = 'sent';
  }

  /** A rest or block lasted SETTLE_MS: re-check every gate, then summarise and record. */
  private onSettle(sessionId: string, entry: Active, kind: 'rest' | 'blocked'): void {
    entry.settle = undefined;
    if (this.active.get(sessionId) !== entry || entry.phase !== 'active') return;
    const { deps } = this;
    const state = deps.getAgentState(sessionId);
    const still = kind === 'blocked' ? state === 'blocked' : isRestfulAgentState(state as AgentState);
    if (!still) return;
    const session = deps.getSession(sessionId);
    if (!session) return this.finish(sessionId, entry, EMPTY);
    if (session.lastKeyInputAt !== entry.keyAtClick) return this.finish(sessionId, entry, { ...EMPTY, keptOpen: 'typed' });
    void this.settleAfter(sessionId, entry, kind === 'rest' ? this.restEndOutcome(sessionId, entry) : this.blockEndOutcome(sessionId, entry));
  }

  private onTimeout(sessionId: string, entry: Active): void {
    entry.timeout = undefined;
    if (this.active.get(sessionId) !== entry || entry.phase === 'finishing') return;
    void this.settleAfter(sessionId, entry, this.timeoutOutcome(sessionId, entry));
  }

  /** Run `work` as the final step: stop the timers, mark `finishing`, then resolve with its outcome. */
  private async settleAfter(sessionId: string, entry: Active, work: Promise<Outcome>): Promise<void> {
    entry.phase = 'finishing';
    this.clearTimers(entry);
    let outcome = EMPTY;
    try {
      outcome = await work;
    } catch (err) {
      this.deps.log(`[wrap-up-close] session=${sessionId.slice(0, 8)} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.finish(sessionId, entry, outcome);
  }

  private finish(sessionId: string, entry: Active, outcome: Outcome): void {
    this.clearTimers(entry);
    if (this.active.get(sessionId) === entry) this.active.delete(sessionId);
    if (entry.phase === 'queued') this.waiting = this.waiting.filter((w) => w.entry !== entry);
    if (entry.slot) {
      entry.slot = false;
      this.slotsInUse--;
      this.startWaiting();
    }
    this.deps.log(`[wrap-up-close] session=${sessionId.slice(0, 8)} done after ${Math.round((this.deps.now() - entry.startedAt) / 1000)}s${outcome.keptOpen ? ` kept open: ${outcome.keptOpen}` : ''}`);
    entry.settleOutcome(outcome);
  }

  private clearSettle(entry: Active): void {
    if (!entry.settle) return;
    this.deps.clearTimer(entry.settle.timer);
    entry.settle = undefined;
  }

  private clearTimers(entry: Active): void {
    this.clearSettle(entry);
    if (entry.timeout) this.deps.clearTimer(entry.timeout);
    entry.timeout = undefined;
  }

  /** Summarise a session that is not typed into and record it as closed without a wrap-up. */
  private async summaryOutcome(sessionId: string, entry: Active, how: 'waiting-on-prompt' | 'no-wrap-up'): Promise<Outcome> {
    // A forced close may start on an agent that is already working: only a change into working is new work.
    const before = this.deps.getAgentState(sessionId);
    const res = await this.summarize(entry.projectId, sessionId);
    // A key press during the summary (for example answering the prompt) means a person took over.
    if (this.keysMoved(sessionId, entry)) return { ...EMPTY, keptOpen: 'typed' };
    if (!res.ok) return this.failed(res.reason);
    const written = this.closed(await this.deps.recordClose(entry.projectId, sessionId, res.title, res.note, how));
    // The record write takes a moment too: a key press or new work since then keeps the agent open.
    const now = this.deps.getAgentState(sessionId);
    return this.keysMoved(sessionId, entry) || (before !== 'working' && now === 'working') ? { ...written, keptOpen: 'typed' } : written;
  }

  private async restEndOutcome(sessionId: string, entry: Active): Promise<Outcome> {
    const res = await this.summarize(entry.projectId, sessionId);
    // The summary can take a minute; a person who typed meanwhile has taken over, so write nothing and keep the agent.
    if (this.tookOver(sessionId, entry)) return { ...EMPTY, keptOpen: 'typed' };
    if (!res.ok) return this.failed(res.reason);
    if (res.note.asksUser) {
      this.deps.markNeedsYou(sessionId);
      return this.kept(await this.deps.recordKeptOpen(entry.projectId, sessionId, res.title, 'asks-you', res.note), 'asks-you');
    }
    const written = this.closed(await this.deps.recordClose(entry.projectId, sessionId, res.title, res.note, 'wrapped'));
    // The record write takes a moment too: a key press or new work since then keeps the agent open.
    return this.tookOver(sessionId, entry) ? { ...written, keptOpen: 'typed' } : written;
  }

  /** A key was pressed since the click. */
  private keysMoved(sessionId: string, entry: Active): boolean {
    const session = this.deps.getSession(sessionId);
    return !!session && session.lastKeyInputAt !== entry.keyAtClick;
  }

  /** A key was pressed since the click, or the agent is no longer resting: it is no longer ours to close. */
  private tookOver(sessionId: string, entry: Active): boolean {
    const session = this.deps.getSession(sessionId);
    if (!session) return false;
    return session.lastKeyInputAt !== entry.keyAtClick || !isRestfulAgentState(this.deps.getAgentState(sessionId) as AgentState);
  }

  /** The agent stopped on a prompt or a question: record what we know and keep it open. */
  private async blockEndOutcome(sessionId: string, entry: Active): Promise<Outcome> {
    const res = await this.summarize(entry.projectId, sessionId);
    if (!res.ok && res.reason === 'ineligible') return EMPTY;
    const session = this.deps.getSession(sessionId);
    if (!session) return EMPTY;
    // Answered while the summary ran (a key press, or the prompt is gone): it is the person's again, so write nothing.
    if (session.lastKeyInputAt !== entry.keyAtClick || this.deps.getAgentState(sessionId) !== 'blocked') {
      return { ...EMPTY, keptOpen: 'typed' };
    }
    const failures: CloseSummaryFailure[] = res.ok || res.reason === 'ineligible' ? [] : [{ reason: res.reason }];
    const title = res.ok ? res.title : session.title;
    const kept = await this.deps.recordKeptOpen(entry.projectId, sessionId, title, 'asks-you', res.ok ? res.note : undefined);
    return { ...this.kept(kept, 'asks-you'), failures: [...failures, ...(kept.failures ?? [])] };
  }

  private async turnErrorOutcome(sessionId: string, entry: Active): Promise<Outcome> {
    const session = this.deps.getSession(sessionId);
    const kept = await this.deps.recordKeptOpen(entry.projectId, sessionId, session?.title ?? sessionId, 'turn-error');
    return this.kept(kept, 'turn-error');
  }

  private async timeoutOutcome(sessionId: string, entry: Active): Promise<Outcome> {
    const session = this.deps.getSession(sessionId);
    const kept = await this.deps.recordKeptOpen(entry.projectId, sessionId, session?.title ?? sessionId, 'timeout');
    return this.kept(kept, 'timeout');
  }

  /** A failed or empty summary is reported, and the agent stays closeable. `ineligible` is not a failure. */
  private failed(reason: 'ineligible' | 'empty' | 'summary-failed'): Outcome {
    return reason === 'ineligible' ? EMPTY : { ...EMPTY, failures: [{ reason }] };
  }

  private closed(r: { summarized: number; followedUp: number; failures?: CloseSummaryFailure[] }): Outcome {
    return { summarized: r.summarized, followedUp: r.followedUp, failures: r.failures ?? [] };
  }

  private kept(r: { failures?: CloseSummaryFailure[] }, reason: CloseFollowupKeptOpen['reason']): Outcome {
    return { ...EMPTY, failures: r.failures ?? [], keptOpen: reason };
  }

  /** One semaphore for every run: at most {@link MAX_CONCURRENT_SUMMARIES} summary calls at a time. */
  private async summarize(projectId: string, sessionId: string): Promise<SummarizeForCloseResult> {
    if (this.summariesInFlight >= MAX_CONCURRENT_SUMMARIES) {
      await new Promise<void>((resolve) => this.summaryWaiters.push(resolve));
    } else {
      this.summariesInFlight++;
    }
    try {
      return await this.deps.summarizeForClose(projectId, sessionId);
    } finally {
      const next = this.summaryWaiters.shift();
      if (next) next(); // hand the slot straight over
      else this.summariesInFlight--;
    }
  }
}
