import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { tmuxScope: 'off', sponsorPromptDismissed: true } });

test('plain planning replies can be reviewed, revised, and implemented in built Electron', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  const path = join(home, 'plan-ux-project'); mkdirSync(path);
  const projectId = await win.evaluate(async path => {
    const project = await window.cc.projects.add(path); if (!project.ok) throw new Error(project.message); return project.value.id;
  }, path);
  const request = (route: string, method = 'GET', body?: unknown) => win.evaluate(async ({ route, method, body }) => {
    const response = await fetch(`/api/v1/${route}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }, { route, method, body });
  const created = await request('threads', 'POST', { projectId, providerId: 'fake', input: '/plan plain_plan:initial' });
  expect(created.status).toBe(201);
  const id = created.data.thread.id;
  await expect.poll(async () => (await request(`threads/${id}`)).data.thread.status).toBe('idle');
  const firstPlan = (await request(`threads/${id}/plan`)).data.plan;
  expect(firstPlan?.revision, JSON.stringify((await request(`threads/${id}/events`)).data)).toBe(1);
  // The plain reply only becomes a document on its successful turn boundary.
  // Batched host ingestion must reconcile that boundary exactly once.
  expect((await request(`threads/${id}/events`)).data.events.filter((event: { type: string }) => event.type === 'plan/document/captured')).toHaveLength(1);
  await win.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, id);
  const openPanel = win.getByRole('button', { name: 'Show right panel', exact: true });
  await expect(openPanel.or(win.getByTestId('thread-plan-pin')).first()).toBeVisible();
  if (await openPanel.isVisible()) await openPanel.click();
  await win.getByTestId('thread-plan-pin').click();
  const panel = win.getByTestId('thread-plan-panel');
  await expect(panel).toContainText('Converter plan');
  await expect(panel).toContainText('Draft');
  await expect(panel).not.toContainText('0/0');
  await expect(panel).not.toContainText('Referenced by');
  await panel.getByRole('button', { name: 'Revise plan', exact: true }).click();
  const input = win.getByTestId('thread-command-input');
  await expect(input).toContainText('Revise the plan:');
  await input.fill('plain_plan:revised');
  await win.getByTestId('thread-command-send').click();
  await expect(panel).toContainText('Add Kelvin');
  await expect(panel).toContainText('Revision 2');
  expect((await request(`threads/${id}/plan/implement`, 'POST', { revision: 1 })).data.error).toBe('stale_plan');
  await panel.getByRole('button', { name: 'Implement plan', exact: true }).click();
  await expect(win.getByTestId('thread-timeline')).toContainText('Implemented reviewed document');
  const timeline = (await request(`threads/${id}/timeline`)).data;
  expect(timeline.durablePlan.requestedExecutionMode).toBe('agent');
  expect(timeline.durablePlan.revision).toBe(2);
  expect(readFileSync(timeline.durablePlan.filePath, 'utf8')).toContain('Add Kelvin');
  await win.reload();
  await expect(win.getByTestId('thread-timeline')).toContainText('Implemented reviewed document');
  expect((await request(`threads/${id}/plan`)).data.plan.revision).toBe(2);
  expect((await request(`threads/${id}/events`)).data.events.filter((event: { type: string }) => event.type === 'plan/document/captured')).toHaveLength(2);
});


test('native Plan implementation requires an explicit execution mode', async ({ app, home }) => {
  const win = app.window;
  const path = join(home, 'native-plan-ux'); mkdirSync(path);
  const projectId = await win.evaluate(async path => {
    const project = await window.cc.projects.add(path); if (!project.ok) throw new Error(project.message); return project.value.id;
  }, path);
  const request = (route: string, body?: unknown) => win.evaluate(async ({ route, body }) => {
    const response = await fetch(`/api/v1/${route}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }, { route, body });
  const created = await request('threads', { projectId, providerId: 'fake', input: 'plain_plan:initial', acpMode: 'plan' });
  expect(created.status).toBe(201);
  const id = created.data.thread.id;
  await expect.poll(async () => (await request(`threads/${id}/plan`)).data.plan?.revision).toBe(1);
  await expect.poll(async () => (await request(`threads/${id}`)).data.thread.status).toBe('idle');
  expect((await request(`threads/${id}/plan/implement`, { revision: 1 })).data.error).toBe('execution_mode_required');
  expect((await request(`threads/${id}/plan/implement`, { revision: 1, acpMode: 'plan' })).status).toBe(400);
  const implemented = await request(`threads/${id}/plan/implement`, { revision: 1, acpMode: 'build' });
  expect(implemented.status, JSON.stringify(implemented.data)).toBe(200);
  await expect.poll(async () => (await request(`threads/${id}`)).data.thread.status).toBe('idle');
  const plan = (await request(`threads/${id}/plan`)).data.plan;
  expect(plan.requestedExecutionMode).toBe('build');
  expect(plan.revision).toBe(1);
});

test('a closed plan card stays closed across messages and reloads, and leaves once finished', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  const path = join(home, 'plan-card-project'); mkdirSync(path);
  const projectId = await win.evaluate(async path => {
    const project = await window.cc.projects.add(path); if (!project.ok) throw new Error(project.message); return project.value.id;
  }, path);
  const request = (route: string, method = 'GET', body?: unknown) => win.evaluate(async ({ route, method, body }) => {
    const response = await fetch(`/api/v1/${route}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }, { route, method, body });
  const created = await request('threads', 'POST', { projectId, providerId: 'fake', input: 'plan_snapshot:initial' });
  expect(created.status).toBe(201);
  const id = created.data.thread.id;
  const idle = () => expect.poll(async () => (await request(`threads/${id}`)).data.thread.status).toBe('idle');
  await idle();
  await win.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, id);
  const card = win.getByTestId('thread-plan-execution');
  const header = card.locator('.thread-plan-execution-header');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(card).toContainText('Obsolete step');
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');

  // The card moves under each new message; the reader's choice moves with it.
  const input = win.getByTestId('thread-command-input');
  await input.fill('plan_snapshot:revised');
  await win.getByTestId('thread-command-send').click();
  await expect(card).toContainText('1/2');
  await idle();
  await expect(card).toHaveCount(1);
  await expect(win.locator('.thread-timeline-item').filter({ has: card })).toContainText('plan_snapshot:revised');
  await expect(header).toHaveAttribute('aria-expanded', 'false');

  await win.reload();
  await expect(card).toContainText('1/2');
  await expect(header).toHaveAttribute('aria-expanded', 'false');

  // A finished plan stops trailing the conversation; the Plan panel keeps it.
  await input.fill('plan_snapshot:done');
  await win.getByTestId('thread-command-send').click();
  await expect.poll(async () => (await request(`threads/${id}/plan`)).data.plan.tasks.map((task: { status: string }) => task.status)).toEqual(['completed', 'completed']);
  await idle();
  await expect(card).toHaveCount(0);
  await expect(win.getByTestId('thread-timeline')).toContainText('plan_snapshot:done');
});
