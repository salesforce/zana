import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('command approval stays compact with inspectable details and keyboard decisions', async ({ app }, testInfo) => {
  const { window, home } = app;
  const projectPath = join(home, 'approval-project');
  mkdirSync(projectPath);
  const resize = async (width: number, height: number) => {
    await app.electron.evaluate(({ BrowserWindow }, size) => {
      const main = BrowserWindow.getAllWindows().find((candidate) => !candidate.webContents.getURL().startsWith('devtools:'));
      main!.webContents.setZoomFactor(1);
      main!.setMinimumSize(640, 480);
      main!.setContentSize(size.width, size.height);
    }, { width, height });
    await expect.poll(() => window.evaluate(() => innerWidth)).toBe(width);
  };
  const action = '.venv/bin/pytest tests/test_session_lifecycle.py tests/test_acp_regressions.py tests/test_chat_agent.py tests/test_worker_handlers.py';
  const command = `/bin/zsh -lc '${action}'`;
  const cwd = '/tmp/approval-project';
  let resolution: unknown;
  const threadId = await window.evaluate(async (path) => {
    const projectResponse = await fetch('/api/v1/projects', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path })
    });
    const project = await projectResponse.json();
    if (!projectResponse.ok) throw new Error(JSON.stringify(project));
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.project.id, providerId: 'fake', input: 'Check approval layout' })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    return (result.thread ?? result.value).id as string;
  }, projectPath);

  // Seed the canonical interaction; a GET-only mock made detail say Needs you
  // while the board still saw Working because its roster had no pending state.
  const auth = JSON.parse(readFileSync(join(home, '.zcc', 'auth.json'), 'utf8'));
  const hostRequest = async (path: string, body: unknown) => {
    const response = await fetch(new URL(`/internal/hosts/${path}`, window.url()), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zcc-host-id': auth.hostId, authorization: `Bearer ${auth.hostKey}` },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    expect(response.ok).toBe(true);
    expect(result.outcome).not.toBe('rejected');
    return result;
  };
  const pending = await hostRequest('interactive-request', {
    sessionId: threadId,
    interaction: {
      threadId, turnId: 'turn-1', providerId: 'fake', providerThreadId: 'provider-1', providerRequestId: 'request-1',
      payload: {
        kind: 'approval',
        reason: 'May I rerun the affected suites after updating the worker subscription tests?',
        availableDecisions: ['allow_once', 'allow_for_session', 'deny'],
        subject: { kind: 'command', itemId: 'item-1', command, cwd, actions: [{ type: 'unknown', command: action }], sessionGrant: null }
      }
    }
  });
  await window.route(`**/api/v1/threads/${threadId}/interactions/${pending.interactionId}/resolve`, async (route) => {
    resolution = route.request().postDataJSON();
    // The fixture command is inert; end its canonical wait after a decision.
    await hostRequest('interactive-request/interrupt', {
      sessionId: threadId, providerId: 'fake', threadIds: [threadId], reason: 'Preview decision received'
    });
    await route.fulfill({ json: {} });
  });
  const support = window.getByRole('dialog', { name: 'Support Zana' });
  if (await support.isVisible()) await support.getByRole('button', { name: 'Dismiss' }).click();
  await window.getByTestId('nav-agents').click();
  await expect(window.locator('.agent-card.is-thread')).toHaveClass(/lane-blocked/);
  await window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);

  const banner = window.getByTestId('thread-pending-banner');
  const preview = banner.getByLabel('Command', { exact: true });
  const details = banner.locator('details');
  const summary = details.locator('summary');
  await expect(banner).toBeVisible();
  await expect(window.locator('.thread-status-badge')).toContainText('Needs you');
  await expect(preview).toHaveText(`$ ${command}`);
  await expect(banner.getByText(cwd, { exact: true })).toBeHidden();
  await resize(1440, 900);
  expect((await banner.boundingBox())!.height).toBeLessThan(190);
  const summaryBox = (await summary.boundingBox())!;
  const actionsBox = (await banner.getByRole('toolbar').boundingBox())!;
  expect(Math.abs(summaryBox.y - actionsBox.y)).toBeLessThan(12);
  await banner.screenshot({ path: testInfo.outputPath('approval-compact.png'), animations: 'disabled' });

  await summary.focus();
  await summary.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(banner.getByText(cwd, { exact: true })).toBeVisible();
  await expect(banner.getByText(action, { exact: true })).toBeVisible();
  await summary.press('Enter');
  await expect(details).not.toHaveAttribute('open');

  for (const width of [900, 800]) {
    await resize(width, 740);
    await expect(preview).toBeVisible();
    await expect(banner.locator('.thread-pending-banner-reason')).toBeVisible();
    await expect(banner.getByTestId('thread-pending-decision-deny')).toBeVisible();
    expect(await banner.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await summary.click();
    await expect(banner.getByText(cwd, { exact: true })).toBeVisible();
    await summary.click();
    await banner.screenshot({ path: testInfo.outputPath(`approval-${width}.png`), animations: 'disabled' });
  }

  await banner.getByTestId('thread-pending-shell-toggle').click();
  await expect(preview).toHaveCount(0);
  await banner.getByTestId('thread-pending-shell-toggle').click();
  await expect(preview).toBeVisible();
  const allow = banner.getByTestId('thread-pending-decision-allow_once');
  await allow.focus();
  await allow.press('End');
  const deny = banner.getByTestId('thread-pending-decision-deny');
  await expect(deny).toBeFocused();
  await deny.press('Enter');
  await expect.poll(() => resolution).toEqual({ decision: 'deny' });
  await expect(banner).toHaveCount(0);
  await window.getByTestId('nav-agents').click();
  await expect(window.locator('.agent-card.is-thread')).not.toHaveClass(/lane-blocked/);
});
