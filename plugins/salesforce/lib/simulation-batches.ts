import { createHash, randomUUID } from 'node:crypto';
import type { AgentforceLab } from './agentforce-lab.js';
import { labRecord, type LabTurn } from './agentforce-lab-contract.js';
import { parsePreviewContext, type PreviewContextVariable } from './preview-context.js';
import {
  SIMULATION_LIMITS, SIMULATION_RPC, SIMULATIONS_CHANGED_KIND, batchSummary, isBatchDone, isLaneDone, laneCalls, parseSimulationRequest,
  simulationCounts, simulationNext, type SimulationBatch, type SimulationLane, type SimulationRequest,
} from './simulation-contract.js';
import { STUDIO_CHANGED_CHANNEL } from './studio-contract.js';
import { rpcFailure, rpcString, type RpcFailure, type StudioServerContext } from './studio-server-context.js';

export class SimulationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

interface Kv { get<T>(key: string): Promise<T | undefined | null>; set(key: string, value: unknown): Promise<void> }
type Lab = Pick<AgentforceLab, 'start' | 'send' | 'next' | 'evaluate' | 'end'>;

export interface SimulationStart {
  project: string;
  agentPath: string;
  source: string;
  candidate: boolean;
  request: SimulationRequest;
  orgAlias?: string;
  model?: string;
  contextVariables?: PreviewContextVariable[];
  threadId?: string;
  startedBy: 'studio' | 'thread';
}

interface Run {
  project: string;
  batch: SimulationBatch;
  input: SimulationStart;
  stopped: boolean;
  /** Lab sessions of the lanes running now, ended by stop. */
  sessions: Set<string>;
  done: Promise<void>;
}

class Stopped extends Error {}

const indexKey = (project: string) => `studio:simulations:${project || 'global'}`;
const batchKey = (project: string, id: string) => `studio:simulation:${project || 'global'}:${id}`;
const trimTurns = (turns: readonly LabTurn[]): LabTurn[] => turns.map(turn => ({ ...turn, text: turn.text.slice(0, SIMULATION_LIMITS.turnText) }));
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1_000);

/**
 * Batches of parallel AI role-plays over the lab. One running batch per project; each lane ends its
 * lab session, so a batch holds at most `parallel` of the lab's 12 sessions. Records are kept per
 * project (SIMULATION_LIMITS.stored), so a result survives a restart; a batch that was running when
 * the app stopped reads back as `interrupted`.
 */
export class SimulationBatches {
  private runs = new Map<string, Run>();
  private chains = new Map<string, Promise<unknown>>();
  private disposed = false;
  constructor(private readonly o: { lab: Lab; kv: Kv; now(): number; id?(): string; changed?(project: string, batchId: string): void }) {}

  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const next = (this.chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.chains.set(key, next);
    void next.finally(() => { if (this.chains.get(key) === next) this.chains.delete(key); }).catch(() => undefined);
    return next;
  }

  /** Stores the batch and tells the Studio. Writes are serialized per batch, so the newest state lands last. */
  private touch(run: Run): Promise<void> {
    run.batch.counts = simulationCounts(run.batch.lanes);
    const copy = structuredClone(run.batch);
    const saved = this.serial(batchKey(run.project, copy.id), () => this.o.kv.set(batchKey(run.project, copy.id), copy));
    try { this.o.changed?.(run.project, copy.id); } catch { /* realtime is best effort */ }
    return saved.catch(() => undefined);
  }

  private async remember(project: string, id: string): Promise<void> {
    await this.serial(indexKey(project), async () => {
      const ids = ((await this.o.kv.get<string[]>(indexKey(project))) ?? []).filter(row => row !== id);
      ids.push(id);
      const dropped = ids.splice(0, Math.max(0, ids.length - SIMULATION_LIMITS.stored));
      await this.o.kv.set(indexKey(project), ids);
      for (const old of dropped) await this.o.kv.set(batchKey(project, old), null);
    });
  }

  private running(project: string): Run | undefined {
    for (const run of this.runs.values()) if (run.project === project && !isBatchDone(run.batch.status)) return run;
    return undefined;
  }

  async start(input: SimulationStart): Promise<SimulationBatch> {
    if (this.disposed) throw new SimulationError('unavailable', 'The Salesforce plugin is shutting down.');
    if (this.running(input.project)) throw new SimulationError('busy', 'A simulation batch is already running for this project. Stop it or wait for it to finish.');
    const { request } = input;
    const id = this.o.id?.() ?? randomUUID();
    const lanes: SimulationLane[] = [];
    for (const scenario of request.scenarios) {
      for (let repeat = 1; repeat <= request.repeats; repeat++) {
        const { name, ...rest } = scenario;
        lanes.push({ id: `${lanes.length + 1}`, name, repeat, scenario: rest, status: 'queued', turns: [] });
      }
    }
    const batch: SimulationBatch = {
      ...(input.contextVariables?.length ? { contextVariables: structuredClone(input.contextVariables) } : {}),
      id, agentPath: input.agentPath, sourceHash: createHash('sha256').update(input.source).digest('hex'), candidate: input.candidate,
      engine: request.engine, ...(input.orgAlias ? { orgAlias: input.orgAlias } : {}), ...(input.model ? { model: input.model } : {}),
      parallel: Math.min(request.parallel, lanes.length),
      plannedCalls: request.scenarios.reduce((sum, scenario) => sum + laneCalls(scenario, request.engine) * request.repeats, 0),
      status: 'running', startedAt: this.o.now(), startedBy: input.startedBy, ...(input.threadId ? { threadId: input.threadId } : {}),
      counts: simulationCounts(lanes), lanes,
    };
    const run: Run = { project: input.project, batch, input, stopped: false, sessions: new Set(), done: Promise.resolve() };
    const key = `${input.project}\n${id}`;
    this.runs.set(key, run);
    for (const [key, old] of this.runs) if (old !== run && old.project === input.project && isBatchDone(old.batch.status)) this.runs.delete(key);
    try {
      await this.remember(input.project, id);
    } catch (error) {
      // No lane has started. Release the reservation so a storage failure does not
      // leave this project permanently busy until the plugin restarts.
      this.runs.delete(key);
      throw error;
    }
    await this.touch(run);
    run.done = this.drive(run);
    return structuredClone(batch);
  }

  private async drive(run: Run): Promise<void> {
    const queue = [...run.batch.lanes];
    const worker = async () => {
      for (let lane = queue.shift(); lane; lane = queue.shift()) await this.lane(run, lane);
    };
    try {
      await Promise.all(Array.from({ length: run.batch.parallel }, worker));
    } finally {
      for (const lane of run.batch.lanes) if (!isLaneDone(lane.status)) lane.status = 'stopped';
      run.batch.status = run.stopped ? 'stopped' : 'done';
      run.batch.endedAt = this.o.now();
      await this.touch(run);
    }
  }

  private async lane(run: Run, lane: SimulationLane): Promise<void> {
    if (run.stopped) { lane.status = 'stopped'; return; }
    const { input } = run;
    const check = () => { if (run.stopped) throw new Stopped(); };
    lane.status = 'running';
    lane.startedAt = this.o.now();
    void this.touch(run);
    let id = '';
    try {
      const started = await this.o.lab.start({
        engine: input.request.engine, source: input.source, scenario: lane.scenario, path: input.agentPath,
        ...(input.model ? { model: input.model } : {}), ...(input.contextVariables?.length ? { contextVariables: input.contextVariables } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {}),
        // The batch start was approved once (a click, or the guardrail in the thread); its lanes do not ask again.
        startedByUser: true,
      });
      id = started.id;
      run.sessions.add(id);
      lane.sessionId = id;
      lane.turns = trimTurns(started.turns);
      check();
      let text = lane.scenario.opening;
      for (let turn = 1; turn <= lane.scenario.maxTurns; turn++) {
        const reply = await this.o.lab.send({ id, text });
        lane.turns = trimTurns(reply.turns);
        void this.touch(run);
        check();
        if (turn === lane.scenario.maxTurns) break;
        text = (await this.o.lab.next({ id })).text;
        check();
      }
      const { verdict } = await this.o.lab.evaluate({ id });
      lane.verdict = verdict;
      lane.status = verdict.outcome;
    } catch (error) {
      if (run.stopped || error instanceof Stopped) lane.status = 'stopped';
      else { lane.status = 'error'; lane.error = message(error); }
    } finally {
      if (id) {
        run.sessions.delete(id);
        try { this.o.lab.end({ id }); } catch { /* already expired */ }
      }
      delete lane.sessionId;
      lane.endedAt = this.o.now();
      await this.touch(run);
    }
  }

  /** A stored (not live) batch still marked running was cut off by a restart: it is interrupted, its unfinished lanes stopped. */
  private settle(batch: SimulationBatch): SimulationBatch {
    if (isBatchDone(batch.status)) return batch;
    const lanes = batch.lanes.map(lane => isLaneDone(lane.status) ? lane : { ...lane, status: 'stopped' as const });
    return { ...batch, status: 'interrupted', lanes, counts: simulationCounts(lanes) };
  }

  private async read(project: string, id: string): Promise<SimulationBatch | null> {
    const live = this.runs.get(`${project}\n${id}`);
    if (live) return structuredClone(live.batch);
    const stored = await this.o.kv.get<SimulationBatch>(batchKey(project, id));
    return stored && typeof stored === 'object' && Array.isArray(stored.lanes) ? this.settle(stored) : null;
  }

  /** `waitMs` waits (at most SIMULATION_LIMITS.waitMs) for a running batch to finish. */
  async get(project: string, id: string, waitMs = 0): Promise<SimulationBatch> {
    const live = this.runs.get(`${project}\n${id}`);
    if (live && !isBatchDone(live.batch.status) && waitMs > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([live.done.catch(() => undefined), new Promise(resolve => { timer = setTimeout(resolve, Math.min(waitMs, SIMULATION_LIMITS.waitMs)); })]);
      clearTimeout(timer);
    }
    const batch = await this.read(project, id);
    if (!batch) throw new SimulationError('not_found', 'This simulation batch does not exist in this project.');
    return batch;
  }

  /** Newest first, without transcripts. */
  async list(project: string, agentPath?: string): Promise<SimulationBatch[]> {
    const ids = (await this.o.kv.get<string[]>(indexKey(project))) ?? [];
    const rows: SimulationBatch[] = [];
    for (const id of [...ids].reverse()) {
      const batch = await this.read(project, id);
      if (batch && (!agentPath || batch.agentPath === agentPath)) rows.push(batchSummary(batch));
    }
    return rows;
  }

  /** Stops queued lanes, ends the running sessions and waits briefly for the lanes to settle. */
  async stop(project: string, id: string): Promise<SimulationBatch> {
    const run = this.runs.get(`${project}\n${id}`);
    if (!run) return this.get(project, id);
    if (!isBatchDone(run.batch.status)) {
      run.stopped = true;
      for (const session of run.sessions) { try { this.o.lab.end({ id: session }); } catch { /* already ended */ } }
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([run.done.catch(() => undefined), new Promise(resolve => { timer = setTimeout(resolve, 5_000); })]);
      clearTimeout(timer);
    }
    return structuredClone(run.batch);
  }

  /** The lab aborts its own sessions on dispose; this only stops the lanes from starting new work. */
  dispose(): void {
    this.disposed = true;
    for (const run of this.runs.values()) run.stopped = true;
  }
}

export interface SimulationOptions {
  /** The agent at a project-relative path: the saved source on disk. Also confirms the path is a local agent. */
  agent(path: string): Promise<{ apiName: string; source: string } | RpcFailure>;
  /** Approves the batch once: a Studio click is the approval, an agent start confirms in its thread. Returns the org alias. */
  authorize(request: { engine: SimulationRequest['engine']; threadId: string; startedByUser: boolean }): Promise<{ orgAlias: string }>;
  id?(): string;
}

/** studio.simulations.start / get / list / stop. */
export function registerSimulations(studio: StudioServerContext, options: SimulationOptions): SimulationBatches {
  const project = () => studio.contexts.current()?.projectId ?? '';
  const batches = new SimulationBatches({
    lab: studio.lab, kv: studio.zcc.storage.kv, now: () => studio.deps.now(), ...(options.id ? { id: options.id } : {}),
    changed: (projectId, batchId) => studio.zcc.realtime.publish(STUDIO_CHANGED_CHANNEL, { projectId, kind: SIMULATIONS_CHANGED_KIND, batchId }),
  });
  studio.zcc.onDispose(() => batches.dispose());
  const guard = async (work: () => Promise<unknown>) => {
    try { return await work(); }
    catch (error) { return error instanceof SimulationError ? rpcFailure(error.code, error.message) : rpcFailure('failed', message(error)); }
  };
  const batchId = (args: unknown) => {
    const id = rpcString(args, 'batchId');
    if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) throw new SimulationError('invalid_input', 'Provide the batchId simulations.start returned.');
    return id;
  };

  studio.registerRpc(SIMULATION_RPC.start, args => guard(async () => {
    const row = labRecord(args);
    const agentPath = rpcString(args, 'agentPath');
    if (!agentPath) throw new SimulationError('invalid_input', 'Provide agentPath, the local .agent file to simulate.');
    let request: SimulationRequest;
    let contextVariables: PreviewContextVariable[];
    try {
      request = parseSimulationRequest(row);
      contextVariables = parsePreviewContext(row.contextVariables);
    } catch (error) { throw new SimulationError('invalid_input', message(error)); }
    const model = rpcString(args, 'model');
    if (model && !/^[a-zA-Z0-9_]{1,160}$/.test(model)) throw new SimulationError('invalid_input', 'Choose a valid Salesforce model API name.');
    const found = await options.agent(agentPath);
    if ('ok' in found) throw new SimulationError(found.code, found.error);
    const candidate = typeof row.source === 'string' && row.source.trim() ? row.source : '';
    const source = candidate || found.source;
    if (!source.trim()) throw new SimulationError('invalid_input', 'The agent file is empty.');
    const threadId = rpcString(args, 'threadId');
    const startedByUser = row.startedByUser === true;
    const { orgAlias } = await options.authorize({ engine: request.engine, threadId, startedByUser });
    const batch = await batches.start({
      project: project(), agentPath, source, candidate: Boolean(candidate) && candidate !== found.source, request, orgAlias,
      ...(model ? { model } : {}), ...(contextVariables.length ? { contextVariables } : {}), ...(threadId ? { threadId } : {}),
      startedBy: startedByUser || !threadId ? 'studio' : 'thread',
    });
    return { ok: true, batch, next: `Started ${batch.counts.total} conversations, ${batch.parallel} at a time. Read simulations.result {batchId: "${batch.id}", waitMs: 60000}; to show it, put ::sf-simulation{batchId="${batch.id}"} on its own line in your reply, or ui.command simulations.open {batchId} in an open Studio.` };
  }));
  studio.registerRpc(SIMULATION_RPC.get, args => guard(async () => {
    const wait = labRecord(args).waitMs;
    const waitMs = typeof wait === 'number' && Number.isFinite(wait) ? Math.max(0, Math.min(wait, SIMULATION_LIMITS.waitMs)) : 0;
    const batch = await batches.get(project(), batchId(args), waitMs);
    return { ok: true, batch: labRecord(args).transcripts === false ? batchSummary(batch) : batch, next: simulationNext(batch) };
  }));
  studio.registerRpc(SIMULATION_RPC.list, args => guard(async () => ({ ok: true, batches: await batches.list(project(), rpcString(args, 'agentPath') || undefined) })));
  studio.registerRpc(SIMULATION_RPC.stop, args => guard(async () => ({ ok: true, batch: await batches.stop(project(), batchId(args)) })));
  return batches;
}
