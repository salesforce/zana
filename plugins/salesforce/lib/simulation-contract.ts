/**
 * Simulation lab: a batch of AI role-plays run in parallel against one agent source.
 * Isomorphic: imported by the server (lib/simulation-batches.ts) and the Studio (src/app/studio/*). No node imports.
 *
 * Each lane is one conversation: an AI customer plays a scenario, the agent answers (Simulate or Rehearse)
 * and an AI judge grades the transcript against the scenario's criteria. Verdicts are AI opinions; they
 * never count as Release or activation evidence.
 */
import { LAB_SCENARIOS, labRecord, parseLabScenario, type LabEngine, type LabScenario, type LabTurn, type LabVerdict } from './agentforce-lab-contract.js';
import { parsePreviewContext, type PreviewContextVariable } from './preview-context.js';

export const SIMULATION_RPC = {
  /** {agentPath, source?, engine?, scenarios?, repeats?, parallel?, model?, contextVariables?, threadId?, startedByUser?} -> {ok, batch} */
  start: 'studio.simulations.start',
  /** {batchId, waitMs?, transcripts?} -> {ok, batch, next} */
  get: 'studio.simulations.get',
  /** {agentPath?} -> {ok, batches: SimulationBatch[] without transcripts} newest first */
  list: 'studio.simulations.list',
  /** {batchId} -> {ok, batch} */
  stop: 'studio.simulations.stop',
} as const;

export const SIMULATION_LIMITS = {
  /** Lanes per batch (scenarios × repeats). The lab holds at most 12 sessions at once. */
  lanes: 12,
  /** Lanes running at the same time. */
  parallel: 4,
  repeats: 3,
  /** Planned Salesforce model calls per batch: customer turns, rehearsal replies and one judge call per lane. */
  calls: 120,
  /** Batches kept per project. */
  stored: 20,
  /** Characters kept per stored turn. */
  turnText: 2_000,
  /** Longest simulations.result wait. */
  waitMs: 60_000,
  name: 80,
} as const;

/** The realtime kind on STUDIO_CHANGED_CHANNEL when a batch changes: {projectId, kind: 'simulations', batchId}. */
export const SIMULATIONS_CHANGED_KIND = 'simulations';

export type LaneStatus = 'queued' | 'running' | 'pass' | 'fail' | 'inconclusive' | 'error' | 'stopped';
/** `interrupted`: the app restarted while the batch ran; its unfinished lanes are stopped. */
export type BatchStatus = 'running' | 'done' | 'stopped' | 'interrupted';

export interface SimulationLane {
  id: string;
  name: string;
  /** 1-based repeat of the same scenario. */
  repeat: number;
  scenario: Omit<SimulationScenarioInput, 'name'>;
  /** Detached effective starting values, after scenario overrides replace batch defaults. */
  contextVariables?: PreviewContextVariable[];
  status: LaneStatus;
  turns: LabTurn[];
  verdict?: LabVerdict;
  error?: string;
  /** Lab session id while the lane runs; ended when it finishes. */
  sessionId?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface SimulationCounts { total: number; pass: number; fail: number; inconclusive: number; error: number; stopped: number; running: number; queued: number }

export interface SimulationBatch {
  contextVariables?: import('./preview-context.js').PreviewContextVariable[];
  id: string;
  agentPath: string;
  /** sha256 of the source the lanes ran: a candidate differs from the saved file. */
  sourceHash: string;
  /** True when the caller supplied the source (an editor draft or candidate), not the saved file. */
  candidate: boolean;
  engine: LabEngine;
  orgAlias?: string;
  model?: string;
  parallel: number;
  plannedCalls: number;
  status: BatchStatus;
  startedAt: number;
  endedAt?: number;
  startedBy: 'studio' | 'thread';
  threadId?: string;
  counts: SimulationCounts;
  lanes: SimulationLane[];
}

export interface SimulationScenarioInput extends LabScenario { name: string; contextVariables?: PreviewContextVariable[] }

/** Validate the combined context too: individually valid sets can exceed the shared limits. */
export function simulationContext(defaults?: PreviewContextVariable[], overrides?: PreviewContextVariable[]): PreviewContextVariable[] {
  const merged = new Map(parsePreviewContext(defaults).map(row => [row.name, row]));
  for (const row of parsePreviewContext(overrides)) merged.set(row.name, row);
  return parsePreviewContext([...merged.values()]);
}

export interface SimulationRequest {
  scenarios: SimulationScenarioInput[];
  repeats: number;
  parallel: number;
  engine: LabEngine;
}

const DONE: readonly LaneStatus[] = ['pass', 'fail', 'inconclusive', 'error', 'stopped'];
export const isLaneDone = (status: LaneStatus) => DONE.includes(status);
export const isBatchDone = (status: BatchStatus) => status !== 'running';

export function simulationCounts(lanes: readonly Pick<SimulationLane, 'status'>[]): SimulationCounts {
  const counts: SimulationCounts = { total: lanes.length, pass: 0, fail: 0, inconclusive: 0, error: 0, stopped: 0, running: 0, queued: 0 };
  for (const lane of lanes) counts[lane.status] += 1;
  return counts;
}

/** Model calls a lane spends: one customer turn per agent turn after the first, one rehearsal reply per turn, one judge call. */
export function laneCalls(scenario: Pick<LabScenario, 'maxTurns'>, engine: LabEngine): number {
  return Math.max(0, scenario.maxTurns - 1) + (engine === 'rehearsal' ? scenario.maxTurns : 0) + 1;
}

function intIn(value: unknown, label: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return Number(value);
}

/** Validates a batch request. Without scenarios the lab's three presets run. Throws a readable Error. */
export function parseSimulationRequest(input: unknown): SimulationRequest {
  const row = labRecord(input);
  const raw = row.scenarios === undefined ? LAB_SCENARIOS.map(preset => ({ name: preset.name, ...preset.scenario })) : row.scenarios;
  if (!Array.isArray(raw) || !raw.length || raw.length > SIMULATION_LIMITS.lanes) throw new Error(`Provide 1 to ${SIMULATION_LIMITS.lanes} scenarios.`);
  const scenarios = raw.map((item, index) => {
    const name = labRecord(item).name;
    if (name !== undefined && (typeof name !== 'string' || name.length > SIMULATION_LIMITS.name)) throw new Error(`Scenario ${index + 1}: name must be at most ${SIMULATION_LIMITS.name} characters.`);
    let scenario: LabScenario;
    let contextVariables: PreviewContextVariable[];
    try { scenario = parseLabScenario(item); contextVariables = parsePreviewContext(labRecord(item).contextVariables); } catch (error) { throw new Error(`Scenario ${index + 1}: ${(error as Error).message}`); }
    return { name: (typeof name === 'string' && name.trim()) || `Scenario ${index + 1}`, ...scenario, ...(contextVariables.length ? { contextVariables } : {}) };
  });
  const repeats = intIn(row.repeats, 'repeats', 1, SIMULATION_LIMITS.repeats, 1);
  if (scenarios.length * repeats > SIMULATION_LIMITS.lanes) throw new Error(`scenarios × repeats must be at most ${SIMULATION_LIMITS.lanes} conversations.`);
  const parallel = intIn(row.parallel, 'parallel', 1, SIMULATION_LIMITS.parallel, SIMULATION_LIMITS.parallel);
  if (row.engine !== undefined && row.engine !== 'preview' && row.engine !== 'rehearsal') throw new Error('engine must be preview (Simulate) or rehearsal.');
  const engine: LabEngine = row.engine === 'rehearsal' ? 'rehearsal' : 'preview';
  const planned = scenarios.reduce((sum, scenario) => sum + laneCalls(scenario, engine) * repeats, 0);
  if (planned > SIMULATION_LIMITS.calls) throw new Error(`This batch plans ${planned} model calls; the limit is ${SIMULATION_LIMITS.calls}. Use fewer scenarios, repeats or turns.`);
  return { scenarios, repeats, parallel, engine };
}

/** What the agent should do with a batch it read. */
export function simulationNext(batch: Pick<SimulationBatch, 'status' | 'counts' | 'id'>): string {
  const { counts } = batch;
  if (batch.status === 'running') return `${counts.running} running, ${counts.queued} queued. Read simulations.result again with waitMs to wait for the rest.`;
  const failing = counts.fail + counts.inconclusive + counts.error;
  if (!failing) return `All ${counts.total} conversations pass. Report the result; to check stability, run the batch again with repeats.`;
  return `${failing} of ${counts.total} conversations did not pass. Read their verdict evidence and transcripts, group them by cause, then propose a script change with ui.command editor.proposeEdit and re-run the batch with the candidate source. Never deploy or publish.`;
}

/** The batch without transcripts: for lists and compact results. */
export function batchSummary(batch: SimulationBatch): SimulationBatch {
  return { ...batch, lanes: batch.lanes.map(({ turns: _turns, ...lane }) => ({ ...lane, turns: [] })) };
}
