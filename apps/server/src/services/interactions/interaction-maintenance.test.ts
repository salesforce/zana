import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@zana-ai/zcc-db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startInteractionMaintenance } from './interaction-maintenance.js';
import { INTERACTION_ACK_TIMEOUT_MS } from './interaction-service.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('startInteractionMaintenance', () => {
  it('sweeps expired interactions at startup and on the daily timer, then disposes its single timer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-interaction-maintenance-'));
    const db = openDatabase(join(dir, 'runtime.sqlite'));
    try {
      const now = Date.now();
      db.sqlite.prepare(`INSERT INTO plugin_interactions (
        id, plugin_id, project_id, correlation_id, kind, payload_json, status,
        generation, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, '{}', 'pending', 1, ?, ?, ?)`)
        .run('int_1', 'plugin', 'project', 'c1', 'prompt', now, now, now - 1);

      vi.useFakeTimers();
      const stop = startInteractionMaintenance(db);
      expect(
        db.sqlite.prepare('SELECT status FROM plugin_interactions WHERE id = ?').get('int_1')
      ).toEqual({ status: 'ack-timeout' });

      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns when global utilization crosses the alert threshold, without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-interaction-maintenance-'));
    const db = openDatabase(join(dir, 'runtime.sqlite'));
    try {
      const now = Date.now();
      const insert = db.sqlite.prepare(`INSERT INTO plugin_interactions (
        id, plugin_id, project_id, correlation_id, kind, payload_json, status,
        generation, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, '{}', 'pending', 1, ?, ?, ?)`);
      db.transaction(() => {
        for (let index = 0; index < 8_001; index += 1) {
          insert.run(`int_${index}`, `plugin-${index}`, `project-${index}`, `c${index}`, 'prompt', now, now, now + INTERACTION_ACK_TIMEOUT_MS);
        }
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const stop = startInteractionMaintenance(db);
      expect(warn).toHaveBeenCalledWith('[interactions] global quota utilization high:', expect.objectContaining({ activeGlobal: 8_001 }));
      stop();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
