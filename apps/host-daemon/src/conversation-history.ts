import type { HarnessHistoryAdapter } from '@zcc/harness-sdk';
import type { NativeConversationResume } from './harness/registration.js';
import type { ConversationTranscript } from '@zana-ai/zcc-domain/product';
import { randomUUID } from 'node:crypto';
import type {
  ConversationHistoryCoverage,
  ConversationHistoryProviderState,
  ConversationHistoryRow,
  ConversationHistorySnapshot,
  ConversationHistorySource,
  Project
} from '@zana-ai/zcc-domain/product';

export const HISTORY_PAGE_SIZE = 40;
export const HISTORY_SETTLEMENT_MS = 30_000;
export const HISTORY_SNAPSHOT_TTL_MS = 10 * 60_000;
export const HISTORY_MAX_SNAPSHOTS = 20;
export const HISTORY_PROJECT_SCAN_CAP = 64;
export const HISTORY_PROVIDER_CONCURRENCY = 2;

// Native readers prove canonical project membership before a row can be resumed.
const HISTORY_RESULT_CAP = 10_000;
export interface HistoryProvider {
  id: string;
  label: string;
  iconId: string;
  adapter?: HarnessHistoryAdapter;
  resume?: (id: string) => NativeConversationResume | undefined;
  unavailableReason?: string;
}

type NativeRow = {
  rowId: string;
  source: ConversationHistorySource;
  nativeConversationId: string;
  projectId: string;
  projectPath: string;
  title: string;
  lastActiveAt: number | null;
};

type SnapshotRecord = {
  id: string;
  windowId: number;
  projectId?: string;
  query: string;
  rows: NativeRow[];
  coverage: ConversationHistoryCoverage[];
  status: ConversationHistorySnapshot['status'];
  createdAt: number;
  settledAt?: number;
  expiresAt: number;
  released: boolean;
  controllers: Set<AbortController>;
};

export interface ConversationHistoryDeps {
  projects(): readonly Project[];
  providers: readonly HistoryProvider[];
  now?(): number;
}

function coverage(provider: HistoryProvider, state: ConversationHistoryProviderState): ConversationHistoryCoverage {
  return {
    source: provider.id, sourceLabel: provider.label, state,
    supportsTranscript: Boolean(provider.adapter?.readTranscript),
    supportsExactResume: Boolean(provider.adapter && provider.resume),
    description: provider.adapter ? `${provider.label}: registered local projects only` : provider.unavailableReason ?? 'Native history is not supported yet.'
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

  private readonly now: () => number;

  constructor(private readonly deps: ConversationHistoryDeps) {
    this.now = deps.now ?? Date.now;
  }

  start(windowId: number, projectId?: string, query = ''): ConversationHistorySnapshot {
    return this.create(windowId, projectId, false, query);
  }

  async refresh(windowId: number, projectId?: string, query = ''): Promise<ConversationHistorySnapshot> {
    const snapshot = this.create(windowId, projectId, true, query);
    const record = this.snapshots.get(snapshot.snapshotId);
    if (!record) return this.expired(snapshot.snapshotId);
    await this.settle(record);
    return this.view(record);
  }

  private create(windowId: number, projectId: string | undefined, deferSettlement: boolean, query: string): ConversationHistorySnapshot {
    this.evict();
    const record: SnapshotRecord = {
      id: randomUUID(), windowId, projectId, query: query.trim().toLowerCase().slice(0, 200), rows: [],
      coverage: this.deps.providers.map((provider) => coverage(provider, provider.adapter ? 'loading' : 'unsupported')),
      status: 'provisional', createdAt: this.now(), expiresAt: this.now() + HISTORY_SNAPSHOT_TTL_MS,
      released: false, controllers: new Set()
    };
    this.snapshots.set(record.id, record);
    this.evict();
    if (!deferSettlement) void this.settle(record);
    return this.view(record);
  }

  get(windowId: number, snapshotId: unknown, cursor?: unknown): ConversationHistorySnapshot {
    this.evict();
    const record = typeof snapshotId === 'string' ? this.snapshots.get(snapshotId) : undefined;
    if (!record || record.windowId !== windowId || record.released) return this.expired(typeof snapshotId === 'string' ? snapshotId : '');
    const offset = cursor === undefined ? 0 : typeof cursor === 'string' && /^\d+$/.test(cursor) ? Number(cursor) : -1;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > HISTORY_RESULT_CAP) return this.expired(record.id);
    return this.view(record, offset);
  }

  query(windowId: number, snapshotId: string): string {
    const record = this.snapshots.get(snapshotId);
    return record?.windowId === windowId ? record.query : '';
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
      record.controllers.forEach((controller) => controller.abort());
      this.snapshots.delete(record.id);
    }
  }

  releaseWindow(windowId: number): void {
    for (const [id, record] of this.snapshots) {
      if (record.windowId === windowId) {
        record.released = true;
      record.controllers.forEach((controller) => controller.abort());
        this.snapshots.delete(id);
      }
    }
  }

  evict(): void {
    const now = this.now();
    for (const [id, record] of this.snapshots) if (record.expiresAt <= now) this.release(record.windowId, id);
    while (this.snapshots.size > HISTORY_MAX_SNAPSHOTS) { const oldest = this.snapshots.values().next().value!; this.release(oldest.windowId, oldest.id); }
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
        const key = sourceKey(row.source, `${row.projectId}:${row.nativeConversationId}`);
        if (identities.has(key)) return false;
        identities.add(key);
        return true;
      })).slice(0, HISTORY_RESULT_CAP);
      record.coverage = this.deps.providers.map((provider) => coverage(provider, !provider.adapter ? 'unsupported' : settled.get(provider.id)?.state ?? 'loading'));
    };
    // Each provider has its own timeout, but keep settlement independent: a
    // reader bug must still publish the other provider and complete this snapshot.
    await Promise.allSettled(this.deps.providers.filter((provider) => provider.adapter)
      .map((provider) => this.collect(provider, eligible, record).then(apply)));
    if (record.released || this.snapshots.get(record.id) !== record) return;
    // A rejected collection callback cannot leave a launcher polling forever.
    record.coverage = this.deps.providers.map((provider) => coverage(provider, !provider.adapter ? 'unsupported' : settled.get(provider.id)?.state ?? 'failed'));
    record.status = 'ready';
    record.settledAt = this.now();
  }

  private async collect(
    provider: HistoryProvider,
    projects: readonly Project[],
    record: SnapshotRecord
  ): Promise<{ source: ConversationHistorySource; state: ConversationHistoryProviderState; rows: NativeRow[] }> {
    const source = provider.id;
    if (projects.length === 0) return { source, state: 'empty', rows: [] };
    const controller = new AbortController();
    record.controllers.add(controller);
    let timedOut = false;
    let rows: NativeRow[] = [];
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timer = new Promise<never>((_, reject) => timeout = setTimeout(() => {
      timedOut = true; controller.abort();
      reject(new Error('history timed out'));
    }, HISTORY_SETTLEMENT_MS));
    try {
      let failed = false;
      await Promise.race([boundedMap(projects, async (project) => {
        if (controller.signal.aborted) return;
        try {
          const sessions = (await provider.adapter!.list({ projectPath: project.path, limit: HISTORY_RESULT_CAP, signal: controller.signal })).slice(0, HISTORY_RESULT_CAP);
          if (controller.signal.aborted) return;
          const next = sessions.map((session) => ({
            rowId: randomUUID(), source, nativeConversationId: session.id, projectId: project.id, projectPath: project.path,
            title: session.title || 'Untitled conversation',
            lastActiveAt: session.lastActiveAt
          }));
          rows = sortRows([...rows, ...next]).slice(0, HISTORY_RESULT_CAP);
        } catch { failed = true; }
      }), timer]);
      return { source, state: failed ? 'failed' : rows.length ? 'fresh' : 'empty', rows };
    } catch {
      return { source, state: timedOut ? 'timed-out' : 'failed', rows };
    } finally {
      if (timeout) clearTimeout(timeout);
      record.controllers.delete(controller);
    }
  }

  private view(record: SnapshotRecord, offset = 0): ConversationHistorySnapshot {
    const projects = new Map(this.deps.projects().map((project) => [project.id, project]));
    const rows = record.rows.filter((row) => !record.query || `${row.title} ${this.provider(row.source)?.label ?? row.source} ${projects.get(row.projectId)?.name ?? ''}`.toLowerCase().includes(record.query));
    const hasNextPage = rows.length > offset + HISTORY_PAGE_SIZE;
    return {
      snapshotId: record.id, status: record.status,
      rows: rows.slice(offset, offset + HISTORY_PAGE_SIZE).map((row): ConversationHistoryRow => ({
        historyId: row.rowId, source: row.source, sourceLabel: this.provider(row.source)!.label, iconId: this.provider(row.source)!.iconId,
        supportsTranscript: Boolean(this.provider(row.source)?.adapter?.readTranscript), supportsExactResume: Boolean(this.provider(row.source)?.resume), title: row.title, lastActiveAt: row.lastActiveAt,
        projectName: projects.get(row.projectId)?.name ?? 'Unavailable project', fidelity: 'exact-native-id',
        availability: projects.has(row.projectId) ? 'available' : 'unavailable',
        ...(projects.has(row.projectId) ? {} : { unavailableReason: 'Project is no longer registered' })
      })),
      coverage: record.coverage, snapshotAt: record.status === 'ready' ? record.settledAt : undefined, hasNextPage,
      ...(hasNextPage ? { nextPageCursor: String(offset + HISTORY_PAGE_SIZE) } : {})
    };
  }

  provider(id: string): HistoryProvider | undefined {
    return this.deps.providers.find((provider) => provider.id === id);
  }

  private async boundedRead<T>(read: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([read(controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('History reader timed out')); }, HISTORY_SETTLEMENT_MS);
      })]);
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  }

  async validate(row: NativeRow): Promise<boolean> {
    const adapter = this.provider(row.source)?.adapter;
    if (!adapter) return false;
    try { return await this.boundedRead((signal) => adapter.validateConversation({ projectPath: row.projectPath, id: row.nativeConversationId, signal })); }
    catch { return false; }
  }

  async transcript(row: NativeRow): Promise<ConversationTranscript> {
    const reader = this.provider(row.source)?.adapter?.readTranscript;
    if (!reader) return { messages: [], truncated: false, unavailableReason: 'This harness does not provide transcript previews.' };
    try {
      const result = await this.boundedRead((signal) => reader({ projectPath: row.projectPath, id: row.nativeConversationId, signal }));
      let total = 0;
      const messages: ConversationTranscript['messages'] = [];
      let truncated = result.truncated || result.messages.length > 500;
      for (const message of result.messages.slice(0, 500)) {
        if (!['user', 'assistant'].includes(message.role)) continue;
        if (total + message.text.length > 1_000_000) { truncated = true; break; }
        total += message.text.length;
        truncated ||= message.text.length > 64_000;
        messages.push({ role: message.role, text: message.text.slice(0, 64_000) });
      }
      return { messages, truncated, ...(result.unavailableReason ? { unavailableReason: result.unavailableReason } : {}) };
    } catch { return { messages: [], truncated: false, unavailableReason: 'The saved transcript is unavailable. Try refreshing history.' }; }
  }

  private expired(snapshotId: string): ConversationHistorySnapshot {
    return { snapshotId, status: 'expired', rows: [], coverage: [], hasNextPage: false };
  }
}
