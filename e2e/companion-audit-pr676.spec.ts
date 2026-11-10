import { test, expect } from './fixtures/app.js';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

test.skip(process.platform !== 'darwin', 'macOS companion audit');
test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true,
  initialConfig: { companionEnabled: true, companionPlacement: { edge: 'left', offsetY: 100000 } } });

async function part(electron: ElectronApplication, name: string): Promise<Page> {
  let page: Page | undefined;
  await expect.poll(() => {
    page = electron.windows().find(p => p.url().includes('surface=companion') && p.url().includes(`part=${name}`));
    return !!page;
  }).toBe(true);
  await page!.waitForSelector('#root');
  return page!;
}

test('audit regression: Modern thread created after rail opens updates the rail', async ({ app }) => {
  const { window, electron } = app;
  expect(await window.evaluate(() => window.cc.companion.enter())).toBe(true);
  const rail = await part(electron, 'rail');
  await expect(rail.getByRole('button', { name: /^Agents:/ })).toHaveAttribute('aria-label', /0 working/);
  const thread = await window.evaluate(async () => {
    const { projects } = await (await fetch('/api/v1/projects')).json();
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: projects[0].id, providerId: 'fake', title: 'Audit live thread', input: 'delay:60000 audit' }) });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread;
  });
  await expect.poll(() => window.evaluate(async id =>
    (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, thread.id)).toBe('active');
  await expect.poll(() => window.evaluate(async () =>
    (await (await fetch('/api/v1/menubar/threads?limit=100')).json()).agents.length)).toBe(1);
  const agents = rail.getByRole('button', { name: /^Agents:/ });
  await expect(agents).toHaveAttribute('aria-label', /1 working/, { timeout: 20000 });
});

test('audit: existing Modern thread route, manual refresh and idle omission', async ({ app }) => {
  const { window, electron } = app;
  const thread = await window.evaluate(async () => {
    const { projects } = await (await fetch('/api/v1/projects')).json();
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: projects[0].id, providerId: 'fake', title: 'Audit live thread', input: 'delay:10000 audit' }) });
    const body = await response.json(); if (!response.ok) throw new Error(JSON.stringify(body)); return body.thread;
  });
  await expect.poll(() => window.evaluate(async id =>
    (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, thread.id)).toBe('active');
  expect(await window.evaluate(() => window.cc.companion.enter())).toBe(true);
  const rail = await part(electron, 'rail');
  const agents = rail.getByRole('button', { name: /^Agents:/ });
  await expect(agents).toHaveAttribute('aria-label', /1 working/);
  await agents.dispatchEvent('click');
  const panel = await part(electron, 'panel');
  await expect(panel.getByText('Audit live thread')).toBeVisible();
  await panel.getByRole('button', { name: /Audit live thread/ }).dispatchEvent('click');
  await expect.poll(() => window.url()).toContain(thread.id);
  await expect.poll(() => window.evaluate(async id =>
    (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, thread.id), { timeout: 25000 }).toBe('idle');
  await window.evaluate(() => window.cc.companion.enter());
  await expect(agents).toHaveAttribute('aria-label', /0 working · 0 idle/);
  // Characterize the current limitation: idle Modern threads disappear altogether.
  await agents.dispatchEvent('click');
  await expect(panel.getByText('Audit live thread')).toHaveCount(0);
});

test('audit: live scheduler row launches a real session, updates counts and opens detail', async ({ app, home }) => {
  const { window, electron } = app;
  const path = join(home, 'scheduler-audit');
  mkdirSync(path);
  const projectId = await window.evaluate(async p => {
    const r = await window.cc.projects.add(p); if (!r.ok) throw new Error(r.message); return r.value.id;
  }, path);
  expect(await window.evaluate(() => window.cc.companion.enter())).toBe(true);
  const rail = await part(electron, 'rail');
  const created = await window.evaluate(projectId => window.cc.scheduler.create({
    projectId, name: 'Audit scheduler cat', profile: 'shell', extraArgs: ['-c', 'cat'], every: '1h', enabled: false,
    inboxLevel: 'silent', autoCloseOnFinish: false
  }), projectId);
  if (!created.ok) throw new Error(created.message);
  const taskId = created.value.id;
  let sessionId: string | undefined;
  try {
    await expect(rail.getByRole('button', { name: /^Scheduler:/ })).toHaveAttribute('aria-label', /1 schedule/);
    await rail.getByRole('button', { name: /^Scheduler:/ }).click();
    const panel = await part(electron, 'panel');
    await expect(panel.getByText('Audit scheduler cat')).toBeVisible();
    await panel.getByRole('button', { name: 'Run Audit scheduler cat now' }).dispatchEvent('click');
    await expect.poll(async () => {
      const tasks = await window.evaluate(() => window.cc.scheduler.list());
      sessionId = tasks.find(t => t.id === taskId)?.status.runs.find(r => r.sessionId)?.sessionId;
      return !!sessionId;
    }, { timeout: 20000 }).toBe(true);
    await expect(panel.getByRole('button', { name: 'Run Audit scheduler cat now' })).toHaveCount(0);
    await expect(panel.locator('.cc-row-meta')).toContainText('Running');
    const snapshot = await rail.evaluate(() => window.cc.companion.request());
    expect(snapshot.counts.runningSchedules).toBe(1);
    expect(snapshot.schedules.find(t => t.id === taskId)?.running).toBe(true);
    await panel.locator('.cc-row').filter({ hasText: 'Audit scheduler cat' }).dispatchEvent('click');
    await expect(window.getByText('Audit scheduler cat').first()).toBeVisible();
  } finally {
    if (sessionId) await window.evaluate(id => window.cc.terminals.close(id), sessionId);
    await window.evaluate(id => window.cc.scheduler.delete(id), taskId);
  }
});

test('audit: saved placement, bounded windows, theme, invalid targets and disabling while active', async ({ app }) => {
  const { window, electron } = app;
  {
    // Renderer writes cannot override main-owned placement.
    const next = await window.evaluate(() => window.cc.config.set({ companionPlacement: { edge: 'right', offsetY: 0 }, theme: 'light' }));
    expect(next.companionPlacement?.edge).toBe('left');
    expect(await window.evaluate(() => window.cc.companion.enter())).toBe(true);
    const rail = await part(electron, 'rail');
    await expect(rail.locator('html')).toHaveAttribute('data-theme', 'light');
    const geometry = await electron.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('part=rail'))!;
      return { bounds: w.getBounds(), work: screen.getDisplayMatching(w.getBounds()).workArea };
    });
    expect(geometry.bounds.y).toBeGreaterThanOrEqual(geometry.work.y);
    expect(geometry.bounds.y + geometry.bounds.height).toBeLessThanOrEqual(geometry.work.y + geometry.work.height);
    expect(geometry.bounds.x).toBe(geometry.work.x);
    const before = window.url();
    await rail.evaluate(() => window.cc.companion.open({ kind: 'thread', threadId: 'missing' }));
    expect(window.url()).toBe(before);
    expect(await rail.evaluate(() => window.cc.companion.runSchedule('missing'))).toBe(false);
    expect(await rail.evaluate(() => window.cc.companion.answer('missing', 'x'))).toMatchObject({ ok: false });
  }
  await window.evaluate(() => window.cc.config.set({ companionEnabled: false }));
  await expect.poll(() => electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter(w => w.webContents.getURL().includes('surface=companion') && w.isVisible()).length)).toBe(0);
  expect(await window.evaluate(() => window.cc.companion.enter())).toBe(false);
});
