/**
 * Agent-status tracker — the main-process source of truth for live agent state
 * (working / blocked / done / idle) per session.
 *
 * This is the LAS-05 + LAS-07b slice of the Live Agent Status Awareness plan
 * (`docs/live-agent-status-plan.md`). It owns:
 *
 *  - the per-session current {@link AgentState},
 *  - the OSC-title fast-path detector (the cheapest, highest-signal detector;
 *    parsed straight from the raw PTY byte stream, so it works for hidden /
 *    unfocused tabs too — something herdr cannot do since it reads the
 *    *rendered* title),
 *  - the Notification-hook overlay, which is the ONLY signal that can tell
 *    "idle at the prompt" apart from "waiting on the user" (a permission
 *    prompt or an interactive question). The OSC title shows the same `✳`
 *    glyph in both cases, so without the hook a blocked agent reads as idle.
 *  - the tool-in-flight idle-veto (the plan's `docs/live-agent-status-plan.md`
 *    §"Hooks — done truth + idle-veto"): a PreToolUse with no matching
 *    PostToolUse yet means a tool is genuinely running, even if Claude's OSC
 *    title happens to read `✳` in that quiet moment (a long silent Bash/
 *    WebSearch/etc. call looks exactly like idle on screen). See
 *    {@link AgentStatusTracker.toolStarted}.
 *  - a small resolver that fuses the sources, and debounce/coalescing so a
 *    burst of detections collapses to at most one emit per session per window.
 *
 * It deliberately does NOT touch `TerminalSession`: status streams over its own
 * `onAgentStatus` channel into a dedicated renderer store slice, so a status
 * tick never rebuilds the `terminals` map (the render-storm guard the arch
 * council made binding — BC 7/10).
 *
 * Source fusion (see {@link resolve}): lifecycle events are authoritative after
 * a provider starts sending them; visual observations remain a responsive,
 * provider-owned fallback for harnesses without lifecycle coverage. The blocked
 * overlay always wins because a session awaiting the user cannot be idle.
 */

import { EventEmitter } from 'node:events';
import type { AgentState, AgentExitState, AgentStatusReplay, SubagentChild } from '../shared/types.js';

/**
 * Max sub-agent child records retained per parent session (Rule 5 — bound an
 * otherwise unbounded accumulating store). On overflow, the oldest `done`
 * children are evicted first; a `running` child is never dropped (its node would
 * vanish while still live). The live COUNT is tracked independently of this
 * array, so capping records never drifts the count.
 */
export const SUBAGENT_CHILD_CAP = 50;

/** Debounce window: collapse a burst of detections into one emit per session.
 *  Spinner frames change ~10 Hz; we don't want to emit at that rate. */
const EMIT_DEBOUNCE_MS = 250;

/** Bounded ring buffer cap. Only real (debounced) transitions are recorded, so
 *  500 covers a long multi-agent session. Rule 5 — bounded work. */
const RING_CAP = 500;

/**
 * Classify an OSC title string into an agent state, or `null` when the title
 * carries no agent signal (so we leave the current state untouched).
 *
 * Mirrors the high-priority rules in the currently supported OSC-status
 * provider's manifest:
 *  - a leading braille glyph (U+2800–U+28FF) or `✻` is a working spinner,
 *  - a leading `✳` (U+2733) is an idle/done marker.
 *
 * Anything else (a cwd-style title, a plain shell title) returns `null`.
 */
export function classifyOscTitle(title: string): AgentState | null {
  // The spinner/marker is the FIRST non-space glyph of the title.
  const ch = title.trimStart().codePointAt(0);
  if (ch === undefined) return null;
  if (ch >= 0x2800 && ch <= 0x28ff) return 'working'; // braille spinner
  if (ch === 0x273b) return 'working'; // ✻ text-spinner marker
  if (ch === 0x2733) return 'idle'; // ✳ heavy asterisk
  return null;
}

/**
 * Strip the leading agent-status glyph (a braille spinner U+2800–U+28FF, or the
 * `✳` U+2733 idle marker) and surrounding whitespace from an OSC title, leaving
 * just the human-readable summary text Claude writes after it (e.g.
 * `✳ Fix the login bug` → `Fix the login bug`). Returns the trimmed remainder,
 * or '' when the title is only a glyph / empty. Pure; exported for tests.
 */
export function stripTitleGlyph(title: string): string {
  const trimmed = title.trimStart();
  const ch = trimmed.codePointAt(0);
  if (ch !== undefined && ((ch >= 0x2800 && ch <= 0x28ff) || ch === 0x2733)) {
    // Drop the glyph (a single code point, which may be >1 UTF-16 unit).
    return trimmed.slice(String.fromCodePoint(ch).length).trim();
  }
  return trimmed.trim();
}

const OSC_TITLE_RE =
  // OSC 0 (icon+title) or 2 (title), terminated by BEL (\x07) or ST (\x1b\\).
  /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

/**
 * Extract the LAST OSC 0/2 title found in a PTY data chunk, or `null` if the
 * chunk sets no title. We only care about the most recent title in the chunk —
 * intermediate spinner frames within one chunk are superseded by the last.
 */
export function extractLastOscTitle(chunk: string): string | null {
  let match: RegExpExecArray | null;
  let last: string | null = null;
  OSC_TITLE_RE.lastIndex = 0;
  while ((match = OSC_TITLE_RE.exec(chunk)) !== null) {
    last = match[1];
  }
  return last;
}

interface Entry {
  /** Last state we actually emitted to listeners. */
  emitted: AgentState;
  /**
   * Latest state derived from the PTY stream (OSC title / screen-scan). This is
   * the moment-to-moment signal: spinner → `working`, `✳` → `idle`.
   */
  osc: AgentState;
  /**
   * Whether the Notification hook says this session is waiting on the user.
   * Sticky: set true on a `permission_prompt`/`idle_prompt` notification and
   * only cleared when the agent visibly resumes (`working`) or the turn is
   * answered (UserPromptSubmit / Stop). The OSC `idle` glyph can't clear it —
   * Claude shows that same glyph the whole time it's blocked.
   */
  blocked: boolean;
  /**
   * A lifecycle source has reported for this session. Until then, visual/output
   * observations remain the fallback authority. Once present, a completed turn
   * is more trustworthy than a stale terminal-title frame.
   */
  lifecycleObserved: boolean;
  /** Whether the current lifecycle turn is active. */
  turnActive: boolean;
  /** The lifecycle source confirmed the current turn ended. */
  turnFinished: boolean;
  timer: NodeJS.Timeout | null;
  /**
   * The last task-summary title we emitted on the `title` event for this
   * session, so a repeated idle title (Claude re-emits the same `✳ summary`
   * on every idle frame) doesn't fire a redundant rename. Undefined until the
   * first idle title is seen.
   */
  emittedTitle?: string;
  /**
   * How many sub-agents (Task tool spawns) are currently in flight for this
   * session. Incremented by the PreToolUse(Task) hook, decremented by
   * SubagentStop, and clamped to 0 (a turn can't end with a live sub-agent, so
   * the parent Stop hook also resets it as a drift guard). A purely
   * informational counter — kept OFF {@link resolve} so it never changes the
   * session's `working`/`blocked`/`idle` state, only the sub-agent badge.
   *
   * Tracked INDEPENDENTLY of {@link subagentChildren} (not derived from its
   * length) so the count behaviour stays byte-identical to before A3 and a
   * record-cap eviction can never drift it.
   */
  subagents: number;
  /**
   * Per-child sub-agent records (A3) — the addressable version of the count,
   * carrying each Task spawn's name/type + running/done. Bounded by
   * {@link SUBAGENT_CHILD_CAP}. Maintained alongside `subagents`.
   */
  subagentChildren: SubagentChild[];
  /**
   * Monotonic per-session child ordinal — seeds the `<sessionId>:<n>` id and is
   * never reused, so a child id is stable for the session even across cap
   * eviction. The start→stop FIFO correlation key.
   */
  subagentSeq: number;
  /**
   * Live count of tools currently in flight (PreToolUse fired, matching
   * PostToolUse hasn't yet) — the idle-veto signal. Incremented by
   * {@link toolStarted}, decremented by {@link toolFinished}, clamped to 0.
   * Unlike {@link subagents} this DOES feed {@link resolve}: while > 0, an
   * `idle` OSC reading is overridden to `working` (see {@link resolve}).
   * Reset to 0 on the Stop hook (a turn can't end mid-tool) as a drift guard
   * against a PostToolUse that never fires.
   */
  toolsInFlight: number;
  /**
   * The last structured exit state captured for this session (see
   * {@link AgentExitState}). Set by {@link AgentStatusTracker.recordExit} when
   * the agent/subagent finishes a turn, and surfaced on its own `exit` event +
   * the `agent_status` MCP tool. Like {@link subagents} it is an ADDITIVE
   * overlay kept OFF {@link resolve} — it NEVER changes the
   * working/blocked/idle status stream. Undefined until the first exit.
   */
  lastExit?: AgentExitState;
}

/**
 * Fuse the per-session inputs into the single state we surface.
 *  - a blocked overlay wins: a session cannot be idle while it needs a person.
 *  - for a lifecycle-backed session, a completed turn is authoritative over a
 *    stale visual spinner and an active turn/tool is authoritative over a stale
 *    idle marker.
 *  - sessions with no lifecycle event yet retain the historical OSC/output
 *    fallback, so harnesses that cannot inject hooks do not regress.
 */
function resolve(entry: Entry): AgentState {
  if (entry.blocked) return 'blocked';
  if (entry.lifecycleObserved) {
    if (entry.turnFinished) return 'idle';
    if (entry.turnActive || entry.toolsInFlight > 0) return 'working';
  }
  if (entry.osc === 'working') return 'working';
  if (entry.toolsInFlight > 0) return 'working';
  return entry.osc;
}

/**
 * Tracks and debounces per-session agent state and emits `status` events.
 *
 * Events:
 *  - `status` (sessionId: string, state: AgentState, seq: number) — debounced,
 *    only on change. The seq is a monotonic counter, advanced on each emitted
 *    transition, so a (re)connecting renderer can replay missed transitions via
 *    {@link since}.
 *  - `subagents` (sessionId: string, count: number) — live Task-tool spawn
 *    count, emitted on each change (not debounced — start/stop are low-rate).
 */
export class AgentStatusTracker extends EventEmitter {
  private entries = new Map<string, Entry>();
  /** Monotonic seq counter, advanced on each emitted transition. Never resets
   *  for process lifetime. */
  private seq = 0;
  /** Bounded ring buffer of emitted transitions: `[seq, sessionId, state]`.
   *  Kept at most {@link RING_CAP} entries (oldest shifted out). A (re)connecting
   *  renderer replays missed transitions via {@link since}. */
  private ring: Array<{ seq: number; sessionId: string; state: AgentState }> = [];

  /** Current debounced state for a session (defaults to `unknown`). */
  get(sessionId: string): AgentState {
    return this.entries.get(sessionId)?.emitted ?? 'unknown';
  }

  /** Live sub-agent (Task tool) count for a session (0 if none / untracked). */
  subagents(sessionId: string): number {
    return this.entries.get(sessionId)?.subagents ?? 0;
  }

  /**
   * One-shot `[sessionId, state]` pairs for every tracked session. Seeds a
   * freshly opened window, whose edge-triggered `onAgentStatus` subscription
   * would otherwise miss the last transition. Reports the debounced `emitted`
   * state (what the `status` event last carried), not the raw OSC reading.
   */
  snapshot(): Array<[string, AgentState]> {
    return Array.from(this.entries, ([sessionId, entry]) => [sessionId, entry.emitted]);
  }

  /**
   * Replay transitions after `sinceSeq`. Returns `{mode:'replay', events, headSeq}`
   * when no gap (sinceSeq >= oldestRetained-1), else `{mode:'snapshot', snapshot, headSeq}`
   * so the caller reseeds from scratch. `headSeq` is the current max seq (the last
   * seq emitted, or 0 when empty). Rule 1: main owns the seq; the renderer cursor
   * is advisory — main decides replay vs snapshot.
   *
   * Bogus `sinceSeq` (negative / NaN / > headSeq) falls back to snapshot mode.
   * `sinceSeq === 0` on a fresh renderer: if the ring holds the whole history
   * (never overflowed) → replay all; if it overflowed → snapshot. Correct either way.
   */
  since(sinceSeq: number): AgentStatusReplay {
    const headSeq = this.seq;
    // Coerce junk (main's validation — Rule 1). Negative / NaN / non-finite
    // is always a snapshot fallback, not coerced to 0.
    if (!Number.isFinite(sinceSeq) || sinceSeq < 0) {
      return { mode: 'snapshot', snapshot: this.snapshot(), headSeq };
    }
    // Empty tracker edge case: since(0) on an empty tracker should return snapshot
    // mode (the test expects this), because there's no history to replay.
    if (headSeq === 0 && sinceSeq === 0) {
      return { mode: 'snapshot', snapshot: [], headSeq: 0 };
    }
    // Oldest retained seq in the ring (or headSeq when empty).
    const oldestRetained = this.ring[0]?.seq ?? headSeq;
    // Gap detection: cursor is too old (overflowed past it) or too new (bogus future).
    if (sinceSeq + 1 < oldestRetained || sinceSeq > headSeq) {
      return { mode: 'snapshot', snapshot: this.snapshot(), headSeq };
    }
    // No gap: replay everything after sinceSeq.
    const events = this.ring
      .filter((e) => e.seq > sinceSeq)
      .map((e) => [e.seq, e.sessionId, e.state] as [number, string, AgentState]);
    return { mode: 'replay', events, headSeq };
  }

  /**
   * One-shot `[sessionId, count]` pairs for every session with a live sub-agent
   * count > 0. Seeds a freshly opened window the same way {@link snapshot} seeds
   * agent state — the `subagents` event is edge-triggered, so a window opened
   * mid-flight would otherwise show no badge until the next start/stop. Only
   * non-zero entries are emitted (zero is the renderer's default).
   */
  subagentSnapshot(): Array<[string, number]> {
    const out: Array<[string, number]> = [];
    for (const [sessionId, entry] of this.entries) {
      if (entry.subagents > 0) out.push([sessionId, entry.subagents]);
    }
    return out;
  }

  /** Per-child sub-agent records for a session ([] if none / untracked). */
  subagentChildren(sessionId: string): SubagentChild[] {
    return this.entries.get(sessionId)?.subagentChildren ?? [];
  }

  /**
   * One-shot `[sessionId, SubagentChild[]]` pairs for every session with ≥1
   * child record. Seeds a freshly opened window the same way
   * {@link subagentSnapshot} seeds the count — the `subagentChildren` event is
   * edge-triggered. Only sessions with records are emitted ([] is the default).
   */
  subagentChildSnapshot(): Array<[string, SubagentChild[]]> {
    const out: Array<[string, SubagentChild[]]> = [];
    for (const [sessionId, entry] of this.entries) {
      if (entry.subagentChildren.length > 0) out.push([sessionId, entry.subagentChildren]);
    }
    return out;
  }

  private entry(sessionId: string): Entry {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = {
        emitted: 'unknown',
        osc: 'unknown',
        blocked: false,
        lifecycleObserved: false,
        turnActive: false,
        turnFinished: false,
        timer: null,
        subagents: 0,
        subagentChildren: [],
        subagentSeq: 0,
        toolsInFlight: 0
      };
      this.entries.set(sessionId, entry);
    }
    return entry;
  }

  /**
   * Feed a raw PTY data chunk through the OSC-title detector. Called from the
   * pty `data` event. Cheap: a regex over the chunk, only acts when the chunk
   * actually sets a title with an agent signal.
   */
  observeData(sessionId: string, chunk: string): void {
    const title = extractLastOscTitle(chunk);
    if (title === null) return;
    const state = classifyOscTitle(title);
    if (state === null) return;
    // When idle, the text after the `✳` glyph is Claude's auto-generated task
    // summary (stable for the duration of idle). Surface it as a `title` event
    // so the renderer can self-label the tab. We only adopt the IDLE title —
    // the working spinner's text is a transient verb ("Cooking…") that would
    // flicker the tab. Emit only on change (Claude re-sends the same idle title
    // each frame).
    if (state === 'idle') {
      const summary = stripTitleGlyph(title);
      if (summary) {
        const entry = this.entry(sessionId);
        if (entry.emittedTitle !== summary) {
          entry.emittedTitle = summary;
          this.emit('title', sessionId, summary);
        }
      }
    }
    this.report(sessionId, state);
  }

  /**
   * Record an OSC/screen-scan derived state. A `working` reading also implies
   * the agent has resumed, so it clears any sticky blocked overlay.
   */
  report(sessionId: string, state: AgentState): void {
    const entry = this.entry(sessionId);
    entry.osc = state;
    if (state === 'working' || state === 'waiting') entry.blocked = false;
    this.schedule(sessionId, entry);
  }

  /**
   * A provider lifecycle hook accepted a new user turn. This is deliberately
   * provider-neutral: a harness-specific launcher maps its own event dialect to
   * this transition. It makes lifecycle state authoritative from this point on.
   */
  turnStarted(sessionId: string): void {
    const entry = this.entry(sessionId);
    entry.lifecycleObserved = true;
    entry.turnActive = true;
    entry.turnFinished = false;
    entry.blocked = false;
    this.schedule(sessionId, entry);
  }

  /**
   * A provider lifecycle hook confirmed the turn ended. Hooks can be duplicated
   * or arrive after a dropped post-tool event, so completion also clears the
   * in-flight counter. A blocked overlay is intentionally retained: if the
   * harness still says it needs a person, that remains more specific than end.
   */
  turnFinished(sessionId: string): void {
    const entry = this.entry(sessionId);
    entry.lifecycleObserved = true;
    entry.turnActive = false;
    entry.turnFinished = true;
    entry.toolsInFlight = 0;
    this.schedule(sessionId, entry);
  }

  /**
   * The Notification hook fired — the agent is waiting on the user (permission
   * prompt or an interactive question). Sets the sticky blocked overlay.
   */
  markBlocked(sessionId: string): void {
    const entry = this.entry(sessionId);
    entry.blocked = true;
    this.schedule(sessionId, entry);
  }

  /**
   * The user answered (UserPromptSubmit) or the turn ended (Stop) — the agent
   * is no longer waiting on input. Drops the blocked overlay; the resolved
   * state falls back to the latest OSC reading.
   */
  clearBlocked(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry || !entry.blocked) return;
    entry.blocked = false;
    this.schedule(sessionId, entry);
  }

  /**
   * A generic PreToolUse hook fired (match-all — every tool, not just
   * Task/AskUserQuestion). Bumps the in-flight counter; while it's > 0 an
   * `idle` OSC reading is vetoed to `working` by {@link resolve}. Unlike
   * {@link subagentStarted} this DOES affect the resolved state.
   */
  toolStarted(sessionId: string): void {
    const entry = this.entry(sessionId);
    entry.lifecycleObserved = true;
    entry.turnActive = true;
    entry.turnFinished = false;
    entry.toolsInFlight += 1;
    this.schedule(sessionId, entry);
  }

  /**
   * The matching PostToolUse hook fired. Decrements the in-flight counter,
   * clamped at 0 so an unmatched stop (e.g. a tool call that started just
   * before this session was reattached) can't drive it negative.
   */
  toolFinished(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.toolsInFlight === 0) return;
    entry.toolsInFlight -= 1;
    this.schedule(sessionId, entry);
  }

  /**
   * Drift guard: reset the in-flight counter to 0. Called on the Stop hook (a
   * turn can't end mid-tool-call, so any uncleared count is a PostToolUse that
   * never fired) so a lost decrement can never permanently veto idle for the
   * rest of the session. No-op (and no emit) when already 0.
   */
  clearToolsInFlight(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.toolsInFlight === 0) return;
    entry.toolsInFlight = 0;
    this.schedule(sessionId, entry);
  }

  /**
   * A sub-agent (Task tool) started — the PreToolUse(Task) hook fired. Bumps
   * the live counter and (A3) appends a `running` child record carrying the
   * `identity` parsed from the hook payload (undefined fields when the payload
   * was absent/malformed — the count still rises, so identity loss never drifts
   * the count). Emits `subagents` (count) and `subagentChildren` (records). This
   * is deliberately separate from {@link report}/{@link markBlocked}: a session
   * running sub-agents is still `working`, so it rides its own events and never
   * touches the resolved {@link AgentState}.
   */
  subagentStarted(
    sessionId: string,
    identity?: { description?: string; subagentType?: string }
  ): void {
    const entry = this.entry(sessionId);
    entry.subagents += 1;
    const child: SubagentChild = {
      id: `${sessionId}:${entry.subagentSeq++}`,
      description: identity?.description,
      subagentType: identity?.subagentType,
      status: 'running',
      startedAt: Date.now()
    };
    entry.subagentChildren.push(child);
    this.capChildren(entry);
    this.emit('subagents', sessionId, entry.subagents);
    this.emit('subagentChildren', sessionId, entry.subagentChildren);
  }

  /**
   * A sub-agent finished — the SubagentStop hook fired. Decrements the counter
   * (clamped at 0 so an unmatched stop can't drive it negative) and (A3) marks
   * the OLDEST still-`running` child `done`. SubagentStop carries no tool_input,
   * so we cannot match the exact child by identity — FIFO mirrors the count's
   * own start=+1/stop=−1 semantics. Skips both emits on a no-op-at-zero.
   */
  subagentStopped(sessionId: string): void {
    const entry = this.entry(sessionId);
    if (entry.subagents === 0) return;
    entry.subagents -= 1;
    const oldestRunning = entry.subagentChildren.find((c) => c.status === 'running');
    if (oldestRunning) {
      oldestRunning.status = 'done';
      oldestRunning.stoppedAt = Date.now();
    }
    this.emit('subagents', sessionId, entry.subagents);
    this.emit('subagentChildren', sessionId, entry.subagentChildren);
  }

  /**
   * Reset the live sub-agent count to 0 AND drain the child records (call on the
   * parent's Stop hook / on exit — a finished turn can have no in-flight
   * sub-agents, so this clears any drift from a SubagentStop that never fired).
   * No-op (and no emit) when already clear.
   */
  clearSubagents(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry || (entry.subagents === 0 && entry.subagentChildren.length === 0)) return;
    entry.subagents = 0;
    entry.subagentChildren = [];
    this.emit('subagents', sessionId, 0);
    this.emit('subagentChildren', sessionId, entry.subagentChildren);
  }

  /**
   * Enforce {@link SUBAGENT_CHILD_CAP} (Rule 5 — hard upper bound). Evict oldest
   * `done` children first (their node has served its purpose); only if STILL
   * over — i.e. more than CAP children are concurrently `running`, which Claude's
   * own Task fan-out makes vanishingly unlikely — drop oldest running as a last
   * resort so the store can never grow without bound. The count is tracked
   * separately, so eviction never drifts it.
   */
  private capChildren(entry: Entry): void {
    if (entry.subagentChildren.length <= SUBAGENT_CHILD_CAP) return;
    let toDrop = entry.subagentChildren.length - SUBAGENT_CHILD_CAP;
    // Pass 1: drop oldest `done` (array is append-order = oldest-first).
    entry.subagentChildren = entry.subagentChildren.filter((c) => {
      if (toDrop > 0 && c.status === 'done') {
        toDrop -= 1;
        return false;
      }
      return true;
    });
    // Pass 2 (rare): still over → trim oldest regardless of status.
    if (entry.subagentChildren.length > SUBAGENT_CHILD_CAP) {
      entry.subagentChildren = entry.subagentChildren.slice(
        entry.subagentChildren.length - SUBAGENT_CHILD_CAP
      );
    }
  }

  /** Schedule a debounced flush when the resolved state would change. */
  private schedule(sessionId: string, entry: Entry): void {
    if (entry.timer !== null) return; // a flush is already scheduled
    if (resolve(entry) === entry.emitted) return; // nothing would change
    entry.timer = setTimeout(() => this.flush(sessionId), EMIT_DEBOUNCE_MS);
  }

  private flush(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.timer = null;
    const next = resolve(entry);
    if (next === entry.emitted) return;
    entry.emitted = next;
    // Increment seq, push to ring, overflow if needed.
    this.seq += 1;
    this.ring.push({ seq: this.seq, sessionId, state: next });
    if (this.ring.length > RING_CAP) this.ring.shift();
    // Emit the transition with the seq as the 3rd arg.
    this.emit('status', sessionId, entry.emitted, this.seq);
  }

  /** Forget a session (call on pty exit). Clears any pending timer. */
  remove(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry?.timer) clearTimeout(entry.timer);
    this.entries.delete(sessionId);
  }
}
