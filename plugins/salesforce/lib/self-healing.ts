import { createHash, randomUUID } from 'node:crypto';
import { labRecord } from './agentforce-lab-contract.js';
import { parseAgentScriptSource } from './agent-script-parse.js';
import type { SimulationBatches, SimulationOptions } from './simulation-batches.js';
import type { SimulationBatch, SimulationRequest } from './simulation-contract.js';
import { AGENT_SOURCE_MAX, STUDIO_CHANGED_CHANNEL } from './studio-contract.js';
import { rpcFailure, rpcString, type StudioServerContext } from './studio-server-context.js';
import { SELF_HEALING_LIMITS, SELF_HEALING_RPC, selfHealingActive, selfHealingNext, type SelfHealingRun } from './self-healing-contract.js';

const hash = (source: string) => createHash('sha256').update(source).digest('hex');
class HealingError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
interface Session {
  project: string; run: SelfHealingRun; baseline: SimulationBatch; best: SimulationBatch;
  bestSource: string; pendingSource?: string; claiming: boolean;
}
type Options = Pick<SimulationOptions, 'agent' | 'authorize'> & {
  batches: Pick<SimulationBatches, 'get' | 'start' | 'stop'>;
  now(): number; id?(): string; changed?(project: string): void;
};

/** The author is the Zana thread agent; this controller owns budgets and evidence. No file writes. */
export class SelfHealingRuns {
  private sessions = new Map<string, Session>();
  private disposed = false;
  constructor(private readonly o: Options) {}
  private change(s: Session) { s.run.updatedAt = this.o.now(); this.o.changed?.(s.project); }
  private find(project: string, id: string): Session {
    const s = this.sessions.get(id);
    if (!s || s.project !== project) throw new HealingError('not_found', 'This self-healing run expired or belongs to another project. Start a new run.');
    if (selfHealingActive(s.run) && this.o.now() - s.run.updatedAt >= SELF_HEALING_LIMITS.idleMs) {
      s.run.status = 'expired';
      const batchId = s.run.attempts.at(-1)?.batchId;
      if (batchId) void this.o.batches.stop(project, batchId).catch(() => undefined);
      this.change(s);
    }
    return s;
  }
  private async agent(path: string) {
    const agent = await this.o.agent(path);
    if ('ok' in agent) throw new HealingError(agent.code, agent.error);
    return agent;
  }
  async start(project: string, input: unknown): Promise<SelfHealingRun> {
    if (this.disposed) throw new HealingError('unavailable', 'The Salesforce plugin is shutting down.');
    const row = labRecord(input);
    const maxAttempts = row.maxAttempts === undefined ? 3 : row.maxAttempts;
    if (!Number.isInteger(maxAttempts) || Number(maxAttempts) < 1 || Number(maxAttempts) > SELF_HEALING_LIMITS.attempts) throw new HealingError('invalid_input', 'Choose 1–5 candidate attempts.');
    const baseline = await this.o.batches.get(project, rpcString(input, 'batchId'));
    if (baseline.status !== 'done' || baseline.engine !== 'preview' || baseline.counts.error || baseline.counts.stopped) throw new HealingError('invalid_baseline', 'Finish a Simulate batch without errors before starting self-healing.');
    if (baseline.counts.pass === baseline.counts.total) throw new HealingError('already_passed', 'All conversations already pass. No repair is needed.');
    const agent = await this.agent(baseline.agentPath);
    const source = typeof row.source === 'string' ? row.source : agent.source;
    if (hash(source) !== baseline.sourceHash) throw new HealingError('source_changed', 'The editor source differs from this batch. Run the current source before starting self-healing.');
    for (const prior of this.sessions.values()) {
      if (prior.project === project && prior.run.agentPath === baseline.agentPath && selfHealingActive(this.find(project, prior.run.id).run)) throw new HealingError('busy', 'Self-healing is already active for this agent. Continue or stop that run.');
    }
    while (this.sessions.size >= SELF_HEALING_LIMITS.stored) {
      const old = [...this.sessions.values()].find(s => !selfHealingActive(this.find(s.project, s.run.id).run));
      if (!old) throw new HealingError('busy', 'Too many active self-healing runs. Stop one first.');
      this.sessions.delete(old.run.id);
    }
    const now = this.o.now();
    const run: SelfHealingRun = {
      id: this.o.id?.() ?? randomUUID(), agentPath: baseline.agentPath, baselineBatchId: baseline.id,
      baselineHash: baseline.sourceHash, savedHash: hash(agent.source), baselinePass: baseline.counts.pass,
      total: baseline.counts.total, bestPass: baseline.counts.pass, bestHash: baseline.sourceHash, bestBatchId: baseline.id,
      maxAttempts: Number(maxAttempts), attempts: [], status: 'awaiting_candidate', startedAt: now, updatedAt: now,
    };
    this.sessions.set(run.id, { project, run, baseline, best: baseline, bestSource: source, claiming: false });
    return structuredClone(run);
  }
  async evaluate(project: string, input: unknown): Promise<SelfHealingRun> {
    const s = this.find(project, rpcString(input, 'runId'));
    if (this.disposed || s.run.status !== 'awaiting_candidate' || s.claiming) throw new HealingError('not_ready', 'This run is not awaiting a candidate. Read selfHealing.status.');
    const source = labRecord(input).source;
    if (typeof source !== 'string' || !source.trim() || source.length > AGENT_SOURCE_MAX) throw new HealingError('invalid_input', 'Provide a nonempty candidate source of at most 10 MB.');
    const sourceHash = hash(source);
    if (sourceHash === s.run.baselineHash || s.run.attempts.some(a => a.sourceHash === sourceHash)) throw new HealingError('duplicate_candidate', 'This source was already tested. Diagnose the evidence before trying a new candidate.');
    if (parseAgentScriptSource(source, 'agentforce').hasErrors) throw new HealingError('invalid_source', 'The candidate has syntax errors. Fix them before spending a simulation attempt.');
    s.claiming = true;
    try {
      if (hash((await this.agent(s.run.agentPath)).source) !== s.run.savedHash) throw new HealingError('source_changed', 'The saved agent changed. Stop this run and test the current source.');
      const { orgAlias } = await this.o.authorize({ engine: 'preview', threadId: rpcString(input, 'threadId'), startedByUser: labRecord(input).startedByUser === true });
      if (s.baseline.orgAlias && s.baseline.orgAlias !== orgAlias) throw new HealingError('org_changed', 'The selected org changed. Start a new baseline in this org.');
      if (!selfHealingActive(s.run) || this.disposed) throw new HealingError('not_ready', 'This run was stopped.');
      const request: SimulationRequest = {
        scenarios: s.baseline.lanes.filter(l => l.repeat === 1).map(l => ({ name: l.name, ...l.scenario })),
        repeats: Math.max(...s.baseline.lanes.map(l => l.repeat)), parallel: s.baseline.parallel, engine: 'preview',
      };
      const batch = await this.o.batches.start({ project, agentPath: s.run.agentPath, source, candidate: true, request, orgAlias,
        ...(s.baseline.model ? { model: s.baseline.model } : {}), contextVariables: s.baseline.contextVariables,
        threadId: rpcString(input, 'threadId'), startedBy: 'thread' });
      if (!selfHealingActive(s.run) || this.disposed) { await this.o.batches.stop(project, batch.id); throw new HealingError('not_ready', 'This run was stopped.'); }
      s.pendingSource = source;
      s.run.attempts.push({ number: s.run.attempts.length + 1, sourceHash, batchId: batch.id, total: batch.counts.total, outcome: 'testing', regressions: [] });
      s.run.status = 'testing'; this.change(s);
      return structuredClone(s.run);
    } finally { s.claiming = false; }
  }
  async status(project: string, input: unknown): Promise<{ run: SelfHealingRun | null; source?: string }> {
    const id = rpcString(input, 'runId');
    const s = id ? this.find(project, id) : [...this.sessions.values()].reverse().find(s => s.project === project && s.run.agentPath === rpcString(input, 'agentPath'));
    if (!s) return { run: null };
    this.find(project, s.run.id);
    const attempt = s.run.attempts.at(-1);
    if (s.run.status === 'testing' && attempt?.batchId) {
      const wait = labRecord(input).waitMs;
      const waitMs = typeof wait === 'number' && Number.isFinite(wait) ? Math.max(0, Math.min(wait, 30_000)) : 0;
      const batch = await this.o.batches.get(project, attempt.batchId, waitMs);
      if (s.run.status === 'testing' && attempt.outcome === 'testing' && batch.status !== 'running') {
        attempt.pass = batch.counts.pass;
        attempt.regressions = s.best.lanes.filter(l => l.status === 'pass' && batch.lanes.find(c => c.id === l.id)?.status !== 'pass').map(l => l.repeat > 1 ? `${l.name} #${l.repeat}` : l.name);
        const complete = batch.status === 'done' && !batch.counts.error && !batch.counts.stopped;
        attempt.outcome = !complete ? 'incomplete' : attempt.regressions.length ? 'regression' : batch.counts.pass > s.run.bestPass ? 'improved' : 'unchanged';
        if (attempt.outcome === 'improved') {
          s.best = batch; s.bestSource = s.pendingSource!;
          s.run.bestPass = batch.counts.pass; s.run.bestHash = batch.sourceHash; s.run.bestBatchId = batch.id;
        }
        s.pendingSource = undefined;
        s.run.status = s.run.bestPass === s.run.total ? 'passed' : s.run.attempts.length >= s.run.maxAttempts ? 'exhausted' : 'awaiting_candidate';
        this.change(s);
      }
    }
    return { run: structuredClone(s.run), ...(labRecord(input).includeSource === true ? { source: s.bestSource } : {}) };
  }
  async stop(project: string, id: string): Promise<SelfHealingRun> {
    const s = this.find(project, id);
    if (selfHealingActive(s.run)) {
      s.run.status = 'stopped'; s.pendingSource = undefined; this.change(s);
      const batchId = s.run.attempts.at(-1)?.batchId;
      if (batchId) await this.o.batches.stop(project, batchId);
    }
    return structuredClone(s.run);
  }
  dispose() { this.disposed = true; for (const s of this.sessions.values()) if (selfHealingActive(s.run)) s.run.status = 'stopped'; }
}

export function registerSelfHealing(studio: StudioServerContext, options: Options) {
  const runs = new SelfHealingRuns({ ...options, changed: projectId => studio.zcc.realtime.publish(STUDIO_CHANGED_CHANNEL, { projectId, kind: 'selfHealing' }) });
  const project = () => studio.contexts.current()?.projectId ?? '';
  const guard = async (work: () => Promise<{ run: SelfHealingRun | null; source?: string }>) => {
    try { const result = await work(); return { ok: true, ...result, ...(result.run ? { next: selfHealingNext(result.run) } : {}) }; }
    catch (error) { return rpcFailure(error instanceof HealingError ? error.code : 'failed', (error instanceof Error ? error.message : String(error)).slice(0, 1000)); }
  };
  studio.registerRpc(SELF_HEALING_RPC.start, args => guard(async () => ({ run: await runs.start(project(), args) })));
  studio.registerRpc(SELF_HEALING_RPC.evaluate, args => guard(async () => ({ run: await runs.evaluate(project(), args) })));
  studio.registerRpc(SELF_HEALING_RPC.status, args => guard(() => runs.status(project(), args)));
  studio.registerRpc(SELF_HEALING_RPC.stop, args => guard(async () => ({ run: await runs.stop(project(), rpcString(args, 'runId')) })));
  studio.zcc.onDispose(() => runs.dispose());
  return runs;
}
