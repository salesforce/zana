import type { MonitoredPr, PrStatusDelta, SyncHealth } from './types.js';

export const SYNC_STATUS_POLL_INTERVAL_MS = 250;
export const SYNC_STATUS_MAX_WAIT_MS = 5 * 60_000;

export type SyncJobState = {
  id: number;
  state: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';
  scope: 'all' | 'repos';
  repos?: string[];
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  prs?: MonitoredPr[];
  deltas?: PrStatusDelta[];
  health?: SyncHealth;
};

export type SyncResult = Omit<SyncJobState, 'id' | 'state' | 'scope' | 'repos' | 'startedAt' | 'finishedAt'> & { ok: boolean };
type SyncRunner = (scope: SyncJobState['scope'], repos?: string[]) => Promise<SyncResult>;

/** One durable owner serializes syncs and runs completion effects exactly once. */
export class SyncCoordinator {
  private nextId = 0;
  private current: SyncJobState = { id: 0, state: 'idle', scope: 'all' };
  private queued: SyncJobState | undefined;
  private jobs = new Map<number, SyncJobState>([[0, this.current]]);

  constructor(
    private readonly run: SyncRunner,
    private readonly onFinished: (job: SyncJobState) => Promise<void>,
    private readonly log: (message: string) => void
  ) {}

  start(scope: 'all' | 'repos', repos?: string[]): SyncJobState {
    const normalized = scope === 'repos' ? Array.from(new Set(repos ?? [])).sort() : undefined;
    if (this.current.state === 'running' && this.covers(this.current, scope, normalized)) return this.snapshot(this.current);
    if (this.queued) {
      this.merge(this.queued, scope, normalized);
      return this.snapshot(this.queued);
    }
    const job: SyncJobState = { id: ++this.nextId, state: this.current.state === 'running' ? 'queued' : 'running', scope, repos: normalized };
    this.jobs.set(job.id, job);
    if (job.state === 'queued') this.queued = job;
    else void this.execute(job);
    return this.snapshot(job);
  }

  status(id?: unknown): SyncJobState {
    return this.snapshot(typeof id === 'number' ? this.jobs.get(id) ?? this.current : this.current);
  }

  private covers(job: SyncJobState, scope: SyncJobState['scope'], repos?: string[]): boolean {
    return job.scope === 'all' || (scope === 'repos' && (repos ?? []).every((repo) => job.repos?.includes(repo)));
  }

  private merge(job: SyncJobState, scope: SyncJobState['scope'], repos?: string[]): void {
    if (scope === 'all') { job.scope = 'all'; job.repos = undefined; return; }
    if (job.scope === 'repos') job.repos = Array.from(new Set([...(job.repos ?? []), ...(repos ?? [])])).sort();
  }

  private async execute(job: SyncJobState): Promise<void> {
    this.current = job;
    job.startedAt = Date.now();
    try {
      const result = await this.run(job.scope, job.repos);
      Object.assign(job, result, { state: result.ok ? 'succeeded' : 'failed', finishedAt: Date.now() });
    } catch (error) {
      job.state = 'failed';
      job.finishedAt = Date.now();
      job.error = error instanceof Error ? error.message : String(error);
      this.log(`sync job ${job.id} (${job.scope}) failed: ${job.error}`);
    }
    try { await this.onFinished(this.snapshot(job)); }
    catch (error) { this.log(`sync job ${job.id} completion failed: ${error instanceof Error ? error.message : String(error)}`); }
    if (this.queued) {
      const next = this.queued;
      this.queued = undefined;
      next.state = 'running';
      void this.execute(next);
    }
  }

  private snapshot(job: SyncJobState): SyncJobState {
    return { ...job, repos: job.repos ? [...job.repos] : undefined, prs: job.prs ? [...job.prs] : undefined, deltas: job.deltas ? [...job.deltas] : undefined };
  }
}
