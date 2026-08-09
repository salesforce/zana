/**
 * OpenCode SQLite-transcript reader tests. Builds an in-memory `better-sqlite3`
 * database matching the real `session`/`message`/`part` schema (reverse-
 * engineered from a live opencode-ai 1.18.4 `opencode.db` — see the reader's
 * module doc) rather than a committed binary fixture, since better-sqlite3
 * supports `:memory:` databases directly. Mirrors the coverage of the Claude/
 * Codex transcript-reader tests: last-text, digest, stats (model/tokens/cost/
 * files/queue), and the never-throw contract on a missing/garbage db.
 */

import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  extractLastAssistantTextOpenCode,
  buildSessionDigestOpenCode,
  buildSessionStatsOpenCode,
  readLastAssistantTextOpenCode,
  readSessionDigestOpenCode,
  readSessionStatsOpenCode,
  openCodeDbPath
} from '../opencode-transcript-reader.js';

/** Build an in-memory db with the real OpenCode schema. */
function makeDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      directory TEXT,
      title TEXT,
      model TEXT,
      cost REAL,
      tokens_input INTEGER,
      tokens_output INTEGER,
      tokens_reasoning INTEGER,
      tokens_cache_read INTEGER,
      tokens_cache_write INTEGER,
      time_created INTEGER,
      time_updated INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      time_created INTEGER,
      data TEXT
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      session_id TEXT,
      time_created INTEGER,
      data TEXT
    );
  `);
  return db;
}

function insertMessage(
  db: InstanceType<typeof Database>,
  id: string,
  sessionId: string,
  t: number,
  role: string
): void {
  db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)').run(
    id,
    sessionId,
    t,
    JSON.stringify({ role })
  );
}

function insertPart(
  db: InstanceType<typeof Database>,
  id: string,
  messageId: string,
  sessionId: string,
  t: number,
  data: unknown
): void {
  db.prepare('INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)').run(
    id,
    messageId,
    sessionId,
    t,
    JSON.stringify(data)
  );
}

function fetchRows(db: InstanceType<typeof Database>, sessionId: string): { mdata: string; pdata: string }[] {
  return db
    .prepare(
      `SELECT m.data as mdata, p.data as pdata FROM part p JOIN message m ON p.message_id = m.id WHERE p.session_id = ? ORDER BY p.time_created ASC`
    )
    .all(sessionId) as { mdata: string; pdata: string }[];
}

const SID = 'ses_test1';

/** Seed a representative session: a user prompt, an apply_patch, a read, a
 *  todowrite, and a final assistant text reply. */
function seedRepresentativeSession(db: InstanceType<typeof Database>): void {
  db.prepare(
    `INSERT INTO session (id, project_id, directory, title, model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated)
     VALUES (?, 'proj1', '/repo', 'Fix the bug', ?, 0.42, 1000, 500, 20, 300, 50, 1, 10)`
  ).run(SID, JSON.stringify({ id: 'gpt-5.6-sol', providerID: 'aisuite', variant: 'default' }));

  insertMessage(db, 'msg1', SID, 1, 'user');
  insertPart(db, 'p1', 'msg1', SID, 1, { type: 'text', text: 'Please fix the bug in server.ts' });

  insertMessage(db, 'msg2', SID, 2, 'assistant');
  insertPart(db, 'p2', 'msg2', SID, 2, {
    type: 'tool',
    tool: 'apply_patch',
    state: {
      metadata: {
        files: [{ relativePath: 'services/api/src/server.ts', type: 'update' }]
      }
    }
  });
  insertPart(db, 'p3', 'msg2', SID, 3, {
    type: 'tool',
    tool: 'read',
    state: { input: { filePath: '/repo/README.md' } }
  });
  insertPart(db, 'p4', 'msg2', SID, 4, {
    type: 'tool',
    tool: 'todowrite',
    state: {
      input: {
        todos: [
          { content: 'Fix the bug', status: 'completed' },
          { content: 'Write a test', status: 'in_progress' },
          { content: 'Ship it', status: 'pending' }
        ]
      }
    }
  });
  insertPart(db, 'p5', 'msg2', SID, 5, { type: 'text', text: 'Fixed the bug and added a test.' });
}

describe('extractLastAssistantTextOpenCode', () => {
  it('returns the last assistant text part', () => {
    const db = makeDb();
    seedRepresentativeSession(db);
    const rows = fetchRows(db, SID);
    db.close();
    expect(extractLastAssistantTextOpenCode(rows)).toBe('Fixed the bug and added a test.');
  });

  it('returns "" when there is no assistant text', () => {
    const rows = [{ mdata: JSON.stringify({ role: 'user' }), pdata: JSON.stringify({ type: 'text', text: 'hi' }) }];
    expect(extractLastAssistantTextOpenCode(rows)).toBe('');
  });

  it('keeps only the tail when longer than maxChars', () => {
    const long = 'x'.repeat(50) + 'TAIL';
    const rows = [
      { mdata: JSON.stringify({ role: 'assistant' }), pdata: JSON.stringify({ type: 'text', text: long }) }
    ];
    expect(extractLastAssistantTextOpenCode(rows, 4).endsWith('TAIL')).toBe(true);
  });
});

describe('buildSessionDigestOpenCode', () => {
  it('tags user prompts, assistant prose, and dedups tool runs', () => {
    const db = makeDb();
    seedRepresentativeSession(db);
    const rows = fetchRows(db, SID);
    db.close();
    const digest = buildSessionDigestOpenCode(rows);
    expect(digest).toContain('User: Please fix the bug in server.ts');
    expect(digest).toContain('Assistant ran: apply_patch, read, todowrite');
    expect(digest).toContain('Assistant: Fixed the bug and added a test.');
  });
});

describe('buildSessionStatsOpenCode', () => {
  const sessionRow = {
    model: JSON.stringify({ id: 'gpt-5.6-sol', providerID: 'aisuite', variant: 'default' }),
    cost: 0.42,
    tokens_input: 1000,
    tokens_output: 500,
    tokens_reasoning: 20,
    tokens_cache_read: 300,
    tokens_cache_write: 50
  };
  const rows = [
    {
      mdata: JSON.stringify({ role: 'assistant' }),
      pdata: JSON.stringify({
        type: 'tool',
        tool: 'apply_patch',
        state: { metadata: { files: [{ relativePath: 'services/api/src/server.ts', type: 'update' }] } }
      })
    },
    {
      mdata: JSON.stringify({ role: 'assistant' }),
      pdata: JSON.stringify({ type: 'tool', tool: 'read', state: { input: { filePath: '/repo/README.md' } } })
    },
    {
      mdata: JSON.stringify({ role: 'assistant' }),
      pdata: JSON.stringify({
        type: 'tool',
        tool: 'todowrite',
        state: { input: { todos: [{ content: 'Ship it', status: 'pending' }] } }
      })
    }
  ];

  it('reads the model id out of the JSON blob', () => {
    expect(buildSessionStatsOpenCode(sessionRow, rows).model).toBe('gpt-5.6-sol');
  });

  it('uses session.cost when present', () => {
    expect(buildSessionStatsOpenCode(sessionRow, rows).costUsd).toBe(0.42);
  });

  it('falls back to a model-rate estimate when cost is 0', () => {
    const zero = { ...sessionRow, cost: 0 };
    const stats = buildSessionStatsOpenCode(zero, rows);
    expect(stats.costUsd).toBeGreaterThan(0);
  });

  it('sums tokens into input/output/cacheRead/cacheWrite buckets', () => {
    const tokens = buildSessionStatsOpenCode(sessionRow, rows).tokens;
    expect(tokens).toEqual({ input: 1000, output: 520, cacheRead: 300, cacheWrite: 50 });
  });

  it('leaves contextTokens undefined (no OpenCode analogue)', () => {
    expect(buildSessionStatsOpenCode(sessionRow, rows).contextTokens).toBeUndefined();
  });

  it('extracts apply_patch and read as file touches, most-recent-first', () => {
    const files = buildSessionStatsOpenCode(sessionRow, rows).files;
    expect(files).toEqual([
      { path: '/repo/README.md', op: 'R' },
      { path: 'services/api/src/server.ts', op: 'W' }
    ]);
  });

  it('maps apply_patch "add" to C and other types to W', () => {
    const addRows = [
      {
        mdata: JSON.stringify({ role: 'assistant' }),
        pdata: JSON.stringify({
          type: 'tool',
          tool: 'apply_patch',
          state: { metadata: { files: [{ relativePath: 'new.ts', type: 'add' }] } }
        })
      }
    ];
    expect(buildSessionStatsOpenCode(undefined, addRows).files).toEqual([{ path: 'new.ts', op: 'C' }]);
  });

  it('reads write/edit tool parts by filePath', () => {
    const rows2 = [
      {
        mdata: JSON.stringify({ role: 'assistant' }),
        pdata: JSON.stringify({ type: 'tool', tool: 'write', state: { input: { filePath: '/repo/a.ts' } } })
      },
      {
        mdata: JSON.stringify({ role: 'assistant' }),
        pdata: JSON.stringify({ type: 'tool', tool: 'edit', state: { input: { filePath: '/repo/b.ts' } } })
      }
    ];
    expect(buildSessionStatsOpenCode(undefined, rows2).files).toEqual([
      { path: '/repo/b.ts', op: 'W' },
      { path: '/repo/a.ts', op: 'C' }
    ]);
  });

  it('takes the latest todowrite as the queue', () => {
    expect(buildSessionStatsOpenCode(sessionRow, rows).queue).toEqual([{ text: 'Ship it', status: 'pending' }]);
  });

  it('degrades to empty files/queue and no tokens when session/rows are empty', () => {
    const stats = buildSessionStatsOpenCode(undefined, []);
    expect(stats).toEqual({
      model: undefined,
      contextTokens: undefined,
      costUsd: undefined,
      tokens: undefined,
      files: [],
      queue: []
    });
  });

  it('ignores malformed JSON blobs without throwing', () => {
    const garbage = [{ mdata: 'not json', pdata: 'also not json' }];
    expect(() => buildSessionStatsOpenCode(sessionRow, garbage)).not.toThrow();
    expect(buildSessionStatsOpenCode(sessionRow, garbage).files).toEqual([]);
  });
});

describe('openCodeDbPath', () => {
  it('honors XDG_DATA_HOME when set', () => {
    const prev = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = '/custom/data';
    try {
      expect(openCodeDbPath()).toBe('/custom/data/opencode/opencode.db');
    } finally {
      if (prev === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = prev;
    }
  });

  it('falls back to ~/.local/share when unset', () => {
    const prev = process.env.XDG_DATA_HOME;
    delete process.env.XDG_DATA_HOME;
    try {
      expect(openCodeDbPath()).toContain('.local/share/opencode/opencode.db');
    } finally {
      if (prev !== undefined) process.env.XDG_DATA_HOME = prev;
    }
  });
});

describe('async readers — never throw', () => {
  it('returns "" / null for a missing db rather than throwing', async () => {
    const missing = '/tmp/zcc-does-not-exist-opencode.db';
    expect(await readLastAssistantTextOpenCode('anything', { dbPath: missing })).toBe('');
    expect(await readSessionDigestOpenCode('anything', { dbPath: missing })).toBe('');
    expect(await readSessionStatsOpenCode('anything', { dbPath: missing })).toBeNull();
  });

  it('reads through a real file-backed db end to end', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'zcc-opencode-')), 'opencode.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, directory TEXT, title TEXT, model TEXT, cost REAL, tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    `);
    seedRepresentativeSession(db);
    db.close();

    const text = await readLastAssistantTextOpenCode(SID, { dbPath });
    expect(text).toBe('Fixed the bug and added a test.');
    const digest = await readSessionDigestOpenCode(SID, { dbPath });
    expect(digest).toContain('Assistant ran: apply_patch, read, todowrite');
    const stats = await readSessionStatsOpenCode(SID, { dbPath });
    expect(stats?.model).toBe('gpt-5.6-sol');
    expect(stats?.costUsd).toBe(0.42);

    expect(await readSessionStatsOpenCode('no-such-session', { dbPath })).toEqual({
      model: undefined,
      contextTokens: undefined,
      costUsd: undefined,
      tokens: undefined,
      files: [],
      queue: []
    });

    rmSync(dirname(dbPath), { recursive: true, force: true });
  });
});
