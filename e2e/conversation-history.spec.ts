import { mkdirSync, realpathSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import { encodeProjectCwd } from '../packages/domain/src/path-encoding.js';
import { test, expect, launchApp } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true, initialConfig: { injectBundledSkills: false } });

test('History reads archived threads and restores the same conversation in built Electron', async ({ app }, testInfo) => {
  test.setTimeout(180_000);
  const { window, home } = app;
  let stderr = '';
  app.electron.process()?.stderr?.on('data', (data) => { stderr = (stderr + String(data)).slice(-64000); });
  mkdirSync(join(home, 'history-project'));
  const root = realpathSync(join(home, 'history-project'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  const thread = await window.evaluate(async (root) => {
    const project = await window.cc.projects.add(root);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', title: 'History regression', input: 'Remember the orange bird' }) });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread ?? body.value;
  }, root);
  try {
    await expect.poll(() => window.evaluate(async (id) => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, thread.id), { timeout: 30_000 }).toBe('idle');
  } catch (error) {
    const details = await window.evaluate(async (id) => ({ thread: await (await fetch(`/api/v1/threads/${id}`)).json(), events: await (await fetch(`/api/v1/threads/${id}/events`)).json() }), thread.id);
    await testInfo.attach('thread-diagnostics', { body: JSON.stringify({ ...details, stderr }), contentType: 'application/json' });
    throw error;
  }
  await window.evaluate(async (id) => {
    const response = await fetch(`/api/v1/threads/${id}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error(await response.text());
  }, thread.id);
  await window.getByTestId('nav-conversation-history').click();
  let dialog = window.getByRole('dialog', { name: 'Conversation history' });
  await dialog.getByLabel('Search conversation history').fill('orange bird');
  const row = dialog.locator('.history-row').filter({ hasText: 'History regression' });
  await expect(row).toContainText('Archived');
  await expect(row.getByTitle('Harness: Fake', { exact: true })).toBeVisible();
  await expect(row.getByTitle('Project: history-project', { exact: true })).toBeVisible();
  await row.locator('.history-open').click();
  const preview = dialog.getByRole('region', { name: 'Saved conversation' });
  await expect(preview).toContainText('Remember the orange bird');
  await expect(preview).toContainText('Response to: Remember the orange bird');
  await expect(row.locator('.history-open')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview.getByRole('button', { name: 'Restore conversation' })).toBeVisible();
  const threadLayout = await dialog.locator('.history-workbench').boundingBox();
  const refreshPosition = await dialog.getByRole('button', { name: 'Refresh history' }).boundingBox();
  await testInfo.attach('thread-history-preview', { body: await window.screenshot(), contentType: 'image/png' });
  await dialog.getByRole('button', { name: 'CLI Agents', exact: true }).click();
  await expect(preview).toContainText('Select a conversation');
  const cliLayout = await dialog.locator('.history-workbench').boundingBox();
  const cliRefreshPosition = await dialog.getByRole('button', { name: 'Refresh history' }).boundingBox();
  expect(cliLayout!.width).toBeCloseTo(threadLayout!.width, 0);
  expect(cliLayout!.height).toBeCloseTo(threadLayout!.height, 0);
  expect(cliLayout!.y).toBeCloseTo(threadLayout!.y, 0);
  expect(cliRefreshPosition!.x).toBeCloseTo(refreshPosition!.x, 0);
  await dialog.getByRole('button', { name: 'Threads', exact: true }).click();
  await row.locator('.history-open').click();
  await expect(preview).toContainText('Remember the orange bird');
  await preview.getByRole('button', { name: 'Open conversation' }).click();
  const detail = window.getByTestId('thread-detail');
  await expect(detail).toContainText('Remember the orange bird', { timeout: 30_000 });
  await expect(detail.getByRole('button', { name: 'Restore conversation' })).toBeVisible();
  await expect(detail.locator('.thread-command-composer')).toHaveCount(0);
  await detail.getByRole('button', { name: 'Restore conversation' }).click();
  await expect(detail.getByTestId('thread-command-input')).toBeVisible();
  await detail.getByTestId('thread-command-input').fill('Continue with the orange bird');
  await detail.getByTestId('thread-command-send').click();
  await expect(detail).toContainText('Response to: Continue with the orange bird', { timeout: 30_000 });
  const saved = await window.evaluate(async (id) => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread, thread.id);
  expect(saved.archivedAt).toBeNull(); expect(saved.id).toBe(thread.id);
  await window.evaluate(async (id) => { await fetch(`/api/v1/threads/${id}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); }, thread.id);
  await window.getByTestId('nav-conversation-history').click();
  dialog = window.getByRole('dialog', { name: 'Conversation history' });
  await dialog.getByRole('button', { name: /^History regression/ }).click();
  await expect(dialog.getByRole('region', { name: 'Saved conversation' })).toContainText('Continue with the orange bird');
  await dialog.getByRole('button', { name: 'Restore conversation' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(detail.getByTestId('thread-command-input')).toBeVisible();
});

test('CLI history survives relaunch, previews large native transcripts and resumes its exact ID', async ({ app }, testInfo) => {
  test.setTimeout(180_000);
  const { home } = app;
  mkdirSync(join(home, 'cli-history-project'));
  const root = realpathSync(join(home, 'cli-history-project'));
  const id = '12345678-1234-4234-8234-123456789012';
  const otherId = '12345678-1234-4234-8234-123456789013';
  const nativeDir = join(home, '.codex', 'sessions', '2026', '09', '22');
  mkdirSync(nativeDir, { recursive: true });
  const transcriptPath = join(nativeDir, `rollout-${id}.jsonl`);
  const jsonl = (nativeId: string, cwd: string, title: string) => [
    { type: 'session_meta', payload: { id: nativeId, cwd } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: title }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Saved answer '.repeat(2200) + 'COMPLETE TRANSCRIPT END' }] } }
  ].map((line) => JSON.stringify(line)).join('\n') + '\n';
  writeFileSync(transcriptPath, jsonl(id, root, 'Native history regression'));
  writeFileSync(join(nativeDir, `rollout-${otherId}.jsonl`), jsonl(otherId, realpathSync(home), 'Other project private conversation'));
  const claudeDir = join(home, '.claude/projects', encodeProjectCwd(root)); mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, `${id}.jsonl`), [
    { cwd: root, message: { role: 'user', content: 'Claude saved history' } },
    { message: { role: 'assistant', content: 'Saved Claude answer '.repeat(1500) + 'CLAUDE TRANSCRIPT END' } }
  ].map((line) => JSON.stringify(line)).join('\n') + '\n');
  const openCodeDir = join(home, '.local/share/opencode'); mkdirSync(openCodeDir, { recursive: true });
  const db = createSqliteDatabase(join(openCodeDir, 'opencode.db'));
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, worktree TEXT, sandboxes TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, project_id TEXT, slug TEXT, version TEXT, directory TEXT, parent_id TEXT, title TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE IF NOT EXISTS message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
      CREATE TABLE IF NOT EXISTS part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)`);
    db.prepare('INSERT INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES (?, ?, ?, 1, 2)').run('history-fixture', root, '[]');
    db.prepare('INSERT INTO session (id, project_id, slug, version, directory, title, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, 1, 2)').run('ses_history', 'history-fixture', 'saved-history', '1', root, 'OpenCode saved history');
    db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, 1, 1, ?)').run('m1', 'ses_history', JSON.stringify({ role: 'assistant' }));
    db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, 1, 1, ?)').run('p1', 'm1', 'ses_history', JSON.stringify({ type: 'text', text: 'Saved OpenCode answer '.repeat(1500) + 'OPEN CODE TRANSCRIPT END' }));
  } finally { db.close(); }
  const fakeBin = join(home, 'history-bin'); mkdirSync(fakeBin);
  const argvPath = join(home, 'history-resume-argv.txt');
  const binary = join(fakeBin, 'codex');
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  writeFileSync(binary, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 'codex-cli 1.0.0'; exit 0; fi\nprintf '%s\\n' "$@" > ${quote(argvPath)}\necho 'Exact conversation resumed'\nwhile :; do sleep 1; done\n`, { mode: 0o755 });
  const project = await app.window.evaluate(async ({ root, binary }) => {
    const project = await window.cc.projects.add(root);
    if (!project.ok) throw new Error('Project registration failed');
    await window.cc.config.set({ codexBinary: binary, harnessCodexEnabled: true, tmuxScope: 'off' });
    return project.value;
  }, { root, binary });
  await app.window.getByTestId('nav-conversation-history').click();
  let dialog = app.window.getByRole('dialog', { name: 'Conversation history' });
  await dialog.getByRole('button', { name: 'CLI Agents', exact: true }).click();
  await dialog.getByLabel('History project').selectOption(project.id);
  await dialog.getByRole('button', { name: /^Claude saved history/ }).click({ timeout: 45_000 });
  await expect(dialog.getByLabel('Saved conversation')).toContainText('CLAUDE TRANSCRIPT END');
  await dialog.getByRole('button', { name: /^OpenCode saved history/ }).click({ timeout: 45_000 });
  await expect(dialog.getByLabel('Saved conversation')).toContainText('OPEN CODE TRANSCRIPT END');
  await dialog.getByRole('button', { name: /^Native history regression/ }).click({ timeout: 45_000 });
  await expect(dialog.getByLabel('Saved conversation')).toContainText('COMPLETE TRANSCRIPT END');
  const nativeRow = dialog.getByRole('button', { name: /^Native history regression/ });
  await expect(nativeRow.getByTitle('Harness: Codex', { exact: true })).toBeVisible();
  await expect(nativeRow.locator('.history-harness-icon')).toBeVisible();
  const iconSize = await nativeRow.locator('.history-harness-icon').evaluate((icon) => {
    const style = getComputedStyle(icon);
    return { width: parseFloat(style.width), height: parseFloat(style.height) };
  });
  expect(iconSize.width).toBeCloseTo(14, 1);
  expect(iconSize.height).toBeCloseTo(14, 1);
  await expect(nativeRow.getByText('Harness', { exact: true })).toHaveCount(0);
  await expect(nativeRow.getByText('Project', { exact: true })).toHaveCount(0);
  await expect(nativeRow.getByTitle('Project: cli-history-project', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Saved conversation').getByTitle('Harness: Codex', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Saved conversation').getByTitle('Project: cli-history-project', { exact: true })).toBeVisible();
  const resumeButton = dialog.getByRole('button', { name: 'Resume conversation' });
  const resumePosition = await resumeButton.boundingBox();
  await dialog.getByLabel('Conversation messages', { exact: true }).evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(resumeButton).toBeVisible();
  expect((await resumeButton.boundingBox())!.y).toBeCloseTo(resumePosition!.y, 0);
  await expect(dialog).not.toContainText('Other project private conversation');
  expect(existsSync(argvPath)).toBe(false);
  const screenshot = testInfo.outputPath('conversation-history.png');
  await app.window.screenshot({ path: screenshot });
  await testInfo.attach('conversation-history', { path: screenshot, contentType: 'image/png' });
  await app.electron.close();
  const restarted = await launchApp(home, { initialConfig: { codexBinary: binary, harnessCodexEnabled: true, tmuxScope: 'off' }, env: { ZCC_FAKE_PROVIDER: '1', PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}` } });
  try {
    await restarted.window.getByTestId('nav-conversation-history').click();
    dialog = restarted.window.getByRole('dialog', { name: 'Conversation history' });
    await dialog.getByRole('button', { name: 'CLI Agents', exact: true }).click();
    await dialog.getByLabel('History project').selectOption(project.id);
    await dialog.getByRole('button', { name: /^Native history regression/ }).click({ timeout: 45_000 });
    await expect(dialog.getByLabel('Saved conversation')).toContainText('COMPLETE TRANSCRIPT END');
    await dialog.getByRole('button', { name: 'Resume conversation' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });
    await expect.poll(() => existsSync(argvPath) ? readFileSync(argvPath, 'utf8') : '', { timeout: 30_000 }).toContain(id);
    const argv = readFileSync(argvPath, 'utf8').split('\n');
    expect(argv).toContain('resume'); expect(argv).not.toContain('--last'); expect(argv).not.toContain(otherId);
    await restarted.window.screenshot({ path: join(home, 'history-resumed.png') });
  } finally {
    // End the resumed fixture process before quitting; Electron asks for confirmation with a live CLI agent.
    await restarted.window.evaluate(async (projectId) => {
      const sessions = await window.cc.terminals.list(projectId);
      await Promise.all(sessions.map((session) => window.cc.terminals.close(session.id)));
    }, project.id).catch(() => undefined);
    await restarted.electron.close();
  }
});
