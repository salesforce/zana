// A hidden or busy terminal drops queued output past a per-session cap and the write queue
// prepends an "omitted output" marker. These cases pin, at the real Electron boundary, that the
// marker pending at refocus is dropped, an already-rendered marker survives until Cmd+K, and Cmd+K
// clears the active terminal (the inspector modal's, not the project tab beneath it).
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

const MARKER = 'Some output was omitted while this terminal was hidden or busy.';

test.use({ e2e: true, initialConfig: { tmuxScope: 'off' }, launchEnv: process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {} });

/** Text of the whole xterm buffer (scrollback included) for one session, read off the live Terminal via its React owner. */
async function readBuffer(page: Page, sessionId: string): Promise<string | null> {
  return page.evaluate((id) => {
    type Fiber = { memoizedProps?: { session?: { id?: string } }; memoizedState?: unknown; return?: Fiber | null };
    type Hook = { memoizedState?: unknown; next?: Hook | null };
    type Term = { buffer: { active: { length: number; getLine(i: number): { translateToString(trim: boolean): string } | undefined } } };
    for (const el of Array.from(document.querySelectorAll('.term'))) {
      const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
      if (!key) continue;
      for (let fiber = (el as unknown as Record<string, Fiber>)[key] as Fiber | null | undefined; fiber; fiber = fiber.return) {
        if (fiber.memoizedProps?.session?.id !== id) continue;
        for (let hook = fiber.memoizedState as Hook | null | undefined; hook; hook = hook.next) {
          const current = (hook.memoizedState as { current?: unknown } | null | undefined)?.current as Term | undefined;
          const active = current && typeof current === 'object' ? current.buffer?.active : undefined;
          if (!active) continue;
          const lines: string[] = [];
          for (let i = 0; i < active.length; i++) lines.push(active.getLine(i)?.translateToString(true) ?? '');
          return lines.join('\n');
        }
      }
    }
    return null;
  }, sessionId);
}

test('omitted-output marker: dropped on refocus, kept once rendered, cleared by Cmd+K, and Cmd+K targets the modal', async ({ app }) => {
  test.setTimeout(240_000);
  const { window: page, home } = app;
  const projectDir = join(home, 'omitted-project');
  mkdirSync(projectDir, { recursive: true });
  // Fake agent: prints scrollback of its own, then idles.
  const bin = join(projectDir, 'agent.cjs');
  writeFileSync(bin, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('2.1.220 (Claude Code)'); process.exit(0); }
for (let i = 1; i <= 200; i++) console.log('AGENT-LINE-' + String(i).padStart(4, '0'));
process.stdin.resume();
setInterval(() => {}, 1000);
`);
  chmodSync(bin, 0o755);
  const { shellId, shell2Id, agentId } = await page.evaluate(async ({ path, bin }) => {
    await window.cc.config.set({ claudeBinary: bin });
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const create = async (profile: 'shell' | 'claude', title: string) => {
      const s = await window.cc.terminals.create({ projectId: project.value.id, profile, title, cols: 100, rows: 30 });
      if (!s.ok) throw new Error(s.message);
      return s.value.id;
    };
    return {
      shellId: await create('shell', 'Flood Shell'),
      shell2Id: await create('shell', 'Scrollback Shell'),
      agentId: await create('claude', 'Modal Agent')
    };
  }, { path: projectDir, bin });

  const heading = page.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await page.getByRole('button', { name: `Open ${basename(projectDir)}`, exact: true }).click();
  await page.getByTestId('project-nav-terminals').click();
  const tab = (title: string) => page.getByRole('tab', { name: new RegExp(`^${title}`) }).or(page.locator('.tab', { hasText: title })).first();
  const buffer = async (id: string) => (await readBuffer(page, id)) ?? '';
  const write = (id: string, data: string) => page.evaluate(([sid, text]) => window.cc.terminals.write(sid!, text!), [id, data]);
  const backlog = (id: string) => page.evaluate((sid) => window.cc.terminals.backlog(sid), id);
  await expect.poll(() => readBuffer(page, shellId)).not.toBeNull();

  // Case 1: output flooded into a hidden session past the queue cap; the omitted-output marker pending at refocus is not shown.
  // End markers are computed by the shell so the echoed command line cannot satisfy them.
  await tab('Scrollback Shell').click();
  await write(shellId, "seq -f 'FLOODA-%06g' 1 30000; echo FLOODA-$((1+1))-END\r");
  await expect.poll(() => backlog(shellId), { timeout: 60_000 }).toContain('FLOODA-2-END');
  await page.waitForTimeout(1_500);
  // The terminal's scrollback must hold the whole flood, so a missing head can only come from the queue cap.
  expect(Number(await page.locator('.term').first().getAttribute('data-scrollback-limit'))).toBeGreaterThan(40_000);
  await tab('Flood Shell').click();
  await expect.poll(() => buffer(shellId), { timeout: 30_000 }).toContain('FLOODA-2-END');
  const refocused = await buffer(shellId);
  expect(refocused).toContain('FLOODA-030000');
  // The head of the flood was dropped (so a gap really was pending), yet no marker was written.
  expect(refocused).not.toContain('FLOODA-000001');
  expect(refocused).not.toContain(MARKER);

  // Case 2: a marker rendered while the session is visible stays until Cmd+K clears the terminal.
  await write(shellId, "seq -f 'FLOODB-%07g' 1 150000; echo FLOODB-$((1+1))-END\r");
  await expect.poll(() => buffer(shellId), { timeout: 90_000 }).toContain(MARKER);
  await expect.poll(() => buffer(shellId), { timeout: 90_000 }).toContain('FLOODB-2-END');
  await tab('Scrollback Shell').click();
  await tab('Flood Shell').click();
  await expect.poll(() => buffer(shellId)).toContain('FLOODB-2-END');
  expect(await buffer(shellId)).toContain(MARKER);
  // Returning to the tab focuses its terminal (which marks it active); wait for that before the shortcut.
  await expect(page.locator('.term:visible .xterm-helper-textarea:focus')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+k');
  await expect.poll(async () => {
    const text = await buffer(shellId);
    return text.includes(MARKER) || text.includes('FLOODB-');
  }).toBe(false);

  // Case 3: Cmd+K with the agent inspector open clears the modal's terminal, not the project tab beneath it.
  await write(shell2Id, "seq -f 'TABLINE-%04g' 1 300; echo TABLINE-$((1+1))-END\r");
  await expect.poll(() => backlog(shell2Id)).toContain('TABLINE-2-END');
  await tab('Scrollback Shell').click();
  await expect.poll(() => buffer(shell2Id)).toContain('TABLINE-2-END');
  // Follow the agent (from its inspector on the Agents board), then peek it from the Followed-agents drawer over the Terminals page.
  const modal = page.getByTestId('agent-terminal-modal');
  await page.getByTestId('project-nav-agents').click();
  await page.getByRole('list', { name: /^Agents board/ }).getByRole('button', { name: /^Modal Agent/ }).click();
  await expect(modal).toBeVisible();
  const follow = modal.getByRole('button', { name: 'Follow this agent' });
  if (await follow.count()) await follow.click();
  await expect(modal.getByRole('button', { name: 'Unfollow this agent' })).toBeVisible();
  await modal.getByRole('button', { name: 'Close' }).first().click();
  await expect(modal).toBeHidden();
  await page.getByTestId('project-nav-terminals').click();
  await tab('Scrollback Shell').click();
  await expect.poll(() => buffer(shell2Id)).toContain('TABLINE-2-END');
  await page.getByRole('button', { name: 'Followed agents' }).click();
  await page.getByText('Modal Agent').last().click();
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId('agent-session-view')).toBeVisible();
  const modalScreen = modal.locator('#cc-terminal-anchor-agent-modal .xterm-screen:visible').first();
  await expect(modalScreen).toBeVisible();
  await expect.poll(() => buffer(agentId), { timeout: 30_000 }).toContain('AGENT-LINE-0200');
  await modalScreen.click();
  await expect(page.locator('#cc-terminal-anchor-agent-modal .xterm-helper-textarea:focus').first()).toBeAttached();
  await page.keyboard.press('ControlOrMeta+k');
  await expect.poll(async () => (await buffer(agentId)).includes('AGENT-LINE-'), { timeout: 15_000 }).toBe(false);
  const tabText = await buffer(shell2Id);
  expect(tabText).toContain('TABLINE-0001');
  expect(tabText).toContain('TABLINE-2-END');
});
