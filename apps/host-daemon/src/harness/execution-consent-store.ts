import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HarnessScope } from '@zana-ai/zcc-domain/harness-adapter';
import {
  atomicDurableWrite,
  createSerializedTransactionQueue,
  hashBytes,
  readRawFile
} from '@zana-ai/zcc-server/services/harness-routing/storage';

const consentTransactionQueue = createSerializedTransactionQueue();

export type ExecutionConsentScope = 'one-launch' | 'project';

type StoredExecutionConsentGrant = Omit<ExecutionConsentGrant, 'scope'> & {
  scope: ExecutionConsentScope | 'global';
};

interface StoredExecutionConsentState {
  version: 1;
  grants: StoredExecutionConsentGrant[];
  reservations: ExecutionConsentReservation[];
}

export interface ExecutionConsentBinding {
  adapterId: string;
  targetId: string;
  targetDigest: string;
  evidenceDigest: string;
  projectId: string;
  launchScope: HarnessScope;
}

export interface ExecutionConsentGrant extends ExecutionConsentBinding {
  id: string;
  scope: ExecutionConsentScope;
  createdAt: number;
  expiresAt?: number;
  revokedAt?: number;
  consumedAt?: number;
}

export interface ExecutionConsentReservation {
  id: string;
  grantId: string;
  idempotencyKey: string;
  createdAt: number;
  expiresAt: number;
  claimedAt?: number;
}

interface ExecutionConsentState {
  version: 1;
  grants: ExecutionConsentGrant[];
  reservations: ExecutionConsentReservation[];
}

export interface ExecutionConsentStoreOptions {
  filePath: string;
  maxReservations?: number;
  reservationTtlMs?: number;
  now?: () => number;
  id?: () => string;
  durableWrite?: typeof atomicDurableWrite;
}

export type ExecutionConsentReserveResult =
  | { outcome: 'reserved'; reservation: ExecutionConsentReservation; grant: ExecutionConsentGrant }
  | { outcome: 'denied' };

export type ExecutionConsentClaimResult =
  | { outcome: 'claimed'; reservation: ExecutionConsentReservation; grant: ExecutionConsentGrant }
  | { outcome: 'denied' };

export type ExecutionConsentConsumeResult =
  | { outcome: 'consumed'; reservation: ExecutionConsentReservation; grant: ExecutionConsentGrant }
  | { outcome: 'denied' };

export function createExecutionConsentStore(opts: ExecutionConsentStoreOptions) {
  const maxReservations = opts.maxReservations ?? 2_000;
  const reservationTtlMs = opts.reservationTtlMs ?? 5 * 60_000;
  const now = opts.now ?? (() => Date.now());
  const id = opts.id ?? randomUUID;
  const durableWrite = opts.durableWrite ?? atomicDurableWrite;

  function runExclusive<T>(task: () => Promise<T>): Promise<T> {
    // Consent may be opened by more than one service instance during startup or
    // tests. Use the process-wide durable transaction queue, not an instance lock.
    return consentTransactionQueue.run(task);
  }

  function readState(): { state: ExecutionConsentState; hash: string | null } {
    const bytes = readRawFile(opts.filePath);
    if (bytes === null) return { state: { version: 1, grants: [], reservations: [] }, hash: null };
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
      if (!isStoredState(parsed)) throw new Error('invalid shape');
      return { state: discardLegacyGlobalConsent(parsed), hash: hashBytes(bytes) };
    } catch {
      throw new Error('corrupt execution consent store');
    }
  }

  function persist(state: ExecutionConsentState, expectedHash: string | null): void {
    mkdirSync(dirname(opts.filePath), { recursive: true });
    compactReservations(state, maxReservations);
    durableWrite(opts.filePath, Buffer.from(JSON.stringify(state)), { expectedHash });
  }

  function prune(state: ExecutionConsentState, timestamp: number): boolean {
    const retained = state.reservations.filter((reservation) => reservation.claimedAt !== undefined || reservation.expiresAt > timestamp);
    const changed = retained.length !== state.reservations.length;
    state.reservations = retained;
    return changed;
  }

  async function grant(input: ExecutionConsentBinding & { scope: ExecutionConsentScope; expiresAt?: number }): Promise<ExecutionConsentGrant> {
    if (!isExecutionConsentScope(input.scope)) throw new Error('unsupported execution consent scope');
    return runExclusive(async () => {
      const snapshot = readState();
      const state = snapshot.state;
      const timestamp = now();
      prune(state, timestamp);
      const created: ExecutionConsentGrant = { id: id(), ...input, createdAt: timestamp };
      state.grants.push(created);
      persist(state, snapshot.hash);
      return { ...created };
    });
  }

  async function reserve(input: ExecutionConsentBinding & { scope: ExecutionConsentScope; idempotencyKey: string }): Promise<ExecutionConsentReserveResult> {
    if (!isExecutionConsentScope(input.scope)) return { outcome: 'denied' };
    return runExclusive(async () => {
      const snapshot = readState();
      const state = snapshot.state;
      const timestamp = now();
      const changed = prune(state, timestamp);
      const replay = state.reservations.find((reservation) => reservation.idempotencyKey === input.idempotencyKey && reservation.claimedAt === undefined);
      if (replay) {
        const replayGrant = state.grants.find((grant) => grant.id === replay.grantId);
        if (replayGrant && matches(replayGrant, input, timestamp)) {
          return { outcome: 'reserved', reservation: { ...replay }, grant: { ...replayGrant } };
        }
        if (changed) persist(state, snapshot.hash);
        return { outcome: 'denied' };
      }
      const matching = [...state.grants].reverse().find((candidate) => matches(candidate, input, timestamp));
      if (!matching) {
        if (changed) persist(state, snapshot.hash);
        return { outcome: 'denied' };
      }
      if (matching.scope === 'one-launch' && state.reservations.some((reservation) => reservation.grantId === matching.id && reservation.claimedAt === undefined)) {
        if (changed) persist(state, snapshot.hash);
        return { outcome: 'denied' };
      }
      const reservation: ExecutionConsentReservation = {
        id: id(), grantId: matching.id, idempotencyKey: input.idempotencyKey,
        createdAt: timestamp, expiresAt: timestamp + reservationTtlMs
      };
      state.reservations.push(reservation);
      persist(state, snapshot.hash);
      return { outcome: 'reserved', reservation: { ...reservation }, grant: { ...matching } };
    });
  }

  async function claim(reservationId: string): Promise<ExecutionConsentClaimResult> {
    return runExclusive(async () => {
      const snapshot = readState();
      const state = snapshot.state;
      const timestamp = now();
      prune(state, timestamp);
      const reservation = state.reservations.find((candidate) => candidate.id === reservationId);
      const consentGrant = reservation && state.grants.find((candidate) => candidate.id === reservation.grantId);
      if (!reservation || !consentGrant || reservation.claimedAt !== undefined || reservation.expiresAt <= timestamp || !isActive(consentGrant, timestamp)) {
        return { outcome: 'denied' };
      }
      reservation.claimedAt = timestamp;
      if (consentGrant.scope === 'one-launch') consentGrant.consumedAt = timestamp;
      persist(state, snapshot.hash);
      return { outcome: 'claimed', reservation: { ...reservation }, grant: { ...consentGrant } };
    });
  }

  /** Idempotent crash-recovery consume. Ledger-owned reservations may be expired. */
  async function consume(reservationId: string): Promise<ExecutionConsentConsumeResult> {
    return runExclusive(async () => {
      const snapshot = readState();
      const state = snapshot.state;
      const reservation = state.reservations.find((candidate) => candidate.id === reservationId);
      const consentGrant = reservation && state.grants.find((candidate) => candidate.id === reservation.grantId);
      if (!reservation || !consentGrant || consentGrant.revokedAt !== undefined) return { outcome: 'denied' };
      if (reservation.claimedAt === undefined) reservation.claimedAt = now();
      if (consentGrant.scope === 'one-launch' && consentGrant.consumedAt === undefined) {
        consentGrant.consumedAt = reservation.claimedAt;
      }
      persist(state, snapshot.hash);
      return { outcome: 'consumed', reservation: { ...reservation }, grant: { ...consentGrant } };
    });
  }

  async function release(reservationId: string): Promise<void> {
    return runExclusive(async () => {
      const snapshot = readState();
      const state = snapshot.state;
      const index = state.reservations.findIndex((reservation) => reservation.id === reservationId && reservation.claimedAt === undefined);
      if (index < 0) return;
      state.reservations.splice(index, 1);
      persist(state, snapshot.hash);
    });
  }

  async function revoke(grantId: string): Promise<void> {
    return runExclusive(async () => {
      const snapshot = readState();
      const state = snapshot.state;
      const consentGrant = state.grants.find((candidate) => candidate.id === grantId);
      if (!consentGrant || consentGrant.revokedAt !== undefined) return;
      consentGrant.revokedAt = now();
      state.reservations = state.reservations.filter((reservation) => reservation.grantId !== grantId || reservation.claimedAt !== undefined);
      persist(state, snapshot.hash);
    });
  }

  async function revokeProject(grantId: string, projectId: string): Promise<boolean> {
    return runExclusive(async () => {
      const snapshot = readState();
      const state = snapshot.state;
      const consentGrant = state.grants.find((candidate) => candidate.id === grantId);
      if (!consentGrant || consentGrant.scope !== 'project' || consentGrant.projectId !== projectId
        || consentGrant.revokedAt !== undefined) return false;
      consentGrant.revokedAt = now();
      state.reservations = state.reservations.filter((reservation) => reservation.grantId !== grantId || reservation.claimedAt !== undefined);
      persist(state, snapshot.hash);
      return true;
    });
  }

  async function list(): Promise<{ grants: ExecutionConsentGrant[]; reservations: ExecutionConsentReservation[] }> {
    return runExclusive(async () => {
      const state = readState().state;
      return { grants: state.grants.map((entry) => ({ ...entry })), reservations: state.reservations.map((entry) => ({ ...entry })) };
    });
  }

  return { grant, reserve, claim, consume, release, revoke, revokeProject, list };
}

function compactReservations(state: ExecutionConsentState, maxReservations: number): void {
  if (maxReservations < 0 || state.reservations.length <= maxReservations) return;
  // Never evict an outstanding reservation: after restart it must continue to
  // lock a one-launch grant until release or expiry. Only claimed history trims.
  let excess = state.reservations.length - maxReservations;
  state.reservations = state.reservations.filter((reservation) => {
    if (excess > 0 && reservation.claimedAt !== undefined) {
      excess -= 1;
      return false;
    }
    return true;
  });
}

function matches(grant: ExecutionConsentGrant, input: ExecutionConsentBinding & { scope: ExecutionConsentScope }, now: number): boolean {
  return isActive(grant, now)
    && grant.scope === input.scope
    && grant.adapterId === input.adapterId
    && grant.targetId === input.targetId
    && grant.targetDigest === input.targetDigest
    && grant.evidenceDigest === input.evidenceDigest
    && grant.launchScope === input.launchScope
    && grant.projectId === input.projectId;
}

function isActive(grant: ExecutionConsentGrant, now: number): boolean {
  return grant.revokedAt === undefined && grant.consumedAt === undefined && (grant.expiresAt === undefined || grant.expiresAt > now);
}

function isStoredState(value: unknown): value is StoredExecutionConsentState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<StoredExecutionConsentState>;
  return state.version === 1 && Array.isArray(state.grants) && state.grants.every(isStoredGrant)
    && Array.isArray(state.reservations) && state.reservations.every(isReservation);
}

function isStoredGrant(value: unknown): value is StoredExecutionConsentGrant {
  if (!value || typeof value !== 'object') return false;
  const grant = value as Partial<StoredExecutionConsentGrant>;
  return typeof grant.id === 'string' && typeof grant.adapterId === 'string' && typeof grant.targetId === 'string'
    && typeof grant.targetDigest === 'string' && typeof grant.evidenceDigest === 'string' && typeof grant.projectId === 'string'
    && (grant.launchScope === 'local' || grant.launchScope === 'remote')
    && (grant.scope === 'one-launch' || grant.scope === 'project' || grant.scope === 'global')
    && typeof grant.createdAt === 'number' && optionalNumber(grant.expiresAt) && optionalNumber(grant.revokedAt) && optionalNumber(grant.consumedAt);
}

function discardLegacyGlobalConsent(state: StoredExecutionConsentState): ExecutionConsentState {
  const grants = state.grants.filter((grant): grant is ExecutionConsentGrant => grant.scope !== 'global');
  const grantIds = new Set(grants.map((grant) => grant.id));
  return {
    version: 1,
    grants,
    reservations: state.reservations.filter((reservation) => grantIds.has(reservation.grantId))
  };
}

function isExecutionConsentScope(value: unknown): value is ExecutionConsentScope {
  return value === 'one-launch' || value === 'project';
}

function isReservation(value: unknown): value is ExecutionConsentReservation {
  if (!value || typeof value !== 'object') return false;
  const reservation = value as Partial<ExecutionConsentReservation>;
  return typeof reservation.id === 'string' && typeof reservation.grantId === 'string'
    && typeof reservation.idempotencyKey === 'string' && typeof reservation.createdAt === 'number'
    && typeof reservation.expiresAt === 'number' && optionalNumber(reservation.claimedAt);
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}
