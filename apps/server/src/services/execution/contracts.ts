import { createHash } from 'node:crypto';
import type { ExecutionArtifactRecord } from './artifact-store.js';
import type { ExecutionEvent, ExecutionRecord, ExecutionWorkUnit } from './store.js';

export type UsageCompleteness = 'complete' | 'partial' | 'unavailable';
export type UsageSampleKind = 'delivery' | 'heartbeat' | 'outcome' | 'reclaim' | 'terminal';

export interface ExecutionUsageCountersV1 {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  providerCostUsd?: number;
}

export interface ExecutionUsageObservationV1 {
  version: 1;
  observationId: string;
  executionAttempt: number;
  role: 'worker' | 'orchestrator';
  slotId: string;
  sessionId: string;
  workUnitId?: string;
  workAttempt: number;
  claimGeneration: number;
  adapterEpoch: number;
  sampleKind: UsageSampleKind;
  sequence: number;
  provider: string;
  model?: string;
  routingIdentity: string;
  cumulative: ExecutionUsageCountersV1;
  delta: ExecutionUsageCountersV1;
  completeness: UsageCompleteness;
  observedAt: number;
  gap?: 'reset' | 'regression' | 'missing';
  replayFingerprint?: string;
}

export interface ExecutionUsageRollupV1 extends ExecutionUsageCountersV1 {
  version: 1;
  completeness: UsageCompleteness;
  observationCount: number;
  gapCount: number;
  byRole: Array<{
    role: 'worker' | 'orchestrator';
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    providerCostUsd?: number;
  }>;
  cursors?: ExecutionUsageCursorV1[];
  replays?: ExecutionUsageReplayV1[];
}

export interface ExecutionUsageCursorV1 {
  sessionId: string;
  provider: string;
  model?: string;
  routingIdentity: string;
  adapterEpoch: number;
  sequence: number;
  cumulative: ExecutionUsageCountersV1;
  observationId?: string;
  replayFingerprint?: string;
}

export interface ExecutionUsageReplayV1 {
  observationId: string;
  /** Digest of full immutable observation tuple. */
  identity: string;
  sequence: number;
  fingerprint: string;
}

export type ExecutionUsageBaselineV1 = ExecutionUsageRollupV1;

export type StructuredOutputSchemaV1 =
  | { type: 'string'; maxLength?: number; enum?: string[] }
  | { type: 'number' | 'integer' | 'boolean' }
  | { type: 'array'; items: StructuredOutputSchemaV1; maxItems?: number }
  | { type: 'object'; properties: Record<string, StructuredOutputSchemaV1>; required?: string[]; additionalProperties?: false };

export interface WorkOutputDeclarationV1 {
  version: 1;
  schema: StructuredOutputSchemaV1;
}

export interface ExecutionAssembledResultV1 {
  version: 1;
  outcome: 'success' | 'partial' | 'failure';
  summary: string;
  units: Array<{
    id: string;
    title: string;
    state: ExecutionWorkUnit['state'];
    result?: string;
    failureCode?: string;
  }>;
  failures: Array<{ workUnitId: string; code: string }>;
  artifacts: Array<{ name: string; mediaType: string; contentDigest: string }>;
  policy?: { status: string; summary: string };
  verification: Array<{ workUnitId: string; checks: string[] }>;
  usage: ExecutionUsageRollupV1;
  digest: string;
}

export type CoordinatorWakeCause = 'HUMAN_BLOCKER' | 'SEMANTIC_CONFLICT' | 'POLICY_ESCALATION' | 'TYPED_OUTPUT_REPAIR' | 'TERMINAL_SYNTHESIS';
export interface CoordinatorWakeV1 {
  version: 1;
  id: string;
  key: string;
  cause: CoordinatorWakeCause;
  message: string;
  workUnitId?: string;
  stateOrClaimGeneration: string;
  createdAt: number;
}

export interface RouteFitProposalV1 {
  version: 1;
  evaluatorVersion: string;
  active: false;
  outcome: ExecutionAssembledResultV1['outcome'];
  fit: 'underpowered' | 'appropriate' | 'overpowered' | 'indeterminate';
  reason: string;
  evaluatedAt: number;
  samples: number;
  selected: Array<{ workUnitId: string; slotId?: string; provider?: string; model?: string }>;
  proposedRouting?: { minimumLevel?: 'low' | 'medium' | 'high' | 'extra-high' };
}

const MAX_SCHEMA_DEPTH = 6;
const MAX_SCHEMA_PROPERTIES = 64;
const MAX_SCHEMA_ITEMS = 100;
const MAX_STRUCTURED_BYTES = 64 * 1024;
export const MAX_OUTPUT_DECLARATION_BYTES = 16 * 1024;
export const MAX_EXECUTION_PLAN_BYTES = 512 * 1024;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  return JSON.stringify(value) ?? String(value);
}

export function validOutputDeclaration(value: unknown): value is WorkOutputDeclarationV1 {
  return jsonBytes(value) <= MAX_OUTPUT_DECLARATION_BYTES && !!value && typeof value === 'object'
    && hasOnlyKeys(value as Record<string, unknown>, ['version', 'schema'])
    && (value as WorkOutputDeclarationV1).version === 1
    && validSchema((value as WorkOutputDeclarationV1).schema, 0);
}

function validSchema(value: unknown, depth: number): value is StructuredOutputSchemaV1 {
  if (!value || typeof value !== 'object' || depth > MAX_SCHEMA_DEPTH) return false;
  const schema = value as Record<string, unknown>;
  if (schema.type === 'string') {
    return hasOnlyKeys(schema, ['type', 'maxLength', 'enum'])
      && (schema.maxLength === undefined || Number.isInteger(schema.maxLength) && (schema.maxLength as number) > 0 && (schema.maxLength as number) <= MAX_STRUCTURED_BYTES)
      && (schema.enum === undefined || Array.isArray(schema.enum) && schema.enum.length <= MAX_SCHEMA_ITEMS && schema.enum.every((item) => typeof item === 'string' && item.length <= 2_048));
  }
  if (schema.type === 'number' || schema.type === 'integer' || schema.type === 'boolean') return hasOnlyKeys(schema, ['type']);
  if (schema.type === 'array') return hasOnlyKeys(schema, ['type', 'items', 'maxItems']) && validSchema(schema.items, depth + 1)
    && (schema.maxItems === undefined || Number.isInteger(schema.maxItems) && (schema.maxItems as number) >= 0 && (schema.maxItems as number) <= MAX_SCHEMA_ITEMS);
  if (schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) return false;
  const entries = Object.entries(schema.properties as Record<string, unknown>);
  const keys = new Set(entries.map(([key]) => key));
  return hasOnlyKeys(schema, ['type', 'properties', 'required', 'additionalProperties'])
    && entries.length <= MAX_SCHEMA_PROPERTIES && entries.every(([key, child]) => key.length > 0 && key.length <= 256 && validSchema(child, depth + 1))
    && (schema.required === undefined || Array.isArray(schema.required) && schema.required.length <= entries.length && schema.required.every((key) => typeof key === 'string' && keys.has(key)))
    && (schema.additionalProperties === undefined || schema.additionalProperties === false);
}

export function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function jsonBytes(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch { return Number.POSITIVE_INFINITY; }
}

export function validateStructuredJson(value: unknown): { ok: true; value: unknown; canonical: string } | { ok: false; reason: string } {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { return { ok: false, reason: 'structuredResult must be JSON serializable' }; }
  if (serialized === undefined) return { ok: false, reason: 'structuredResult must be JSON serializable' };
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > MAX_STRUCTURED_BYTES) return { ok: false, reason: `structuredResult exceeds ${MAX_STRUCTURED_BYTES} bytes` };
  const parsed = JSON.parse(serialized);
  try { return { ok: true, value: parsed, canonical: canonicalJson(parsed) }; }
  catch { return { ok: false, reason: 'structuredResult must be safely canonicalizable' }; }
}

export function validateStructuredResult(declaration: WorkOutputDeclarationV1, value: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  const bounded = validateStructuredJson(value);
  if (!bounded.ok) return bounded;
  const reason = validateValue(declaration.schema, bounded.value, '$', 0);
  return reason ? { ok: false, reason } : { ok: true, value: bounded.value };
}

function validateValue(schema: StructuredOutputSchemaV1, value: unknown, path: string, depth: number): string | undefined {
  if (depth > MAX_SCHEMA_DEPTH) return `${path} exceeds schema depth`;
  if (schema.type === 'string') {
    if (typeof value !== 'string') return `${path} must be string`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} exceeds maxLength`;
    if (schema.enum && !schema.enum.includes(value)) return `${path} must match enum`;
    return;
  }
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) ? undefined : `${path} must be finite number`;
  if (schema.type === 'integer') return Number.isInteger(value) ? undefined : `${path} must be integer`;
  if (schema.type === 'boolean') return typeof value === 'boolean' ? undefined : `${path} must be boolean`;
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${path} must be array`;
    if (value.length > (schema.maxItems ?? MAX_SCHEMA_ITEMS)) return `${path} exceeds maxItems`;
    for (let index = 0; index < value.length; index += 1) {
      const reason = validateValue(schema.items, value[index], `${path}[${index}]`, depth + 1);
      if (reason) return reason;
    }
    return;
  }
  if (schema.type !== 'object') return `${path} has unsupported schema`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path} must be object`;
  const object = value as Record<string, unknown>;
  for (const required of schema.required ?? []) if (!(required in object)) return `${path}.${required} is required`;
  if (schema.additionalProperties === false) {
    const extra = Object.keys(object).find((key) => !(key in schema.properties));
    if (extra) return `${path}.${extra} is not allowed`;
  }
  for (const [key, child] of Object.entries(schema.properties)) {
    if (!(key in object)) continue;
    const reason = validateValue(child, object[key], `${path}.${key}`, depth + 1);
    if (reason) return reason;
  }
}

const counterKeys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'providerCostUsd'] as const;

export function usageRollup(observations: readonly ExecutionUsageObservationV1[], baseline?: ExecutionUsageBaselineV1): ExecutionUsageRollupV1 {
  const byRole = new Map<'worker' | 'orchestrator', ExecutionUsageCountersV1>();
  const total: ExecutionUsageCountersV1 = baseline ? Object.fromEntries(counterKeys.flatMap((key) => baseline[key] === undefined ? [] : [[key, baseline[key]]])) : {};
  for (const role of baseline?.byRole ?? []) byRole.set(role.role, Object.fromEntries(counterKeys.flatMap((key) => role[key] === undefined ? [] : [[key, role[key]]])));
  let gapCount = baseline?.gapCount ?? 0;
  let completeness: UsageCompleteness = baseline?.completeness ?? (observations.length ? 'complete' : 'unavailable');
  for (const observation of observations) {
    if (observation.completeness === 'unavailable') completeness = 'unavailable';
    else if (observation.completeness === 'partial' && completeness === 'complete') completeness = 'partial';
    if (observation.gap) gapCount += 1;
    const role = byRole.get(observation.role) ?? {};
    for (const key of counterKeys) {
      const delta = observation.delta[key];
      if (delta === undefined) continue;
      total[key] = (total[key] ?? 0) + delta;
      role[key] = (role[key] ?? 0) + delta;
    }
    byRole.set(observation.role, role);
  }
  const cursors = new Map<string, ExecutionUsageCursorV1>();
  for (const cursor of baseline?.cursors ?? []) cursors.set(usageCursorIdentity(cursor), cursor);
  for (const observation of observations) {
    const cursor = { sessionId: observation.sessionId, provider: observation.provider, ...(observation.model ? { model: observation.model } : {}), routingIdentity: observation.routingIdentity, adapterEpoch: observation.adapterEpoch, sequence: observation.sequence, cumulative: observation.cumulative, observationId: observation.observationId, ...(observation.replayFingerprint ? { replayFingerprint: observation.replayFingerprint } : {}) };
    const key = usageCursorIdentity(cursor);
    const previous = cursors.get(key);
    if (!previous || cursor.adapterEpoch > previous.adapterEpoch || cursor.adapterEpoch === previous.adapterEpoch && cursor.sequence > previous.sequence) cursors.set(key, cursor);
  }
  const replays = [...(baseline?.replays ?? []), ...observations.flatMap((observation) => observation.replayFingerprint ? [{
    observationId: observation.observationId, identity: usageIdentityDigest(observation), sequence: observation.sequence, fingerprint: observation.replayFingerprint
  }] : [])].slice(-1_000);
  return {
    version: 1, ...total, completeness, observationCount: (baseline?.observationCount ?? 0) + observations.length, gapCount,
    byRole: [...byRole.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([role, counters]) => ({ role, ...counters })),
    ...(cursors.size ? { cursors: [...cursors.values()].sort((left, right) => left.sequence - right.sequence).slice(-1_000) } : {}),
    ...(replays.length ? { replays } : {})
  };
}

export function usageCursorIdentity(value: Pick<ExecutionUsageCursorV1, 'sessionId' | 'provider' | 'model' | 'routingIdentity'>): string {
  return [value.sessionId, value.provider, value.model ?? '', value.routingIdentity].join('\0');
}

export function usageIdentity(observation: Pick<ExecutionUsageObservationV1, 'executionAttempt' | 'role' | 'slotId' | 'sessionId' | 'workUnitId' | 'workAttempt' | 'claimGeneration' | 'adapterEpoch' | 'sampleKind' | 'sequence' | 'provider' | 'model' | 'routingIdentity'>): string {
  return [observation.executionAttempt, observation.role, observation.slotId, observation.sessionId, observation.workUnitId ?? '', observation.workAttempt,
    observation.claimGeneration, observation.adapterEpoch, observation.sampleKind, observation.sequence, observation.provider, observation.model ?? '', observation.routingIdentity].join('\0');
}

export function usageObservationFingerprint(observation: Omit<ExecutionUsageObservationV1, 'version' | 'delta' | 'replayFingerprint'>): string {
  return `sha256:${createHash('sha256').update(canonicalJson(observation)).digest('hex')}`;
}

export function usageIdentityDigest(observation: Parameters<typeof usageIdentity>[0]): string {
  return `sha256:${createHash('sha256').update(usageIdentity(observation)).digest('hex')}`;
}

export function assembleExecutionResult(record: ExecutionRecord, artifacts: readonly ExecutionArtifactRecord[], summary: string): ExecutionAssembledResultV1 {
  const currentArtifacts = artifacts.filter((artifact) => artifact.attempt === record.attempt);
  const units = (record.workUnits ?? []).map((unit) => ({
    id: unit.id, title: unit.title, state: unit.state,
    ...(unit.result === undefined ? {} : { result: unit.result.slice(0, 2_048) }),
    ...(unit.failureCode === undefined ? {} : { failureCode: unit.failureCode })
  }));
  const outcome: ExecutionAssembledResultV1['outcome'] = units.every((unit) => unit.state === 'COMPLETED') ? 'success'
    : units.some((unit) => unit.state === 'COMPLETED') ? 'partial' : 'failure';
  const withoutDigest = {
    version: 1 as const, outcome, summary: summary.slice(0, 64 * 1024), units,
    failures: units.flatMap((unit) => unit.failureCode ? [{ workUnitId: unit.id, code: unit.failureCode }] : []),
    artifacts: currentArtifacts.slice(0, 100).map(({ name, mediaType, contentDigest }) => ({ name, mediaType, contentDigest })),
    ...(record.policyResult ? { policy: { status: record.policyResult.status, summary: record.policyResult.summary.slice(0, 2_048) } } : {}),
    verification: (record.workUnits ?? []).flatMap((unit) => unit.verification?.length ? [{ workUnitId: unit.id, checks: unit.verification.slice(0, 100) }] : []),
    usage: usageRollup(record.usageObservations ?? [], record.usageBaseline)
  };
  return { ...withoutDigest, digest: `sha256:${createHash('sha256').update(JSON.stringify(withoutDigest)).digest('hex')}` };
}

export const ROUTE_FIT_EVALUATOR_VERSION = 'route-fit-v1';
export function evaluateRouteFit(record: ExecutionRecord, evaluatedAt: number): RouteFitProposalV1 {
  const usage = usageRollup(record.usageObservations ?? [], record.usageBaseline);
  const decisions = record.routingDecisions ?? [];
  const selected = (record.workUnits ?? []).map((unit) => {
    const model = record.resolvedModels.find((candidate) => candidate.slotId === unit.assignedSlotId);
    return { workUnitId: unit.id, ...(unit.assignedSlotId ? { slotId: unit.assignedSlotId } : {}), ...(model?.provider ? { provider: model.provider } : {}), ...(model?.model ? { model: model.model } : {}) };
  });
  const hasWork = (record.workUnits?.length ?? 0) > 0;
  const outcome = record.assembledResult?.outcome ?? (hasWork && record.workUnits!.every((unit) => unit.state === 'COMPLETED') ? 'success' : 'failure');
  let fit: RouteFitProposalV1['fit'] = 'indeterminate';
  let reason = hasWork ? 'Complete usage and at least two immutable routing samples are required.' : 'No work units were available to evaluate.';
  if (hasWork && usage.completeness === 'complete' && decisions.length >= 2 && selected.every((item) => item.slotId && item.provider)) {
    const illegal = decisions.some((decision) => decision.candidates.find((candidate) => candidate.slotId === decision.recommendedSlotId)?.status === 'FAIL');
    const routeFailures = (record.workUnits ?? []).some((unit) => unit.failureCode === 'NO_QUALIFIED_ROUTE' || unit.failureCode === 'ROUTE_FACTS_UNAVAILABLE');
    const ranks = ['low', 'medium', 'high', 'extra-high'] as const;
    const overpowered = outcome === 'success' && (record.workUnits ?? []).length > 0 && (record.workUnits ?? []).every((unit) => {
      if (!unit.routing?.minimumLevel || !unit.assignedSlotId) return false;
      const selectedModel = record.resolvedModels.find((model) => model.slotId === unit.assignedSlotId);
      return selectedModel?.level !== undefined && ranks.indexOf(selectedModel.level) - ranks.indexOf(unit.routing.minimumLevel) >= 2;
    });
    fit = illegal || routeFailures ? 'underpowered' : overpowered ? 'overpowered' : 'appropriate';
    reason = illegal ? 'Selected route violated declared hard routing constraints.'
      : routeFailures ? 'Declared routing could not satisfy execution.'
      : overpowered ? 'Every selected route exceeded declared minimum level by at least two tiers.'
      : 'Declared routing was legal and execution evidence was sufficient.';
  }
  return { version: 1, evaluatorVersion: ROUTE_FIT_EVALUATOR_VERSION, active: false, outcome, fit, reason, evaluatedAt, samples: decisions.length, selected };
}

export function terminalEvents(events: readonly ExecutionEvent[]): ExecutionEvent[] {
  return events.filter((event) => event.eventType === 'outcome' || event.eventType === 'failure').slice(-20);
}
