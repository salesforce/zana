import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '@zana-ai/zcc-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenCodeApiErrorProducer, failureFromMessage } from '../api-error-producer.js';
import { OPENCODE_FIXTURE_SESSION as SID, createOpenCodeDb, insertMessage, openCodeMessages as msg } from '../../__tests__/fixtures/opencode-api-error.js';

let dir: string;
let cwd: string;
let dbPath: string;
const base = () => ({ id: 'pty-1', cwd, createdAt: 400, openCodeSessionId: SID } as Record<string, unknown> & { id: string; cwd: string });
const producer = (log?: (m: string) => void) => createOpenCodeApiErrorProducer({ dbPath: () => dbPath, log });

function write(fn: (db: ReturnType<typeof createSqliteDatabase>) => void) {
  const db = createSqliteDatabase(dbPath);
  try { fn(db); } finally { db.close(); }
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'oc-producer-')));
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'oc-cwd-')));
  dbPath = join(dir, 'opencode.db');
  const db = createOpenCodeDb(dbPath);
  db.prepare('INSERT INTO session (id, directory, parent_id, time_created, time_updated) VALUES (?, ?, NULL, 500, 500)').run(SID, cwd);
  db.close();
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); });

let clock = 2000;
async function turn(data: unknown, ref = base(), p = producer()) {
  const marker = await p.markTurnStart(ref);
  write((db) => {
    insertMessage(db, `u${clock}`, clock += 10, msg.user());
    insertMessage(db, `a${clock}`, clock += 10, data);
  });
  return p.check(ref, marker);
}

describe('failureFromMessage', () => {
  it('maps status codes and text through the shared classifier', () => {
    expect(failureFromMessage(msg.failed('APIError', { statusCode: 401, message: 'bad key', isRetryable: false })))
      .toMatchObject({ error: 'authentication_failed', retryable: false });
    expect(failureFromMessage(msg.failed('APIError', { statusCode: '400', message: 'nope' }))).toMatchObject({ error: 'invalid_request', retryable: false });
    expect(failureFromMessage(msg.failed())).toMatchObject({ error: 'server_error', retryable: true });
    expect(failureFromMessage(msg.failed('UnknownError', {}))).toMatchObject({ error: 'unknown', retryable: true });
    expect(failureFromMessage(msg.failed('ProviderAuthError', { message: 'x' }))).toMatchObject({ error: 'authentication_failed', retryable: false });
  });

  it('ignores aborts, other error names, incomplete rows, user rows and junk', () => {
    expect(failureFromMessage(msg.aborted())).toBeNull();
    expect(failureFromMessage(msg.failed('MessageOutputLengthError'))).toBeNull();
    expect(failureFromMessage(msg.retrying())).toBeNull();
    expect(failureFromMessage(msg.user())).toBeNull();
    expect(failureFromMessage(msg.ok())).toBeNull();
    expect(failureFromMessage(null)).toBeNull();
    expect(failureFromMessage('x')).toBeNull();
  });

  it('sanitises and caps text', () => {
    const event = failureFromMessage(msg.failed('UnknownError', { message: `\u001b[31m${'y'.repeat(9000)}` })) as { text: string };
    expect(event.text.length).toBeLessThanOrEqual(4096);
    expect(event.text).not.toContain('\u001b');
  });
});

describe('opencode api-error producer', () => {
  it('reports a persisted provider failure', async () => {
    expect(await turn(msg.failed())).toMatchObject({ kind: 'api-error-stop', error: 'server_error', retryable: true });
  });

  it('is silent for success, user interrupt, and a still-retrying row', async () => {
    expect(await turn(msg.ok())).toBeNull();
    expect(await turn(msg.aborted())).toBeNull();
    expect(await turn(msg.retrying())).toBeNull();
  });

  it('ignores a failure from before the turn marker', async () => {
    write((db) => insertMessage(db, 'old', 1500, msg.failed()));
    expect(await turn(msg.ok())).toBeNull();
  });

  it('uses only the newest assistant message', async () => {
    const p = producer();
    const marker = await p.markTurnStart(base());
    write((db) => { insertMessage(db, 'a', 2000, msg.failed()); insertMessage(db, 'b', 2010, msg.ok()); });
    expect(await p.check(base(), marker)).toBeNull();
  });

  it('ignores error text in non-assistant rows and malformed or oversized data', async () => {
    const p = producer();
    const marker = await p.markTurnStart(base());
    write((db) => {
      insertMessage(db, 'u', 2000, { role: 'user', error: { name: 'APIError', data: { statusCode: 429 } }, time: { completed: 1 } });
      insertMessage(db, 'junk', 2010, '{not json');
      insertMessage(db, 'big', 2020, JSON.stringify({ role: 'assistant', time: { completed: 1 }, error: { name: 'UnknownError', data: { message: 'z'.repeat(300_000) } } }));
    });
    expect(await p.check(base(), marker)).toBeNull();
  });

  it('works on the first turn, before a session id is known', async () => {
    const ref = { id: 'pty-1', cwd, createdAt: 400 };
    expect(await turn(msg.failed(), ref)).toMatchObject({ kind: 'api-error-stop' });
  });

  it('fails closed on ambiguous or foreign sessions', async () => {
    const ref = { id: 'pty-1', cwd, createdAt: 400 };
    write((db) => db.prepare('INSERT INTO session (id, directory, parent_id, time_created, time_updated) VALUES (?, ?, NULL, 600, 600)').run('ses_second0000', cwd));
    expect(await turn(msg.failed(), ref)).toBeNull();
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'oc-other-')));
    try { expect(await turn(msg.failed(), { ...base(), cwd: other })).toBeNull(); } finally { rmSync(other, { recursive: true, force: true }); }
    expect(await turn(msg.failed(), { ...base(), openCodeSessionId: 'ses_unknown00000' })).toBeNull();
    expect(await turn(msg.failed(), { ...base(), openCodeSessionId: "ses_x'; DROP TABLE message;--" })).toBeNull();
  });

  it('ignores a session created before this tab spawned', async () => {
    expect(await turn(msg.failed(), { id: 'pty-1', cwd, createdAt: 900_000 })).toBeNull();
  });

  it('returns null for remote sessions, a missing database, an unknown marker and a symlinked database', async () => {
    expect(await turn(msg.failed(), { ...base(), remote: { host: 'h' } })).toBeNull();
    expect(await producer().check(base(), undefined)).toBeNull();
    const log = vi.fn();
    const missing = createOpenCodeApiErrorProducer({ dbPath: () => join(dir, 'none.db'), log });
    expect(await missing.markTurnStart(base())).toEqual({ since: null });
    expect(await missing.check(base(), { since: null })).toBeNull();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'oc-out-')));
    try {
      const real = join(outside, 'x.db');
      createOpenCodeDb(real).close();
      const link = join(dir, 'link.db');
      symlinkSync(real, link);
      expect(await createOpenCodeApiErrorProducer({ dbPath: () => link }).check(base(), { since: null })).toBeNull();
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });

  it('logs a schema problem once per session and recovers on release', async () => {
    const log = vi.fn();
    const bad = join(dir, 'bad.db');
    mkdirSync(dir, { recursive: true });
    createSqliteDatabase(bad).close();
    const p = createOpenCodeApiErrorProducer({ dbPath: () => bad, log });
    await p.check(base(), { since: null });
    await p.check(base(), { since: null });
    expect(log).toHaveBeenCalledTimes(1);
    p.release('pty-1');
    await p.check(base(), { since: null });
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('exposes a quiet period', () => {
    expect(producer().quietMs).toBeGreaterThan(0);
  });
});
