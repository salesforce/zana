import { randomUUID } from 'node:crypto';
import type {
  ClaudeSessionSummary,
  ConversationHistoryCoverage,
  ConversationHistoryProviderState,
  ConversationHistoryRow,
  ConversationHistorySnapshot,
  ConversationHistorySource,
  OpenCodeSessionSummary,
  Project
} from '../shared/types.js';

export const HISTORY_PAGE_SIZE = 8;
export const HISTORY_SETTLEMENT_MS = 5_000;
export const HISTORY_SNAPSHOT_TTL_MS = 10 * 60_000;
export const HISTORY_MAX_SNAPSHOTS = 20;
export const HISTORY_PROJECT_SCAN_CAP = 24;
export const HISTORY_PROVIDER_CONCURRENCY = 2;

/**
 * Native history is deliberately project-scoped. A provider may join only when
 * its reader starts from main's registered canonical cwd and can prove returned
 * rows belong to that cwd. Claude uses its derived per-project store; OpenCode
 * validates the CLI row directory. Cursor, Codex, and PI remain excluded: their
 * current adapters have no reviewed cwd-scoped enumeration contract, so a global
 * scan could resume a conversation under a different project's assumptions.
 */
const PROJECT_SCOPED_SOURCES: readonly ConversationHistorySource[] = ['claude', 'opencode'];

type NativeRow = {
  rowId: string;
  source: ConversationHistorySource;
  nativeConversationId: string;
  projectId: string;
  title: string;
  lastActiveAt: number | null;
};

type SnapshotRecord = {
  id: string;
  windowId: number;
  projectId?: string;
  rows: NativeRow[];
  coverage: ConversationHistoryCoverage[];
  status: ConversationHistorySnapshot['status'];
  createdAt: number;
  settledAt?: number;
  expiresAt: number;
  released: boolean;
};

export interface ConversationHistoryDeps {
  projects(): readonly Project[];
  claude(project: Project, limit: number): Promise<ClaudeSessionSummary[]>;
  opencode(project: Project, limit: number): Promise<OpenCodeSessionSummary[]>;
  now?(): number;
}

function coverage(source: ConversationHistorySource, state: ConversationHistoryProviderState): ConversationHistoryCoverage {
  return {
    source,
    state,
    description: source === 'claude' ? 'Claude: local native history' : 'OpenCode: registered projects only'
  };
}

function sourceKey(source: ConversationHistorySource, nativeConversationId: string): string {
  return `${source}\u0000${nativeConversationId}`;
}

function sortRows(rows: NativeRow[]): NativeRow[] {
  return rows.sort((left, right) => {
    const byTime = (right.lastActiveAt ?? -Infinity) - (left.lastActiveAt ?? -Infinity);
    if (byTime) return byTime;
    return left.rowId.localeCompare(right.rowId);
  });
}

async function boundedMap<T, R>(items: readonly T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(HISTORY_PROVIDER_CONCURRENCY, items.length) }, run));
  return out;
}

export class ConversationHistoryService {
  private readonly snapshots = new Map<string, SnapshotRecord>();
  private readonly opaqueIds = new Map<string, string>();
  private readonly now: () => number;

  constructor(private readonly deps: ConversationHistoryDeps) {
    this.now = deps.now ?? Date.now;
  }

  start(windowId: number, projectId?: string): ConversationHistorySnapshot {
    return this.create(windowId, projectId, false);
  }

  async refresh(windowId: number, projectId?: string): Promise<ConversationHistorySnapshot> {
    const snapshot = this.create(windowId, projectId, true);
    const record = this.snapshots.get(snapshot.snapshotId);
    if (!record) return this.expired(snapshot.snapshotId);
    await this.settle(record);
    return this.view(record);
  }

  private create(windowId: number, projectId: string | undefined, deferSettlement: boolean): ConversationHistorySnapshot {
    this.evict();
    const record: SnapshotRecord = {
      id: randomUUID(), windowId, projectId, rows: [],
      coverage: PROJECT_SCOPED_SOURCES.map((source) => coverage(source, 'loading')),
      status: 'provisional', createdAt: this.now(), expiresAt: this.now() + HISTORY_SNAPSHOT_TTL_MS,
      released: false
    };
    this.snapshots.set(record.id, record);
    if (!deferSettlement) void this.settle(record);
    return this.view(record);
  }

  get(windowId: number, snapshotId: unknown): ConversationHistorySnapshot {
    this.evict();
    const record = typeof snapshotId === 'string' ? this.snapshots.get(snapshotId) : undefined;
    if (!record || record.windowId !== windowId || record.released) return this.expired(typeof snapshotId === 'string' ? snapshotId : '');
    return this.view(record);
  }

  scope(windowId: number, snapshotId: unknown): string | undefined {
    const record = typeof snapshotId === 'string' ? this.snapshots.get(snapshotId) : undefined;
    return record?.windowId === windowId && !record.released ? record.projectId : undefined;
  }

  find(windowId: number, snapshotId: unknown, rowId: unknown): NativeRow | undefined {
    this.evict();
    const record = typeof snapshotId === 'string' ? this.snapshots.get(snapshotId) : undefined;
    if (!record || record.windowId !== windowId || record.released || record.status !== 'ready' || typeof rowId !== 'string') return undefined;
    return record.rows.find((row) => row.rowId === rowId);
  }

  release(windowId: number, snapshotId: unknown): void {
    const record = typeof snapshotId === 'string' ? this.snapshots.get(snapshotId) : undefined;
    if (record?.windowId === windowId) {
      record.released = true;
      this.snapshots.delete(record.id);
    }
  }

  releaseWindow(windowId: number): void {
    for (const [id, record] of this.snapshots) {
      if (record.windowId === windowId) {
        record.released = true;
        this.snapshots.delete(id);
      }
    }
  }

  evict(): void {
    const now = this.now();
    for (const [id, record] of this.snapshots) if (record.expiresAt <= now) this.snapshots.delete(id);
    while (this.snapshots.size > HISTORY_MAX_SNAPSHOTS) this.snapshots.delete(this.snapshots.keys().next().value!);
  }

  private async settle(record: SnapshotRecord): Promise<void> {
    const eligible = this.deps.projects()
      .filter((project) => !project.remote && (!record.projectId || project.id === record.projectId))
      .slice(0, HISTORY_PROJECT_SCAN_CAP);
    const settled = new Map<ConversationHistorySource, Awaited<ReturnType<typeof this.collect>>>();
    const apply = (result: Awaited<ReturnType<typeof this.collect>>) => {
      settled.set(result.source, result);
      if (record.released || this.snapshots.get(record.id) !== record) return;
      const identities = new Set<string>();
      record.rows = sortRows([...settled.values()].flatMap((entry) => entry.rows).filter((row) => {
        const key = sourceKey(row.source, row.nativeConversationId);
        if (identities.has(key)) return false;
        identities.add(key);
        return true;
      })).slice(0, HISTORY_PAGE_SIZE);
      record.coverage = PROJECT_SCOPED_SOURCES.map((source) => {
        const entry = settled.get(source);
        return coverage(source, entry?.state ?? 'loading');
      });
    };
    // Each provider has its own timeout, but keep settlement independent: a
    // reader bug must still publish the other provider and complete this snapshot.
    await Promise.allSettled([
      this.collect('claude', eligible, (project) => this.deps.claude(project, HISTORY_PAGE_SIZE)).then(apply),
      this.collect('opencode', eligible, (project) => this.deps.opencode(project, HISTORY_PAGE_SIZE)).then(apply)
    ]);
    if (record.released || this.snapshots.get(record.id) !== record) return;
    // A rejected collection callback cannot leave a launcher polling forever.
    record.coverage = PROJECT_SCOPED_SOURCES.map((source) => {
      const entry = settled.get(source);
      return coverage(source, entry?.state ?? 'failed');
    });
    record.status = 'ready';
    record.settledAt = this.now();
  }

  private async collect<T extends ClaudeSessionSummary | OpenCodeSessionSummary>(
    source: ConversationHistorySource,
    projects: readonly Project[],
    reader: (project: Project) => Promise<T[]>
  ): Promise<{ source: ConversationHistorySource; state: ConversationHistoryProviderState; rows: NativeRow[] }> {
    if (projects.length === 0) return { source, state: 'empty', rows: [] };
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timer = new Promise<never>((_, reject) => timeout = setTimeout(() => {
      timedOut = true;
      reject(new Error('history timed out'));
    }, HISTORY_SETTLEMENT_MS));
    try {
      const results = await Promise.race([boundedMap(projects, async (project) => ({ project, sessions: (await reader(project)).slice(0, HISTORY_PAGE_SIZE) })), timer]);
      const rows = results.flatMap(({ project, sessions }) => sessions.map((session) => ({
        rowId: this.opaqueId(source, session.id), source, nativeConversationId: session.id, projectId: project.id,
        title: source === 'claude'
          ? (session as ClaudeSessionSummary).title ?? (session as ClaudeSessionSummary).firstUserPrompt ?? 'Untitled conversation'
          : (session as OpenCodeSessionSummary).title || 'Untitled conversation',
        lastActiveAt: session.lastActiveAt
      })));
      return { source, state: rows.length ? 'fresh' : 'empty', rows };
    } catch {
      return { source, state: timedOut ? 'timed-out' : 'failed', rows: [] };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private opaqueId(source: ConversationHistorySource, nativeConversationId: string): string {
    const key = sourceKey(source, nativeConversationId);
    let id = this.opaqueIds.get(key);
    if (!id) {
      id = randomUUID();
      this.opaqueIds.set(key, id);
    }
    return id;
  }

  private view(record: SnapshotRecord): ConversationHistorySnapshot {
    const projects = new Map(this.deps.projects().map((project) => [project.id, project]));
    return {
      snapshotId: record.id, status: record.status,
      rows: record.rows.map((row): ConversationHistoryRow => ({
        historyId: row.rowId, source: row.source, title: row.title, lastActiveAt: row.lastActiveAt,
        projectName: projects.get(row.projectId)?.name ?? 'Unavailable project', fidelity: 'exact-native-id',
        availability: projects.has(row.projectId) ? 'available' : 'unavailable',
        ...(projects.has(row.projectId) ? {} : { unavailableReason: 'Project is no longer registered' })
      })),
      coverage: record.coverage, snapshotAt: record.status === 'ready' ? record.settledAt : undefined, hasNextPage: false
    };
  }

  private expired(snapshotId: string): ConversationHistorySnapshot {
    return { snapshotId, status: 'expired', rows: [], coverage: [], hasNextPage: false };
  }
}
