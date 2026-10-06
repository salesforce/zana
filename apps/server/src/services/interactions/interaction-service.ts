import { randomUUID } from 'node:crypto';
import type { ZccDatabase } from '@zana-ai/zcc-db';
import type {
  ContractJson,
  InteractionAcknowledgement,
  InteractionContract,
  InteractionStatus,
} from '@zana-ai/zcc-domain';

export const INTERACTION_MAX_ACTIVE_PER_PLUGIN_PROJECT = 100;
export const INTERACTION_MAX_ACTIVE_GLOBAL = 10_000;
export const INTERACTION_ACK_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
export const INTERACTION_ACKNOWLEDGED_RESOLUTION_MS = 30 * 24 * 60 * 60 * 1000;
export const INTERACTION_TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const INTERACTION_MAX_PAYLOAD_BYTES = 64 * 1024;
const INTERACTION_PRUNE_INTERVAL_MS = 60_000;

interface InteractionRow {
  id: string;
  plugin_id: string;
  project_id: string;
  correlation_id: string;
  kind: string;
  payload_json: string;
  status: InteractionStatus;
  generation: number;
  created_at: number;
  updated_at: number;
  acknowledged_at: number | null;
  terminal_at: number | null;
  expires_at: number | null;
}

export interface UpsertInteractionInput {
  pluginId: string;
  projectId: string;
  correlationId: string;
  kind: string;
  payload: ContractJson;
}

export class InteractionQuotaError extends Error {
  readonly code = 'INTERACTION_CAPACITY_EXCEEDED';

  constructor(public readonly scope: 'plugin+project' | 'global') {
    super(
      scope === 'global'
        ? `Interaction quota exceeded: at most ${INTERACTION_MAX_ACTIVE_GLOBAL} active interactions globally; ack or cancel existing interactions and retry`
        : `Interaction quota exceeded: at most ${INTERACTION_MAX_ACTIVE_PER_PLUGIN_PROJECT} active interactions per plugin and project; ack or cancel existing interactions and retry`
    );
    this.name = 'InteractionQuotaError';
  }
}

export class InteractionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InteractionConflictError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonPayload(value: ContractJson): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new InteractionConflictError('Interaction payload must be JSON-serializable');
  }
  if (json === undefined || Buffer.byteLength(json, 'utf8') > INTERACTION_MAX_PAYLOAD_BYTES) {
    throw new InteractionConflictError('Interaction payload exceeds 64 KiB');
  }
  return json;
}

function requireText(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new InteractionConflictError(`${name} is required`);
  return trimmed;
}

function toContract(row: InteractionRow): InteractionContract {
  const parsed = JSON.parse(row.payload_json) as unknown;
  if (!isRecord(parsed) && !Array.isArray(parsed) && parsed !== null && typeof parsed !== 'string' && typeof parsed !== 'number' && typeof parsed !== 'boolean') {
    throw new InteractionConflictError(`Interaction ${row.id} has invalid persisted payload`);
  }
  return {
    id: row.id,
    pluginId: row.plugin_id,
    projectId: row.project_id,
    correlationId: row.correlation_id,
    kind: row.kind,
    payload: parsed as ContractJson,
    status: row.status,
    generation: row.generation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acknowledgedAt: row.acknowledged_at,
    terminalAt: row.terminal_at,
    expiresAt: row.expires_at,
  };
}

/** Durable, server-owned interaction projection. All writes are idempotent by correlation key. */
export class InteractionService {
  private lastPrunedAt = -Infinity;

  constructor(
    private readonly db: ZccDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  upsertInteraction(input: UpsertInteractionInput): InteractionContract {
    const pluginId = requireText(input.pluginId, 'pluginId');
    const projectId = requireText(input.projectId, 'projectId');
    const correlationId = requireText(input.correlationId, 'correlationId');
    const kind = requireText(input.kind, 'kind');
    const payloadJson = jsonPayload(input.payload);
    this.pruneIfDue(this.now());
    return this.db.transaction(() => {
      const existing = this.db.sqlite.prepare(`SELECT * FROM plugin_interactions
        WHERE plugin_id = ? AND project_id = ? AND correlation_id = ?`)
        .get(pluginId, projectId, correlationId) as InteractionRow | undefined;
      if (existing) {
        if (existing.kind !== kind || existing.payload_json !== payloadJson) {
          throw new InteractionConflictError(`Interaction correlation ${correlationId} already has a different payload`);
        }
        return toContract(existing);
      }
      const active = this.db.sqlite.prepare(`SELECT count(*) AS count FROM plugin_interactions
        WHERE plugin_id = ? AND project_id = ? AND status = 'pending' AND expires_at > ?`)
        .get(pluginId, projectId, this.now()) as { count: number };
      if (active.count >= INTERACTION_MAX_ACTIVE_PER_PLUGIN_PROJECT) throw new InteractionQuotaError('plugin+project');
      const activeGlobal = this.db.sqlite.prepare(`SELECT count(*) AS count FROM plugin_interactions
        WHERE status = 'pending' AND expires_at > ?`)
        .get(this.now()) as { count: number };
      if (activeGlobal.count >= INTERACTION_MAX_ACTIVE_GLOBAL) throw new InteractionQuotaError('global');

      const now = this.now();
      const id = `interaction_${randomUUID()}`;
      this.db.sqlite.prepare(`INSERT INTO plugin_interactions (
        id, plugin_id, project_id, correlation_id, kind, payload_json, status,
        generation, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?)`)
        .run(id, pluginId, projectId, correlationId, kind, payloadJson, now, now, now + INTERACTION_ACK_TIMEOUT_MS);
      return toContract(this.getRow(id)!);
    });
  }

  acknowledge(input: InteractionAcknowledgement): InteractionContract {
    this.pruneIfDue(this.now());
    return this.db.transaction(() => {
      const now = this.now();
      const result = this.db.sqlite.prepare(`UPDATE plugin_interactions
        SET status = 'acknowledged', generation = generation + 1, acknowledged_at = ?, updated_at = ?, expires_at = ?
        WHERE id = ? AND generation = ? AND status = 'pending' AND expires_at > ?`)
        .run(now, now, now + INTERACTION_ACKNOWLEDGED_RESOLUTION_MS, input.interactionId, input.generation, now);
      if (result.changes === 0) throw new InteractionConflictError('Interaction acknowledgement is stale or no longer pending');
      return toContract(this.getRow(input.interactionId)!);
    });
  }

  resolve(interactionId: string, generation: number, status: 'resolved' | 'cancelled'): InteractionContract {
    this.pruneIfDue(this.now());
    return this.db.transaction(() => {
      const now = this.now();
      const result = this.db.sqlite.prepare(`UPDATE plugin_interactions
        SET status = ?, generation = generation + 1, terminal_at = ?, updated_at = ?
        WHERE id = ? AND generation = ? AND ((status = 'acknowledged' AND acknowledged_at > ?) OR (status = 'pending' AND expires_at > ?))`)
        .run(status, now, now, interactionId, generation, now - INTERACTION_ACKNOWLEDGED_RESOLUTION_MS, now);
      if (result.changes === 0) throw new InteractionConflictError('Interaction resolution is stale or already terminal');
      return toContract(this.getRow(interactionId)!);
    });
  }

  get(interactionId: string): InteractionContract | null {
    this.pruneIfDue(this.now());
    const row = this.getRow(interactionId);
    return row ? toContract(row) : null;
  }

  /** Utilization against the global quota, plus the oldest pending submission's age, for operator alerting. */
  metrics(): { activeGlobal: number; capacityGlobal: number; utilization: number; oldestPendingAgeMs: number | null } {
    this.pruneIfDue(this.now());
    const activeGlobal = (this.db.sqlite.prepare(`SELECT count(*) AS count FROM plugin_interactions
      WHERE status = 'pending' AND expires_at > ?`).get(this.now()) as { count: number }).count;
    const oldest = this.db.sqlite.prepare(`SELECT min(created_at) AS createdAt FROM plugin_interactions
      WHERE status = 'pending' AND expires_at > ?`).get(this.now()) as { createdAt: number | null };
    return {
      activeGlobal,
      capacityGlobal: INTERACTION_MAX_ACTIVE_GLOBAL,
      utilization: activeGlobal / INTERACTION_MAX_ACTIVE_GLOBAL,
      oldestPendingAgeMs: oldest.createdAt === null ? null : this.now() - oldest.createdAt
    };
  }

  prune(now = this.now()): void {
    this.db.sqlite.prepare(`UPDATE plugin_interactions
      SET status = 'ack-timeout', terminal_at = expires_at, updated_at = ?, generation = generation + 1
      WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?`)
      .run(now, now);
    this.db.sqlite.prepare(`UPDATE plugin_interactions
      SET status = 'cancelled', terminal_at = acknowledged_at + ?, updated_at = ?, generation = generation + 1
      WHERE status = 'acknowledged' AND acknowledged_at IS NOT NULL AND acknowledged_at <= ?`)
      .run(INTERACTION_ACKNOWLEDGED_RESOLUTION_MS, now, now - INTERACTION_ACKNOWLEDGED_RESOLUTION_MS);
    this.db.sqlite.prepare('DELETE FROM plugin_interactions WHERE terminal_at IS NOT NULL AND terminal_at <= ?')
      .run(now - INTERACTION_TERMINAL_RETENTION_MS);
    this.lastPrunedAt = now;
  }

  private pruneIfDue(now: number): void {
    if (now - this.lastPrunedAt >= INTERACTION_PRUNE_INTERVAL_MS) this.prune(now);
  }

  private getRow(interactionId: string): InteractionRow | undefined {
    return this.db.sqlite.prepare('SELECT * FROM plugin_interactions WHERE id = ?').get(interactionId) as InteractionRow | undefined;
  }
}
