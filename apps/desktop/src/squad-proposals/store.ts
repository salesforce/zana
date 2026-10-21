import { mkdir } from 'node:fs/promises';
import { renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue, hashBytes, readRawFile } from '@zana-ai/zcc-server/services/harness-routing/storage';
import { SQUAD_PROPOSAL_LIMITS, squadProposalRecordSchema, type SquadProposalRecord } from '@zana-ai/zcc-domain/squad-proposal';

interface StateFile { version: 1; revision: number; records: SquadProposalRecord[]; }
interface Snapshot { state: StateFile; hash: string | null }

const queue = createSerializedTransactionQueue();

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
/** Writes are checked against the same schema as reads, so this store never persists a record that would void the ledger. */
function assertValidRecord(record: SquadProposalRecord): void {
  if (!squadProposalRecordSchema.safeParse(record).success) throw new Error(`invalid squad proposal record ${record.id}`);
}
function empty(): Snapshot { return { state: { version: 1, revision: 0, records: [] }, hash: null }; }

/** The ledger only when it, and every record in it, has the expected shape. */
function decodeLedger(bytes: Buffer): StateFile | undefined {
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as Partial<StateFile>;
    if (parsed.version !== 1 || !Number.isInteger(parsed.revision) || !Array.isArray(parsed.records)) return undefined;
    return parsed.records.every((record) => squadProposalRecordSchema.safeParse(record).success) ? parsed as StateFile : undefined;
  } catch {
    return undefined;
  }
}

/** Read the ledger. A damaged one is kept aside as evidence and the store starts empty: it must not block boot. */
function readLedger(filePath: string, now: () => number): Snapshot {
  let bytes: Buffer | null = null;
  try { bytes = readRawFile(filePath); } catch { bytes = null; }
  if (!bytes) return empty();
  const state = decodeLedger(bytes);
  if (state) return { state, hash: hashBytes(bytes) };
  try { renameSync(filePath, join(dirname(filePath), `squad-proposals.corrupt-${now()}.json`)); } catch { /* best effort */ }
  return empty();
}

/** Drop the oldest finished records beyond the cap; pending ones are never evicted. */
function prune(state: StateFile, maxRecords: number): void {
  const excess = state.records.length - maxRecords;
  if (excess <= 0) return;
  const doomed = new Set(
    state.records.filter((r) => r.state !== 'pending').sort((a, b) => a.createdAt - b.createdAt).slice(0, excess).map((r) => r.id)
  );
  state.records = state.records.filter((r) => !doomed.has(r.id));
}

async function persist(filePath: string, snapshot: Snapshot): Promise<void> {
  snapshot.state.revision += 1;
  await mkdir(dirname(filePath), { recursive: true });
  atomicDurableWrite(filePath, Buffer.from(JSON.stringify(snapshot.state)), { expectedHash: snapshot.hash });
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
  const read = () => readLedger(options.filePath, now);

  return {
    async create(record: SquadProposalRecord): Promise<SquadProposalRecord> {
      return queue.run(async () => {
        assertValidRecord(record);
        const snapshot = read();
        snapshot.state.records.push(clone(record));
        prune(snapshot.state, maxRecords);
        await persist(options.filePath, snapshot);
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
        assertValidRecord(next);
        snapshot.state.records[index] = next;
        await persist(options.filePath, snapshot);
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
        if (expired.length) await persist(options.filePath, snapshot);
        return expired;
      });
    }
  };
}
