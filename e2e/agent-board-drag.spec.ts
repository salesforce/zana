import { test, expect, dismissConsentOverlays } from './fixtures/app.js';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ e2e: true, initialConfig: { agentsBoardView: 'board', sponsorPromptDismissed: true } });

test('board drags interrupt real agents and close Done agents after one minute', async ({ app }) => {
  const { window } = app;
  const dir = mkdtempSync(join(tmpdir(), 'zcc-board-drag-'));
  const bin = join(dir, 'agent.cjs');
  writeFileSync(bin, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('2.1.220 (Claude Code)'); process.exit(0); }
const title = process.argv.find((arg) => arg.startsWith('--board-title='))?.slice(14) || 'ready';
const idle = () => process.stdout.write('\\x1b]2;✳ ' + title + '\\x07');
const working = () => process.stdout.write('\\x1b]2;⠉ Working\\x07');
if (process.argv.includes('--idle')) idle(); else working();
if (process.argv.includes('--blocked')) {
  fetch(process.env.ZCC_NOTIFY_URL + '/blocked', { method: 'POST' }).catch(() => {});
}
process.on('SIGINT', () => {
  idle();
  fetch(process.env.ZCC_HOOK_URL, { method: 'POST' }).catch(() => {});
});
process.stdin.resume();
setInterval(() => {}, 1000);
`);
  chmodSync(bin, 0o755);
  const ids: string[] = [];
  let projectId = '';
  try {
    await dismissConsentOverlays(window);
    projectId = await window.evaluate(async ({ dir, bin }) => {
      await window.cc.config.set({ claudeBinary: bin, agentsBoardView: 'board' });
      const result = await window.cc.projects.add(dir);
      if (!result.ok) throw new Error(result.message);
      return result.value.id;
    }, { dir, bin });
    async function launch(title: string, state: 'working' | 'blocked' | 'idle') {
      const id = await window.evaluate(async ({ projectId, title, state }) => {
        const result = await window.cc.terminals.create({ projectId, profile: 'claude', title, cols: 80, rows: 24,
          extraArgs: [`--board-title=${title}`, ...(state === 'working' ? [] : [`--${state}`])] });
        if (!result.ok) throw new Error(result.message);
        return result.value.id;
      }, { projectId, title, state });
      ids.push(id);
      return id;
    }
    const workingId = await launch('Drag Working', 'working');
    const blockedId = await launch('Drag Needs you', 'blocked');
    await launch('Drag Idle', 'idle');
    await window.locator('.nav-item').filter({ hasText: 'Agents' }).first().click();
    await window.getByRole('button', { name: 'Board view', exact: true }).click();
    const lane = (key: string) => window.locator(`[data-board-column="${key}"]`);
    const card = (title: string) => window.locator('.agent-card').filter({ hasText: title });
    await expect(lane('working').locator('.agent-card').filter({ hasText: 'Drag Working' })).toHaveCount(1);
    await expect(lane('blocked').locator('.agent-card').filter({ hasText: 'Drag Needs you' })).toHaveCount(1);
    await expect(lane('idle').locator('.agent-card').filter({ hasText: 'Drag Idle' })).toHaveCount(1);

    // Invalid moves do not alter the real process or its live classification.
    await card('Drag Working').dragTo(lane('blocked'));
    await card('Drag Needs you').dragTo(lane('working'));
    await card('Drag Idle').dragTo(lane('working'));
    await card('Drag Idle').dragTo(lane('blocked'));
    await expect(lane('working').locator('.agent-card').filter({ hasText: 'Drag Working' })).toHaveCount(1);
    await expect(lane('blocked').locator('.agent-card').filter({ hasText: 'Drag Needs you' })).toHaveCount(1);
    await expect(lane('idle').locator('.agent-card').filter({ hasText: 'Drag Idle' })).toHaveCount(1);

    await card('Drag Working').dragTo(lane('idle'));
    await card('Drag Needs you').dragTo(lane('idle'));
    await expect.poll(async () => window.evaluate(async ({ ids, projectId }) =>
      (await window.cc.terminals.list(projectId)).filter((s) => ids.includes(s.id) && typeof s.lastInputAt === 'number').length,
    { ids: [workingId, blockedId], projectId })).toBe(2);
    await expect(lane('idle').locator('.agent-card')).toHaveCount(3);
    expect(await window.evaluate(async ({ id, projectId }) => (await window.cc.terminals.list(projectId)).find((s) => s.id === id)?.status, { id: workingId, projectId })).toBe('running');

    await launch('Finish Working', 'working');
    await launch('Finish Needs you', 'blocked');
    await expect(lane('working').locator('.agent-card').filter({ hasText: 'Finish Working' })).toHaveCount(1);
    await expect(lane('blocked').locator('.agent-card').filter({ hasText: 'Finish Needs you' })).toHaveCount(1);
    // Freeze renderer time for deterministic countdown assertions; main and the
    // PTYs remain real, and the native drag travels through the built renderer.
    await window.clock.install();
    await window.clock.pauseAt(new Date());
    for (const title of ['Finish Working', 'Finish Needs you', 'Drag Idle']) {
      await card(title).dragTo(lane('done'));
      await expect(lane('done').locator('.agent-card').filter({ hasText: title })).toHaveCount(1);
    }
    await expect(lane('done').getByText('Closes in 60s')).toHaveCount(3);
    await window.clock.fastForward(59_999);
    expect(await window.evaluate(async ({ ids, projectId }) => (await window.cc.terminals.list(projectId)).filter((s) => ids.includes(s.id) && s.status !== 'exited').length, { ids, projectId })).toBe(5);
    await window.locator('.nav-item').filter({ hasText: 'Inbox' }).first().click();
    await window.clock.fastForward(1);
    await expect.poll(async () => window.evaluate(async ({ ids, projectId }) => (await window.cc.terminals.list(projectId)).filter((s) => ids.includes(s.id)).length, { ids, projectId })).toBe(2);
    await window.locator('.nav-item').filter({ hasText: 'Agents' }).first().click();
    await expect(lane('done').locator('.agent-card')).toHaveCount(0);
    await expect(lane('idle').locator('.agent-card')).toHaveCount(2);
  } finally {
    await window.evaluate(async ({ ids, projectId }) => {
      for (const id of ids) await window.cc.terminals.close(id).catch(() => {});
      if (projectId) await window.cc.projects.remove(projectId);
    }, { ids, projectId });
    rmSync(dir, { recursive: true, force: true });
  }
});
