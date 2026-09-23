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
 * `ssh <probeOpts> -o BatchMode=yes <target> tmux display-message -p -t <name>
 * '#{pane_current_command}'` and classifies the pane command. NEVER throws and
 * NEVER returns a false `dead`: any ssh failure/timeout, or an unrecognized pane
 * command, resolves to `unknown` (fail safe — an undecidable probe must not
 * reclaim a claim). A leading-dash `target` (readable as an ssh flag) short-
 * circuits to `unknown`, mirroring the reattach-probe guard.
 */
export function probeAgentLiveness(params: AgentLivenessProbeParams): Promise<AgentLiveness> {
  const { execFile, target, tmuxName, probeOpts, timeoutMs, classify } = params;
  if (target.startsWith('-')) return Promise.resolve('unknown');
  const args = [
    ...probeOpts,
    '-o', 'BatchMode=yes', // never block on an auth prompt in a background probe
    target,
    'tmux', 'display-message', '-p', '-t', tmuxName, '#{pane_current_command}'
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
 *  - `get` returns the cached verdict only while FRESH; otherwise `unknown`, and
 *    kicks a deduped background probe so the NEXT tick has a fresh verdict. The
 *    reclaim therefore lands ~one reconcile interval (30 s) after the agent dies
 *    — bounded, and far tighter than the 10-min stall ceiling it replaces.
 *  - Only `alive`/`dead` are cached; an `unknown` probe result is NOT stored, so
 *    an undecidable session is re-probed every tick until it resolves (a
 *    telemetry-gap worker keeps being checked rather than pinned at `unknown`).
 *  - `evict` drops a session on pty exit (Rule 3 — release per-session state).
 *
 * The probe is injected (in production, `PtyManager.probeAgentLiveness`, which
 * itself returns `unknown` for local / non-liveness-reporting sessions and never
 * throws), so this class is deterministically unit-testable with a fake probe +
 * fake clock — no live remote host.
 */
export class AgentLivenessCache {
  private readonly entries = new Map<string, LivenessCacheEntry>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly probe: (sessionId: string) => Promise<AgentLiveness>,
    private readonly options: { now?: () => number; staleMs?: number } = {}
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private get staleMs(): number {
    return this.options.staleMs ?? DEFAULT_LIVENESS_STALE_MS;
  }

  get(sessionId: string): AgentLiveness {
    const entry = this.entries.get(sessionId);
    const fresh = entry !== undefined && this.now() - entry.at <= this.staleMs;
    if (!fresh) this.scheduleRefresh(sessionId);
    return fresh ? entry!.verdict : 'unknown';
  }

  private store(sessionId: string, verdict: AgentLiveness): void {
    // Only decisive verdicts are worth caching; an `unknown` is dropped so the
    // session is re-probed on the next tick rather than pinned as unknown.
    if (verdict === 'unknown') this.entries.delete(sessionId);
    else this.entries.set(sessionId, { verdict, at: this.now() });
  }

  private scheduleRefresh(sessionId: string): void {
    if (this.inFlight.has(sessionId)) return;
    this.inFlight.add(sessionId);
    void this.probe(sessionId)
      .then((verdict) => this.store(sessionId, verdict))
      .catch(() => { /* the injected probe never rejects; ignore defensively */ })
      .finally(() => this.inFlight.delete(sessionId));
  }

  /** Await a probe now and cache the result — explicit warm (host boot / tests). */
  async refresh(sessionId: string): Promise<AgentLiveness> {
    const verdict = await this.probe(sessionId).catch(() => 'unknown' as const);
    this.store(sessionId, verdict);
    return verdict;
  }

  /** Drop a session's cached verdict on pty exit (Rule 3 resource release). */
  evict(sessionId: string): void {
    this.entries.delete(sessionId);
  }
}
