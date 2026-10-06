import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@zana-ai/zcc-db';
import { describe, expect, it } from 'vitest';
import {
  InteractionConflictError,
  InteractionQuotaError,
  InteractionService,
  INTERACTION_ACKNOWLEDGED_RESOLUTION_MS,
  INTERACTION_ACK_TIMEOUT_MS,
  INTERACTION_MAX_ACTIVE_GLOBAL,
  INTERACTION_MAX_ACTIVE_PER_PLUGIN_PROJECT,
  INTERACTION_TERMINAL_RETENTION_MS,
} from './interaction-service.js';

function fixture(now = 10_000) {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-interactions-'));
  const db = openDatabase(join(dir, 'runtime.sqlite'));
  let clock = now;
  const service = new InteractionService(db, () => clock);
  return {
    service,
    db,
    advance(ms: number) { clock += ms; },
    cleanup() { db.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

describe('InteractionService', () => {
  it('upserts by correlation and rejects a conflicting replay', () => {
    const f = fixture();
    try {
      const first = f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c1', kind: 'prompt', payload: { name: 'A' } });
      expect(f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c1', kind: 'prompt', payload: { name: 'A' } })).toEqual(first);
      expect(() => f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c1', kind: 'prompt', payload: { name: 'B' } })).toThrow(InteractionConflictError);
    } finally { f.cleanup(); }
  });

  it('uses generation CAS for acknowledgement and terminal transitions', () => {
    const f = fixture();
    try {
      const pending = f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c1', kind: 'prompt', payload: {} });
      const acknowledged = f.service.acknowledge({ interactionId: pending.id, generation: pending.generation });
      expect(acknowledged).toMatchObject({ status: 'acknowledged', generation: 2, acknowledgedAt: 10_000 });
      expect(() => f.service.acknowledge({ interactionId: pending.id, generation: pending.generation })).toThrow(InteractionConflictError);
      expect(f.service.resolve(pending.id, acknowledged.generation, 'resolved')).toMatchObject({ status: 'resolved', generation: 3, terminalAt: 10_000 });
    } finally { f.cleanup(); }
  });

  it('resolves to cancelled distinctly from resolved', () => {
    const f = fixture();
    try {
      const pending = f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c1', kind: 'prompt', payload: {} });
      const cancelled = f.service.resolve(pending.id, pending.generation, 'cancelled');
      expect(cancelled).toMatchObject({ status: 'cancelled', generation: 2, terminalAt: 10_000 });
      expect(() => f.service.resolve(pending.id, cancelled.generation, 'resolved')).toThrow(InteractionConflictError);
    } finally { f.cleanup(); }
  });

  it('expires unacknowledged rows after thirty days and prunes terminal rows after seven days', () => {
    const f = fixture();
    try {
      const pending = f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c1', kind: 'prompt', payload: {} });
      f.advance(INTERACTION_ACK_TIMEOUT_MS);
      expect(f.service.get(pending.id)).toMatchObject({ status: 'ack-timeout', terminalAt: 10_000 + INTERACTION_ACK_TIMEOUT_MS });
      f.advance(INTERACTION_TERMINAL_RETENTION_MS);
      expect(f.service.get(pending.id)).toBeNull();
    } finally { f.cleanup(); }
  });

  it('acknowledgement frees capacity while giving the row a new thirty-day resolution window', () => {
    const f = fixture();
    try {
      const pending = f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c1', kind: 'prompt', payload: {} });
      f.advance(60_000);
      const acknowledged = f.service.acknowledge({ interactionId: pending.id, generation: pending.generation });
      expect(acknowledged).toMatchObject({ status: 'acknowledged', acknowledgedAt: 70_000, terminalAt: null, expiresAt: 70_000 + INTERACTION_ACKNOWLEDGED_RESOLUTION_MS });
      for (let index = 0; index < INTERACTION_MAX_ACTIVE_PER_PLUGIN_PROJECT; index += 1) {
        f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: `filler${index}`, kind: 'prompt', payload: {} });
      }
      expect(() => f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'overflow', kind: 'prompt', payload: {} })).toThrow(InteractionQuotaError);
      f.advance(INTERACTION_ACKNOWLEDGED_RESOLUTION_MS - 1);
      expect(f.service.get(pending.id)).toMatchObject({ status: 'acknowledged', terminalAt: null });
      f.advance(1);
      expect(() => f.service.resolve(pending.id, acknowledged.generation, 'resolved')).toThrow(InteractionConflictError);
      f.service.prune();
      expect(f.service.get(pending.id)).toMatchObject({ status: 'cancelled', generation: 3, terminalAt: acknowledged.expiresAt });
      expect(() => f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'overflow', kind: 'prompt', payload: {} })).not.toThrow();
      f.advance(INTERACTION_TERMINAL_RETENTION_MS - 1);
      expect(f.service.get(pending.id)?.status).toBe('cancelled');
      f.advance(1);
      f.service.prune();
      expect(f.service.get(pending.id)).toBeNull();
    } finally { f.cleanup(); }
  });

  it('accepts resolution before the acknowledged deadline and rejects it at the deadline', () => {
    const f = fixture();
    try {
      const pending = f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c1', kind: 'prompt', payload: {} });
      const acknowledged = f.service.acknowledge({ interactionId: pending.id, generation: pending.generation });
      f.advance(INTERACTION_ACKNOWLEDGED_RESOLUTION_MS - 1);
      expect(f.service.resolve(pending.id, acknowledged.generation, 'resolved')).toMatchObject({ status: 'resolved', generation: 3 });

      const second = f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c2', kind: 'prompt', payload: {} });
      const waiting = f.service.acknowledge({ interactionId: second.id, generation: second.generation });
      f.advance(INTERACTION_ACKNOWLEDGED_RESOLUTION_MS);
      expect(f.db.sqlite.prepare('SELECT status, generation FROM plugin_interactions WHERE id = ?').get(second.id)).toEqual({ status: 'acknowledged', generation: 2 });
      expect(() => f.service.resolve(second.id, waiting.generation, 'cancelled')).toThrow(InteractionConflictError);
      expect(f.service.get(second.id)).toMatchObject({ status: 'cancelled', generation: 3, terminalAt: waiting.expiresAt });
    } finally { f.cleanup(); }
  });

  it('bases delayed sweep retention on the deadline, not sweep time', () => {
    const f = fixture();
    try {
      const pending = f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c1', kind: 'prompt', payload: {} });
      f.service.acknowledge({ interactionId: pending.id, generation: pending.generation });
      f.advance(INTERACTION_ACKNOWLEDGED_RESOLUTION_MS + INTERACTION_TERMINAL_RETENTION_MS);
      f.service.prune();
      expect(f.service.get(pending.id)).toBeNull();
      expect(() => f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c1', kind: 'prompt', payload: {} })).not.toThrow();
    } finally { f.cleanup(); }
  });

  it('enforces active interaction quota per plugin and project', () => {
    const f = fixture();
    try {
      for (let index = 0; index < INTERACTION_MAX_ACTIVE_PER_PLUGIN_PROJECT; index += 1) {
        f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: `c${index}`, kind: 'prompt', payload: {} });
      }
      expect(() => f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'overflow', kind: 'prompt', payload: {} })).toThrow(InteractionQuotaError);
      expect(() => f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'other-project', correlationId: 'allowed', kind: 'prompt', payload: {} })).not.toThrow();
    } finally { f.cleanup(); }
  });

  it('enforces the global active interaction quota across every plugin and project, with a typed code and retry guidance', () => {
    const f = fixture();
    try {
      const now = 10_000;
      const insert = f.db.sqlite.prepare(`INSERT INTO plugin_interactions (
        id, plugin_id, project_id, correlation_id, kind, payload_json, status,
        generation, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, '{}', 'pending', 1, ?, ?, ?)`);
      f.db.transaction(() => {
        for (let index = 0; index < INTERACTION_MAX_ACTIVE_GLOBAL; index += 1) {
          insert.run(`seed_${index}`, `plugin-${index}`, `project-${index}`, `seed-${index}`, 'prompt', now, now, now + INTERACTION_ACK_TIMEOUT_MS);
        }
      });
      let error: unknown;
      try {
        f.service.upsertInteraction({ pluginId: 'overflow-plugin', projectId: 'overflow-project', correlationId: 'overflow', kind: 'prompt', payload: {} });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(InteractionQuotaError);
      expect((error as InteractionQuotaError).code).toBe('INTERACTION_CAPACITY_EXCEEDED');
      expect((error as InteractionQuotaError).scope).toBe('global');
      expect((error as Error).message).toMatch(/retry/);
      const acknowledged = f.service.acknowledge({ interactionId: 'seed_0', generation: 1 });
      expect(acknowledged.status).toBe('acknowledged');
      expect(() => f.service.upsertInteraction({ pluginId: 'overflow-plugin', projectId: 'overflow-project', correlationId: 'overflow', kind: 'prompt', payload: {} })).not.toThrow();
    } finally { f.cleanup(); }
  });

  it('metrics() excludes acknowledged rows from capacity and oldest pending age', () => {
    const f = fixture();
    try {
      const pending = f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c1', kind: 'prompt', payload: {} });
      f.service.acknowledge({ interactionId: pending.id, generation: pending.generation });
      f.advance(60_000);
      f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c2', kind: 'prompt', payload: {} });
      const metrics = f.service.metrics();
      expect(metrics.activeGlobal).toBe(1);
      expect(metrics.oldestPendingAgeMs).toBe(0);
    } finally { f.cleanup(); }
  });

  it('throttles table-wide pruning while excluding expired pending rows from quota and metrics', () => {
    const f = fixture();
    try {
      const expired = f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'expired', kind: 'prompt', payload: {} });
      f.db.sqlite.prepare('UPDATE plugin_interactions SET expires_at = ? WHERE id = ?').run(10_001, expired.id);
      f.advance(2);
      expect(f.service.metrics()).toMatchObject({ activeGlobal: 0, oldestPendingAgeMs: null });
      expect(f.service.get(expired.id)).toMatchObject({ status: 'pending' });
      expect(() => f.service.acknowledge({ interactionId: expired.id, generation: expired.generation })).toThrow(InteractionConflictError);
      expect(() => f.service.resolve(expired.id, expired.generation, 'resolved')).toThrow(InteractionConflictError);
      for (let index = 0; index < INTERACTION_MAX_ACTIVE_PER_PLUGIN_PROJECT; index += 1) {
        f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: `c${index}`, kind: 'prompt', payload: {} });
      }
      expect(() => f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'overflow', kind: 'prompt', payload: {} })).toThrow(InteractionQuotaError);
      f.advance(60_000);
      expect(f.service.get(expired.id)).toMatchObject({ status: 'ack-timeout' });
    } finally { f.cleanup(); }
  });
});
