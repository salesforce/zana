/**
 * Built-Electron: Close with follow-up with "Wrap up before closing" on (#537).
 *
 * A stub Claude CLI runs the REAL `UserPromptSubmit` and `Stop` hook commands main
 * injected into its `--settings`, as Claude Code does, and writes a transcript the
 * app reads. The wrap-up instructions must reach the PTY as ONE typed line, the
 * agent must close only after its turn ended, and the inbox must hold a record made
 * from the whole session. When the summary says the agent asks the user something,
 * the agent stays open and its tab reads Needs you.
 *
 * The stub ends its turn with `Stop`, not `StopFailure` (that is the API-error path).
 *
 * The third test closes a conversation thread (fake provider) the same way: the thread
 * is asked to wrap up in the background, archived when its turn ends, and the inbox
 * holds the record. The summary call is served by the same stub through `claudeBinary`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

const CLAUDE_STUB = String.raw`
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.296 (Claude Code)'); process.exit(0); }
if (args.includes('--print')) {
  const at = args.indexOf('--system-prompt');
  if (at >= 0 && args[at + 1].includes('Asks the user')) {
    const asks = fs.existsSync(join(__dirname, 'asks.flag')) ? 'yes' : 'no';
    console.log(['**Goal** — Probe goal.', '', '**What it did**', '- Did the probe work.', '', '**Left / next**', '- Check the probe result.', '', 'Unfinished: yes', 'Asks the user: ' + asks].join('\n'));
  } else console.log('Probe');
  process.exit(0);
}
const sid = args[args.indexOf('--session-id') + 1];
const at = args.indexOf('--settings');
const hooks = (at >= 0 ? JSON.parse(args[at + 1]) : { hooks: {} }).hooks || {};
const commands = (event) => (hooks[event] || []).flatMap((entry) => (entry.hooks || []).map((hook) => hook.command));
const run = (event, input) => commands(event).forEach((command) =>
  spawnSync('/bin/sh', ['-c', command], { input, env: process.env, timeout: 15000, encoding: 'utf8' }));
const idle = () => process.stdout.write('\x1b]0;✳ Claude Code\x07');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const writeTranscript = () => {
  const dir = join(os.homedir(), '.claude', 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const user = { type: 'user', message: { role: 'user', content: 'Do the probe work' } };
  const assistant = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'I did the probe work and wrapped up.' }] } };
  fs.writeFileSync(join(dir, sid + '.jsonl'), JSON.stringify(user) + '\n' + JSON.stringify(assistant) + '\n');
};
writeTranscript();
console.log('Claude wrap-up probe ready');
idle();
createInterface({ input: process.stdin }).on('line', (raw) => {
  // Drop bracketed-paste markers and terminal replies: on a slow host, tmux's late device-attributes
  // reply (\x1b[>0;276;0c, sometimes only "0;276;0c") leaks into the pane ahead of the typed text.
  const line = raw
    .replace(/\x1b\[20[01]~/g, '')
    .replace(/\x1b\[[?>]?[0-9;]*c/g, '')
    .replace(/^(?:[0-9]+(?:;[0-9]+)+c)+/, '')
    .trim();
  if (!line) return;
  fs.appendFileSync(join(__dirname, 'typed.log'), line + '\n');
  if (line.includes('Wrap up this session')) {
    run('UserPromptSubmit', JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: line }));
    // Normally long enough for the 250 ms status debounce to emit "working". With fast.flag the turn ends
    // at once, inside one debounce, so "working" is never emitted and only the turn hooks show it ran.
    if (!fs.existsSync(join(__dirname, 'fast.flag'))) sleep(1500);
    run('Stop', JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: false }));
  }
  idle();
});
`;

// The stub's OSC title replaces the title the spec passes at create time.
const TITLE = 'Claude Code';

async function launchStub(home: string) {
  const stubDir = mkdtempSync(join(tmpdir(), 'zcc-wrap-up-'));
  writeFileSync(join(stubDir, 'claude-stub.cjs'), `#!${process.execPath}\n${CLAUDE_STUB}`, { mode: 0o700 });
  const app = await launchApp(home, {
    e2e: true,
    initialConfig: {
      sponsorPromptDismissed: true,
      claudeBinary: join(stubDir, 'claude-stub.cjs'),
      closeWrapUpEnabled: true,
      autoRenameTabs: false
    }
  });
  const typed = () => {
    const file = join(stubDir, 'typed.log');
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  };
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-wrap-up-project-')));
  mkdirSync(projectDir, { recursive: true });
  const win = app.window;
  const projectId = await win.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id as string;
  }, projectDir);
  const sessionId = await win.evaluate(async (projectId) => {
    const result = await window.cc.terminals.create({ projectId, profile: 'claude', cols: 100, rows: 32, title: 'Wrap Up Probe' });
    const session = result && 'ok' in result ? result.value : result;
    if (!session?.id) throw new Error(JSON.stringify(result));
    return session.id as string;
  }, projectId);
  const state = () => win.evaluate(async (id) => {
    const pairs = (await window.cc.terminals.agentStatusSnapshot()) as Array<[string, string]>;
    return pairs.find(([sid]) => sid === id)?.[1];
  }, sessionId);
  const live = () => win.evaluate(async ({ pid, sid }) => {
    const sessions = (await window.cc.terminals.list(pid)) as Array<{ id: string; status?: string }>;
    return sessions.some((s) => s.id === sid && s.status !== 'exited');
  }, { pid: projectId, sid: sessionId });
  const inbox = (sid: string) => win.evaluate(async ({ pid, sid }) => {
    const { entries } = await window.cc.inbox.history({ projectId: pid, limit: 50 });
    return entries.filter((e) => e.sessionId === sid).map((e) => e.comments ?? '');
  }, { pid: projectId, sid });
  const cleanup = async () => {
    await closeApp(app.electron);
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  };
  return { app, win, stubDir, typed, sessionId, projectId, state, live, inbox, cleanup };
}

/** Open the agent in the Agents list and click Close with follow-up, answering the confirm. */
async function clickClose(win: Page): Promise<() => string> {
  const openList = async () => {
    await win.locator('[data-testid="nav-agents"]').click();
    await win.getByLabel('List view').click({ timeout: 10_000 });
    await expect(win.locator('.agent-monitor-list')).toBeVisible({ timeout: 15_000 });
  };
  const card = win.locator('.agent-monitor-list').getByText(TITLE).first();
  // A renderer that started before the spec created the session can miss it ("No agents"); a reload
  // re-reads the session list, the same way agents-list-view.spec.ts does before it navigates.
  const listed = await openList()
    .then(() => card.waitFor({ state: 'visible', timeout: 10_000 }))
    .then(() => true, () => false);
  if (!listed) {
    await win.reload();
    await openList();
  }
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();
  const closeButton = win.getByRole('button', { name: 'Close with follow-up' });
  await expect(closeButton).toBeVisible({ timeout: 15_000 });
  let message = '';
  win.once('dialog', (dialog) => { message = dialog.message(); void dialog.accept(); });
  await closeButton.click();
  return () => message;
}

test('Close with follow-up wraps the agent up, then closes it with a full record', async ({ home }, testInfo) => {
  test.setTimeout(150_000);
  const stub = await launchStub(home);
  const { win } = stub;
  try {
    await expect.poll(stub.state, { timeout: 20_000 }).toBe('idle');
    const confirmText = await clickClose(win);
    expect(confirmText()).toContain('The agent first saves what it learnt and tidies up');
    await expect(win.getByRole('button', { name: 'Wrapping up…' })).toBeVisible({ timeout: 8_000 });
    await captureElectronScreenshot(stub.app.electron, win, testInfo.outputPath('wrap-up-busy.png'));
    await testInfo.attach('wrap-up-busy', { path: testInfo.outputPath('wrap-up-busy.png'), contentType: 'image/png' });

    await expect.poll(stub.live, { timeout: 60_000, message: 'the agent was not closed' }).toBe(false);

    const typed = stub.typed();
    expect(typed).toHaveLength(1);
    expect(typed[0]).toMatch(/^Wrap up this session; it will be closed when you finish\. 1\. Summarise:/);

    await expect.poll(async () => (await stub.inbox(stub.sessionId)).join('\n'), { timeout: 20_000 })
      .toContain('Closed after it wrapped up.');
    expect((await stub.inbox(stub.sessionId)).join('\n')).toContain('Probe goal');
    const followUps = await win.evaluate(() => window.cc.followups.list());
    expect(followUps.some((f) => f.title === 'Check the probe result.')).toBe(true);
  } finally {
    await stub.cleanup();
  }
});

test('a wrap-up turn too quick for the status to show working still closes, through the turn hooks', async ({ home }) => {
  test.setTimeout(150_000);
  const stub = await launchStub(home);
  const { win } = stub;
  try {
    writeFileSync(join(stub.stubDir, 'fast.flag'), '1');
    await expect.poll(stub.state, { timeout: 20_000 }).toBe('idle');
    await clickClose(win);
    await expect.poll(stub.live, { timeout: 60_000, message: 'the fast wrap-up turn never finished' }).toBe(false);
    expect(stub.typed()).toHaveLength(1);
    await expect.poll(async () => (await stub.inbox(stub.sessionId)).join('\n'), { timeout: 20_000 })
      .toContain('Closed after it wrapped up.');
  } finally {
    await stub.cleanup();
  }
});

test('an agent that asks the user something stays open and reads Needs you', async ({ home }) => {
  test.setTimeout(150_000);
  const stub = await launchStub(home);
  const { win } = stub;
  try {
    writeFileSync(join(stub.stubDir, 'asks.flag'), '1');
    await expect.poll(stub.state, { timeout: 20_000 }).toBe('idle');
    await clickClose(win);

    await expect
      .poll(async () => (await stub.inbox(stub.sessionId)).join('\n'), { timeout: 60_000 })
      .toContain('Still open: it asked you something while wrapping up.');
    await expect(win.locator('.toast').filter({ hasText: /Kept 1 agent open/ })).toBeVisible({ timeout: 10_000 });
    await expect.poll(stub.state, { timeout: 10_000 }).toBe('blocked');
    expect(await stub.live()).toBe(true);
    expect(stub.typed()).toHaveLength(1);
  } finally {
    await stub.cleanup();
  }
});

test('Close with follow-up wraps a thread up in the background, then archives it with a full record', async ({ home }) => {
  test.setTimeout(150_000);
  const stubDir = mkdtempSync(join(tmpdir(), 'zcc-wrap-up-thread-'));
  writeFileSync(join(stubDir, 'claude-stub.cjs'), `#!${process.execPath}\n${CLAUDE_STUB}`, { mode: 0o700 });
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-wrap-up-thread-project-')));
  execFileSync('git', ['init', '--quiet'], { cwd: projectDir });
  writeFileSync(join(projectDir, 'README.md'), 'Wrap-up thread fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: projectDir });
  execFileSync('git', ['-c', 'user.name=Wrap Up E2E', '-c', 'user.email=wrap-up@example.test', 'commit', '--quiet', '-m', 'Initial'], { cwd: projectDir });
  const app = await launchApp(home, {
    e2e: true,
    env: { ZCC_FAKE_PROVIDER: '1' },
    initialConfig: { sponsorPromptDismissed: true, claudeBinary: join(stubDir, 'claude-stub.cjs'), closeWrapUpEnabled: true }
  });
  const win = app.window;
  try {
    const { projectId, threadId } = await win.evaluate(async (path) => {
      const project = await window.cc.projects.add(path);
      if (!project.ok) throw new Error(project.message);
      const response = await fetch('/api/v1/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Check the wrap-up thread' })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(body));
      return { projectId: project.value.id as string, threadId: (body.thread ?? body.value).id as string };
    }, projectDir);
    const thread = () => win.evaluate(async (id) => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread as { status: string; archivedAt?: number | null; title?: string }, threadId);
    await expect.poll(async () => (await thread()).status, { timeout: 30_000 }).toBe('idle');
    await win.evaluate((id) => {
      window.history.pushState({}, '', `/threads/${id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, threadId);
    await win.getByTestId('thread-overflow-trigger').click();
    let confirmText = '';
    win.once('dialog', (dialog) => { confirmText = dialog.message(); void dialog.accept(); });
    await win.getByRole('menuitem', { name: 'Close with follow-up' }).click();
    expect(confirmText).toContain('The agent first saves what it learnt and tidies up');
    await expect(win.locator('.toast').filter({ hasText: /Wrapping up… “.+” closes when it finishes\./ })).toBeVisible({ timeout: 10_000 });

    await expect.poll(async () => (await thread()).archivedAt ?? null, { timeout: 90_000, message: 'the thread was not archived' }).not.toBeNull();
    const entries = await win.evaluate(async ({ pid, tid }) => {
      const { entries } = await window.cc.inbox.history({ projectId: pid, limit: 50 });
      return entries.filter((e) => e.sessionId === tid).map((e) => e.comments ?? '');
    }, { pid: projectId, tid: threadId });
    expect(entries.join('\n')).toContain('Closed after it wrapped up.');
    expect(entries.join('\n')).toContain('Probe goal');
  } finally {
    await closeApp(app.electron);
    rmSync(stubDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
