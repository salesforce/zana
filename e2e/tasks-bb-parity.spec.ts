import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test as base, expect } from './fixtures/app.js';

const test = base.extend({
  home: async ({ home }, use) => {
    const root = join(home, '.zcc', 'plugins', 'tasks'); mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'kv.json'), JSON.stringify({ store: { version: 2, nextSeq: 8, items: [{
      id: 'legacy', key: 'TSK-4', title: 'Preserved before upgrade', description: 'Keep these notes',
      status: 'in_review', priority: 'high', dueDate: null, order: 1, createdAt: 1000, updatedAt: 2000,
    }] } }));
    await use(home);
  },
});
test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { tmuxScope: 'off', sponsorPromptDismissed: true } });

test('Tasks dialogs and property menus stay styled in body portals', async ({ app }, testInfo) => {
  const win = app.window;
  await win.setViewportSize({ width: 1440, height: 1000 });
  // Electron's configured zoom makes CSS viewport pixels differ from window pixels.
  const viewport = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const rem = await win.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'tasks' }))).toMatchObject({ ok: true });
  await win.locator('.nav-item', { hasText: 'Tasks' }).first().click();
  const panel = win.locator('.bb-tasks').filter({ has: win.getByRole('button', { name: 'New task', exact: true, includeHidden: true }) });
  await expect(panel).toBeVisible();
  const initialPanel = await panel.boundingBox();
  await win.getByRole('button', { name: 'New task', exact: true }).click();
  const dialog = win.getByRole('dialog', { name: /New task/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('position', 'fixed');
  await expect(dialog).toHaveCSS('box-sizing', 'border-box');
  await expect(dialog).toHaveCSS('z-index', '50');
  await expect.poll(async () => {
    const box = await dialog.boundingBox();
    return box ? Math.max(Math.abs(box.x + box.width / 2 - viewport.width / 2), Math.abs(box.y + box.height / 2 - viewport.height / 2)) : Infinity;
  }).toBeLessThan(2);
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeLessThan(700);
  expect(bounds!.y).toBeGreaterThan(0);
  expect(bounds!.y + bounds!.height).toBeLessThan(viewport.height);
  expect(await panel.boundingBox()).toEqual(initialPanel);
  expect(await win.evaluate(() => window.scrollY)).toBe(0);
  const backdrop = win.locator('[data-bb-plugin="tasks"][data-state="open"]').filter({ hasNot: win.locator('*') }).filter({ visible: true });
  await expect(backdrop).toHaveCSS('position', 'fixed');
  const backdropBounds = await backdrop.boundingBox();
  expect(backdropBounds).toMatchObject({ x: 0, y: 0 });
  expect(Math.abs(backdropBounds!.width - viewport.width)).toBeLessThan(1);
  expect(Math.abs(backdropBounds!.height - viewport.height)).toBeLessThan(1);
  await expect(dialog.locator('.ProseMirror')).toHaveCSS('min-height', `${5 * rem}px`);
  // A nested Select also portals outside the dialog's DOM subtree.
  await dialog.getByRole('combobox', { name: 'Status', exact: true }).click();
  const options = win.getByRole('listbox');
  await expect(options).toHaveCSS('z-index', '50');
  expect(await options.evaluate(node => parseFloat(getComputedStyle(node).borderTopWidth))).toBeGreaterThan(0);
  await win.getByRole('option', { name: 'Done', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Task title', exact: true }).fill('Portal layout regression');
  await testInfo.attach('new-task-dialog', { body: await win.screenshot({ path: testInfo.outputPath('new-task-dialog.png') }), contentType: 'image/png' });
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(win.getByText('Portal layout regression', { exact: true })).toBeVisible();
  await win.getByRole('button', { name: 'No priority', exact: true }).click();
  const menu = win.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('z-index', '50');
  expect(await menu.evaluate(node => parseFloat(getComputedStyle(node).borderTopWidth))).toBeGreaterThan(0);
  await expect(menu).toHaveCSS('padding', `${rem / 4}px`);
  expect(await menu.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  expect(await menu.evaluate(node => getComputedStyle(node).boxShadow)).not.toBe('none');
  const menuBounds = await menu.boundingBox();
  const urgent = win.getByRole('menuitem', { name: 'Urgent', exact: true });
  const urgentBounds = await urgent.boundingBox();
  expect(urgentBounds!.x).toBeGreaterThan(menuBounds!.x);
  expect(urgentBounds!.x + urgentBounds!.width).toBeLessThan(menuBounds!.x + menuBounds!.width);
  await testInfo.attach('priority-menu', { body: await win.screenshot({ path: testInfo.outputPath('priority-menu.png') }), contentType: 'image/png' });
  await urgent.click();
  await expect(menu).toBeHidden();
  await expect(win.getByRole('button', { name: 'Urgent', exact: true })).toBeVisible();
  await win.getByRole('button', { name: 'Set due date', exact: true }).click();
  const dueDate = win.getByRole('dialog');
  await expect(dueDate).toHaveCSS('z-index', '50');
  await expect(dueDate).toHaveCSS('padding', `${rem / 2}px`);
  await win.keyboard.press('Escape');
  await expect(dueDate).toBeHidden();
  // Plugin utility class names must not restyle an unrelated host element.
  expect(await win.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'fixed z-50 bg-popover';
    document.body.append(host);
    const position = getComputedStyle(host).position;
    host.remove();
    return position;
  })).toBe('static');
  // Compact view uses separate body-portal roots for its sheet and backdrop.
  await win.getByRole('button', { name: 'Back (Esc)', exact: true }).click();
  await win.setViewportSize({ width: 700, height: 900 });
  const compactHeight = await win.evaluate(() => innerHeight);
  await win.getByRole('button', { name: 'New task', exact: true }).click();
  const sheet = win.getByRole('dialog', { name: /New task/ });
  await expect(sheet).toHaveCSS('position', 'fixed');
  await expect(sheet).toHaveCSS('z-index', '50');
  await expect.poll(async () => {
    const box = await sheet.boundingBox();
    return box ? Math.abs(box.y + box.height - compactHeight) : Infinity;
  }).toBeLessThan(1);
  await expect(sheet.getByRole('textbox', { name: 'Task title', exact: true })).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('BB Tasks migrates, scopes CLI, delegates, and round-trips attachments in built Electron', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'tasks' }))).toMatchObject({ ok: true });
  const projectPath = join(home, 'task-project'); mkdirSync(projectPath);
  const projectId = await win.evaluate(async path => {
    const result = await window.cc.projects.add(path); if (!result.ok) throw new Error(result.message); return result.value.id;
  }, projectPath);
  const rpc = <T,>(method: string, args?: unknown) => win.evaluate(async ({ method, args }) =>
    window.cc.pluginApps.callRpc('tasks', method, args), { method, args }) as Promise<T>;
  async function cli(argv: string[], context: { projectId?: string; threadId?: string } = {}) {
    return win.evaluate(async ({ argv, context }) => {
      const response = await fetch('/api/v1/plugins/tasks/cli', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ argv, ...context }) });
      const result = await response.json(); if (!response.ok) throw new Error(JSON.stringify(result));
      return result as { exitCode: number; stdout: string; stderr: string };
    }, { argv, context });
  }
  await expect.poll(() => win.evaluate(async () => (await window.cc.pluginApps.list()).find(p => p.id === 'tasks'))).toMatchObject({ status: 'running' });
  const legacy = await rpc<{ task: { title: string; key: string; status: string } }>('getTaskByKey', { taskKey: 'TSK-4' });
  expect(legacy.task).toMatchObject({ key: 'TSK-4', title: 'Preserved before upgrade', status: 'in_review' });
  expect((await cli(['create', '--title', 'No random project'], { projectId })).stderr).toContain('no tracker project is linked');
  const project = await cli(['project', 'create', '--name', 'Product work', '--prefix', 'WORK', '--link-project', projectId, '--json']);
  expect(project.exitCode, project.stderr).toBe(0);
  const created = await cli(['create', '--title', 'Verify the BB workflow', '--description', 'Report the result as a task comment.', '--json'], { projectId });
  expect(created.exitCode, created.stderr).toBe(0);
  const task = JSON.parse(created.stdout).task as { id: string; key: string; projectId: string };
  expect(task.key).toBe('WORK-1');
  expect((await cli(['list', '--nonsense'])).exitCode).toBe(1);
  const preset = await cli(['preset', 'create', '--name', 'Fixture worker', '--provider', 'fake', '--model', 'fake-model', '--reasoning', 'medium', '--service-tier', 'fast', '--permission', 'full', '--json']);
  expect(preset.exitCode, preset.stderr).toBe(0);
  const dispatched = await cli(['dispatch', task.key, '--preset', 'Fixture worker', '--json']);
  expect(dispatched.exitCode, dispatched.stderr).toBe(0);
  const threadId = JSON.parse(dispatched.stdout).threadId as string;
  expect(threadId).toBeTruthy();
  await expect.poll(async () => ({
    tracked: (await rpc<{ taskThreads: { threadId: string; liveStatus: string }[] }>('listTaskThreads', { taskId: task.id })).taskThreads[0],
    thread: await win.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread, threadId),
  })).toMatchObject({ tracked: { liveStatus: 'idle' }, thread: { status: 'idle' } });
  expect((await rpc<{ task: { status: string } }>('getTask', { taskId: task.id })).task.status).toBe('in_progress');
  // Search reaches saved conversation context, not a truncated in-memory roster.
  expect((await rpc<{ threads: { id: string }[] }>('searchThreads', { query: 'Report the result as a task comment.' })).threads).toEqual(expect.arrayContaining([expect.objectContaining({ id: threadId })]));
  expect((await cli(['comment', task.key, '--body', 'Verified by the attached agent', '--json'], { projectId, threadId })).exitCode).toBe(0);
  // Release the runtime, then notify the prior worker: the preset survives resume.
  await win.evaluate(async id => {
    const response = await fetch(`/api/v1/threads/${id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error(await response.text());
  }, threadId);
  const notified = await cli(['comment', task.key, '--body', 'report_execution_options after-resume', '--notify', '--json'], { projectId });
  expect(notified.exitCode, notified.stderr).toBe(0);
  expect(JSON.parse(notified.stdout).comment.notifiedCount).toBe(1);
  await expect.poll(() => win.evaluate(async id => JSON.stringify(await (await fetch(`/api/v1/threads/${id}/timeline`)).json()), threadId)).toContain('serviceTier=fast; New comment');
  const size = 26 * 1024 + 17;
  const attachment = await win.evaluate(async ({ taskId, size }) => {
    const data = Uint8Array.from({ length: size }, (_, index) => index % 251);
    const response = await fetch(`/api/v1/plugins/tasks/http/attachments/upload?taskId=${taskId}&fileName=proof.bin&mime=application%2Foctet-stream`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: data,
    });
    const result = await response.json(); if (!response.ok) throw new Error(JSON.stringify(result));
    const download = await fetch(result.url); const bytes = new Uint8Array(await download.arrayBuffer());
    return { attachmentId: result.attachmentId as string, length: bytes.length, exact: bytes.every((value, index) => value === data[index]) };
  }, { taskId: task.id, size });
  expect(attachment).toMatchObject({ length: size, exact: true });
  await win.evaluate(projectId => { history.pushState({}, '', `/plugins/tasks/panel/${projectId}`); dispatchEvent(new PopStateEvent('popstate')); }, task.projectId);
  // Use the same host navigation target as the SDK.
  await win.locator('.nav-item', { hasText: 'Tasks' }).first().click();
  await expect(win.locator('.bb-tasks')).toBeVisible();
  await expect(win.getByText('Verify the BB workflow', { exact: true })).toBeVisible();
  await win.getByRole('button', { name: 'Open WORK-1: Verify the BB workflow', exact: true }).click();
  await expect(win.getByText('Verified by the attached agent')).toBeVisible();
  await expect(win.getByText('proof.bin', { exact: true })).toBeVisible();
  await expect(win.getByText('Dispatched to Fixture worker', { exact: true })).toBeVisible();
  await win.getByTitle('Edit preset Fixture worker', { exact: true }).click();
  await expect(win.getByLabel('Model', { exact: true })).toBeEnabled();
  await expect(win.getByLabel('Model', { exact: true })).toHaveValue('fake-model');
  await expect(win.getByLabel('Service tier', { exact: true })).toHaveValue('fast');
  await win.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Exercise the packaged CLI parser and plugin proxy, not only the plugin's run().
  const env = { ...process.env, HOME: home, ZCC_DATA_DIR: join(home, '.zcc'), ZCC_SERVER_URL: new URL(win.url()).origin,
    ZCC_SESSION_ID: undefined, ZCC_THREAD_ID: undefined, BB_THREAD_ID: undefined,
    ZCC_SESSION_TOKEN: undefined, ZCC_PROJECT_ID: projectId };
  const cliPath = resolve('packages/cli/dist/bin/zcc');
  const fileBytes = Buffer.from([0, 255, 128, 12, 65]);
  const sourceFile = join(projectPath, 'cli-binary.bin'); writeFileSync(sourceFile, fileBytes);
  const added = JSON.parse(execFileSync(process.execPath, [cliPath, 'tasks', 'attachment', 'add', task.key, '--file', sourceFile, '--json'], { env, encoding: 'utf8' }));
  const restoredFile = join(projectPath, 'restored', 'cli-binary.bin');
  execFileSync(process.execPath, [cliPath, 'tasks', 'attachment', 'get', added.attachment.id, '--out', restoredFile], { env, encoding: 'utf8' });
  expect(readFileSync(restoredFile)).toEqual(fileBytes);
  const help = execFileSync(process.execPath, [cliPath, 'tasks', '--help'], { env, encoding: 'utf8' });
  expect(help).toContain('Usage: zcc tasks');
  const listed = JSON.parse(execFileSync(process.execPath, [cliPath, 'tasks', 'list', '--json'], { env, encoding: 'utf8' }));
  expect(listed.tasks[0].key).toBe('WORK-1');
  expect(JSON.parse(readFileSync(join(home, '.zcc', 'plugins', 'tasks', 'kv.json'), 'utf8')).store.items[0].key).toBe('TSK-4');
});


test('provider plan snapshots replace stale steps while Zana keeps its Plan document and panel', async ({ app, home }) => {
  test.setTimeout(90_000);
  const win = app.window;
  const path = join(home, 'plan-project'); mkdirSync(path);
  const projectId = await win.evaluate(async path => {
    const project = await window.cc.projects.add(path); if (!project.ok) throw new Error(project.message); return project.value.id;
  }, path);
  async function request(route: string, method = 'GET', body?: unknown) {
    return win.evaluate(async ({ route, method, body }) => {
      const response = await fetch(`/api/v1/${route}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = await response.json(); if (!response.ok) throw new Error(JSON.stringify(value)); return value;
    }, { route, method, body });
  }
  const { thread } = await request('threads', 'POST', { projectId, providerId: 'fake', input: 'plan_snapshot:initial' });
  await expect.poll(async () => (await request(`threads/${thread.id}/plan`).catch(() => null))?.plan.tasks.map((task: { text: string }) => task.text)).toEqual(['Inspect implementation', 'Obsolete step']);
  await expect.poll(async () => (await request(`threads/${thread.id}`)).thread.status).toBe('idle');
  await request(`threads/${thread.id}/plan`, 'PATCH', { markdown: '# Retained plan document\n\nAcceptance criteria stay available.' });
  await request(`threads/${thread.id}/plan/tasks`, 'POST', { text: 'User review requirement' });
  await request(`threads/${thread.id}/send`, 'POST', { input: 'plan_snapshot:revised' });
  await expect.poll(async () => (await request(`threads/${thread.id}/plan`)).plan.tasks.map((task: { text: string }) => task.text).sort()).toEqual(['Inspect implementation', 'User review requirement', 'Verify behavior']);
  await expect.poll(async () => (await request(`threads/${thread.id}`)).thread.status).toBe('idle');
  await request(`threads/${thread.id}/send`, 'POST', { input: 'plan_snapshot:empty' });
  await expect.poll(async () => (await request(`threads/${thread.id}/plan`)).plan.tasks.map((task: { text: string }) => task.text)).toEqual(['User review requirement']);
  const { plan } = await request(`threads/${thread.id}/plan`);
  expect(plan.markdown).toContain('Retained plan document'); expect(plan.revision).toBeGreaterThan(0);
  expect(readFileSync(plan.filePath, 'utf8')).toContain('Retained plan document');
  await win.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, thread.id);
  const showPanel = win.getByRole('button', { name: 'Show right panel', exact: true });
  await expect(showPanel.or(win.getByTestId('thread-plan-pin')).first()).toBeVisible();
  if (await showPanel.isVisible()) await showPanel.click();
  await win.getByTestId('thread-plan-pin').click();
  const panel = win.getByTestId('thread-plan-panel');
  await expect(panel).toContainText('Retained plan document');
  await expect(panel).toContainText('User review requirement');
  await expect(panel).not.toContainText('Obsolete step');
  // Plan cancellation crosses renderer HTTP, host dispatch and provider confirmation.
  await expect.poll(async () => (await request(`threads/${thread.id}`)).thread.status).toBe('idle');
  await request(`threads/${thread.id}/send`, 'POST', { acpMode: 'plan', input: [{ type: 'text', text: '/plan delay:60000 inspect the next change', mentions: [{ start: 0, end: 5, resource: { kind: 'command', trigger: '/', name: 'plan', source: 'command', origin: 'builtin', label: 'plan', argumentHint: null } }] }] });
  await expect.poll(async () => {
    const timeline = await request(`threads/${thread.id}/timeline`);
    return timeline.status === 'active' && timeline.activePromptMode?.mode === 'plan';
  }).toBe(true);
  await expect.poll(async () => {
    try { return await request(`threads/${thread.id}/plan/cancel`, 'POST', {}); } catch { return null; }
  }).toEqual({ ok: true });
  await expect.poll(async () => (await request(`threads/${thread.id}`)).thread.status).toBe('idle');
  await request(`threads/${thread.id}/send`, 'POST', { input: 'report_execution_snapshot Continue after leaving plan mode' });
  await expect.poll(async () => (await request(`threads/${thread.id}`)).thread.status).toBe('idle');
  const events = (await request(`threads/${thread.id}/events`)).events;
  const resumed = events.filter((event: { type: string }) => event.type === 'client/turn/requested').at(-1);
  expect(resumed.payload.execution.acpMode).toBeUndefined();
  expect((await request(`threads/${thread.id}/plan`)).plan.requestedExecutionMode).toBe('agent');

});
