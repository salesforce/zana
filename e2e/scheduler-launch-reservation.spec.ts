import { test, expect } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { callControlPlane } from '../packages/cli/src/lib/control-client.js';

test('a packaged schedule preserves its durable reservation through worker launch, edits and exit', async ({ app }) => {
  const root = join(app.home, 'schedule-reservation-project'); mkdirSync(root);
  const agent = makeFakeAgentBinary({ script: `
if [ "$1" = "--version" ]; then echo '2.1.220 (Claude Code)'; exit 0; fi
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const dir = '.zcc/schedules';
const task = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(name => name.endsWith('.json'))), 'utf8'));
const run = task.status.runs[0];
fs.appendFileSync('schedule-starts.jsonl', JSON.stringify({ cwd: process.cwd(), state: run.launchState, reserved: run.sessionId, actual: process.env.ZCC_SESSION_ID }) + '\\n');
NODE
cat
` });
  let taskId: string | undefined, sessionId: string | undefined;
  try {
    await app.window.evaluate(binary => window.cc.config.set({ claudeBinary: binary, defaultHarness: 'claude' }), agent.path);
    const project = await app.window.evaluate(path => window.cc.projects.add(path), root);
    expect(project.ok).toBe(true); if (!project.ok) throw new Error('Project registration failed');
    const created = await app.window.evaluate(projectId => window.cc.scheduler.create({ projectId, scope: { projectId }, name: 'Reserved schedule', every: '5m', profile: 'claude', enabled: false }), project.value.id);
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true }); if (!created.ok) throw new Error(created.message);
    taskId = created.value.id;
    expect(await app.window.evaluate(id => window.cc.scheduler.runNow(id), taskId)).toMatchObject({ ok: true });
    const path = join(root, '.zcc/schedules', `${taskId}.json`);
    const task = () => JSON.parse(readFileSync(path, 'utf8'));
    await expect.poll(() => task().status.runs[0]?.launchState).toBe('running');
    sessionId = task().status.runs[0].sessionId;
    const marker = join(root, 'schedule-starts.jsonl'); await expect.poll(() => existsSync(marker)).toBe(true);
    const starts = () => readFileSync(marker, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(starts()).toEqual([{ cwd: realpathSync(root), state: expect.stringMatching(/^(pending|running)$/), reserved: sessionId, actual: sessionId }]);
    // External definition edit inside the scheduler's write-suppression window.
    writeFileSync(path, JSON.stringify({ ...task(), prompt: 'External prompt', extraArgs: ['--effort', 'high'] }));
    const control = (op: string, args: Record<string, unknown>) => callControlPlane({ dataDir: join(app.home, '.zcc'), op, args, callerSessionId: '', callerCredential: '' });
    expect(await control('sched.reload', { id: taskId })).toMatchObject({ ok: true, value: { reloaded: false, reason: expect.stringContaining(sessionId!) } });

    const idleRoot = join(app.home, 'schedule-idle-project'); mkdirSync(idleRoot);
    const idleProject = await app.window.evaluate(path => window.cc.projects.add(path), idleRoot);
    if (!idleProject.ok) throw new Error(idleProject.message);
    const idle = await app.window.evaluate(projectId => window.cc.scheduler.create({ projectId, scope: { projectId }, name: 'Idle schedule', every: '5m', profile: 'claude', enabled: false }), idleProject.value.id);
    if (!idle.ok) throw new Error(idle.message);
    const idlePath = join(idleRoot, '.zcc/schedules', `${idle.value.id}.json`);
    const idleDisk = JSON.parse(readFileSync(idlePath, 'utf8'));
    writeFileSync(idlePath, JSON.stringify({ ...idleDisk, prompt: 'Other project edit' }));
    // An unrelated live scheduled session must not prevent a watcher refresh.
    await expect.poll(async () => {
      const result = await app.window.evaluate(id => window.cc.scheduler.get(id), idle.value.id);
      return result.ok ? result.value.prompt : result.message;
    }).toBe('Other project edit');
    expect(await control('sched.reload', { id: idle.value.id })).toMatchObject({ ok: true, value: { reloaded: true } });
    expect(await app.window.evaluate(id => window.cc.scheduler.reload(id), idle.value.id)).toMatchObject({ ok: true, value: { reloaded: true } });
    for (const method of ['get', 'reload'] as const) {
      expect(await app.window.evaluate(method => window.cc.scheduler[method](''), method)).toMatchObject({ ok: false, code: 'BAD_INPUT' });
      expect(await app.window.evaluate(method => window.cc.scheduler[method]('claude-loop:external'), method)).toMatchObject({ ok: false, code: 'READ_ONLY' });
      expect(await app.window.evaluate(method => window.cc.scheduler[method]('missing'), method)).toMatchObject({ ok: false, code: 'SCHEDULE_FAILED' });
    }

    expect(await control('sched.update', { id: taskId, patch: { every: '1h' } })).toMatchObject({ ok: true, value: { prompt: 'External prompt', extraArgs: ['--effort', 'high'], schedule: { every: '1h' } } });
    expect(await control('sched.get', { id: taskId })).toMatchObject({ ok: true, value: { prompt: 'External prompt', updatedAt: expect.any(String) } });
    expect(await control('sched.update', { id: taskId, patch: { status: { runCount: 0 } } })).toMatchObject({ ok: false, code: 'BAD_ARGS' });
    expect(await app.window.evaluate(id => window.cc.scheduler.update(id, { name: 'Edited while running' }), taskId)).toMatchObject({ ok: true });
    // Toggle and exit status writes must preserve a second edit without a timestamp bump.
    writeFileSync(path, JSON.stringify({ ...task(), prompt: 'Final disk prompt', extraArgs: ['--effort', 'medium'] }));
    expect(await app.window.evaluate(id => window.cc.scheduler.setEnabled(id, false), taskId)).toMatchObject({ ok: true });

    expect(task().status.runCount).toBe(1);
    await app.window.evaluate(id => window.cc.terminals.close(id), sessionId!);
    await expect.poll(() => task().status.runs[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(task()).toMatchObject({ name: 'Edited while running', prompt: 'Final disk prompt', extraArgs: ['--effort', 'medium'], schedule: { every: '1h' } }); expect(starts()).toHaveLength(1);
  } finally {
    if (taskId) await app.window.evaluate(id => window.cc.scheduler.setEnabled(id, false), taskId).catch(() => {});
    if (sessionId) await app.window.evaluate(id => window.cc.terminals.close(id), sessionId).catch(() => {});
    agent.cleanup();
  }
});
