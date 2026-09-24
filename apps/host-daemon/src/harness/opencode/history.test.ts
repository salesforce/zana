import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '@zana-ai/zcc-db';
import { listOpenCodeHistory, readOpenCodeHistory } from './history.js';

let home: string; let project: string;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'opencode-history-')); project = join(home, 'project'); await mkdir(project); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });
async function seed(text = 'Saved answer', count = 1) {
  const dir = join(home, '.local/share/opencode'); await mkdir(dir, { recursive: true });
  const db = createSqliteDatabase(join(dir, 'opencode.db'));
  db.exec('CREATE TABLE session (id TEXT, directory TEXT, parent_id TEXT, title TEXT, time_created INTEGER, time_updated INTEGER); CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT); CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT)');
  const insert = db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, 1, 2)');
  insert.run('ses_saved', project, null, 'Saved session'); insert.run('ses_child', project, 'ses_saved', 'Child'); insert.run('ses_other', home, null, 'Other project');
  for (let i = 0; i < count; i++) {
    db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(`m${i}`, 'ses_saved', i, JSON.stringify({ role: i ? 'user' : 'assistant' }));
    db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?)').run(`p${i}`, `m${i}`, 'ses_saved', i, JSON.stringify({ type: 'text', text }));
  }
  db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?)').run('tool', 'm0', 'ses_saved', 1, JSON.stringify({ type: 'tool', text: 'not a message' }));
  db.close();
}

it('reads native SQLite history without exposing subagents, another project, or tools', async () => {
  await seed();
  expect(await listOpenCodeHistory(home, project, 40)).toEqual([{ id: 'ses_saved', title: 'Saved session', startedAt: 1, lastActiveAt: 2 }]);
  expect(await readOpenCodeHistory(home, project, 'ses_saved')).toEqual({ messages: [{ role: 'assistant', text: 'Saved answer' }], truncated: false });
  expect((await readOpenCodeHistory(home, project, 'ses_other')).unavailableReason).toBeTruthy();
  expect((await readOpenCodeHistory(home, project, 'ses_child')).unavailableReason).toBeTruthy();
});

it('handles absent stores and missing projects honestly', async () => {
  expect(await listOpenCodeHistory(home, project, 40)).toEqual([]);
  expect((await readOpenCodeHistory(home, project, 'missing')).unavailableReason).toBeTruthy();
  await expect(listOpenCodeHistory(home, join(home, 'missing'), 40)).rejects.toThrow();
});

it('caps individual message size and total preview size', async () => {
  await seed('x'.repeat(70_000), 20);
  const preview = await readOpenCodeHistory(home, project, 'ses_saved');
  expect(preview.truncated).toBe(true); expect(preview.messages).toHaveLength(15);
  expect(preview.messages[0].text).toHaveLength(64_000);
});

it('caps message count and skips empty text', async () => {
  await seed('', 501);
  expect(await readOpenCodeHistory(home, project, 'ses_saved')).toEqual({ messages: [], truncated: true });
});
