import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LaunchLedgerState } from './types.js';
import type { LaunchAuthorizationBinding, LaunchPrincipalRef } from './types.js';
import {
  atomicDurableWrite,
  createSerializedTransactionQueue,
  hashBytes,
  readRawFile
} from '../harness-routing-migration/storage.js';

export interface LaunchLedgerEntry {
  id: string;
  idempotencyKey: string;
  launchDigest: string;
  authorizationId: string;
  sessionId?: string;
  consentReservationId?: string;
  principal?: LaunchPrincipalRef;
  binding?: LaunchAuthorizationBinding;
  state: LaunchLedgerState;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

interface LaunchLedgerStateFile { version: 1; revision: number; entries: LaunchLedgerEntry[] }

const TRANSITIONS: Readonly<Record<LaunchLedgerState, ReadonlySet<LaunchLedgerState>>> = {
  authorized: new Set(['committing', 'denied', 'failed', 'interrupted']),
  committing: new Set(['launched', 'failed', 'interrupted']),
  launched: new Set(['exited', 'failed', 'interrupted']),
  exited: new Set(), denied: new Set(), failed: new Set(), interrupted: new Set()
};

export function canTransitionLaunchLedger(from: LaunchLedgerState, to: LaunchLedgerState): boolean {
  return TRANSITIONS[from].has(to);
}

export interface LaunchLedgerClaim {
  idempotencyKey: string;
  launchDigest: string;
  authorizationId: string;
  sessionId?: string;
  consentReservationId?: string;
  principal?: LaunchPrincipalRef;
  binding?: LaunchAuthorizationBinding;
}

export type LaunchLedgerClaimResult =
  | { outcome: 'claimed'; entry: LaunchLedgerEntry }
  | { outcome: 'replay'; entry: LaunchLedgerEntry }
  | { outcome: 'conflict'; entry: LaunchLedgerEntry };

export interface LaunchLedgerStoreOptions {
  filePath: string;
  maxEntries?: number;
  now?: () => number;
  id?: () => string;
  durableWrite?: typeof atomicDurableWrite;
}

const ledgerTransactionQueue = createSerializedTransactionQueue();

export function createLaunchLedgerStore(opts: LaunchLedgerStoreOptions) {
  const maxEntries = opts.maxEntries ?? 2_000;
  const now = opts.now ?? (() => Date.now());
  const id = opts.id ?? randomUUID;
  const durableWrite = opts.durableWrite ?? atomicDurableWrite;

  const runExclusive = <T>(task: () => Promise<T>): Promise<T> => ledgerTransactionQueue.run(task);

  function readState(): { state: LaunchLedgerStateFile; hash: string | null } {
    const bytes = readRawFile(opts.filePath);
    if (bytes === null) return { state: { version: 1, revision: 0, entries: [] }, hash: null };
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
      // Migration from Phase-6 draft array format is lossless and written on
      // next mutation through same durable CAS path.
      if (Array.isArray(parsed) && parsed.every(isLegacyEntry)) {
        return {
          state: { version: 1, revision: 0, entries: parsed.map((entry) => ({ ...entry, revision: 0 })) },
          hash: hashBytes(bytes)
        };
      }
      if (!isState(parsed)) throw new Error('invalid shape');
      return { state: parsed, hash: hashBytes(bytes) };
    } catch (error) {
      throw new Error(`corrupt launch ledger: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function persist(state: LaunchLedgerStateFile, expectedHash: string | null): void {
    mkdirSync(dirname(opts.filePath), { recursive: true });
    state.entries = maxEntries > 0 ? state.entries.slice(-maxEntries) : [];
    state.revision += 1;
    durableWrite(opts.filePath, Buffer.from(JSON.stringify(state)), { expectedHash });
  }

  async function claim(input: LaunchLedgerClaim): Promise<LaunchLedgerClaimResult> {
    return runExclusive(async () => {
      const snapshot = readState();
      const existing = snapshot.state.entries.find((entry) => entry.idempotencyKey === input.idempotencyKey);
      if (existing) return existing.launchDigest === input.launchDigest
        ? { outcome: 'replay', entry: { ...existing } }
        : { outcome: 'conflict', entry: { ...existing } };
      const timestamp = now();
      const entry: LaunchLedgerEntry = {
        id: id(), ...input, state: 'authorized', revision: 0, createdAt: timestamp, updatedAt: timestamp
      };
      snapshot.state.entries.push(entry);
      persist(snapshot.state, snapshot.hash);
      return { outcome: 'claimed', entry: { ...entry } };
    });
  }

  async function transition(
    entryId: string,
    state: LaunchLedgerState,
    expectedState?: LaunchLedgerState
  ): Promise<LaunchLedgerEntry> {
    return runExclusive(async () => {
      const snapshot = readState();
      const entry = snapshot.state.entries.find((candidate) => candidate.id === entryId);
      if (!entry) throw new Error(`unknown launch ledger entry "${entryId}"`);
      if (expectedState !== undefined && entry.state !== expectedState) {
        throw new Error(`launch ledger CAS rejected: expected ${expectedState}, found ${entry.state}`);
      }
      if (!canTransitionLaunchLedger(entry.state, state)) {
        throw new Error(`invalid launch ledger transition ${entry.state} -> ${state}`);
      }
      entry.state = state;
      entry.revision += 1;
      entry.updatedAt = now();
      persist(snapshot.state, snapshot.hash);
      return { ...entry };
    });
  }

  async function list(): Promise<LaunchLedgerEntry[]> {
    return runExclusive(async () => readState().state.entries.map((entry) => ({ ...entry })));
  }

  async function get(entryId: string): Promise<LaunchLedgerEntry | undefined> {
    return (await list()).find((entry) => entry.id === entryId);
  }

  async function reconcileStartup(hooks?: {
    consumeConsent?: (reservationId: string) => Promise<unknown>;
    reapSession?: (sessionId: string) => Promise<unknown>;
  }): Promise<LaunchLedgerEntry[]> {
    return runExclusive(async () => {
      const snapshot = readState();
      const reconciled: LaunchLedgerEntry[] = [];
      for (const entry of snapshot.state.entries) {
        if (!canTransitionLaunchLedger(entry.state, 'interrupted')) continue;
        // Ledger ownership is enough to consume consent. Perform recovery work
        // before transition so a second crash retries rather than permits reuse.
        if (entry.consentReservationId) await hooks?.consumeConsent?.(entry.consentReservationId);
        if (entry.sessionId) await hooks?.reapSession?.(entry.sessionId);
        entry.state = 'interrupted';
        entry.revision += 1;
        entry.updatedAt = now();
        reconciled.push({ ...entry });
      }
      if (reconciled.length > 0 || snapshot.hash !== null && snapshot.state.revision === 0) {
        persist(snapshot.state, snapshot.hash);
      }
      return reconciled;
    });
  }

  return { claim, transition, list, get, reconcileStartup };
}

function isState(value: unknown): value is LaunchLedgerStateFile {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<LaunchLedgerStateFile>;
  return state.version === 1 && Number.isInteger(state.revision) && Array.isArray(state.entries)
    && state.entries.every(isLaunchLedgerEntry);
}

function isLegacyEntry(value: unknown): value is Omit<LaunchLedgerEntry, 'revision'> {
  return isEntryFields(value) && !('revision' in (value as object));
}

function isLaunchLedgerEntry(value: unknown): value is LaunchLedgerEntry {
  return isEntryFields(value) && Number.isInteger((value as Partial<LaunchLedgerEntry>).revision);
}

function isEntryFields(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<LaunchLedgerEntry>;
  return typeof entry.id === 'string' && typeof entry.idempotencyKey === 'string'
    && typeof entry.launchDigest === 'string' && typeof entry.authorizationId === 'string'
    && (entry.sessionId === undefined || typeof entry.sessionId === 'string')
    && (entry.consentReservationId === undefined || typeof entry.consentReservationId === 'string')
    && typeof entry.state === 'string' && entry.state in TRANSITIONS
    && typeof entry.createdAt === 'number' && typeof entry.updatedAt === 'number'
    && (entry.principal === undefined || isPrincipalRef(entry.principal))
    && (entry.binding === undefined || isAuthorizationBinding(entry.binding));
}

function isPrincipalRef(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Partial<LaunchPrincipalRef>;
  return typeof ref.id === 'string'
    && (ref.kind === 'interactive-user' || ref.kind === 'schedule' || ref.kind === 'team' || ref.kind === 'automation');
}

function isAuthorizationBinding(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Partial<LaunchAuthorizationBinding>;
  return (binding.consumerKind === 'terminal' || binding.consumerKind === 'team-slot' || binding.consumerKind === 'orchestrator-child')
    && typeof binding.initialTaskDigest === 'string'
    && (binding.scope === 'local' || binding.scope === 'remote')
    && typeof binding.storeRevision === 'string'
    && typeof binding.projectIdentityDigest === 'string'
    && typeof binding.autonomous === 'boolean'
    && (binding.expiresAt === undefined || typeof binding.expiresAt === 'number');
}
