/**
 * Inner-agent liveness for tmux-backed REMOTE sessions.
 *
 * A remote agent runs inside a persistent tmux session reached over ssh
 * (`wrapRemoteTmux`). The pty/wrapper process (the ssh client) can stay `running`
 * long after the INNER agent has exited — the classic remote-opencode zombie: the
 * agent dies, its login-shell wrapper survives, and anything typed at the pane
 * (an execution assignment injected via `reply()`) is eaten by that shell as a
 * shell command (`command not found`) instead of reaching a live agent. The
 * remote-liveness probe used for reconnect (`tmux has-session`) only proves the
 * SESSION exists, so it reports the zombie as alive.
 *
 * This module distinguishes the two by asking tmux what command the pane is
 * actually running (`#{pane_current_command}`): the agent binary => `alive`, a
 * bare login shell => `dead` (agent exited, wrapper survives), anything else =>
 * `unknown`. The classification is provider-owned (only a provider that launches
 * a distinguishable agent binary can name it, Rule 6), so the pure probe here
 * takes an injected `classify` and an injected `execFile` — it never binds to a
 * specific remote host, which keeps it deterministically unit-testable with a
 * fake command runner (no live box).
 */

import type { AgentLiveness } from './launch-provider.js';
import { shellQuote } from './shell-quote.js';

export type { AgentLiveness };

/**
 * The `execFile`-shaped callback surface this module needs — narrowed to the one
 * overload used, so a fake can be injected in tests without pulling in node's
 * full typings.
 */
export type ProbeExecError = (Error & { code?: number | string; killed?: boolean }) | null;
export type ProbeRunner = (
  command: string,
  args: string[],
  options: { timeout: number },
  cb: (error: ProbeExecError, stdout: string) => void
) => void;

export interface AgentLivenessProbeParams {
  execFile: ProbeRunner;
  /** ssh target (`user@host` or `host`). */
  target: string;
  /** tmux session name the agent runs in. */
  tmuxName: string;
  /** Keepalive/-o opts to reuse on the probe ssh (a subset of the reattach argv, no `-t`). */
  probeOpts: string[];
  timeoutMs: number;
  /** Provider-owned pane-command classifier (Rule 6). */
  classify: (command: string) => AgentLiveness;
}

/**
 * Probe a tmux-backed remote agent's inner-process liveness. Runs
 * `ssh <probeOpts> -o BatchMode=yes <target> "tmux display-message -p -t 'name'
 * '#{pane_current_command}'"` and classifies the pane command. NEVER throws and
 * NEVER returns a false `dead`: any ssh failure/timeout, or an unrecognized pane
 * command, resolves to `unknown` (fail safe — an undecidable probe must not
 * reclaim a claim). A leading-dash `target` (readable as an ssh flag) short-
 * circuits to `unknown`, mirroring the reattach-probe guard.
 *
 * The tmux command is assembled as a SINGLE remote-command string with
 * POSIX-single-quoted operands, NOT as separate trailing ssh argv elements.
 * OpenSSH space-joins the trailing operands and hands the result to the remote
 * login shell via `sh -c`, so a bare `#{pane_current_command}` operand would be
 * eaten as a `#` comment — tmux would then print its default status format and
 * the probe could never observe the real pane command (silently degrading to
 * `unknown`). Quoting the format string and the session name keeps `#{…}` and
 * any whitespace/metacharacters intact across that remote re-parse.
 */
export function probeAgentLiveness(params: AgentLivenessProbeParams): Promise<AgentLiveness> {
  const { execFile, target, tmuxName, probeOpts, timeoutMs, classify } = params;
  if (target.startsWith('-')) return Promise.resolve('unknown');
  // One quoted remote command — see the doc comment: ssh re-parses the trailing
  // operands under a remote `sh -c`, so `#{…}` and the session name MUST be
  // single-quoted or the `#` starts a comment and the format is lost.
  const remoteCmd =
    `tmux display-message -p -t ${shellQuote(tmuxName)} '#{pane_current_command}'`;
  const args = [
    ...probeOpts,
    '-o', 'BatchMode=yes', // never block on an auth prompt in a background probe
    target,
    remoteCmd
  ];
  return new Promise<AgentLiveness>((resolve) => {
    execFile('ssh', args, { timeout: timeoutMs }, (error, stdout) => {
      // ssh connect failure / auth / timeout / tmux error => can't tell => unknown.
      if (error) return resolve('unknown');
      resolve(classify(stdout ?? ''));
    });
  });
}

/**
 * How long a decisive liveness verdict stays trustworthy. Past this the cache
 * treats the entry as stale and re-probes — a value must never be acted on if it
 * predates the window (a `dead` verdict for a since-relaunched session would
 * over-reclaim). Comfortably spans a few reconcile ticks
 * (`EXECUTION_CLAIM_RECONCILE_INTERVAL_MS` = 30 s).
 */
export const DEFAULT_LIVENESS_STALE_MS = 90_000;

interface LivenessCacheEntry {
  verdict: AgentLiveness;
  at: number;
}

/**
 * Synchronous liveness lookup for the claim-reconcile tick, backed by an async
 * ssh probe. The reconcile loop reads {@link get} SYNCHRONOUSLY (it can't await a
 * round-trip per claim), so this caches the last DECISIVE verdict and refreshes
 * in the background:
 *
 *  - `get` returns the cached verdict while FRESH (else `unknown`) and ALWAYS
 *    kicks a deduped background probe — a PROACTIVE refresh, not only a stale
 *    top-up. An agent that dies immediately after a successful probe would
 *    otherwise stay `alive` for the whole freshness window (several ticks);
 *    refreshing on every read means the flip is observed on the NEXT reconcile
 *    tick (~one interval, 30 s) regardless of when in the window it died.
 *  - Only `alive`/`dead` are cached; an `unknown` probe result is NOT stored, so
 *    an undecidable session is re-probed every tick until it resolves (a
 *    telemetry-gap worker keeps being checked rather than pinned at `unknown`).
 *  - `refresh` and the background refresh scheduled by `get` share ONE in-flight
 *    probe per session (deduped via {@link inFlight}), so a concurrent
 *    `refresh()` + `get()`-triggered probe can never store a stale verdict over
 *    a newer one — both await the same result and `store` runs once.
 *  - `evict` drops a session on pty exit (Rule 3 — release per-session state).
 *
 * The probe is injected (in production, `PtyManager.probeAgentLiveness`, which
 * itself returns `unknown` for local / non-liveness-reporting sessions and never
 * throws), so this class is deterministically unit-testable with a fake probe +
 * fake clock — no live remote host.
 */
export class AgentLivenessCache {
  private readonly entries = new Map<string, LivenessCacheEntry>();
  /**
   * The single in-flight probe per session, shared by `get`'s background
   * refresh and an explicit `refresh()`. Keyed so both callers await the SAME
   * promise instead of racing two probes whose `store()` order is decided by
   * wall-clock rather than probe recency.
   */
  private readonly inFlight = new Map<string, Promise<AgentLiveness>>();

  constructor(
    private readonly probe: (sessionId: string) => Promise<AgentLiveness>,
    private readonly options: {
      now?: () => number;
      staleMs?: number;
      /**
       * Telemetry sink for a background probe that unexpectedly REJECTS (the
       * injected probe's contract is never-throws, so this is a defensive
       * last resort). Receives the session id for diagnosis; the cache still
       * fails safe to `unknown`. Defaults to a `console.warn`.
       */
      onProbeError?: (sessionId: string, error: unknown) => void;
    } = {}
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private get staleMs(): number {
    return this.options.staleMs ?? DEFAULT_LIVENESS_STALE_MS;
  }

  private reportProbeError(sessionId: string, error: unknown): void {
    if (this.options.onProbeError) {
      this.options.onProbeError(sessionId, error);
      return;
    }
    // eslint-disable-next-line no-console
    console.warn(`[agent-liveness] background probe rejected for session ${sessionId}:`, error);
  }

  get(sessionId: string): AgentLiveness {
    const entry = this.entries.get(sessionId);
    const fresh = entry !== undefined && this.now() - entry.at <= this.staleMs;
    // Always kick a deduped background probe — even when the cached verdict is
    // still fresh — so a verdict that flips mid-window is caught within ~one
    // reconcile interval rather than after the whole freshness window.
    this.scheduleRefresh(sessionId);
    return fresh ? entry!.verdict : 'unknown';
  }

  private store(sessionId: string, verdict: AgentLiveness): void {
    // Only decisive verdicts are worth caching; an `unknown` is dropped so the
    // session is re-probed on the next tick rather than pinned as unknown.
    if (verdict === 'unknown') this.entries.delete(sessionId);
    else this.entries.set(sessionId, { verdict, at: this.now() });
  }

  /**
   * Run (or join) the one probe in flight for `sessionId`, store its result,
   * and resolve to the verdict. A concurrent caller gets the SAME promise, so
   * `store` runs exactly once and no later, staler probe can clobber it.
   */
  private runProbe(sessionId: string): Promise<AgentLiveness> {
    const existing = this.inFlight.get(sessionId);
    if (existing) return existing;
    const pending = this.probe(sessionId)
      .catch((error: unknown) => {
        // Fail safe — an undecidable probe must never read as a false `dead` —
        // but surface the rejection with session context (finding: silent swallow).
        this.reportProbeError(sessionId, error);
        return 'unknown' as const;
      })
      .then((verdict) => {
        this.store(sessionId, verdict);
        return verdict;
      })
      .finally(() => {
        if (this.inFlight.get(sessionId) === pending) this.inFlight.delete(sessionId);
      });
    this.inFlight.set(sessionId, pending);
    return pending;
  }

  private scheduleRefresh(sessionId: string): void {
    void this.runProbe(sessionId);
  }

  /**
   * Await a probe now and cache the result — explicit warm (host boot / tests).
   * Joins an in-flight background probe rather than racing a second one.
   */
  async refresh(sessionId: string): Promise<AgentLiveness> {
    return this.runProbe(sessionId);
  }

  /** Drop a session's cached verdict on pty exit (Rule 3 resource release). */
  evict(sessionId: string): void {
    this.entries.delete(sessionId);
  }
}
