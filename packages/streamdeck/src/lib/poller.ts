/**
 * Poll loop — periodically pulls the live agent list from the control plane and
 * hands it to a callback (which rebuilds the grid). Replaces the showcase's
 * log-tailing status thread; here the data is authoritative, so there's no
 * heuristic guessing, just a fixed-interval snapshot.
 *
 * Kept deliberately dumb: it owns only the timer. Rendering and diffing live in
 * the caller so this stays trivially testable (inject a fake ZccSource, advance
 * fake timers, assert the callback fired with the parsed rows).
 */

import type { ZccSource } from './zcc-source.js';
import type { AgentListItem } from './types.js';

export interface PollerOpts {
  intervalMs?: number;
  /** Return false to skip a tick (e.g. the deck is on a non-agent page). */
  shouldPoll?: () => boolean;
}

export class AgentPoller {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly source: ZccSource,
    private readonly onSnapshot: (agents: AgentListItem[]) => void,
    private readonly opts: PollerOpts = {}
  ) {}

  start(): void {
    if (this.timer) return;
    const interval = this.opts.intervalMs ?? 1_500;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Fetch a snapshot right now, bypassing the interval AND the `shouldPoll`
   * gate. Used when the user opens the agents view so the grid populates
   * immediately instead of waiting up to `intervalMs` for the next tick.
   */
  async pollNow(): Promise<void> {
    const agents = await this.source.listAgents();
    this.onSnapshot(agents);
  }

  private async tick(): Promise<void> {
    if (this.opts.shouldPoll && !this.opts.shouldPoll()) return;
    const agents = await this.source.listAgents();
    this.onSnapshot(agents);
  }
}
