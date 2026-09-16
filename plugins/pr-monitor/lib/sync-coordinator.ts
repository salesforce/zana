import type { MonitoredPr, PrStatusDelta, SyncHealth } from './types.js';

export type SyncJobState = {
  id: number;
  state: 'idle' | 'running' | 'succeeded' | 'failed';
  scope: 'all' | 'repos';
  repos?: string[];
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  prs?: MonitoredPr[];
  deltas?: PrStatusDelta[];
  health?: SyncHealth;
};

type SyncResult = Omit<SyncJobState, 'id' | 'state' | 'scope' | 'repos' | 'startedAt' | 'finishedAt'> & { ok: boolean };

/** One durable owner prevents background and renderer RPCs from overlapping. */
export class SyncCoordinator {
  private job: SyncJobState = { id: 0, state: 'idle', scope: 'all' };
  private running: Promise<SyncJobState> | undefined;

  start(
    scope: 'all' | 'repos',
    repos: string[] | undefined,
    run: () => Promise<SyncResult>
  ): SyncJobState {
    if (this.running) return this.snapshot();
    const id = this.job.id + 1;
    this.job = { id, state: 'running', scope, repos, startedAt: Date.now() };
    this.running = run()
      .then((result) => {
        this.job = {
          ...this.job,
          state: result.ok ? 'succeeded' : 'failed',
          finishedAt: Date.now(),
          error: result.error,
          prs: result.prs,
          deltas: result.deltas,
          health: result.health,
        };
        return this.snapshot();
      })
      .catch((error) => {
        this.job = {
          ...this.job,
          state: 'failed',
          finishedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        };
        return this.snapshot();
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.snapshot();
  }

  async wait(): Promise<SyncJobState> {
    return this.running ? this.running : this.snapshot();
  }

  snapshot(): SyncJobState {
    return {
      ...this.job,
      repos: this.job.repos ? [...this.job.repos] : undefined,
      prs: this.job.prs ? [...this.job.prs] : undefined,
      deltas: this.job.deltas ? [...this.job.deltas] : undefined,
    };
  }
}
