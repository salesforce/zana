import { describe, expect, it } from 'vitest';
import { completeThread, listLiveThreads, type ZccDatabase } from '../index.js';

function fakeDb(rows: Map<string, Record<string, unknown>>): ZccDatabase {
  return {
    file: ':memory:',
    sqlite: {
      prepare(sql: string) {
        if (sql.startsWith('SELECT * FROM legacy_agent_sessions WHERE id')) {
          return {
            get: (id: string) => rows.get(id)
          };
        }
        if (sql.startsWith('UPDATE legacy_agent_sessions SET status = ?')) {
          return {
            run: (status: string, now: number, id: string) => {
              const row = rows.get(id);
              if (row) {
                row.status = status;
                row.updated_at = now;
              }
            }
          };
        }
        if (sql.includes("status IN ('starting', 'running')") && sql.startsWith('SELECT')) {
          return {
            all: () => [...rows.values()].filter((row) => row.status === 'starting' || row.status === 'running')
          };
        }
        throw new Error(`unexpected sql: ${sql}`);
      }
    },
    transaction: <T>(fn: () => T) => fn(),
    close: () => {}
  } as unknown as ZccDatabase;
}

function runningRow(id: string) {
  return {
    id,
    project_id: 'proj-1',
    host_id: 'host-1',
    environment_id: 'env-1',
    provider_id: 'claude',
    status: 'running',
    title: 'Hello',
    created_at: 1,
    updated_at: 1
  };
}

describe('completeThread', () => {
  it('drops a running row out of the live list', () => {
    const rows = new Map([['thr-1', runningRow('thr-1')]]);
    const db = fakeDb(rows);
    expect(listLiveThreads(db).map((row) => row.id)).toEqual(['thr-1']);
    expect(completeThread(db, 'thr-1')).toBe(true);
    expect(rows.get('thr-1')?.status).toBe('completed');
    expect(listLiveThreads(db).map((row) => row.id)).toEqual([]);
  });

  it('returns false for a missing id', () => {
    expect(completeThread(fakeDb(new Map()), 'missing')).toBe(false);
  });

  it('is a no-op success for an already completed row', () => {
    const rows = new Map([['thr-1', { ...runningRow('thr-1'), status: 'completed' }]]);
    expect(completeThread(fakeDb(rows), 'thr-1')).toBe(true);
    expect(rows.get('thr-1')?.status).toBe('completed');
  });
});
