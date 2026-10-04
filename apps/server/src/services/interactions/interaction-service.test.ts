import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@zana-ai/zcc-db';
import { describe, expect, it } from 'vitest';
import {
  InteractionConflictError,
  InteractionQuotaError,
  InteractionService,
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

  it('also expires a stuck acknowledged row after thirty days, freeing its quota slot', () => {
    const f = fixture();
    try {
      const pending = f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c1', kind: 'prompt', payload: {} });
      const acknowledged = f.service.acknowledge({ interactionId: pending.id, generation: pending.generation });
      expect(acknowledged.status).toBe('acknowledged');
      for (let index = 0; index < INTERACTION_MAX_ACTIVE_PER_PLUGIN_PROJECT - 1; index += 1) {
        f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: `filler${index}`, kind: 'prompt', payload: {} });
      }
      expect(() => f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'overflow', kind: 'prompt', payload: {} })).toThrow(InteractionQuotaError);
      f.advance(INTERACTION_ACK_TIMEOUT_MS);
      expect(f.service.get(pending.id)).toMatchObject({ status: 'ack-timeout', terminalAt: 10_000 + INTERACTION_ACK_TIMEOUT_MS });
      expect(() => f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'overflow', kind: 'prompt', payload: {} })).not.toThrow();
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
    } finally { f.cleanup(); }
  });

  it('metrics() surfaces a stuck acknowledged row\'s age, not only pending rows', () => {
    const f = fixture();
    try {
      const pending = f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c1', kind: 'prompt', payload: {} });
      f.service.acknowledge({ interactionId: pending.id, generation: pending.generation });
      f.advance(60_000);
      f.service.upsertInteraction({ pluginId: 'plugin', projectId: 'project', correlationId: 'c2', kind: 'prompt', payload: {} });
      const metrics = f.service.metrics();
      expect(metrics.activeGlobal).toBe(2);
      expect(metrics.oldestPendingAgeMs).toBe(60_000);
    } finally { f.cleanup(); }
  });
});
