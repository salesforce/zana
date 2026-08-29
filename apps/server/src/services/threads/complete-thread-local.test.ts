import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { completeThreadAtDataDir } from './complete-thread-local.js';

const LIVE_ID = '11111111-1111-4111-8111-111111111111';
const DONE_ID = '22222222-2222-4222-8222-222222222222';

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function sqliteFile(): string {
  dir = mkdtempSync(join(tmpdir(), 'zcc-complete-thread-'));
  const file = join(dir, 'zcc.sqlite');
  execFileSync('sqlite3', [file, `
    CREATE TABLE legacy_agent_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      host_id TEXT NOT NULL,
      environment_id TEXT,
      provider_id TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO legacy_agent_sessions VALUES ('${LIVE_ID}','proj','host','env','claude','running','Hello',1,1);
    INSERT INTO legacy_agent_sessions VALUES ('${DONE_ID}','proj','host','env','claude','completed','Bye',1,1);
  `]);
  return file;
}

describe('completeThreadAtDataDir', () => {
  it('marks a running thread completed so it cannot be listed as live', () => {
    sqliteFile();
    expect(completeThreadAtDataDir(dir!, LIVE_ID)).toBe(true);
    const status = execFileSync('sqlite3', [join(dir!, 'zcc.sqlite'), `SELECT status FROM legacy_agent_sessions WHERE id='${LIVE_ID}';`], { encoding: 'utf8' }).trim();
    expect(status).toBe('completed');
    const live = execFileSync('sqlite3', [join(dir!, 'zcc.sqlite'), `SELECT id FROM legacy_agent_sessions WHERE status IN ('starting','running');`], { encoding: 'utf8' }).trim();
    expect(live).toBe('');
  });

  it('returns true for an already completed row', () => {
    sqliteFile();
    expect(completeThreadAtDataDir(dir!, DONE_ID)).toBe(true);
  });

  it('returns false for a missing id without throwing', () => {
    sqliteFile();
    expect(completeThreadAtDataDir(dir!, '33333333-3333-4333-8333-333333333333')).toBe(false);
  });

  it('rejects a non-uuid id so the SQL stays bound to a thread key', () => {
    sqliteFile();
    expect(completeThreadAtDataDir(dir!, `'; DROP TABLE threads; --`)).toBe(false);
  });
});
