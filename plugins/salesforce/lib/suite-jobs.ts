import { randomUUID } from 'node:crypto';

interface Job {
  jobId: string; project: string; requestId?: string; fingerprint: string;
  status: 'running' | 'completed' | 'failed' | 'stopped'; startedAt: number;
  result?: unknown; error?: string; controller: AbortController;
}

/** Short RPCs own bounded background work. A retry never launches another run. */
export class SuiteJobs {
  private jobs = new Map<string, Job>();
  private disposed = false;
  constructor(private readonly now: () => number = Date.now) {}
  start(project: string, requestId: string | undefined, fingerprint: string, work: (signal: AbortSignal) => Promise<unknown>) {
    if (this.disposed) throw Error('Studio has closed. Reload before starting a suite.');
    if (requestId && (!/^[\w.-]{1,100}$/.test(requestId))) throw Error('Use a requestId of 1–100 letters, digits, dots or dashes.');
    const prior = requestId && [...this.jobs.values()].find(j => j.project === project && j.requestId === requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw Error('This requestId already belongs to different suite input.');
      return this.snapshot(prior);
    }
    if ([...this.jobs.values()].some(j => j.project === project && j.status === 'running')) throw Error('A suite is already running for this project. Read its progress before retrying.');
    for (const [id, job] of this.jobs) if (job.status !== 'running' && (this.jobs.size >= 40 || this.now() - job.startedAt > 86_400_000)) this.jobs.delete(id);
    if (this.jobs.size >= 40) throw Error('Studio suite capacity reached. Wait for a running suite to finish.');
    const job: Job = { jobId: randomUUID(), project, requestId, fingerprint, status: 'running', startedAt: this.now(), controller: new AbortController() };
    this.jobs.set(job.jobId, job);
    // Schedule after the handle is installed, preserving the caller's project context.
    void Promise.resolve().then(() => work(job.controller.signal)).then(result => {
      if (job.status !== 'running') return;
      if (JSON.stringify(result).length > 750_000) { job.error = 'Run finished; detailed reply exceeds the display limit. Read saved suite results.'; job.status = 'failed'; return; }
      job.result = result; job.status = 'completed';
    }, error => {
      if (job.status !== 'running') return;
      job.error = String(error instanceof Error ? error.message : error).slice(0, 1000); job.status = 'failed';
    });
    return this.snapshot(job);
  }
  private owned(project: string, id: string): Job {
    const job = this.jobs.get(id);
    if (!job || job.project !== project) throw Error('This suite job expired or belongs to another project. Check saved suite results before starting another run.');
    return job;
  }
  private snapshot(job: Job) {
    return { jobId: job.jobId, status: job.status, startedAt: job.startedAt, ...(job.result !== undefined ? { result: job.result } : {}), ...(job.error ? { error: job.error } : {}) };
  }
  latest(project: string) {
    const job = [...this.jobs.values()].reverse().find(j => j.project === project && j.status === 'running');
    return job ? this.snapshot(job) : null;
  }
  get(project: string, id: string) { return this.snapshot(this.owned(project, id)); }
  stop(project: string, id: string) {
    const job = this.owned(project, id);
    if (job.status === 'running') { job.status = 'stopped'; job.controller.abort(); }
    return this.snapshot(job);
  }
  dispose() {
    this.disposed = true;
    for (const job of this.jobs.values()) job.controller.abort();
    this.jobs.clear();
  }
}
