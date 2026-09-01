import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue, hashBytes, readRawFile } from '../harness-routing/storage.js';

export type DeliveryState = 'DELIVERY_AUTHORIZED' | 'DELIVERY_IN_FLIGHT' | 'DELIVERED' | 'DELIVERY_REVOKED' | 'DELIVERY_UNCERTAIN';

export interface DeliveryDescriptorV1 {
  version: 1;
  executionId: string;
  attempt: number;
  outputDigest: string;
  extensionDigest: string;
  policyResultDigest: string;
  targetId: string;
  adapterId: string;
  adapterVersion: string;
}

export function validateDeliveryDescriptor(value: unknown): DeliveryDescriptorV1 | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = value as Partial<DeliveryDescriptorV1>;
  const attempt = descriptor.attempt;
  if (descriptor.version !== 1 || typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 1) return undefined;
  const fields = ['executionId', 'outputDigest', 'extensionDigest', 'policyResultDigest', 'targetId', 'adapterId', 'adapterVersion'] as const;
  if (fields.some((field) => typeof descriptor[field] !== 'string' || !descriptor[field]!.trim() || descriptor[field]!.length > 2_048)) return undefined;
  return { ...descriptor, attempt } as DeliveryDescriptorV1;
}

export interface DeliveryGrantV1 {
  id: string;
  executionId: string;
  projectId: string;
  descriptorDigest: string;
  expiresAt: number;
  revocationEpoch: number;
}

export interface DeliveryResultV1 {
  id: string;
  grantId: string;
  executionId: string;
  projectId: string;
  descriptorDigest: string;
  state: DeliveryState;
  receipt?: string;
  createdAt: number;
  updatedAt: number;
}

interface StateFile { version: 1; revision: number; grants: DeliveryGrantV1[]; results: DeliveryResultV1[] }

const queue = createSerializedTransactionQueue();
const MAX_RECORDS = 2_000;

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) throw new Error(`invalid delivery ${label}`);
  return value;
}
function isState(value: unknown): value is DeliveryState {
  return value === 'DELIVERY_AUTHORIZED' || value === 'DELIVERY_IN_FLIGHT' || value === 'DELIVERED' || value === 'DELIVERY_REVOKED' || value === 'DELIVERY_UNCERTAIN';
}
function validGrant(value: unknown): value is DeliveryGrantV1 {
  if (!value || typeof value !== 'object') return false;
  const grant = value as Partial<DeliveryGrantV1>;
  return typeof grant.id === 'string' && typeof grant.executionId === 'string' && typeof grant.projectId === 'string'
    && typeof grant.descriptorDigest === 'string' && typeof grant.expiresAt === 'number' && Number.isInteger(grant.revocationEpoch);
}
function validResult(value: unknown): value is DeliveryResultV1 {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<DeliveryResultV1>;
  return typeof result.id === 'string' && typeof result.grantId === 'string' && typeof result.executionId === 'string' && typeof result.projectId === 'string' && typeof result.descriptorDigest === 'string'
    && isState(result.state) && (result.receipt === undefined || typeof result.receipt === 'string')
    && typeof result.createdAt === 'number' && typeof result.updatedAt === 'number';
}

export function deliveryDescriptorDigest(descriptor: DeliveryDescriptorV1): string {
  return `sha256:${hashBytes(Buffer.from(JSON.stringify(descriptor)))}`;
}

export function createDeliveryStore(options: { filePath: string; now?: () => number; id?: () => string }) {
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  function read(): { state: StateFile; hash: string | null } {
    const bytes = readRawFile(options.filePath);
    if (!bytes) return { state: { version: 1, revision: 0, grants: [], results: [] }, hash: null };
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as Partial<StateFile>;
      if (parsed.version !== 1 || !Number.isInteger(parsed.revision) || !Array.isArray(parsed.grants) || !parsed.grants.every(validGrant)
        || !Array.isArray(parsed.results) || !parsed.results.every(validResult)) throw new Error('invalid shape');
      return { state: parsed as StateFile, hash: hashBytes(bytes) };
    } catch (error) { throw new Error(`corrupt delivery store: ${error instanceof Error ? error.message : String(error)}`); }
  }
  function persist(state: StateFile, expectedHash: string | null): void {
    state.grants = state.grants.slice(-MAX_RECORDS);
    state.results = state.results.slice(-MAX_RECORDS);
    state.revision += 1;
    mkdirSync(dirname(options.filePath), { recursive: true });
    atomicDurableWrite(options.filePath, Buffer.from(JSON.stringify(state)), { expectedHash });
  }
  async function grant(input: Omit<DeliveryGrantV1, 'id'>) {
    const bounded = { executionId: string(input.executionId, 'execution id'), projectId: string(input.projectId, 'project id'), descriptorDigest: string(input.descriptorDigest, 'descriptor digest'), expiresAt: input.expiresAt, revocationEpoch: input.revocationEpoch };
    if (!Number.isFinite(bounded.expiresAt) || bounded.expiresAt <= now() || !Number.isInteger(bounded.revocationEpoch) || bounded.revocationEpoch < 0) throw new Error('invalid delivery grant');
    return queue.run(async () => {
      const snapshot = read();
      const existing = snapshot.state.grants.find((candidate) => candidate.executionId === bounded.executionId && candidate.descriptorDigest === bounded.descriptorDigest);
      if (existing && existing.expiresAt > now() && existing.revocationEpoch === bounded.revocationEpoch) {
        return { outcome: 'replay' as const, grant: clone(existing) };
      }
      if (existing) snapshot.state.grants = snapshot.state.grants.filter((candidate) => candidate.id !== existing.id);
      const record = { id: string(id(), 'grant id'), ...bounded };
      snapshot.state.grants.push(record);
      persist(snapshot.state, snapshot.hash);
      return { outcome: 'granted' as const, grant: clone(record) };
    });
  }
  async function dispatch(grantId: string, descriptorDigest: string, expectedEpoch: number): Promise<DeliveryResultV1> {
    return queue.run(async () => {
      const snapshot = read();
      const grant = snapshot.state.grants.find((candidate) => candidate.id === string(grantId, 'grant id'));
      if (!grant || grant.descriptorDigest !== string(descriptorDigest, 'descriptor digest') || grant.revocationEpoch !== expectedEpoch || grant.expiresAt <= now()) throw new Error('delivery grant is not current');
      const existing = snapshot.state.results.find((candidate) => candidate.grantId === grant.id);
      if (existing) return clone(existing);
      const timestamp = now();
      const result = { id: string(id(), 'result id'), grantId: grant.id, executionId: grant.executionId, projectId: grant.projectId, descriptorDigest: grant.descriptorDigest, state: 'DELIVERY_IN_FLIGHT' as const, createdAt: timestamp, updatedAt: timestamp };
      snapshot.state.results.push(result);
      persist(snapshot.state, snapshot.hash);
      return clone(result);
    });
  }
  async function receipt(resultId: string, executionId: string, projectId: string, receipt: string): Promise<DeliveryResultV1> {
    return queue.run(async () => {
      const snapshot = read();
      const result = snapshot.state.results.find((candidate) => candidate.id === string(resultId, 'result id'));
      if (!result || result.executionId !== string(executionId, 'execution id') || result.projectId !== string(projectId, 'project id') || result.state !== 'DELIVERY_IN_FLIGHT') throw new Error('delivery result is not in flight');
      result.state = 'DELIVERED';
      result.receipt = string(receipt, 'receipt');
      result.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return clone(result);
    });
  }
  return { grant, dispatch, receipt };
}
