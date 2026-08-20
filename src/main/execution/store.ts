import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  atomicDurableWrite,
  createSerializedTransactionQueue,
  hashBytes,
  readRawFile
} from '../harness-routing-migration/storage.js';
import type { WorkflowPolicyResultV1 } from './policy-result.js';
import type { TeamLaunchAuthorizationContextV1 } from '../../shared/types.js';
import type { SquadBundleWorkflowMetadataV1, TeamLaunchAuthorizationInputSlot, TeamLaunchRequestInput } from '../../shared/types.js';

export type ExecutionState = 'READY' | 'STARTING' | 'RUNNING' | 'COMPLETED' | 'BLOCKED' | 'STOPPED' | 'FAILED';

export interface ExecutionRecord {
  id: string;
  callerPrincipalId: string;
  projectId: string;
  teamId: string;
  jobTitle: string;
  summary?: string;
  requestDigest: string;
  launchRequestId: string;
  teamLaunchRequestId: string;
  request: ExecutionRequestSnapshotV1;
  attempt: number;
  state: ExecutionState;
  stateVersion: number;
  resolvedModels: ResolvedModelSnapshotV1[];
  authorizationContext?: TeamLaunchAuthorizationContextV1;
  authorizationContextDigest?: string;
  launchIntent?: ExecutionLaunchIntentV1;
  policyResult?: WorkflowPolicyResultV1;
  effectiveOwnerPrincipalIds?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ExecutionRequestSnapshotV1 {
  version: 1;
  slots: TeamLaunchAuthorizationInputSlot[];
  policy?: TeamLaunchRequestInput['policy'];
  workflow?: SquadBundleWorkflowMetadataV1;
  resolvedModels: ResolvedModelSnapshotV1[];
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
  eventType?: 'progress' | 'blocker' | 'failure' | 'outcome';
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
}

const MAX_RECORDS = 2_000;
const MAX_EVENTS = 10_000;
const MAX_STRING = 2_048;
const storeQueue = createSerializedTransactionQueue();
const terminalStates = new Set<ExecutionState>(['COMPLETED', 'BLOCKED', 'STOPPED', 'FAILED']);

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
    && validString(record.launchRequestId) && validString(record.teamLaunchRequestId) && validRequestSnapshot(record.request)
    && (record.summary === undefined || validString(record.summary)) && Number.isInteger(record.attempt)
    && isState(record.state) && Number.isInteger(record.stateVersion) && Array.isArray(record.resolvedModels) && record.resolvedModels.every(validModelSnapshot)
    && (record.authorizationContext === undefined || validAuthorizationContext(record.authorizationContext))
    && (record.authorizationContextDigest === undefined || validString(record.authorizationContextDigest))
    && (record.launchIntent === undefined || validLaunchIntent(record.launchIntent))
    && (record.policyResult === undefined || validPolicyResult(record.policyResult))
    && (record.effectiveOwnerPrincipalIds === undefined || Array.isArray(record.effectiveOwnerPrincipalIds) && record.effectiveOwnerPrincipalIds.every(validString))
    && typeof record.createdAt === 'number' && typeof record.updatedAt === 'number';
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
  return request.version === 1 && Array.isArray(request.slots) && request.slots.length > 0
    && request.slots.every((slot) => !!slot && typeof slot === 'object' && validString((slot as { initialTask?: unknown }).initialTask))
    && Array.isArray(request.resolvedModels) && request.resolvedModels.every(validModelSnapshot)
    && (request.policy === undefined || typeof request.policy === 'object')
    && (request.workflow === undefined || typeof request.workflow === 'object');
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
    && (event.eventType === undefined || event.eventType === 'progress' || event.eventType === 'blocker' || event.eventType === 'failure' || event.eventType === 'outcome')
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

function validString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING;
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

  function read(): { state: ExecutionStateFile; hash: string | null } {
    const bytes = readRawFile(options.filePath);
    if (!bytes) return { state: { version: 1, revision: 0, records: [], events: [] }, hash: null };
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as Partial<ExecutionStateFile>;
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
    const active = state.records.filter((record) => !terminalStates.has(record.state));
    const retainedTerminalIds = new Set(state.records
      .filter((record) => terminalStates.has(record.state))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, maxRecords)
      .map((record) => record.id));
    state.records = state.records.filter((record) => !terminalStates.has(record.state) || retainedTerminalIds.has(record.id));
    state.events = state.events.slice(-maxEvents);
    state.revision += 1;
    mkdirSync(dirname(options.filePath), { recursive: true });
    atomicDurableWrite(options.filePath, Buffer.from(JSON.stringify(state)), { expectedHash });
  }

  async function claim(input: Omit<ExecutionRecord, 'id' | 'teamLaunchRequestId' | 'attempt' | 'state' | 'stateVersion' | 'createdAt' | 'updatedAt'>) {
    const bounded = {
      callerPrincipalId: string(input.callerPrincipalId, 'caller principal id'),
      projectId: string(input.projectId, 'project id'),
      teamId: string(input.teamId, 'team id'),
      jobTitle: string(input.jobTitle, 'job title'),
      ...(input.summary === undefined ? {} : { summary: string(input.summary, 'summary') }),
      requestDigest: string(input.requestDigest, 'request digest'),
      launchRequestId: string(input.launchRequestId, 'launch request id'),
      request: normalizeRequest(input.request),
      resolvedModels: input.resolvedModels.map((snapshot) => ({
        slotId: string(snapshot.slotId, 'model slot id'), provider: string(snapshot.provider, 'model provider'),
        model: string(snapshot.model, 'model'), ...(snapshot.reasoning === undefined ? {} : { reasoning: string(snapshot.reasoning, 'model reasoning') })
      }))
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
        ...bounded, id: string(id(), 'id'), teamLaunchRequestId: bounded.launchRequestId, attempt: 1, state: 'READY', stateVersion: 0,
        createdAt: timestamp, updatedAt: timestamp
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
      if (!canTransition(record.state, state)) throw new Error(`invalid execution transition ${record.state} -> ${state}`);
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
      type: NonNullable<ExecutionEvent['eventType']>;
      severity: ExecutionEvent['severity'];
      summary: string;
      detail?: string;
      blocker?: { question: string; options?: string[] };
    }
  ): Promise<{ outcome: 'accepted' | 'replay'; event: ExecutionEvent }> {
    return storeQueue.run(async () => {
      const snapshot = read();
      const record = snapshot.state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record) throw new Error('execution not found');
      const eventId = string(input.id, 'event id');
      const existing = snapshot.state.events.find((event) => event.executionId === record.id && event.id === eventId);
      if (existing) return { outcome: 'replay' as const, event: clone(existing) };
      if ((input.type === 'blocker') !== !!input.blocker || (input.type === 'blocker' && !validBlocker(input.blocker))) {
        throw new Error('invalid execution blocker');
      }
      const timestamp = now();
      const event: ExecutionEvent = {
        id: eventId, executionId: record.id, attempt: record.attempt,
        sequence: nextSequence(snapshot.state, record.id), state: record.state, stateVersion: record.stateVersion,
        kind: 'event', eventType: input.type, severity: input.severity,
        summary: string(input.summary, 'event summary'), createdAt: timestamp,
        ...(input.slotId === undefined ? {} : { slotId: string(input.slotId, 'slot id') }),
        ...(input.detail === undefined ? {} : { detail: string(input.detail, 'event detail') }),
        ...(input.blocker === undefined ? {} : { blocker: clone(input.blocker) })
      };
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
      .filter((record) => record.callerPrincipalId === string(callerPrincipalId, 'caller principal id')
        && record.projectId === string(projectId, 'project id'))
      .slice(-safeLimit).reverse()));
  }

  async function listInProject(projectId: string, limit = 100): Promise<ExecutionRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return storeQueue.run(async () => clone(read().state.records
      .filter((record) => record.projectId === string(projectId, 'project id'))
      .slice(-safeLimit).reverse()));
  }

  async function events(
    callerPrincipalId: string,
    projectId: string,
    executionId: string,
    after = 0,
    limit = 100
  ): Promise<{ events: ExecutionEvent[]; nextSequence?: number }> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return storeQueue.run(async () => {
      const state = read().state;
      const record = state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record || record.callerPrincipalId !== string(callerPrincipalId, 'caller principal id')
        || record.projectId !== string(projectId, 'project id')) return { events: [] };
      const matching = state.events.filter((event) => event.executionId === record.id && event.sequence > after);
      const events = matching.slice(0, safeLimit);
      return {
        events: clone(events),
        ...(matching.length > events.length ? { nextSequence: events.at(-1)!.sequence } : {})
      };
    });
  }

  async function eventsInProject(projectId: string, executionId: string, after = 0, limit = 100): Promise<{ events: ExecutionEvent[]; nextSequence?: number }> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return storeQueue.run(async () => {
      const state = read().state;
      const record = state.records.find((candidate) => candidate.id === string(executionId, 'id'));
      if (!record || record.projectId !== string(projectId, 'project id')) return { events: [] };
      const matching = state.events.filter((event) => event.executionId === record.id && event.sequence > after);
      const events = matching.slice(0, safeLimit);
      return { events: clone(events), ...(matching.length > events.length ? { nextSequence: events.at(-1)!.sequence } : {}) };
    });
  }

  return { claim, transition, event, command, producerEvent, setPolicyResult, setAuthorizationContext, prepareLaunchIntent, addEffectiveOwner, removeEffectiveOwner, beginRetry, get, getInProject, list, listInProject, events, eventsInProject };
}

function normalizeRequest(input: ExecutionRequestSnapshotV1): ExecutionRequestSnapshotV1 {
  if (!validRequestSnapshot(input)) throw new Error('invalid execution request snapshot');
  return clone(input);
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
  const sequence = nextSequence(state, record.id);
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
