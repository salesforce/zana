import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openExecutionDatabase, putExecutionRecord, type ExecutionDatabase } from '@zana-ai/zcc-db';
import {
  executionStoreHasRecord,
  readExecutionStoreSqliteState,
  writeExecutionStoreSqliteState
} from '../../storage/sqlite-state.js';

interface State {
  version: 1;
  revision: number;
  records: Array<{ id: string; note?: string }>;
  events: Array<{ id: string; executionId: string; sequence: number; note?: string }>;
}

let directory: string;
let database: ExecutionDatabase;

function open(): void {
  directory = mkdtempSync(join(tmpdir(), 'zcc-sqlite-state-'));
  database = openExecutionDatabase(join(directory, 'execution.sqlite'));
  // Count every row write so tests can prove unchanged rows are untouched.
  database.sqlite.exec('CREATE TABLE write_log (tbl TEXT, id TEXT, op TEXT)');
  for (const table of ['execution_store_record_rows', 'execution_store_event_rows']) {
    database.sqlite.exec(`
      CREATE TRIGGER ${table}_ins AFTER INSERT ON ${table} BEGIN INSERT INTO write_log VALUES ('${table}', NEW.id, 'insert'); END;
      CREATE TRIGGER ${table}_upd AFTER UPDATE ON ${table} BEGIN INSERT INTO write_log VALUES ('${table}', NEW.id, 'update'); END;
      CREATE TRIGGER ${table}_del AFTER DELETE ON ${table} BEGIN INSERT INTO write_log VALUES ('${table}', OLD.id, 'delete'); END;`);
  }
}

function writes(): Array<{ tbl: string; id: string; op: string }> {
  const rows = database.sqlite.prepare('SELECT tbl, id, op FROM write_log ORDER BY rowid').all() as Array<{ tbl: string; id: string; op: string }>;
  database.sqlite.exec('DELETE FROM write_log');
  return rows;
}

function save(state: State): void {
  const current = readExecutionStoreSqliteState<State>(database, 'execution-store');
  writeExecutionStoreSqliteState(database, 'execution-store', state, current?.hash ?? null);
}

function readExecutionStoreSqliteStateHash(): string {
  return readExecutionStoreSqliteState<State>(database, 'execution-store')!.hash;
}

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

const base = (): State => ({
  version: 1,
  revision: 1,
  records: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  events: [
    { id: 'e1', executionId: 'a', sequence: 1 },
    { id: 'e2', executionId: 'a', sequence: 2 }
  ]
});

describe('writeExecutionStoreSqliteState row sync', () => {
  it('inserts every row on first write', () => {
    open();
    save(base());
    expect(writes().filter((w) => w.op === 'insert').map((w) => w.id)).toEqual(['a', 'b', 'c', 'e1', 'e2']);
    expect(readExecutionStoreSqliteState<State>(database, 'execution-store')?.value).toEqual(base());
  });

  it('writes only the changed and new rows, never rewriting identical ones', () => {
    open();
    save(base());
    writes();
    const next = base();
    next.revision = 2;
    next.records[1] = { id: 'b', note: 'changed' };
    next.records.push({ id: 'd' });
    next.events.push({ id: 'e3', executionId: 'b', sequence: 1 });
    save(next);
    expect(writes()).toEqual([
      { tbl: 'execution_store_record_rows', id: 'b', op: 'update' },
      { tbl: 'execution_store_record_rows', id: 'd', op: 'insert' },
      { tbl: 'execution_store_event_rows', id: 'e3', op: 'insert' }
    ]);
    expect(readExecutionStoreSqliteState<State>(database, 'execution-store')?.value).toEqual(next);
  });

  it('deletes only rows absent from the new state and handles position shifts', () => {
    open();
    save(base());
    writes();
    const next = base();
    next.revision = 2;
    next.records = next.records.slice(1); // prune oldest: b,c shift down
    next.events = next.events.slice(1);
    save(next);
    const log = writes();
    expect(log.filter((w) => w.op === 'delete').map((w) => w.id).sort()).toEqual(['a', 'e1']);
    const read = readExecutionStoreSqliteState<State>(database, 'execution-store')!.value;
    expect(read.records.map((r) => r.id)).toEqual(['b', 'c']);
    expect(read.events.map((e) => e.id)).toEqual(['e2']);
  });

  it('survives swapped positions without tripping the position uniqueness constraint', () => {
    open();
    save(base());
    const next = base();
    next.revision = 2;
    next.records = [next.records[2]!, next.records[1]!, next.records[0]!];
    save(next);
    expect(readExecutionStoreSqliteState<State>(database, 'execution-store')?.value.records.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('updates event execution and sequence columns', () => {
    open();
    save(base());
    const next = base();
    next.revision = 2;
    next.events[0] = { id: 'e1', executionId: 'z', sequence: 9 };
    save(next);
    expect(database.sqlite.prepare('SELECT execution_id, sequence FROM execution_store_event_rows WHERE id = ?').get('e1'))
      .toEqual({ execution_id: 'z', sequence: 9 });
  });

  it('rolls the whole transaction back on a stale hash and on a mid-write failure', () => {
    open();
    save(base());
    const stale = readExecutionStoreSqliteState<State>(database, 'execution-store')!.hash;
    save({ ...base(), revision: 2, records: [{ id: 'a' }] });
    expect(() => writeExecutionStoreSqliteState(database, 'execution-store', { ...base(), revision: 3 }, stale)).toThrow('stale execution SQLite state');
    expect(readExecutionStoreSqliteState<State>(database, 'execution-store')?.value.records.map((r) => r.id)).toEqual(['a']);

    const hash = readExecutionStoreSqliteState<State>(database, 'execution-store')!.hash;
    const duplicate = { ...base(), revision: 4, records: [{ id: 'a' }, { id: 'a' }, { id: 'q' }] };
    // Duplicate ids collapse into one upsert; a bad event row (null execution id) forces a mid-transaction failure.
    const broken = { ...duplicate, events: [{ id: 'x', executionId: null as unknown as string, sequence: 1 }] };
    expect(() => writeExecutionStoreSqliteState(database, 'execution-store', broken, hash)).toThrow();
    expect(readExecutionStoreSqliteState<State>(database, 'execution-store')?.value.records.map((r) => r.id)).toEqual(['a']);
  });

  it('does not read stored bodies back on a warm write', () => {
    open();
    save(base());
    writes();
    const prepared: string[] = [];
    const realPrepare = database.sqlite.prepare.bind(database.sqlite);
    database.sqlite.prepare = ((sql: string) => { prepared.push(sql); return realPrepare(sql); }) as typeof database.sqlite.prepare;
    const next = base();
    next.revision = 2;
    next.records[0] = { id: 'a', note: 'x' };
    writeExecutionStoreSqliteState(database, 'execution-store', next, readExecutionStoreSqliteStateHash());
    expect(prepared.some((sql) => /SELECT id, position, value_json/.test(sql))).toBe(false);
    expect(writes()).toEqual([{ tbl: 'execution_store_record_rows', id: 'a', op: 'update' }]);
    expect(readExecutionStoreSqliteState<State>(database, 'execution-store')?.value).toEqual(next);
  });

  it('falls back to a cold diff after another handle moves the ledger', () => {
    open();
    save(base());
    const other = openExecutionDatabase(join(directory, 'execution.sqlite'));
    try {
      const hash = readExecutionStoreSqliteState<State>(other, 'execution-store')!.hash;
      const moved = base();
      moved.revision = 2;
      moved.records = [{ id: 'a', note: 'other' }, { id: 'z' }];
      writeExecutionStoreSqliteState(other, 'execution-store', moved, hash);
      const back = base();
      back.revision = 3;
      back.records[0] = { id: 'a', note: 'other' };
      save(back);
      expect(readExecutionStoreSqliteState<State>(database, 'execution-store')?.value).toEqual(back);
    } finally {
      other.close();
    }
  });

  it('keeps diffs correct after a rolled-back write and across a reopened handle', () => {
    open();
    save(base());
    const hash = readExecutionStoreSqliteStateHash();
    const broken = { ...base(), revision: 2, records: [{ id: 'a', note: 'lost' }], events: [{ id: 'x', executionId: null as unknown as string, sequence: 1 }] };
    expect(() => writeExecutionStoreSqliteState(database, 'execution-store', broken, hash)).toThrow();
    const next = base();
    next.revision = 2;
    next.records[2] = { id: 'c', note: 'kept' };
    save(next);
    expect(readExecutionStoreSqliteState<State>(database, 'execution-store')?.value).toEqual(next);

    database.close();
    database = openExecutionDatabase(join(directory, 'execution.sqlite'));
    const again = { ...next, revision: 3, records: next.records.slice(1) };
    save(again);
    expect(readExecutionStoreSqliteState<State>(database, 'execution-store')?.value).toEqual(again);
  });

  it('rejects non-serializable state', () => {
    open();
    expect(() => writeExecutionStoreSqliteState(database, 'execution-store', undefined as unknown as State, null)).toThrow(TypeError);
  });
});

describe('executionStoreHasRecord and legacy migration', () => {
  it('answers point lookups and migrates a legacy aggregate row once', () => {
    open();
    putExecutionRecord(database, 'execution-store', { version: 1, revision: 2, records: [{ id: 'legacy' }], events: [] });
    expect(executionStoreHasRecord(database, 'execution-store', 'legacy')).toBe(true);
    expect(executionStoreHasRecord(database, 'execution-store', 'missing')).toBe(false);
    expect(database.sqlite.prepare('SELECT id FROM execution_records WHERE id = ?').get('execution-store')).toBeUndefined();
  });

  it('rejects a corrupt legacy ledger', () => {
    open();
    putExecutionRecord(database, 'execution-store', { version: 2, revision: 1, records: [], events: [] });
    expect(() => executionStoreHasRecord(database, 'execution-store', 'x')).toThrow('corrupt legacy execution SQLite state');
  });
});
