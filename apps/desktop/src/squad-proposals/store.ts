import { mkdir } from 'node:fs/promises';
import { renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue, hashBytes, readRawFile } from '@zana-ai/zcc-server/services/harness-routing/storage';
import { SQUAD_PROPOSAL_LIMITS, type SquadProposalRecord } from '@zana-ai/zcc-domain/squad-proposal';

interface StateFile { version: 1; revision: number; records: SquadProposalRecord[]; }

const queue = createSerializedTransactionQueue();
const STATES = ['pending', 'launched', 'dismissed', 'expired'];

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function optString(value: unknown): boolean { return value === undefined || typeof value === 'string'; }
function validRecord(value: unknown): value is SquadProposalRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<SquadProposalRecord>;
  const proposer = r.proposer as Partial<SquadProposalRecord['proposer']> | undefined;
  return typeof r.id === 'string' && typeof r.projectId === 'string' && typeof r.teamId === 'string'
    && typeof r.goal === 'string' && (r.planning === 'infer' || r.planning === 'provided')
    && !!proposer && (proposer.kind === 'pty' || proposer.kind === 'thread') && typeof proposer.id === 'string'
    && Array.isArray(r.sources) && STATES.includes(r.state ?? '')
    && optString(r.title) && optString(r.summary) && optString(r.inboxEntryId) && optString(r.executionId)
    && Number.isFinite(r.createdAt) && Number.isFinite(r.updatedAt) && Number.isFinite(r.expiresAt);
}

export interface SquadProposalStoreOptions {
  filePath: string;
  now?: () => number;
  maxRecords?: number;
}

export type SquadProposalStore = ReturnType<typeof createSquadProposalStore>;

/** Durable proposal ledger (JSON, atomic writes, one serialised queue). A bad file never throws at boot. */
export function createSquadProposalStore(options: SquadProposalStoreOptions) {
  const now = options.now ?? Date.now;
  const maxRecords = options.maxRecords ?? SQUAD_PROPOSAL_LIMITS.maxRecords;

  function empty(): { state: StateFile; hash: string | null } {
    return { state: { version: 1, revision: 0, records: [] }, hash: null };
  }
  function read(): { state: StateFile; hash: string | null } {
    let bytes: Buffer | null = null;
    try { bytes = readRawFile(options.filePath); } catch { bytes = null; }
    if (!bytes) return empty();
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as Partial<StateFile>;
      if (parsed.version !== 1 || !Number.isInteger(parsed.revision) || !Array.isArray(parsed.records) || !parsed.records.every(validRecord)) {
        throw new Error('invalid shape');
      }
      return { state: parsed as StateFile, hash: hashBytes(bytes) };
    } catch {
      // Keep the evidence, start empty: a damaged ledger must not block boot.
      try { renameSync(options.filePath, join(dirname(options.filePath), `squad-proposals.corrupt-${now()}.json`)); } catch { /* best effort */ }
      return empty();
    }
  }
  /** Drop the oldest finished records beyond the cap; pending ones are never evicted. */
  function prune(state: StateFile): void {
    let excess = state.records.length - maxRecords;
    if (excess <= 0) return;
    const doomed = new Set(
      state.records.filter((r) => r.state !== 'pending').sort((a, b) => a.createdAt - b.createdAt).slice(0, excess).map((r) => r.id)
    );
    state.records = state.records.filter((r) => !doomed.has(r.id));
  }
  async function persist(state: StateFile, expectedHash: string | null): Promise<void> {
    state.revision += 1;
    await mkdir(dirname(options.filePath), { recursive: true });
    atomicDurableWrite(options.filePath, Buffer.from(JSON.stringify(state)), { expectedHash });
  }

  return {
    async create(record: SquadProposalRecord): Promise<SquadProposalRecord> {
      return queue.run(async () => {
        const snapshot = read();
        snapshot.state.records.push(clone(record));
        prune(snapshot.state);
        await persist(snapshot.state, snapshot.hash);
        return clone(record);
      });
    },
    async get(id: string): Promise<SquadProposalRecord | undefined> {
      return queue.run(async () => {
        const record = read().state.records.find((candidate) => candidate.id === id);
        return record ? clone(record) : undefined;
      });
    },
    async listPending(projectId: string): Promise<SquadProposalRecord[]> {
      return queue.run(async () => clone(read().state.records.filter((r) => r.projectId === projectId && r.state === 'pending')));
    },
    /** Read-modify-write inside the queue. `mutate` edits a copy; the result is stamped `updatedAt`. */
    async update(id: string, mutate: (record: SquadProposalRecord) => void): Promise<SquadProposalRecord | undefined> {
      return queue.run(async () => {
        const snapshot = read();
        const index = snapshot.state.records.findIndex((candidate) => candidate.id === id);
        if (index < 0) return undefined;
        const next = clone(snapshot.state.records[index]!);
        mutate(next);
        next.id = id;
        next.updatedAt = now();
        snapshot.state.records[index] = next;
        await persist(snapshot.state, snapshot.hash);
        return clone(next);
      });
    },
    /** Mark every pending record whose TTL has passed as expired and return them. */
    async expireDue(at: number): Promise<SquadProposalRecord[]> {
      return queue.run(async () => {
        const snapshot = read();
        const expired: SquadProposalRecord[] = [];
        for (const record of snapshot.state.records) {
          if (record.state === 'pending' && record.expiresAt <= at) {
            record.state = 'expired';
            record.updatedAt = at;
            expired.push(clone(record));
          }
        }
        if (expired.length) await persist(snapshot.state, snapshot.hash);
        return expired;
      });
    }
  };
}
