import { test, expect, launchApp } from './fixtures/app';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function python(script: string, args: string[]): void {
  execFileSync('python3', ['-c', script, ...args]);
}

test('OpenCode session stats cross main IPC into the renderer', async () => {
  const home = mkdtempSync(join(tmpdir(), 'zcc-opencode-stats-'));
  const dataHome = join(home, '.local', 'share');
  const dbDir = join(dataHome, 'opencode');
  const projectDir = join(home, 'project');
  mkdirSync(dbDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  const binary = join(home, 'fake-opencode');
  writeFileSync(binary, `#!/bin/sh
if [ "$1" = "export" ]; then
  printf '%s' '{"info":{"model":{"id":"gpt-5.6-terra"},"version":"1.18.10","agent":"build","cost":0,"tokens":{"input":100,"output":20,"reasoning":5,"cache":{"read":300,"write":0}}},"messages":[]}'
  exit 0
fi
if [ "$1" = "session" ]; then
  printf '%s' '[{"id":"ses_e2e","created":'"$(($(date +%s) * 1000))"',"directory":"${projectDir}"}]'
  exit 0
fi
sleep 60
`);
  chmodSync(binary, 0o755);

  const dbPath = join(dbDir, 'opencode.db');
  python("import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.executescript('CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, version TEXT, agent TEXT, model TEXT, cost REAL, tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER, tokens_cache_read INTEGER, tokens_cache_write INTEGER, time_created INTEGER, time_updated INTEGER); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT); CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);'); db.close()", [dbPath]);

  const app = await launchApp(home, { e2e: true });
  let sessionId: string | null = null;
  try {
    const { window } = app;
    const projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      return (result && 'ok' in result ? result.value : result).id;
    }, projectDir);
    await window.evaluate((path) => window.cc.config.set({ opencodeBinary: path }), binary);
    sessionId = await window.evaluate(async (pid) => {
      const result = await window.cc.terminals.create({ projectId: pid, profile: 'opencode' });
      return (result && 'ok' in result ? result.value : result).id;
    }, projectId);

    const now = String(Date.now());
    python("import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', sys.argv[2:]); db.commit(); db.close()", [dbPath, 'ses_e2e', projectDir, '1.18.10', 'build', JSON.stringify({ id: 'gpt-5.6-terra', providerID: 'aisuite' }), '0', '100', '20', '5', '300', '0', now, now]);

    await expect.poll(() => window.evaluate(
      ({ pid, sid }) => window.cc.terminals.sessionStats(pid, sid),
      { pid: projectId, sid: sessionId! }
    )).toMatchObject({
      model: 'gpt-5.6-terra',
      harnessVersion: '1.18.10',
      agent: 'build',
      tokens: { input: 100, output: 25, cacheRead: 300, cacheWrite: 0 }
    });
  } finally {
    if (sessionId) {
      await app.window.evaluate((sid) => window.cc.terminals.close(sid).catch(() => {}), sessionId);
    }
    await app.electron.close().catch(() => {});
    rmSync(home, { recursive: true, force: true });
  }
});
