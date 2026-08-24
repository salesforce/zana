/**
 * Idle-agent triage add-on (off by default; spends tokens).
 *
 * The agent-status tracker tells us WHEN an agent is idle, but the OSC `✳` glyph
 * looks identical whether the agent (a) asked you a question, (b) finished and
 * is closeable, or (c) paused mid-task. This service fills that gap: when a
 * claude agent settles into idle, it reads the session transcript's last
 * assistant turn and runs the `builtin:idle-triage` LLM micro-call to classify
 * WHY it's idle, then emits an {@link IdleTriageResult} the renderer surfaces on
 * the Agents board.
 *
 * Cost discipline (this is the whole reason it's opt-in):
 *  - It fires only after the agent has DWELLED idle for `delaySeconds` (armed on
 *    the working/blocked → idle edge, cancelled by any non-idle transition), so
 *    the 1–2s idle flicker between tool calls never spends a call.
 *  - One-shot per idle spell: re-armed only when the agent leaves idle, so a
 *    steady idle agent is classified exactly once (mirrors the tab-namer's
 *    one-shot-per-session gate).
 *  - It bails before spending anything when the add-on is disabled, no transcript
 *    text exists, or no eligible monitor HTTP provider is configured.
 *
 * All collaborators are injected so the trigger logic is unit-testable without
 * Electron, the filesystem, or a real provider call.
 */

import { EventEmitter } from 'node:events';
import type { AgentState, IdleResolution, IdleTriageResult, LlmRunResult } from '../shared/types.js';

/**
 * The minimal session identity a transcript reader needs to LOCATE a transcript.
 * Claude derives its path from `cwd` + `claudeSessionId`; Codex resolves its
 * rollout from `id` + `createdAt`. The DI callback takes this whole ref so the
 * service stays provider-agnostic — it never knows which fields the reader uses.
 */
export interface TranscriptRef {
  /** PTY session id (the Codex rollout resolver's cache key). */
  id: string;
  profile: string;
  cwd: string;
  claudeSessionId?: string;
  /** OpenCode's already-detected session id (see `TranscriptSessionRef`). */
  openCodeSessionId?: string;
  /** Spawn time (epoch ms) — the floor for detecting a Codex rollout file. */
  createdAt?: number;
}

/** What the service needs to know about a session to triage it. */
export interface TriageSessionInfo {
  profile: string;
  cwd: string;
  claudeSessionId?: string;
  /** OpenCode's already-detected session id (see `TranscriptSessionRef`). */
  openCodeSessionId?: string;
  /** Spawn time (epoch ms) — the floor for detecting a Codex rollout file. */
  createdAt?: number;
  status: 'starting' | 'running' | 'exited';
  /** Background sessions (scheduled runs, team workers) are never triaged —
   *  they must not surface for the user's attention. */
  scheduled?: boolean;
  headless?: boolean;
}

export interface IdleTriageDeps {
  /** Is the add-on enabled? Read live so a config toggle takes effect at once. */
  isEnabled: () => boolean;
  /**
   * Idle dwell (seconds) to wait on the working/blocked → idle edge before
   * triaging. Read live (same as {@link isEnabled}) so a config change takes
   * effect without a restart. Filters the 1–2s idle flicker between tool calls.
   */
  delaySeconds: () => number;
  /** Session metadata, or null if the session is gone. */
  getSession: (sessionId: string) => TriageSessionInfo | null;
  /**
   * True when the profile has a readable/summarizable transcript (the
   * `hasTranscript` capability). Idle-triage reads the last assistant turn, so
   * a profile without a transcript is skipped. Provider-agnostic: any provider
   * whose `providerCapabilities().hasTranscript` is true participates.
   */
  hasTranscript: (profile: string) => boolean;
  /** Only registrations with verified native monitor facts can use semantic work. */
  hasMonitorCapability: (profile: string) => boolean;
  /**
   * Read the session transcript's last assistant prose ('' when unavailable).
   * Takes a session ref (not just cwd/claudeSessionId) so a provider whose
   * transcript is located by other means — Codex resolves its rollout by
   * `id` + `createdAt` — can be dispatched behind this one callback.
   */
  readLastTurn: (ref: TranscriptRef) => Promise<string>;
  /** Run the idle-triage prompt with the given vars; never throws. */
  runTriage: (lastTurn: string, dedupeKey: string) => Promise<LlmRunResult>;
  /** Current epoch ms. Injected so tests are deterministic. */
  now: () => number;
  /** Arm the dwell timer; returns a handle. Injected so tests can use fake timers. */
  setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  /** Clear a dwell-timer handle. Injected to pair with {@link setTimer}. */
  clearTimer: (handle: NodeJS.Timeout) => void;
}

export const MAX_CONCURRENT_TRIAGES = 5;
export const MAX_TRIAGES_PER_SESSION = 6;

/**
 * Coerce a model's JSON reply into an {@link IdleResolution} + summary. Tolerant:
 * the model may wrap the JSON in stray prose or code fences despite the prompt,
 * so we extract the first {...} and parse that. Unparsable / unknown → null (the
 * caller then emits nothing rather than a bogus badge). Pure; exported for tests.
 */
export function parseTriage(text: string): Omit<IdleTriageResult, 'sessionId' | 'at'> | null {
  if (!text.trim()) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const raw = obj as Record<string, unknown>;
  const resolution = raw.resolution;
  const valid: IdleResolution[] = ['awaiting-reply', 'done', 'paused', 'unknown'];
  if (typeof resolution !== 'string' || !valid.includes(resolution as IdleResolution)) {
    return null;
  }
  const summary = typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 80) : '';
  const detailRaw = typeof raw.detail === 'string' ? raw.detail.trim().slice(0, 400) : '';
  const detail = detailRaw || undefined;
  // Concrete choices the agent offered, host-capped so a verbose/malformed
  // options array can never crowd out the rest of the JSON or drop the verdict:
  // strings only, trimmed, empties dropped, each ≤60 chars, at most 6. Absent
  // (or invalid) → omitted entirely, so behaviour is byte-identical to before
  // this field existed — the awaiting-reply badge is never lost to bad options.
  let options: string[] | undefined;
  if (Array.isArray(raw.options)) {
    const cleaned = raw.options
      .filter((o): o is string => typeof o === 'string')
      .map((o) => o.trim().slice(0, 60))
      .filter((o) => o.length > 0)
      .slice(0, 6);
    if (cleaned.length > 0) options = cleaned;
  }
  let confidence: number | undefined;
  if (typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)) {
    confidence = Math.max(0, Math.min(1, raw.confidence));
  }
  return { resolution: resolution as IdleResolution, summary, detail, options, confidence };
}

/**
 * Per-session triage gate. `fired` is true once we've claimed the one-shot for
 * the current idle spell (set when the dwell timer elapses, before any await);
 * it's reset only after the agent leaves idle, so a steady idle agent triages
 * once. `timer` holds the pending dwell timer armed on the idle edge — non-null
 * only between entering idle and either the timer elapsing or being cancelled
 * (any non-idle transition clears it).
 */
interface Entry {
  /** Last agent state we saw, to detect the edge into/out of idle. */
  lastState: AgentState;
  /** A triage for the CURRENT idle spell is in flight or already done. */
  fired: boolean;
  /** The armed dwell timer (null when not idle / already elapsed / cancelled). */
  timer: NodeJS.Timeout | null;
  /** Lifetime budget prevents agent-controlled OSC state cycling from spending without bound. */
  runs: number;
}

/**
 * Watches agent-state transitions and emits `triage` ({@link IdleTriageResult})
 * once per idle spell, when enabled. Wire {@link observe} to the agent-status
 * `status` event and {@link remove} to pty exit.
 */
export class IdleTriageService extends EventEmitter {
  private entries = new Map<string, Entry>();
  private pending = 0;

  constructor(private readonly deps: IdleTriageDeps) {
    super();
  }

  /**
   * Feed a session's newly-resolved agent state. On the edge into idle it arms a
   * dwell timer of `delaySeconds()`; the triage micro-call fires only when that
   * timer elapses AND the agent is still idle (so the 1–2s idle flicker between
   * tool calls never triages). Any non-idle transition cancels the pending timer
   * and re-arms the one-shot gate so the NEXT idle spell triages afresh. Cheap
   * and synchronous on the hot path — the LLM call is fired-and-forgotten once
   * the dwell elapses.
   */
  observe(sessionId: string, state: AgentState): void {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { lastState: 'unknown', fired: false, timer: null, runs: 0 };
      this.entries.set(sessionId, entry);
    }
    const wasIdle = entry.lastState === 'idle';
    entry.lastState = state;

    if (state !== 'idle') {
      // Left idle (working/blocked/exited): cancel any pending dwell and re-arm
      // so the NEXT idle spell triages.
      this.disarm(entry);
      entry.fired = false;
      return;
    }
    // state === 'idle' from here.
    if (wasIdle || entry.fired || entry.timer) return; // not a fresh edge / handled / already waiting
    // Arm the dwell: triage only if still idle when it elapses.
    const ms = Math.max(1, Math.round(this.deps.delaySeconds())) * 1000;
    entry.timer = this.deps.setTimer(() => this.onDwellElapsed(sessionId), ms);
  }

  /** Forget a session (call on pty exit). Clears any pending dwell timer. */
  remove(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) this.disarm(entry);
    this.entries.delete(sessionId);
  }

  // ----- internals -----------------------------------------------------------

  /** Cancel a pending dwell timer (idempotent). */
  private disarm(entry: Entry): void {
    if (entry.timer) {
      this.deps.clearTimer(entry.timer);
      entry.timer = null;
    }
  }

  /**
   * The dwell elapsed. If the agent is still idle (observe() would have disarmed
   * on leaving, but guard the race), claim the one-shot and fire the triage. The
   * LLM call is fired-and-forgotten; a failure releases the one-shot so a later
   * working→idle cycle can retry.
   */
  private onDwellElapsed(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.timer = null;
    if (entry.lastState !== 'idle' || entry.fired || entry.runs >= MAX_TRIAGES_PER_SESSION) return;
    entry.fired = true; // claim the one-shot before any await

    if (this.pending >= MAX_CONCURRENT_TRIAGES) {
      entry.fired = false;
      entry.timer = this.deps.setTimer(() => this.onDwellElapsed(sessionId), 1_000);
      return;
    }
    this.pending++;
    entry.runs++;
    void this.triage(sessionId).catch(() => {
      // Never let a triage failure crash the timer callback. Release the one-shot
      // so a future working→idle cycle gets a fresh attempt.
      const e = this.entries.get(sessionId);
      if (e) e.fired = false;
    }).finally(() => {
      this.pending--;
    });
  }

  private async triage(sessionId: string): Promise<void> {
    if (!this.deps.isEnabled()) return;
    const session = this.deps.getSession(sessionId);
    if (!session || session.status === 'exited') return;
    // Background agents (scheduled runs, team workers) never request attention.
    if (session.scheduled || session.headless) return;
    if (!this.deps.hasMonitorCapability(session.profile) || !this.deps.hasTranscript(session.profile)) return;

    const lastTurn = await this.deps.readLastTurn({
      id: sessionId,
      profile: session.profile,
      cwd: session.cwd,
      claudeSessionId: session.claudeSessionId,
      openCodeSessionId: session.openCodeSessionId,
      createdAt: session.createdAt
    });
    if (!lastTurn.trim()) return; // nothing to classify — don't spend a call

    // Re-check enablement after the (cheap) read but before the (costly) call,
    // so toggling the add-on off mid-read doesn't still spend a token.
    if (!this.deps.isEnabled()) return;

    const result = await this.deps.runTriage(lastTurn, sessionId);
    if (!result.ok) return;

    // The agent may have moved on during the ~10–20s call. Only emit if it's
    // still idle — a stale badge on a now-working agent would be misleading.
    if (this.entries.get(sessionId)?.lastState !== 'idle') return;

    const parsed = parseTriage(result.text);
    if (!parsed) return;

    const payload: IdleTriageResult = { sessionId, at: this.deps.now(), ...parsed };
    this.emit('triage', payload);
  }
}
