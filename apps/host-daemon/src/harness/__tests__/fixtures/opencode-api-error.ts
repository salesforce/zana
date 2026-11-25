import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '@zana-ai/zcc-db';
import type { ApiErrorFailureFixture } from './api-error-fixture-types.js';

export const OPENCODE_FIXTURE_SESSION = 'ses_0123456789abcdef';

type Db = ReturnType<typeof createSqliteDatabase>;

/** Create an OpenCode-shaped database (message + session tables as observed in opencode 1.18.x). */
export function createOpenCodeDb(path: string): Db {
  const db = createSqliteDatabase(path);
  db.prepare('CREATE TABLE session (id text PRIMARY KEY, directory text NOT NULL, parent_id text, time_created integer NOT NULL, time_updated integer NOT NULL)').run();
  db.prepare('CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)').run();
  return db;
}

export const openCodeMessages = {
  user: () => ({ role: 'user', time: { created: 1 } }),
  ok: () => ({ role: 'assistant', finish: 'stop', time: { created: 1, completed: 2 } }),
  failed: (name = 'UnknownError', data: Record<string, unknown> = { message: 'litellm.ServiceUnavailableError: BedrockException' }) =>
    ({ role: 'assistant', time: { created: 1, completed: 2 }, error: { name, data } }),
  aborted: () => ({ role: 'assistant', time: { created: 1, completed: 2 }, error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } }),
  retrying: () => ({ role: 'assistant', time: { created: 1 } })
};

export function insertMessage(db: Db, id: string, time: number, data: unknown, session = OPENCODE_FIXTURE_SESSION): void {
  db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)')
    .run(id, session, time, time, typeof data === 'string' ? data : JSON.stringify(data));
}

export function openCodeFixture(): ApiErrorFailureFixture {
  let dbPath = '';
  let clock = 1000;
  const append = (data: unknown) => {
    const db = createSqliteDatabase(dbPath);
    try {
      insertMessage(db, `msg_${clock}`, clock += 10, openCodeMessages.user());
      insertMessage(db, `msg_${clock}`, clock += 10, data);
    } finally { db.close(); }
  };
  return {
    prepare() {
      const home = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-api-error-')));
      const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-cwd-')));
      const data = join(home, 'opencode');
      mkdirSync(data, { recursive: true });
      dbPath = join(data, 'opencode.db');
      const db = createOpenCodeDb(dbPath);
      db.prepare('INSERT INTO session (id, directory, parent_id, time_created, time_updated) VALUES (?, ?, NULL, ?, ?)')
        .run(OPENCODE_FIXTURE_SESSION, cwd, 500, 500);
      db.close();
      const previous = process.env.XDG_DATA_HOME;
      process.env.XDG_DATA_HOME = home;
      return {
        session: { id: 'pty-1', cwd, createdAt: 400, openCodeSessionId: OPENCODE_FIXTURE_SESSION },
        cleanup: () => { if (previous === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = previous; }
      };
    },
    appendFailedTurn: () => append(openCodeMessages.failed()),
    appendSuccessfulTurn: () => append(openCodeMessages.ok())
  };
}
