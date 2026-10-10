// A large follow-up list used to overflow the main -> utility product-event link, which broadcast
// product:reset every ~30 s and made every terminal re-read its backlog and jump to the bottom.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

const FOLLOWUPS = 330;

// Under Xvfb a hidden E2E window never paints, so xterm 6 never applies wheel
// scrolls or moves its scrollbar slider (both run on animation frames). Show the
// window on Linux; macOS paints hidden windows, so local runs stay headless.
test.use({ e2e: true, initialConfig: { tmuxScope: 'off' }, launchEnv: process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {} });

test('a large follow-up list neither resets the product link nor replays or moves an open terminal', async ({ app }, testInfo) => {
  test.setTimeout(240_000);
  const { window: page, electron } = app;
  const projectDir = join(app.home, 'reset-project');
  mkdirSync(projectDir, { recursive: true });
  const projectId = await page.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, projectDir);

  // Synthetic follow-ups (about 1 KB each), enough to exceed the 256 KB snapshot limit.
  const dir = join(projectDir, '.zcc', 'followups');
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < FOLLOWUPS; i++) {
    const id = randomUUID(); const now = new Date(Date.now() - i * 60_000).toISOString();
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({
      id, projectId, title: `Synthetic follow-up ${i} `.padEnd(80, 'x'), detail: 'Synthetic detail '.repeat(42),
      options: ['Option A', 'Option B', 'Option C', 'Option D'], kind: 'question', status: 'open',
      origin: { source: 'idle-triage', sessionId: randomUUID(), confidence: 0.9 },
      createdAt: now, updatedAt: now, dedupeKey: `synthetic-${i}`
    }, null, 2));
  }

  // Count terminal backlog reads at the main-process IPC boundary.
  await electron.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers;
    const original = handlers.get('terminals:backlog')!;
    const g = globalThis as unknown as { __backlogReads: number[] };
    g.__backlogReads = [];
    handlers.set('terminals:backlog', (...args: unknown[]) => { g.__backlogReads.push(Date.now()); return original(...args); });
  });

  const heading = page.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await page.getByRole('button', { name: `Open ${basename(projectDir)}`, exact: true }).click();
  await page.getByTestId('project-nav-terminals').click();
  await page.locator('.empty-project').getByRole('button', { name: 'New terminal', exact: true }).click();
  const terminal = page.locator('.term .xterm').first();
  await expect(terminal).toBeVisible();
  const sessionId = await page.evaluate(async (projectId) => {
    const shell = (await window.cc.terminals.list(projectId)).find(s => s.profile === 'shell' && s.status !== 'exited');
    if (!shell) throw new Error('no shell');
    return shell.id;
  }, projectId);
  await page.evaluate((id) => window.cc.terminals.write(id, "printf 'LINE-%04d\\n' {1..3000}; echo TAIL-MARKER\r"), sessionId);
  await expect.poll(() => page.evaluate((id) => window.cc.terminals.backlog(id), sessionId)).toContain('TAIL-MARKER');

  // Passive observer of the product /ws from the renderer.
  await page.evaluate(() => {
    const w = window as unknown as { __events: Array<{ at: number; kind: string; args: number }> };
    w.__events = [];
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      const kind = m.type === 'shared:changed' ? `shared:${m.payload?.channel}` : m.type;
      if (kind === 'pong') return;
      if (kind === 'shared:terminals:onData') {
        // Only the burst's end marker is recorded; every other PTY frame is ignored.
        if (String(m.payload?.args?.[1] ?? '').includes('SPLIT-2-DONE')) w.__events.push({ at: Date.now(), kind: 'split-done', args: 2 });
        return;
      }
      w.__events.push({ at: Date.now(), kind, args: Array.isArray(m.payload?.args) ? m.payload.args.length : -1 });
    };
  });
  const events = () => page.evaluate(() => (window as unknown as { __events: Array<{ at: number; kind: string; args: number }> }).__events);
  const backlogReads = () => electron.evaluate(() => (globalThis as unknown as { __backlogReads: number[] }).__backlogReads.length);

  // Where the scrollbar slider sits: xterm 6 renders it as `.scrollbar.vertical .slider`, the most direct observable of scroll position.
  const scrollPosition = () => terminal.evaluate((node) => {
    const slider = node.querySelector<HTMLElement>('.scrollbar.vertical .slider')!;
    const track = slider.parentElement!.getBoundingClientRect().height;
    return { top: parseFloat(slider.style.top || '0'), height: slider.getBoundingClientRect().height, track };
  });

  const box = (await terminal.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Scroll well above the bottom, into the middle of the 3000-line history.
  await expect.poll(async () => {
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -600);
    const position = await scrollPosition();
    return position.top / position.track;
  }, { timeout: 30_000 }).toBeLessThan(0.5);
  await page.waitForTimeout(500);
  const before = await scrollPosition();
  const baselineReads = await backlogReads();
  await captureElectronScreenshot(electron, page, testInfo.outputPath('terminal-before.png'), terminal);

  // 70 s of the large list sitting in main: no product reset, no replay.
  await page.waitForTimeout(70_000);
  expect((await events()).filter(e => e.kind === 'product:reset')).toEqual([]);
  expect(await backlogReads()).toBe(baselineReads);

  // An external edit still reaches the web client, and still no reset.
  const editAt = Date.now();
  const file = join(dir, readdirSync(dir).sort()[0]!);
  const record = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...record, title: 'Edited on disk '.padEnd(80, 'y'), updatedAt: new Date().toISOString() }, null, 2));
  // 330 follow-ups exceed the event cap, so the change must arrive as a zero-arg invalidation.
  const afterEdit = async () => (await events()).filter(e => e.kind === 'shared:followups:onChanged' && e.at >= editAt);
  await expect.poll(async () => (await afterEdit()).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const followupEvents = await afterEdit();
  expect(followupEvents.length).toBeGreaterThan(0);
  expect(followupEvents.every(e => e.args === 0)).toBe(true);
  await page.waitForTimeout(3_000);
  expect((await events()).filter(e => e.kind === 'product:reset')).toEqual([]);

  // The terminal stayed exactly where the user left it.
  expect(await backlogReads()).toBe(baselineReads);
  const after = await scrollPosition();
  await captureElectronScreenshot(electron, page, testInfo.outputPath('terminal-after.png'), terminal);
  expect(after.top / after.track).toBeLessThan(0.5);
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(2);

  // A fast, escape-heavy burst produces PTY chunks far over the event cap once
  // JSON-escaped; they are split into ordered slices instead of resetting. The
  // end marker is computed by the shell so the echoed command line can't match it.
  const burstAt = Date.now();
  await page.evaluate((id) => window.cc.terminals.write(id, "yes $'\\e[0m\\e[0m\\e[0m\\e[0m' | head -n 50000 | tr -d '\\n'; echo SPLIT-$((1+1))-DONE\r"), sessionId);
  await expect.poll(async () => (await events()).some(e => e.kind === 'split-done' && e.at >= burstAt), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(3_000);
  expect((await events()).filter(e => e.kind === 'product:reset')).toEqual([]);
});
