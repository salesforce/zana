import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  atomicDurableWrite,
  createSerializedTransactionQueue,
  hashBytes,
  readRawFile
} from '../harness-routing/storage.js';
import type { WorkflowPolicyResultV1 } from './policy-result.js';
import type { ExecutionSourceSnapshot, TeamLaunchAuthorizationContextV1 } from '@zana-ai/zcc-domain/product';
import type { SquadBundleWorkflowMetadataV1, TeamLaunchAuthorizationInputSlot, TeamLaunchRequestInput } from '@zana-ai/zcc-domain/product';
import { MAX_TEAM_INITIAL_TASK_BYTES } from '../launch/team-lifecycle-store.js';

export type ExecutionState = 'READY' | 'STARTING' | 'RUNNING' | 'COMPLETED' | 'BLOCKED' | 'STOPPED' | 'FAILED';
export type ExecutionWorkUnitState = 'PENDING' | 'READY' | 'CLAIMED' | 'BLOCKED' | 'COMPLETED' | 'FAILED';
export type ExecutionCohortAuthority = { role: 'worker' | 'orchestrator'; slotId: string };
export type ExecutionLaunchKind = 'team';

/** Backend-neutral label captured with a durable execution request. */
export interface ExecutionLaunchDisplayV1 {
  label: string;
}

export interface ExecutionWorkUnitInput {
  id: string;
  title: string;
  task: string;
  dependencies: string[];
  preferredRole?: string;
  files?: string[];
  verification?: string[];
  readOnly?: boolean;
}

export interface ExecutionWorkUnit extends ExecutionWorkUnitInput {
  state: ExecutionWorkUnitState;
  assignedSlotId?: string;
  attempt: number;
  failure?: string;
  result?: string;
  history: Array<{ action: 'claimed' | 'released' | 'retried' | 'blocked' | 'failed' | 'completed'; slotId?: string; attempt: number; at: number; detail?: string }>;
}

export interface ExecutionBlocker {
  id: string;
  workUnitId: string;
  slotId: string;
  question: string;
  options?: string[];
  response?: string;
  resolved: boolean;
  createdAt: number;
  respondedAt?: number;
  resolvedAt?: number;
}

export type ExecutionDeliveryState = 'PENDING' | 'LEASED' | 'DELIVERED' | 'FAILED';

export interface ExecutionDeliveryRecord {
  id: string;
  clientRequestId: string;
  blockerId: string;
  workUnitId: string;
  slotId: string;
  payload: { text: string };
  state: ExecutionDeliveryState;
  attempt: number;
  manualRetryCount?: number;
  recipientPrincipalId?: string;
  recipientAuthorizationId?: string;
  leaseId?: string;
  leaseExpiresAt?: number;
  nextAttemptAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  deliveredAt?: number;
}

export interface ExecutionRecord {
  id: string;
  callerPrincipalId: string;
  projectId: string;
  teamId: string;
  /** Generic launch identity. Team ids remain for current backend reconciliation. */
  launchKind?: ExecutionLaunchKind;
  launchDisplay?: ExecutionLaunchDisplayV1;
  jobTitle: string;
  summary?: string;
  requestDigest: string;
  launchRequestId: string;
  teamLaunchRequestId: string;
  request: ExecutionRequestSnapshotV1;
  attempt: number;
  state: ExecutionState;
  stateVersion: number;
  lastEventSequence?: number;
  resolvedModels: ResolvedModelSnapshotV1[];
  authorizationContext?: TeamLaunchAuthorizationContextV1;
  authorizationContextDigest?: string;
  launchIntent?: ExecutionLaunchIntentV1;
  policyResult?: WorkflowPolicyResultV1;
  effectiveOwnerPrincipalIds?: string[];
  recoveryGeneration?: number;
  recoveryDeadlineAt?: number;
  workUnits?: ExecutionWorkUnit[];
  blockers?: ExecutionBlocker[];
  deliveries?: ExecutionDeliveryRecord[];
  finalSummary?: string;
  coordinationMode?: import('@zana-ai/zcc-domain/product').TeamCoordinationMode;
  createdAt: number;
  updatedAt: number;
  /** User hid terminal history from board; durable evidence remains retained. */
  dismissedAt?: number;
}

export type ExecutionClaimInput = Omit<ExecutionRecord,
  'id' | 'teamLaunchRequestId' | 'attempt' | 'state' | 'stateVersion' | 'createdAt' | 'updatedAt' | 'workUnits' | 'blockers'
> & { workUnits?: ExecutionWorkUnitInput[] };

export interface ExecutionRequestSnapshotV1 {
  version: 1;
  launchKind?: ExecutionLaunchKind;
  launchDisplay?: ExecutionLaunchDisplayV1;
  slots: TeamLaunchAuthorizationInputSlot[];
  policy?: TeamLaunchRequestInput['policy'];
  workflow?: SquadBundleWorkflowMetadataV1;
  resolvedModels: ResolvedModelSnapshotV1[];
  sourceBundle?: {
    contentRef: string;
    sources: Array<Omit<ExecutionSourceSnapshot, 'extractedText'>>;
  };
  goal?: string;
}

/** Durable, non-capability launch boundary for crash diagnosis and reconciliation. */
export interface ExecutionLaunchIntentV1 {
  version: 1;
  authorizationContextDigest: string;
  slots: Array<{ slotId: string; personaId: string; initialTaskDigest: string }>;
  preparedAt: number;
}

export interface ResolvedModelSnapshotV1 {
  slotId: string;
  provider: string;
  model: string;
  reasoning?: string;
}

export interface ExecutionEvent {
  id: string;
  executionId: string;
  attempt: number;
  sequence: number;
  state: ExecutionState;
  stateVersion?: number;
  kind?: 'reservation' | 'transition' | 'command' | 'event';
  fromState?: ExecutionState;
  toState?: ExecutionState;
  slotId?: string;
  producerRole?: 'worker' | 'orchestrator';
  eventType?: 'progress' | 'blocker' | 'failure' | 'outcome';
  attention?: boolean;
  progress?: { completed: number; total: number };
  references?: Array<{ label: string; uri: string }>;
  detail?: string;
  blocker?: { question: string; options?: string[] };
  severity: 'info' | 'warning' | 'error';
  summary: string;
  createdAt: number;
}

interface ExecutionStateFile {
  version: 1;
  revision: number;
  records: ExecutionRecord[];
  events: ExecutionEvent[];
}

export interface ExecutionStoreOptions {
  filePath: string;
  now?: () => number;
  id?: () => string;
  maxRecords?: number;
  maxEvents?: number;
  maxEventsPerExecution?: number;
}

const MAX_RECORDS = 2_000;
const MAX_EVENTS = 10_000;
const MAX_EVENTS_PER_EXECUTION = 500;
export const EXECUTION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const EXECUTION_RECOVERY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_STRING = 2_048;
const MAX_FINAL_SUMMARY = 64 * 1024;
const MAX_WORK_UNITS = 100;
const MAX_UNIT_LIST = 100;
const MAX_DELIVERIES_PER_EXECUTION = 128;
const MAX_DELIVERY_TEXT_BYTES = 16 * 1024;
const MAX_DELIVERY_ERROR_BYTES = 1024;
export const MAX_DELIVERY_ATTEMPTS = 8;
const DELIVERY_LEASE_MS = 60_000;
const DELIVERED_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const storeQueue = createSerializedTransactionQueue();
const terminalStates = new Set<ExecutionState>(['COMPLETED', 'STOPPED', 'FAILED']);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_STRING) throw new Error(`invalid execution ${label}`);
  return value;
}

function isState(value: unknown): value is ExecutionState {
  return value === 'READY' || value === 'STARTING' || value === 'RUNNING' || value === 'COMPLETED'
    || value === 'BLOCKED' || value === 'STOPPED' || value === 'FAILED';
}

function validRecord(value: unknown): value is ExecutionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ExecutionRecord>;
  return validString(record.id) && validString(record.callerPrincipalId)
    && validString(record.projectId) && validString(record.teamId)
    && validString(record.jobTitle) && validString(record.requestDigest)
    && (record.launchKind === undefined || record.launchKind === 'team')
    && (record.launchDisplay === undefined || validLaunchDisplay(record.launchDisplay))
    && validString(record.launchRequestId) && validString(record.teamLaunchRequestId) && validRequestSnapshot(record.request)
    && (record.summary === undefined || validString(record.summary)) && Number.isInteger(record.attempt)
    && isState(record.state) && Number.isInteger(record.stateVersion)
    && (record.lastEventSequence === undefined || Number.isInteger(record.lastEventSequence) && record.lastEventSequence >= 0)
    && Array.isArray(record.resolvedModels) && record.resolvedModels.every(validModelSnapshot)
    && (record.authorizationContext === undefined || validAuthorizationContext(record.authorizationContext))
    && (record.authorizationContextDigest === undefined || validString(record.authorizationContextDigest))
    && (record.launchIntent === undefined || validLaunchIntent(record.launchIntent))
    && (record.policyResult === undefined || validPolicyResult(record.policyResult))
    && (record.effectiveOwnerPrincipalIds === undefined || Array.isArray(record.effectiveOwnerPrincipalIds) && record.effectiveOwnerPrincipalIds.every(validString))
    && (record.recoveryGeneration === undefined || Number.isInteger(record.recoveryGeneration) && record.recoveryGeneration >= 0)
    && (record.recoveryDeadlineAt === undefined || typeof record.recoveryDeadlineAt === 'number' && Number.isFinite(record.recoveryDeadlineAt))
    && (record.workUnits === undefined || Array.isArray(record.workUnits) && record.workUnits.length <= MAX_WORK_UNITS && record.workUnits.every(validWorkUnit))
    && (record.blockers === undefined || Array.isArray(record.blockers) && record.blockers.length <= MAX_WORK_UNITS && record.blockers.every(validExecutionBlocker))
    && (record.deliveries === undefined || Array.isArray(record.deliveries) && record.deliveries.length <= MAX_DELIVERIES_PER_EXECUTION && record.deliveries.every(validExecutionDelivery))
    && (record.finalSummary === undefined || typeof record.finalSummary === 'string' && record.finalSummary.length > 0 && record.finalSummary.length <= MAX_FINAL_SUMMARY)
    && (record.coordinationMode === undefined || record.coordinationMode === 'interactive-team' || record.coordinationMode === 'autonomous-team' || record.coordinationMode === 'job-team')
    && typeof record.createdAt === 'number' && typeof record.updatedAt === 'number'
    && (record.dismissedAt === undefined || typeof record.dismissedAt === 'number');
}

function validWorkUnit(value: unknown): value is ExecutionWorkUnit {
  if (!value || typeof value !== 'object') return false;
  const unit = value as Partial<ExecutionWorkUnit>;
  return validString(unit.id) && validString(unit.title) && validString(unit.task)
    && Array.isArray(unit.dependencies) && unit.dependencies.length <= MAX_UNIT_LIST && unit.dependencies.every(validString)
    && (unit.preferredRole === undefined || validString(unit.preferredRole))
    && (unit.files === undefined || Array.isArray(unit.files) && unit.files.length <= MAX_UNIT_LIST && unit.files.every(validString))
    && (unit.verification === undefined || Array.isArray(unit.verification) && unit.verification.length <= MAX_UNIT_LIST && unit.verification.every(validString))
    && (unit.readOnly === undefined || typeof unit.readOnly === 'boolean')
    && (unit.state === 'PENDING' || unit.state === 'READY' || unit.state === 'CLAIMED' || unit.state === 'BLOCKED' || unit.state === 'COMPLETED' || unit.state === 'FAILED')
    && (unit.assignedSlotId === undefined || validString(unit.assignedSlotId)) && Number.isInteger(unit.attempt) && (unit.attempt ?? -1) >= 0
    && (unit.failure === undefined || validString(unit.failure)) && (unit.result === undefined || validString(unit.result))
    && Array.isArray(unit.history) && unit.history.length <= MAX_UNIT_LIST * 10;
}

function validExecutionBlocker(value: unknown): value is ExecutionBlocker {
  if (!value || typeof value !== 'object') return false;
  const blocker = value as Partial<ExecutionBlocker>;
  return validString(blocker.id) && validString(blocker.workUnitId) && validString(blocker.slotId)
    && validString(blocker.question) && (blocker.options === undefined || Array.isArray(blocker.options) && blocker.options.length <= 20 && blocker.options.every(validString))
    && (blocker.response === undefined || validUtf8String(blocker.response, MAX_DELIVERY_TEXT_BYTES)) && typeof blocker.resolved === 'boolean'
    && typeof blocker.createdAt === 'number' && (blocker.respondedAt === undefined || typeof blocker.respondedAt === 'number')
    && (blocker.resolvedAt === undefined || typeof blocker.resolvedAt === 'number');
}

function validExecutionDelivery(value: unknown): value is ExecutionDeliveryRecord {
  if (!value || typeof value !== 'object') return false;
  const delivery = value as Partial<ExecutionDeliveryRecord>;
  return validString(delivery.id) && validString(delivery.clientRequestId) && validString(delivery.blockerId)
    && validString(delivery.workUnitId) && validString(delivery.slotId)
    && !!delivery.payload && validUtf8String(delivery.payload.text, MAX_DELIVERY_TEXT_BYTES)
    && (delivery.state === 'PENDING' || delivery.state === 'LEASED' || delivery.state === 'DELIVERED' || delivery.state === 'FAILED')
    && Number.isInteger(delivery.attempt) && (delivery.attempt ?? -1) >= 0 && (delivery.attempt ?? 0) <= MAX_DELIVERY_ATTEMPTS
    && (delivery.manualRetryCount === undefined || Number.isInteger(delivery.manualRetryCount) && delivery.manualRetryCount >= 0 && delivery.manualRetryCount <= 1)
    && (delivery.recipientPrincipalId === undefined || validString(delivery.recipientPrincipalId))
    && (delivery.recipientAuthorizationId === undefined || validString(delivery.recipientAuthorizationId))
    && (delivery.leaseId === undefined || validString(delivery.leaseId))
    && (delivery.leaseExpiresAt === undefined || typeof delivery.leaseExpiresAt === 'number')
    && (delivery.nextAttemptAt === undefined || typeof delivery.nextAttemptAt === 'number')
    && (delivery.lastError === undefined || validUtf8String(delivery.lastError, MAX_DELIVERY_ERROR_BYTES))
    && typeof delivery.createdAt === 'number' && typeof delivery.updatedAt === 'number'
    && (delivery.deliveredAt === undefined || typeof delivery.deliveredAt === 'number');
}

function validPolicyResult(value: unknown): value is WorkflowPolicyResultV1 {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<WorkflowPolicyResultV1>;
  return result.version === 1 && validString(result.executionId) && typeof result.attempt === 'number'
    && validString(result.outputDigest) && validString(result.extensionDigest) && validString(result.summary)
    && (result.status === 'PENDING' || result.status === 'PASSED' || result.status === 'BLOCKED' || result.status === 'FAILED' || result.status === 'ELIGIBLE_FOR_DELIVERY');
}

function validModelSnapshot(value: unknown): value is ResolvedModelSnapshotV1 {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<ResolvedModelSnapshotV1>;
  return validString(snapshot.slotId) && validString(snapshot.provider) && validString(snapshot.model)
    && (snapshot.reasoning === undefined || validString(snapshot.reasoning));
}

function validRequestSnapshot(value: unknown): value is ExecutionRequestSnapshotV1 {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<ExecutionRequestSnapshotV1>;
  return request.version === 1 && (request.launchKind === undefined || request.launchKind === 'team')
    && (request.launchDisplay === undefined || validLaunchDisplay(request.launchDisplay))
    && Array.isArray(request.slots) && request.slots.length > 0
    && request.slots.every((slot) => !!slot && typeof slot === 'object'
      && validUtf8String((slot as { initialTask?: unknown }).initialTask, MAX_TEAM_INITIAL_TASK_BYTES))
    && Array.isArray(request.resolvedModels) && request.resolvedModels.every(validModelSnapshot)
    && (request.goal === undefined || validString(request.goal))
    && (request.sourceBundle === undefined || validSourceBundle(request.sourceBundle))
    && (request.policy === undefined || typeof request.policy === 'object')
    && (request.workflow === undefined || typeof request.workflow === 'object');
}

function validSourceBundle(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const bundle = value as ExecutionRequestSnapshotV1['sourceBundle'];
  return !!bundle && validString(bundle.contentRef) && Array.isArray(bundle.sources)
    && bundle.sources.every((source) => !!source && validString(source.id) && validString(source.name)
      && validString(source.mediaType) && validDigest(source.contentDigest)
      && (source.extractedTextDigest === undefined || validDigest(source.extractedTextDigest))
      && typeof source.byteSize === 'number' && source.extractionStatus === 'READY'
      && Array.isArray(source.extractionWarnings) && source.extractionWarnings.every((warning) => typeof warning === 'string'));
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function validLaunchDisplay(value: unknown): value is ExecutionLaunchDisplayV1 {
  return !!value && typeof value === 'object' && validString((value as Partial<ExecutionLaunchDisplayV1>).label);
}

function validAuthorizationContext(value: unknown): value is TeamLaunchAuthorizationContextV1 {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<TeamLaunchAuthorizationContextV1>;
  return context.version === 1 && validString(context.principalId)
    && typeof context.authorizedAt === 'number' && typeof context.expiresAt === 'number'
    && context.expiresAt > context.authorizedAt && Array.isArray(context.slots)
    && context.slots.every((slot) => !!slot && typeof slot === 'object'
      && validString((slot as { slotId?: unknown }).slotId)
      && validString((slot as { personaId?: unknown }).personaId)
      && validString((slot as { authorizationIdDigest?: unknown }).authorizationIdDigest));
}

function validLaunchIntent(value: unknown): value is ExecutionLaunchIntentV1 {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Partial<ExecutionLaunchIntentV1>;
  return intent.version === 1 && validString(intent.authorizationContextDigest)
    && typeof intent.preparedAt === 'number'
    && Array.isArray(intent.slots) && intent.slots.every((slot) => !!slot && typeof slot === 'object'
      && validString((slot as { slotId?: unknown }).slotId)
      && validString((slot as { personaId?: unknown }).personaId)
      && validString((slot as { initialTaskDigest?: unknown }).initialTaskDigest));
}

function validEvent(value: unknown): value is ExecutionEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<ExecutionEvent>;
  return validString(event.id) && validString(event.executionId)
    && Number.isInteger(event.attempt) && Number.isInteger(event.sequence) && isState(event.state)
    && (event.stateVersion === undefined || Number.isInteger(event.stateVersion))
    && (event.kind === undefined || event.kind === 'reservation' || event.kind === 'transition' || event.kind === 'command' || event.kind === 'event')
    && (event.fromState === undefined || isState(event.fromState)) && (event.toState === undefined || isState(event.toState))
    && (event.slotId === undefined || validString(event.slotId))
    && (event.producerRole === undefined || event.producerRole === 'worker' || event.producerRole === 'orchestrator')
    && (event.eventType === undefined || event.eventType === 'progress' || event.eventType === 'blocker' || event.eventType === 'failure' || event.eventType === 'outcome')
    && (event.attention === undefined || typeof event.attention === 'boolean')
    && (event.progress === undefined || validProgress(event.progress))
    && (event.references === undefined || Array.isArray(event.references) && event.references.length <= 20 && event.references.every(validReference))
    && (event.detail === undefined || validString(event.detail))
    && (event.blocker === undefined || validBlocker(event.blocker))
    && (event.severity === 'info' || event.severity === 'warning' || event.severity === 'error')
    && validString(event.summary) && typeof event.createdAt === 'number';
}

function validBlocker(value: unknown): value is { question: string; options?: string[] } {
  if (!value || typeof value !== 'object') return false;
  const blocker = value as { question?: unknown; options?: unknown };
  return validString(blocker.question) && (blocker.options === undefined
    || Array.isArray(blocker.options) && blocker.options.length <= 20 && blocker.options.every(validString));
}

function validProgress(value: unknown): value is { completed: number; total: number } {
  if (!value || typeof value !== 'object') return false;
  const progress = value as { completed: unknown; total: unknown };
  return Number.isInteger(progress.completed) && Number.isInteger(progress.total)
    && (progress.completed as number) >= 0 && (progress.total as number) >= (progress.completed as number);
}

function validReference(value: unknown): value is { label: string; uri: string } {
  if (!value || typeof value !== 'object') return false;
  const reference = value as { label?: unknown; uri?: unknown };
  return validString(reference.label) && validString(reference.uri);
}

function validString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING;
}

function validUtf8String(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= maxBytes;
}

export function createExecutionStore(options: ExecutionStoreOptions) {
  if (options.maxRecords !== undefined && (!Number.isInteger(options.maxRecords) || options.maxRecords < 1)) {
    throw new Error('invalid execution max records');
  }
  if (options.maxEvents !== undefined && (!Number.isInteger(options.maxEvents) || options.maxEvents < 1)) {
    throw new Error('invalid execution max events');
  }
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  const maxRecords = Math.min(options.maxRecords ?? MAX_RECORDS, MAX_RECORDS);
  const maxEvents = Math.min(options.maxEvents ?? MAX_EVENTS, MAX_EVENTS);
  const maxEventsPerExecution = Math.min(options.maxEventsPerExecution ?? MAX_EVENTS_PER_EXECUTION, MAX_EVENTS_PER_EXECUTION);

  function read(): { state: ExecutionStateFile; hash: string | null } {
    const bytes = readRawFile(options.filePath);
    if (!bytes) return { state: { version: 1, revision: 0, records: [], events: [] }, hash: null };
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as Partial<ExecutionStateFile>;
      if (Array.isArray(parsed.records)) {
        for (const record of parsed.records) {
          if (!record || typeof record !== 'object') continue;
          if (!Array.isArray(record.deliveries)) record.deliveries = [];
          for (const delivery of record.deliveries) delivery.manualRetryCount ??= 0;
          record.recoveryGeneration ??= 0;
          if (typeof record.createdAt === 'number') record.recoveryDeadlineAt ??= record.createdAt + EXECUTION_RECOVERY_TTL_MS;
        }
      }
      if (parsed.version !== 1 || !Array.isArray(parsed.records) || !parsed.records.every(validRecord)
        || !Array.isArray(parsed.events) || !parsed.events.every(validEvent) || !Number.isInteger(parsed.revision)) {
        throw new Error('invalid shape');
      }
      return { state: parsed as ExecutionStateFile, hash: hashBytes(bytes) };
    } catch (error) {
      throw new Error(`corrupt execution store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function persist(state: ExecutionStateFile, expectedHash: string | null): void {
    for (const record of state.records) {
      record.deliveries ??= [];
      record.deliveries = record.deliveries.filter((delivery) => {
        if (delivery.state === 'DELIVERED') return delivery.deliveredAt === undefined || now() - delivery.deliveredAt < DELIVERED_RETENTION_MS;
        if (delivery.state === 'FAILED') return now() - delivery.updatedAt < DELIVERED_RETENTION_MS;
        return true;
      });
      for (const unit of record.workUnits ?? []) unit.history = unit.history.slice(-MAX_UNIT_LIST * 10);
      if ((record.blockers?.length ?? 0) > MAX_WORK_UNITS) {
        const activeBlockers = record.blockers!.filter((blocker) => !blocker.resolved);
        const resolved = record.blockers!.filter((blocker) => blocker.resolved).slice(-(MAX_WORK_UNITS - activeBlockers.length));
        record.blockers = [...resolved, ...activeBlockers];
      }
    }
    const active = state.records.filter((record) => !terminalStates.has(record.state));
    const protectedTerminalIds = new Set(state.records
      .filter((record) => terminalStates.has(record.state) && now() - record.updatedAt < EXECUTION_RETENTION_MS)
      .map((record) => record.id));
    const retainedTerminalIds = new Set(state.records
      .filter((record) => terminalStates.has(record.state) && !protectedTerminalIds.has(record.id))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, maxRecords)
      .map((record) => record.id));
    const retainedIds = new Set([...protectedTerminalIds, ...retainedTerminalIds, ...active.map((record) => record.id)]);
    if (maxRecords === MAX_RECORDS && protectedTerminalIds.size > maxRecords) {
      throw new Error('execution retention pressure: protected history exceeds storage limit');
    }
    state.records = state.records.filter((record) => retainedIds.has(record.id));
    state.events = compactEvents(state.events, maxEventsPerExecution, maxEvents);
    if (!state.records.every(validRecord) || !state.events.every(validEvent)) throw new Error('invalid execution state before persistence');
    state.revision += 1;
    mkdirSync(dirname(options.filePath), { recursive: true });
    atomicDurableWrite(options.filePath, Buffer.from(JSON.stringify(state)), { expectedHash });
  }

  async function claim(input: ExecutionClaimInput) {
    if (input.launchKind !== undefined && input.launchKind !== 'team') throw new Error('invalid execution launch kind');
    const request = normalizeRequest(input.request);
    const workUnits = input.workUnits === undefined ? undefined : normalizePlan(input.workUnits, input.coordinationMode === 'job-team');
    if (input.launchKind !== undefined && input.launchKind !== request.launchKind) {
      throw new Error('execution launch kind disagrees with request snapshot');
    }
    if (input.launchDisplay !== undefined && !sameLaunchDisplay(input.launchDisplay, request.launchDisplay)) {
      throw new Error('execution launch display disagrees with request snapshot');
    }
    const bounded = {
      callerPrincipalId: string(input.callerPrincipalId, 'caller principal id'),
      projectId: string(input.projectId, 'project id'),
      teamId: string(input.teamId, 'team id'),
      launchKind: request.launchKind,
      ...(request.launchDisplay === undefined ? {} : { launchDisplay: request.launchDisplay }),
      jobTitle: string(input.jobTitle, 'job title'),
      ...(input.summary === undefined ? {} : { summary: string(input.summary, 'summary') }),
      requestDigest: string(input.requestDigest, 'request digest'),
      launchRequestId: string(input.launchRequestId, 'launch request id'),
      request,
      resolvedModels: input.resolvedModels.map((snapshot) => ({
        slotId: string(snapshot.slotId, 'model slot id'), provider: string(snapshot.provider, 'model provider'),
        model: string(snapshot.model, 'model'), ...(snapshot.reasoning === undefined ? {} : { reasoning: string(snapshot.reasoning, 'model reasoning') })
      })),
      ...(workUnits ? { workUnits, blockers: [] } : {}),
      ...(input.coordinationMode ? { coordinationMode: input.coordinationMode } : {})
    };
    return storeQueue.run(async () => {
      const snapshot = read();
      const existing = snapshot.state.records.find((record) =>
        record.callerPrincipalId === bounded.callerPrincipalId && record.launchRequestId === bounded.launchRequestId);
      if (existing) {
        return existing.requestDigest === bounded.requestDigest
          ? { outcome: 'replay' as const, record: clone(existing) }
          : { outcome: 'conflict' as const, record: clone(existing) };
      }
      if (snapshot.state.records.filter((record) => !terminalStates.has(record.state)).length >= maxRecords) {
        throw new Error('execution active record limit reached');
      }
      const timestamp = now();
      const record: ExecutionRecord = {
        ...bounded, id: string(id(), 'id'), teamLaunchRequestId: bounded.launchRequestId, attempt: 1, state: 'READY', stateVersion: 0, lastEventSequence: 0,
        deliveries: [], recoveryGeneration: 0, recoveryDeadlineAt: timestamp + EXECUTION_RECOVERY_TTL_MS, createdAt: timestamp, updatedAt: timestamp
      };
      snapshot.state.records.push(record);
      append(snapshot.state, record, 'READY', 'info', 'Execution reserved', timestamp);
      persist(snapshot.state, snapshot.hash);
      return { outcome: 'claimed' as const, record: clone(record) };
    });
  }

  async function transition(
    executionId: string,
    expectedStateVersion: number,
    state: ExecutionState,
    severity: ExecutionEvent['severity'],
    summary: string
  ): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      assertActive(record);
      if (!canTransition(record.state, state)) throw new Error(`invalid execution transition ${record.state} -> ${state}`);
      if ((state === 'COMPLETED' || state === 'FAILED') && record.blockers?.some((blocker) => !blocker.resolved)) {
        throw new Error(`cannot transition to ${state} while blockers are unresolved`);
      }
      const fromState = record.state;
      const timestamp = now();
      record.state = state;
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, state, severity, string(summary, 'event summary'), timestamp, { kind: 'transition', fromState, toState: state });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function event(
    executionId: string,
    expectedStateVersion: number,
    severity: ExecutionEvent['severity'],
    summary: string
  ): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      assertActive(record);
      const timestamp = now();
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, record.state, severity, string(summary, 'event summary'), timestamp, { kind: 'event' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function command(
    executionId: string,
    expectedStateVersion: number,
    summary: string,
    slotId?: string
  ): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      assertActive(record);
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      const timestamp = now();
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, record.state, 'info', string(summary, 'event summary'), timestamp, { kind: 'command', ...(slotId === undefined ? {} : { slotId: string(slotId, 'slot id') }) });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function producerEvent(
    executionId: string,
    input: {
      id: string;
      slotId?: string;
      producerRole?: 'worker' | 'orchestrator';
      type: NonNullable<ExecutionEvent['eventType']>;
      severity: ExecutionEvent['severity'];
      summary: string;
      detail?: string;
      blocker?: { question: string; options?: string[] };
      attention?: boolean;
      progress?: { completed: number; total: number };
      references?: Array<{ label: string; uri: string }>;
    }
  ): Promise<{ outcome: 'accepted' | 'replay'; event: ExecutionEvent }> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      assertActive(record);
      const eventId = string(input.id, 'event id');
      const existing = snapshot.state.events.find((event) => event.executionId === record.id && event.id === eventId);
      if (existing) return { outcome: 'replay' as const, event: clone(existing) };
      if ((input.type === 'blocker') !== !!input.blocker || (input.type === 'blocker' && !validBlocker(input.blocker))) {
        throw new Error('invalid execution blocker');
      }
      const timestamp = now();
      const event: ExecutionEvent = {
        id: eventId, executionId: record.id, attempt: record.attempt,
        sequence: (record.lastEventSequence ?? nextSequence(snapshot.state, record.id) - 1) + 1, state: record.state, stateVersion: record.stateVersion,
        kind: 'event', eventType: input.type, severity: input.severity,
        summary: string(input.summary, 'event summary'), createdAt: timestamp,
        ...(input.slotId === undefined ? {} : { slotId: string(input.slotId, 'slot id') }),
        ...(input.producerRole === undefined ? {} : { producerRole: input.producerRole }),
        ...(input.detail === undefined ? {} : { detail: string(input.detail, 'event detail') }),
        ...(input.blocker === undefined ? {} : { blocker: clone(input.blocker) }),
        ...(input.attention === undefined ? {} : { attention: input.attention }),
        ...(input.progress === undefined ? {} : { progress: validProgress(input.progress) ? clone(input.progress) : (() => { throw new Error('invalid execution progress'); })() }),
        ...(input.references === undefined ? {} : { references: Array.isArray(input.references) && input.references.length <= 20 && input.references.every(validReference) ? clone(input.references) : (() => { throw new Error('invalid execution references'); })() })
      };
      record.lastEventSequence = event.sequence;
      snapshot.state.events.push(event);
      persist(snapshot.state, snapshot.hash);
      return { outcome: 'accepted' as const, event: clone(event) };
    });
  }

  async function setPolicyResult(executionId: string, expectedStateVersion: number, policyResult: WorkflowPolicyResultV1): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      assertActive(record);
      if (!validPolicyResult(policyResult) || policyResult.executionId !== record.id || policyResult.attempt !== record.attempt) throw new Error('invalid execution policy result');
      record.policyResult = clone(policyResult);
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, policyResult.status === 'FAILED' ? 'error' : policyResult.status === 'BLOCKED' ? 'warning' : 'info', `Optional policy: ${policyResult.status}` , record.updatedAt);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function setAuthorizationContext(
    executionId: string,
    expectedStateVersion: number,
    authorizationContext: TeamLaunchAuthorizationContextV1,
    authorizationContextDigest: string
  ): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      if (record.authorizationContext || !validAuthorizationContext(authorizationContext)) throw new Error('invalid execution authorization context');
      record.authorizationContext = clone(authorizationContext);
      record.authorizationContextDigest = string(authorizationContextDigest, 'authorization context digest');
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', 'Team authorization context recorded', record.updatedAt);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function prepareLaunchIntent(
    executionId: string,
    expectedStateVersion: number,
    intent: Omit<ExecutionLaunchIntentV1, 'preparedAt' | 'dispatchedAt'>
  ): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      if (record.launchIntent || !validLaunchIntent({ ...intent, version: 1, preparedAt: now() })) throw new Error('invalid execution launch intent');
      record.launchIntent = { ...clone(intent), version: 1, preparedAt: now() };
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', 'Team launch intent prepared', record.updatedAt);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function addEffectiveOwner(executionId: string, principalId: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const safePrincipalId = string(principalId, 'effective owner principal id');
      const owners = new Set(record.effectiveOwnerPrincipalIds ?? []);
      owners.add(safePrincipalId);
      record.effectiveOwnerPrincipalIds = [...owners];
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', 'Execution monitor rebound', record.updatedAt);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function removeEffectiveOwner(executionId: string, principalId: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const safePrincipalId = string(principalId, 'effective owner principal id');
      record.effectiveOwnerPrincipalIds = (record.effectiveOwnerPrincipalIds ?? []).filter((owner) => owner !== safePrincipalId);
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', 'Execution monitor binding revoked', record.updatedAt);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function rotateRecoveryGeneration(executionId: string, expectedStateVersion: number, expectedGeneration: number, generation: number): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      assertActive(record);
      if ((record.recoveryGeneration ?? 0) !== expectedGeneration || generation <= expectedGeneration) {
        throw new Error('stale execution recovery generation');
      }
      record.recoveryGeneration = generation;
      record.effectiveOwnerPrincipalIds = [];
      record.stateVersion += 1;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'warning', 'Execution recovery grant rotated', record.updatedAt);
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function beginRetry(executionId: string, expectedStateVersion: number): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      if (record.state !== 'BLOCKED' || record.launchIntent) throw new Error('execution retry is not allowed');
      record.attempt += 1;
      record.teamLaunchRequestId = `${record.id}:attempt:${record.attempt}`;
      record.state = 'STARTING';
      record.stateVersion += 1;
      record.authorizationContext = undefined;
      record.authorizationContextDigest = undefined;
      record.policyResult = undefined;
      record.updatedAt = now();
      append(snapshot.state, record, record.state, 'info', 'Execution retry started', record.updatedAt, { kind: 'transition', fromState: 'BLOCKED', toState: 'STARTING' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function mutateRecord(executionId: string, expectedStateVersion: number, operation: (record: ExecutionRecord, timestamp: number) => void, summary: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      assertActive(record);
      const timestamp = now();
      operation(record, timestamp);
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, record.state, 'info', summary, timestamp, { kind: 'command' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function registerPlan(executionId: string, expectedStateVersion: number, units: ExecutionWorkUnitInput[]): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      assertActive(record);
      // Job-team plans registered dynamically by a coordinator must meet the SAME
      // strict bar as work supplied at claim (store.ts:492): every mutating unit
      // needs a non-empty file scope and every unit needs verification. Otherwise a
      // scope-less mutating unit passes registration but `scopesOverlap` treats it
      // as overlapping every other mutation, falsely serializing the whole plan.
      const normalized = normalizePlan(units, record.coordinationMode === 'job-team');
      if (record.workUnits?.length) {
        if (JSON.stringify(record.workUnits.map(stripWorkUnitState)) === JSON.stringify(normalized.map(stripWorkUnitState))) {
          return clone(record);
        }
        throw new Error('execution plan already registered with different work units');
      }
      const timestamp = now();
      record.workUnits = normalized;
      record.blockers = [];
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, record.state, 'info', 'Execution plan registered', timestamp, { kind: 'command' });
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function claimWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string, assignedSlotId?: string): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const unit = findUnit(record, workUnitId);
      if (authority.role === 'orchestrator' && assignedSlotId === undefined) throw new Error('coordinator assignment requires assigned slot id');
      const slotId = authority.role === 'worker' ? authority.slotId : string(assignedSlotId, 'assigned slot id');
      if (authority.role === 'worker' && assignedSlotId && assignedSlotId !== authority.slotId) throw new Error('worker cannot claim another slot assignment');
      // Stale coordinator retries can race a persisted completion. Same-owner
      // claims and completed work are replays, not evidence of a broken DAG.
      if (unit.state === 'COMPLETED') return;
      if (unit.state === 'CLAIMED' && unit.assignedSlotId === slotId) return;
      if (unit.state !== 'READY') throw new Error('work unit is not ready');
      if (unit.assignedSlotId && unit.assignedSlotId !== slotId) throw new Error('work unit is assigned to another slot');
      if (authority.role === 'orchestrator') {
        if (slotId === authority.slotId || slotId.startsWith('orchestrator:')) throw new Error('coordinator must assign work to a worker slot');
        assertAuthorizedSlot(record, slotId);
      }
      assertScopeAvailable(record, unit);
      unit.state = 'CLAIMED';
      unit.assignedSlotId = slotId;
      unit.attempt += 1;
      unit.failure = undefined;
      unit.history.push({ action: 'claimed', slotId, attempt: unit.attempt, at: timestamp });
    }, `Work unit claimed: ${workUnitId}`);
  }

  async function completeWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string, result: string): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const unit = findUnit(record, workUnitId);
      assertUnitAuthority(unit, authority);
      if (record.blockers?.some((blocker) => !blocker.resolved && blocker.workUnitId === workUnitId)) {
        throw new Error('work unit has unresolved blockers');
      }
      if (unit.state === 'COMPLETED') return;
      if (unit.state !== 'CLAIMED') throw new Error('work unit is not claimed');
      unit.state = 'COMPLETED';
      unit.result = string(result, 'work unit result');
      unit.history.push({ action: 'completed', slotId: unit.assignedSlotId, attempt: unit.attempt, at: timestamp, detail: unit.result });
      deriveReadiness(record);
    }, `Work unit completed: ${workUnitId}`);
  }

  async function failWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string, failure: string): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const unit = findUnit(record, workUnitId);
      assertUnitAuthority(unit, authority);
      if (record.blockers?.some((blocker) => !blocker.resolved && blocker.workUnitId === workUnitId)) {
        throw new Error('work unit has unresolved blockers');
      }
      if (unit.state !== 'CLAIMED') throw new Error('work unit is not claimed');
      unit.state = 'FAILED';
      unit.failure = string(failure, 'work unit failure');
      unit.history.push({ action: 'failed', slotId: unit.assignedSlotId, attempt: unit.attempt, at: timestamp, detail: unit.failure });
    }, `Work unit failed: ${workUnitId}`);
  }

  async function releaseWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const unit = findUnit(record, workUnitId);
      assertUnitAuthority(unit, authority);
      if (unit.state !== 'CLAIMED') throw new Error('work unit is not claimed');
      unit.state = 'READY';
      unit.history.push({ action: 'released', slotId: unit.assignedSlotId, attempt: unit.attempt, at: timestamp });
      unit.assignedSlotId = undefined;
    }, `Work unit released: ${workUnitId}`);
  }

  async function retryWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string, assignedSlotId?: string): Promise<ExecutionRecord> {
    if (authority.role !== 'orchestrator') throw new Error('only coordinator can retry work');
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const unit = findUnit(record, workUnitId);
      if (unit.state !== 'FAILED' && unit.state !== 'BLOCKED') throw new Error('work unit retry is not allowed');
      if (assignedSlotId) assertAuthorizedSlot(record, assignedSlotId);
      unit.state = 'READY';
      unit.assignedSlotId = assignedSlotId ? string(assignedSlotId, 'assigned slot id') : undefined;
      unit.failure = undefined;
      unit.history.push({ action: 'retried', slotId: unit.assignedSlotId, attempt: unit.attempt, at: timestamp });
      for (const blocker of record.blockers ?? []) {
        if (blocker.workUnitId === unit.id && !blocker.resolved) {
          blocker.resolved = true;
          blocker.resolvedAt = timestamp;
          failActiveDeliveries(record, blocker.id, 'blocker resolved by work retry', timestamp);
        }
      }
      record.state = record.blockers?.some((blocker) => !blocker.resolved) ? 'BLOCKED' : 'RUNNING';
    }, `Work unit retry ready: ${workUnitId}`);
  }

  async function reassignWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string, assignedSlotId: string): Promise<ExecutionRecord> {
    if (authority.role !== 'orchestrator') throw new Error('only coordinator can reassign work');
    return mutateRecord(executionId, expectedStateVersion, (record) => {
      const unit = findUnit(record, workUnitId);
      if (unit.state !== 'READY') throw new Error('work unit reassignment is not allowed');
      assertAuthorizedSlot(record, assignedSlotId);
      unit.assignedSlotId = string(assignedSlotId, 'assigned slot id');
    }, `Work unit reassigned: ${workUnitId}`);
  }

  async function blockWork(executionId: string, expectedStateVersion: number, authority: ExecutionCohortAuthority, workUnitId: string, input: { id: string; question: string; options?: string[] }): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const unit = findUnit(record, workUnitId);
      assertUnitAuthority(unit, authority);
      if (unit.state !== 'CLAIMED') throw new Error('work unit is not claimed');
      if (record.blockers?.some((blocker) => blocker.id === input.id)) throw new Error('duplicate execution blocker id');
      unit.state = 'BLOCKED';
      unit.history.push({ action: 'blocked', slotId: unit.assignedSlotId, attempt: unit.attempt, at: timestamp, detail: string(input.question, 'blocker question') });
      record.blockers ??= [];
      record.blockers.push({ id: string(input.id, 'blocker id'), workUnitId: unit.id, slotId: authority.slotId, question: string(input.question, 'blocker question'), ...(input.options ? { options: input.options.map((option) => string(option, 'blocker option')) } : {}), resolved: false, createdAt: timestamp });
      record.state = 'BLOCKED';
    }, `Work unit blocked: ${workUnitId}`);
  }

  async function respondToBlocker(executionId: string, expectedStateVersion: number, blockerId: string, response: string): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const blocker = findBlocker(record, blockerId);
      if (blocker.resolved) throw new Error('execution blocker is resolved');
      blocker.response = string(response, 'blocker response');
      blocker.respondedAt = timestamp;
    }, `Execution blocker response recorded: ${blockerId}`);
  }

  async function resumeBlocker(executionId: string, expectedStateVersion: number, blockerId: string): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const blocker = findBlocker(record, blockerId);
      if (!blocker.response) throw new Error('execution blocker has no response');
      blocker.resolved = true;
      blocker.resolvedAt = timestamp;
      failActiveDeliveries(record, blocker.id, 'blocker resolved through alternate path', timestamp);
      const unit = findUnit(record, blocker.workUnitId);
      unit.state = unit.assignedSlotId ? 'CLAIMED' : 'READY';
      record.state = record.blockers?.some((candidate) => !candidate.resolved) ? 'BLOCKED' : 'RUNNING';
    }, `Execution blocker resumed: ${blockerId}`);
  }

  async function enqueueBlockerDelivery(
    executionId: string,
    expectedStateVersion: number,
    input: { clientRequestId: string; blockerId: string; text: string }
  ): Promise<{ outcome: 'accepted' | 'replay'; delivery: ExecutionDeliveryRecord; record: ExecutionRecord }> {
    const clientRequestId = string(input.clientRequestId, 'delivery client request id');
    const blockerId = string(input.blockerId, 'blocker id');
    if (!validUtf8String(input.text, MAX_DELIVERY_TEXT_BYTES)) throw new Error('delivery payload exceeds 16384 bytes');
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      assertActive(record);
      record.deliveries ??= [];
      record.deliveries = record.deliveries.filter((delivery) => {
        if (delivery.state === 'DELIVERED') return delivery.deliveredAt === undefined || now() - delivery.deliveredAt < DELIVERED_RETENTION_MS;
        if (delivery.state === 'FAILED') return now() - delivery.updatedAt < DELIVERED_RETENTION_MS;
        return true;
      });
      const existing = record.deliveries.find((delivery) => delivery.clientRequestId === clientRequestId);
      if (existing) {
        if (existing.blockerId !== blockerId || existing.payload.text !== input.text) throw new Error('delivery client request conflict');
        return { outcome: 'replay' as const, delivery: clone(existing), record: clone(record) };
      }
      if (record.stateVersion !== expectedStateVersion) throw new Error('stale execution state');
      const blocker = findBlocker(record, blockerId);
      if (blocker.resolved) throw new Error('execution blocker is resolved');
      if (record.deliveries.some((delivery) => delivery.blockerId === blockerId && (delivery.state === 'PENDING' || delivery.state === 'LEASED'))) {
        throw new Error('execution blocker already has an active delivery');
      }
      if (record.deliveries.length >= MAX_DELIVERIES_PER_EXECUTION) {
        throw new Error('execution delivery outbox limit reached');
      }
      const timestamp = now();
      const delivery: ExecutionDeliveryRecord = {
        id: string(id(), 'delivery id'), clientRequestId, blockerId, workUnitId: blocker.workUnitId,
        slotId: blocker.slotId, payload: { text: input.text }, state: 'PENDING', attempt: 0,
        createdAt: timestamp, updatedAt: timestamp
      };
      record.deliveries.push(delivery);
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, record.state, 'info', `Execution blocker response accepted: ${blockerId}`, timestamp, { kind: 'command', slotId: blocker.slotId });
      persist(snapshot.state, snapshot.hash);
      return { outcome: 'accepted' as const, delivery: clone(delivery), record: clone(record) };
    });
  }

  async function pullBlockerDelivery(binding: ExecutionCohortAuthority & { executionId: string; projectId: string; principalId?: string; authorizationId?: string }): Promise<ExecutionDeliveryRecord | undefined> {
    if (binding.role !== 'worker' && binding.role !== 'orchestrator') return undefined;
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === binding.executionId && candidate.projectId === binding.projectId);
      if (!record || terminalStates.has(record.state)) return undefined;
      record.deliveries ??= [];
      const timestamp = now();
      const activeLease = record.deliveries.find((delivery) => delivery.slotId === binding.slotId && delivery.state === 'LEASED' && (delivery.leaseExpiresAt ?? 0) > timestamp);
      if (activeLease) {
        if (binding.principalId && (activeLease.recipientPrincipalId !== binding.principalId
          || activeLease.recipientAuthorizationId !== binding.authorizationId)) return undefined;
        return clone(activeLease);
      }
      let leaseExpired = false;
      for (const delivery of record.deliveries) {
        if (delivery.state === 'LEASED' && (delivery.leaseExpiresAt ?? 0) <= timestamp) {
          delivery.state = delivery.attempt >= MAX_DELIVERY_ATTEMPTS ? 'FAILED' : 'PENDING';
          delivery.recipientPrincipalId = undefined;
          delivery.recipientAuthorizationId = undefined;
          delivery.leaseId = undefined;
          delivery.leaseExpiresAt = undefined;
          delivery.updatedAt = timestamp;
          leaseExpired = true;
        }
      }
      const delivery = record.deliveries.find((candidate) => candidate.slotId === binding.slotId && candidate.state === 'PENDING' && (candidate.nextAttemptAt ?? 0) <= timestamp);
      if (!delivery) {
        if (leaseExpired) persist(snapshot.state, snapshot.hash);
        return undefined;
      }
      if (binding.principalId && delivery.recipientPrincipalId && (delivery.recipientPrincipalId !== binding.principalId
        || delivery.recipientAuthorizationId !== binding.authorizationId)) return undefined;
      if (binding.principalId) delivery.recipientPrincipalId = binding.principalId;
      if (binding.authorizationId) delivery.recipientAuthorizationId = binding.authorizationId;
      delivery.state = 'LEASED';
      delivery.attempt += 1;
      delivery.leaseId = string(id(), 'delivery lease id');
      delivery.leaseExpiresAt = timestamp + DELIVERY_LEASE_MS;
      delivery.updatedAt = timestamp;
      persist(snapshot.state, snapshot.hash);
      return clone(delivery);
    });
  }

  async function ackBlockerDelivery(
    binding: ExecutionCohortAuthority & { executionId: string; projectId: string; principalId?: string; authorizationId?: string },
    deliveryId: string,
    leaseId: string,
    result: { delivered: boolean; error?: string }
  ): Promise<{ outcome: 'accepted' | 'replay'; delivery: ExecutionDeliveryRecord; record: ExecutionRecord }> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === binding.executionId && candidate.projectId === binding.projectId);
      const delivery = record?.deliveries?.find((candidate) => candidate.id === string(deliveryId, 'delivery id'));
      if (!record || (binding.role !== 'worker' && binding.role !== 'orchestrator') || !delivery || delivery.slotId !== binding.slotId
        || binding.principalId && delivery.recipientPrincipalId !== binding.principalId
        || binding.authorizationId && delivery.recipientAuthorizationId !== binding.authorizationId) throw new Error('delivery route is not authorized');
      if (delivery.state === 'DELIVERED') return { outcome: 'replay' as const, delivery: clone(delivery), record: clone(record) };
      if (delivery.state === 'FAILED') throw new Error('delivery is no longer active');
      assertActive(record);
      if (delivery.state !== 'LEASED' || delivery.leaseId !== leaseId || (delivery.leaseExpiresAt ?? 0) <= now()) throw new Error('delivery lease is not current');
      const timestamp = now();
      delivery.leaseId = undefined;
      delivery.leaseExpiresAt = undefined;
      delivery.updatedAt = timestamp;
      if (result.delivered) {
        delivery.state = 'DELIVERED';
        delivery.deliveredAt = timestamp;
        delivery.nextAttemptAt = undefined;
        delivery.lastError = undefined;
        const blocker = findBlocker(record, delivery.blockerId);
        if (blocker.workUnitId !== delivery.workUnitId || blocker.slotId !== delivery.slotId) throw new Error('delivery blocker binding changed');
        blocker.response = delivery.payload.text;
        blocker.respondedAt = timestamp;
        blocker.resolved = true;
        blocker.resolvedAt = timestamp;
        const unit = findUnit(record, blocker.workUnitId);
        unit.state = unit.assignedSlotId ? 'CLAIMED' : 'READY';
        record.state = record.blockers?.some((candidate) => !candidate.resolved) ? 'BLOCKED' : 'RUNNING';
      } else {
        delivery.lastError = truncateUtf8(result.error?.trim() || 'delivery failed', MAX_DELIVERY_ERROR_BYTES);
        if (delivery.attempt >= MAX_DELIVERY_ATTEMPTS) {
          delivery.state = 'FAILED';
          delivery.nextAttemptAt = undefined;
        } else {
          delivery.state = 'PENDING';
          delivery.nextAttemptAt = timestamp + Math.min(300_000, 1_000 * 2 ** (delivery.attempt - 1));
        }
      }
      record.stateVersion += 1;
      record.updatedAt = timestamp;
      append(snapshot.state, record, record.state, result.delivered ? 'info' : 'warning', result.delivered
        ? `Execution blocker response delivered: ${delivery.blockerId}` : `Execution blocker response delivery failed: ${delivery.blockerId}`, timestamp, { kind: 'command', slotId: delivery.slotId });
      persist(snapshot.state, snapshot.hash);
      return { outcome: 'accepted' as const, delivery: clone(delivery), record: clone(record) };
    });
  }

  async function retryBlockerDelivery(
    executionId: string,
    expectedStateVersion: number,
    blockerId: string,
    deliveryId: string
  ): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record, timestamp) => {
      const blocker = findBlocker(record, blockerId);
      const delivery = record.deliveries?.find((candidate) => candidate.id === string(deliveryId, 'delivery id'));
      if (!delivery || delivery.blockerId !== blocker.id || delivery.workUnitId !== blocker.workUnitId
        || delivery.slotId !== blocker.slotId) throw new Error('delivery route is not authorized');
      if (blocker.resolved || delivery.state !== 'FAILED' || (delivery.manualRetryCount ?? 0) >= 1) {
        throw new Error('delivery retry is not allowed');
      }
      delivery.state = 'PENDING';
      delivery.attempt = 0;
      delivery.manualRetryCount = (delivery.manualRetryCount ?? 0) + 1;
      delete delivery.recipientPrincipalId;
      delete delivery.recipientAuthorizationId;
      delivery.nextAttemptAt = timestamp;
      delivery.lastError = undefined;
      delivery.leaseId = undefined;
      delivery.leaseExpiresAt = undefined;
      delivery.updatedAt = timestamp;
    }, `Execution blocker response delivery retried: ${blockerId}`);
  }

  async function completeExecution(executionId: string, expectedStateVersion: number, finalSummary: string): Promise<ExecutionRecord> {
    return mutateRecord(executionId, expectedStateVersion, (record) => {
      if (record.coordinationMode === 'job-team' && !record.workUnits?.length) throw new Error('execution plan is required');
      if (record.workUnits?.some((unit) => unit.state !== 'COMPLETED')) throw new Error('required work units are incomplete');
      if (record.blockers?.some((blocker) => !blocker.resolved)) throw new Error('execution has unresolved blockers');
      if (record.state !== 'RUNNING' && record.state !== 'STARTING') throw new Error(`invalid execution transition ${record.state} -> COMPLETED`);
      if (typeof finalSummary !== 'string' || !finalSummary.trim() || finalSummary.length > MAX_FINAL_SUMMARY) throw new Error('invalid execution final summary');
      record.finalSummary = finalSummary;
      record.state = 'COMPLETED';
    }, 'Coordinator completed execution');
  }

  /** Hide terminal board history without deleting audit records or source retention. */
  async function dismiss(executionId: string): Promise<ExecutionRecord> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      if (!terminalStates.has(record.state)) throw new Error('only terminal executions can be dismissed');
      if (record.dismissedAt !== undefined) return clone(record);
      record.dismissedAt = now();
      persist(snapshot.state, snapshot.hash);
      return clone(record);
    });
  }

  async function get(executionId: string): Promise<ExecutionRecord | undefined> {
    return storeQueue.run(async () => {
      const record = read().state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      return record ? clone(record) : undefined;
    });
  }

  async function getInProject(projectId: string, executionId: string): Promise<ExecutionRecord | undefined> {
    const record = await get(executionId);
    return record?.projectId === string(projectId, 'project id') ? record : undefined;
  }

  async function list(callerPrincipalId: string, projectId: string, limit = 100): Promise<ExecutionRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return storeQueue.run(async () => clone(read().state.records
      .filter((record) => (record.callerPrincipalId === string(callerPrincipalId, 'caller principal id')
          || record.effectiveOwnerPrincipalIds?.includes(callerPrincipalId))
        && record.projectId === string(projectId, 'project id') && record.dismissedAt === undefined)
      .slice(-safeLimit).reverse()));
  }

  async function listInProject(projectId: string, before?: number, limit = 100): Promise<{ records: ExecutionRecord[]; hasMore: boolean }> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return storeQueue.run(async () => {
      const candidates = read().state.records
        .filter((record) => record.projectId === string(projectId, 'project id'))
        .filter((record) => record.dismissedAt === undefined)
        .filter((record) => before === undefined || record.createdAt < before)
        .sort((left, right) => right.createdAt - left.createdAt);
      return { records: clone(candidates.slice(0, safeLimit)), hasMore: candidates.length > safeLimit };
    });
  }

  async function listActive(): Promise<ExecutionRecord[]> {
    return storeQueue.run(async () => clone(read().state.records.filter((record) => !terminalStates.has(record.state))));
  }

  async function retainedSourceContentRefs(): Promise<ReadonlySet<string>> {
    return storeQueue.run(async () => new Set(read().state.records
      .map((record) => record.request.sourceBundle?.contentRef)
      .filter((contentRef): contentRef is string => !!contentRef)));
  }

  async function upgradeSourceBundle(
    executionId: string,
    expectedSources: NonNullable<ExecutionRequestSnapshotV1['sourceBundle']>['sources'],
    upgradedSources: NonNullable<ExecutionRequestSnapshotV1['sourceBundle']>['sources']
  ): Promise<void> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record?.request.sourceBundle) throw new Error('execution source bundle not found');
      if (JSON.stringify(record.request.sourceBundle.sources) === JSON.stringify(upgradedSources)) return;
      if (JSON.stringify(record.request.sourceBundle.sources) !== JSON.stringify(expectedSources)) {
        throw new Error('execution source metadata changed before upgrade');
      }
      if (!upgradedSources.every((source) => validDigest(source.extractedTextDigest)) || !validSourceBundle({
        contentRef: record.request.sourceBundle.contentRef,
        sources: upgradedSources
      })) throw new Error('invalid execution source metadata upgrade');
      record.request.sourceBundle.sources = clone(upgradedSources);
      persist(snapshot.state, snapshot.hash);
    });
  }

  async function events(
    callerPrincipalId: string,
    projectId: string,
    executionId: string,
    after = 0,
    limit = 100
  ): Promise<{ events: ExecutionEvent[]; nextSequence?: number; resyncRequired?: boolean }> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return storeQueue.run(async () => {
      const state = read().state;
      const record = state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record || record.callerPrincipalId !== string(callerPrincipalId, 'caller principal id')
        || record.projectId !== string(projectId, 'project id')) return { events: [] };
      const all = state.events.filter((event) => event.executionId === record.id);
      const earliest = all[0]?.sequence;
      const matching = all.filter((event) => event.sequence > after);
      const events = matching.slice(0, safeLimit);
      return {
        events: clone(events),
        ...(matching.length > events.length ? { nextSequence: events.at(-1)!.sequence } : {}),
        ...((earliest === undefined ? after > 0 : after < earliest - 1 || after > (record.lastEventSequence ?? 0)) ? { resyncRequired: true } : {})
      };
    });
  }

  async function eventsInProject(projectId: string, executionId: string, after = 0, limit = 100): Promise<{ events: ExecutionEvent[]; nextSequence?: number; resyncRequired?: boolean }> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return storeQueue.run(async () => {
      const state = read().state;
      const record = state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record || record.projectId !== string(projectId, 'project id')) return { events: [] };
      const all = state.events.filter((event) => event.executionId === record.id);
      const earliest = all[0]?.sequence;
      const matching = all.filter((event) => event.sequence > after);
      const events = matching.slice(0, safeLimit);
      return {
        events: clone(events),
        ...(matching.length > events.length ? { nextSequence: events.at(-1)!.sequence } : {}),
        ...((earliest === undefined ? after > 0 : after < earliest - 1 || after > (record.lastEventSequence ?? 0)) ? { resyncRequired: true } : {})
      };
    });
  }

  return { claim, transition, event, command, producerEvent, setPolicyResult, setAuthorizationContext, prepareLaunchIntent, addEffectiveOwner, removeEffectiveOwner, rotateRecoveryGeneration, beginRetry, registerPlan, claimWork, completeWork, failWork, releaseWork, retryWork, reassignWork, blockWork, respondToBlocker, resumeBlocker, enqueueBlockerDelivery, pullBlockerDelivery, ackBlockerDelivery, retryBlockerDelivery, completeExecution, dismiss, get, getInProject, list, listInProject, listActive, retainedSourceContentRefs, upgradeSourceBundle, events, eventsInProject };
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let end = value.length;
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maxBytes) end -= 1;
  return value.slice(0, end);
}

function failActiveDeliveries(record: ExecutionRecord, blockerId: string, reason: string, timestamp: number): void {
  for (const delivery of record.deliveries ?? []) {
    if (delivery.blockerId !== blockerId || delivery.state === 'DELIVERED' || delivery.state === 'FAILED') continue;
    delivery.state = 'FAILED';
    delivery.leaseId = undefined;
    delivery.leaseExpiresAt = undefined;
    delivery.nextAttemptAt = undefined;
    delivery.lastError = truncateUtf8(reason, MAX_DELIVERY_ERROR_BYTES);
    delivery.updatedAt = timestamp;
  }
}

function normalizeRequest(input: ExecutionRequestSnapshotV1): ExecutionRequestSnapshotV1 {
  if (!validRequestSnapshot(input)) throw new Error('invalid execution request snapshot');
  return { ...clone(input), launchKind: input.launchKind ?? 'team' };
}

function sameLaunchDisplay(left: ExecutionLaunchDisplayV1, right: ExecutionLaunchDisplayV1 | undefined): boolean {
  return left.label === right?.label;
}

function normalizePlan(inputs: ExecutionWorkUnitInput[], requireComplete = false): ExecutionWorkUnit[] {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_WORK_UNITS) throw new Error('invalid execution work unit count');
  const ids = new Set<string>();
  const units = inputs.map((input) => {
    const unitId = string(input.id, 'work unit id');
    if (ids.has(unitId)) throw new Error('duplicate work unit id');
    ids.add(unitId);
    const dependencies = Array.isArray(input.dependencies) && input.dependencies.length <= MAX_UNIT_LIST
      ? input.dependencies.map((dependency) => string(dependency, 'work unit dependency')) : (() => { throw new Error('invalid work unit dependencies'); })();
    const files = input.files?.map(normalizeFileScope);
    const verification = input.verification?.map((step) => string(step, 'work unit verification'));
    if (requireComplete && !input.readOnly && !files?.length) throw new Error('mutating work unit requires file scope');
    if (requireComplete && !verification?.length) throw new Error('work unit requires verification');
    return {
      id: unitId, title: string(input.title, 'work unit title'), task: string(input.task, 'work unit task'), dependencies,
      ...(input.preferredRole ? { preferredRole: string(input.preferredRole, 'work unit preferred role') } : {}),
      ...(files ? { files } : {}),
      ...(verification ? { verification } : {}),
      ...(input.readOnly ? { readOnly: true } : {}),
      state: dependencies.length ? 'PENDING' as const : 'READY' as const, attempt: 0, history: []
    };
  });
  for (const unit of units) for (const dependency of unit.dependencies) if (!ids.has(dependency)) throw new Error('missing work unit dependency');
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (unitId: string) => {
    if (visiting.has(unitId)) throw new Error('work unit dependency cycle');
    if (visited.has(unitId)) return;
    visiting.add(unitId);
    for (const dependency of units.find((unit) => unit.id === unitId)!.dependencies) visit(dependency);
    visiting.delete(unitId); visited.add(unitId);
  };
  for (const unit of units) visit(unit.id);
  return units;
}

function stripWorkUnitState(unit: ExecutionWorkUnit): ExecutionWorkUnitInput {
  const { state: _state, assignedSlotId: _assignedSlotId, attempt: _attempt, failure: _failure, result: _result, history: _history, ...input } = unit;
  return input;
}

function normalizeFileScope(value: string): string {
  const raw = string(value, 'work unit file scope').replace(/\\/g, '/');
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) throw new Error('invalid work unit file scope');
  const parts: string[] = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') throw new Error('invalid work unit file scope');
    parts.push(part);
  }
  if (!parts.length) throw new Error('invalid work unit file scope');
  return parts.join('/');
}

function findUnit(record: ExecutionRecord, workUnitId: string): ExecutionWorkUnit {
  const unit = record.workUnits?.find((candidate) => candidate.id === string(workUnitId, 'work unit id'));
  if (!unit) throw new Error('work unit not found');
  return unit;
}

function findBlocker(record: ExecutionRecord, blockerId: string): ExecutionBlocker {
  const blocker = record.blockers?.find((candidate) => candidate.id === string(blockerId, 'blocker id'));
  if (!blocker) throw new Error('execution blocker not found');
  return blocker;
}

function assertUnitAuthority(unit: ExecutionWorkUnit, authority: ExecutionCohortAuthority): void {
  if (authority.role === 'worker' && unit.assignedSlotId !== authority.slotId) throw new Error('work unit is assigned to another slot');
}

function assertAuthorizedSlot(record: ExecutionRecord, slotId: string): void {
  if (record.coordinationMode === 'job-team' && !record.authorizationContext?.slots.some((slot) => slot.slotId === slotId)) {
    throw new Error('assigned slot is not authorized');
  }
}

function deriveReadiness(record: ExecutionRecord): void {
  const complete = new Set(record.workUnits?.filter((unit) => unit.state === 'COMPLETED').map((unit) => unit.id));
  for (const unit of record.workUnits ?? []) if (unit.state === 'PENDING' && unit.dependencies.every((dependency) => complete.has(dependency))) unit.state = 'READY';
}

function scopesOverlap(left: ExecutionWorkUnit, right: ExecutionWorkUnit): boolean {
  if (left.readOnly || right.readOnly) return false;
  if (!left.files?.length || !right.files?.length) return true;
  return left.files.some((a) => right.files!.some((b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
}

function assertScopeAvailable(record: ExecutionRecord, candidate: ExecutionWorkUnit): void {
  const conflict = record.workUnits?.some((unit) => unit.id !== candidate.id && unit.state === 'CLAIMED' && scopesOverlap(candidate, unit));
  if (conflict) throw new Error('overlapping mutating file scope');
}

function assertActive(record: ExecutionRecord): void {
  if (terminalStates.has(record.state)) throw new Error(`execution is ${record.state.toLowerCase()}`);
}

function compactEvents(events: ExecutionEvent[], perExecution: number, global: number): ExecutionEvent[] {
  const byExecution = new Map<string, ExecutionEvent[]>();
  for (const event of events) {
    const group = byExecution.get(event.executionId) ?? [];
    group.push(event);
    byExecution.set(event.executionId, group);
  }
  let retained = [...byExecution.values()].flatMap((group) => retainEvents(group, perExecution));
  if (retained.length > global) retained = retainEvents(retained, global);
  return retained.sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence);
}

function retainEvents(events: ExecutionEvent[], limit: number): ExecutionEvent[] {
  if (events.length <= limit) return events;
  const newestFirst = [...events].sort((left, right) => right.createdAt - left.createdAt || right.sequence - left.sequence);
  const essential = newestFirst.filter((event) => event.kind === 'transition' || event.eventType === 'blocker' || event.eventType === 'outcome');
  const selected = essential.slice(0, limit);
  if (selected.length < limit) {
    const selectedIds = new Set(selected);
    selected.push(...newestFirst.filter((event) => !selectedIds.has(event)).slice(0, limit - selected.length));
  }
  return selected;
}

function append(
  state: ExecutionStateFile,
  record: ExecutionRecord,
  eventState: ExecutionState,
  severity: ExecutionEvent['severity'],
  summary: string,
  createdAt: number,
  metadata: Pick<ExecutionEvent, 'kind' | 'fromState' | 'toState' | 'slotId'> = {}
): void {
  const sequence = (record.lastEventSequence ?? nextSequence(state, record.id) - 1) + 1;
  record.lastEventSequence = sequence;
  state.events.push({ id: randomUUID(), executionId: record.id, attempt: record.attempt, sequence, state: eventState, stateVersion: record.stateVersion, severity, summary, createdAt, ...metadata });
}

function nextSequence(state: ExecutionStateFile, executionId: string): number {
  return state.events.reduce((highest, event) => event.executionId === executionId ? Math.max(highest, event.sequence) : highest, 0) + 1;
}

function canTransition(from: ExecutionState, to: ExecutionState): boolean {
  return (from === 'READY' && (to === 'STARTING' || to === 'BLOCKED' || to === 'STOPPED' || to === 'FAILED'))
    || (from === 'STARTING' && (to === 'RUNNING' || to === 'COMPLETED' || to === 'BLOCKED' || to === 'FAILED' || to === 'STOPPED'))
    || (from === 'RUNNING' && (to === 'COMPLETED' || to === 'BLOCKED' || to === 'FAILED' || to === 'STOPPED'))
    || (from === 'BLOCKED' && (to === 'RUNNING' || to === 'STOPPED' || to === 'FAILED'));
}
