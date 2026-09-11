/**
 * Built-Electron: single-card Close with follow-up on a Needs you (blocked)
 * CLI agent files a paper trail and removes the session.
 *
 * Drive blocked via the existing lifecycle notify hook
 * (`e2e/sdk/harness.ts` `blocked-hold` + `$ZCC_NOTIFY_URL/blocked`) — same
 * production path as `e2e/harness-lifecycle.spec.ts`. Do not invent markBlocked
 * IPC.
 *
 * Idle+awaiting-reply Needs you has no public e2e seed (triage is LLM-only
 * `onIdleTriage`). That state is covered by unit tests of the forced closer.
 */
import { test, expect } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ e2e: true });
test.setTimeout(90_000);

async function spawnClaude(
  window: import('@playwright/test').Page,
  projectId: string,
  binPath: string,
  title: string
): Promise<string> {
  await window.evaluate((bin) => window.cc.config.set({ claudeBinary: bin }), binPath);
  const sessionId = await window.evaluate(
    async (args) => {
      const { pid, t } = args as { pid: string; t: string };
      const res = await window.cc.terminals.create({
        projectId: pid,
        profile: 'claude',
        cols: 80,
        rows: 24,
        title: t
      });
      const s = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
        id: string;
      };
      return s.id;
    },
    { pid: projectId, t: title }
  );
  expect(sessionId).toBeTruthy();
  return sessionId;
}

test('Close with follow-up on a blocked Needs you agent closes the session', async ({
  app,
  events
}) => {
  const { window } = app;
  const agent = makeFakeAgentBinary({
    profile: 'claude',
    sequence: 'blocked-hold',
    workingTitle: 'Needs you probe'
  });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-close-followup-'));
  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
      id: string;
    };
    return proj.id;
  }, projectDir);
  expect(projectId).toBeTruthy();

  let sessionId: string | null = null;
  try {
    sessionId = await spawnClaude(window, projectId, agent.path, 'Needs You Close Probe');

    await events.waitForEvent((e) => {
      return (
        e.channel === 'terminals:onAgentStatus' &&
        JSON.stringify(e.args).includes(sessionId as string) &&
        JSON.stringify(e.args).includes('blocked')
      );
    }, 20_000);

    await expect
      .poll(
        async () =>
          window.evaluate(async (sid) => {
            const pairs = (await window.cc.terminals.agentStatusSnapshot()) as Array<
              [string, string]
            >;
            return pairs.find(([id]) => id === sid)?.[1] ?? null;
          }, sessionId),
        { timeout: 10_000 }
      )
      .toBe('blocked');

    await window.locator('[data-testid="nav-agents"]').click();
    await window.getByLabel('List view').click();
    await expect(window.locator('.agent-monitor-list')).toBeVisible({ timeout: 15_000 });

    const card = window.locator('.agent-monitor-list').getByText('Needs You Close Probe');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();

    const closeButton = window.getByRole('button', { name: 'Close with follow-up' });
    await expect(closeButton).toBeVisible({ timeout: 15_000 });
    const progress = window
      .locator('.toast')
      .filter({ hasText: /Closing/ })
      .or(window.getByRole('button', { name: 'Closing…' }));
    window.once('dialog', (dialog) => void dialog.accept());
    await closeButton.click();
    await expect(progress).toBeVisible({ timeout: 8_000 });

    await expect
      .poll(
        async () =>
          window.evaluate(async (args) => {
            const { pid, sid } = args as { pid: string; sid: string };
            const sessions = (await window.cc.terminals.list(pid)) as Array<{
              id: string;
              status?: string;
            }>;
            return sessions.some((s) => s.id === sid && s.status !== 'exited');
          }, { pid: projectId, sid: sessionId }),
        { timeout: 20_000 }
      )
      .toBe(false);

  } finally {
    await window.evaluate(
      async (args) => {
        const { pid, sid } = args as { pid: string; sid: string | null };
        try {
          if (sid) await window.cc.terminals.close(sid);
        } catch {
          /* already closed */
        }
        try {
          await window.cc.projects.remove(pid);
        } catch {
          /* best-effort */
        }
      },
      { pid: projectId, sid: sessionId }
    );
    agent.cleanup();
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});
