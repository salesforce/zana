/** Shapes of the sync diagnostics shared by the CLI, the RPC layer and the Peers screen (R8, R10). */

/** One queued, not yet delivered send of a doc version to one computer. */
export interface SyncQueueEntry {
  docId: string;
  /** The other computer's app id (what `peers` lists) and its replica id in the sync group. */
  peerId: string;
  replicaId: string;
  direction: 'outgoing';
  /** `failed` only for a real error; offline, stage receipts and no error read `waiting`. */
  state: 'waiting' | 'failed';
  /** Bounded, redacted text; null when the delivery has not failed yet. */
  lastError: string | null;
  lastErrorAt: number | null;
  attempts: number;
  /** When the send was queued. A first-failure time is not stored, so this is the oldest honest anchor. */
  queuedAt: number;
  /** The queue row is parked after too many attempts; `Sync Now` revives it when the error is retryable. */
  parked: boolean;
}

export interface PeerDiagnostics {
  replicaId: string;
  peerId: string;
  queueDepth: number;
  queuedDocs: number;
  failed: number;
  waiting: number;
  oldestQueuedAt: number | null;
  /** Newest first, at most 20. */
  recentErrors: Array<{ docId: string; error: string; at: number; attempts: number }>;
}

export interface DocCounts {
  total: number;
  byStatus: Record<string, number>;
  /** Docs in a registered project, by project id; the rest are global or unmapped. */
  byProject: Record<string, number>;
  unmapped: number;
}

export interface CompareEntry { docId: string; hash: string | null; files: number }
export interface CompareResult { total: number; offset: number; limit: number; docs: CompareEntry[] }
