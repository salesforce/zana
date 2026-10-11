import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

async function createThread(window: import('@playwright/test').Page, title: string): Promise<string> {
  return window.evaluate(async (threadTitle) => {
    const projects = await fetch('/api/v1/projects').then((response) => response.json()) as {
      projects: Array<{ id: string }>;
    };
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: projects.projects[0]!.id,
        providerId: 'fake',
        title: threadTitle,
        input: 'delay:60000 parity probe'
      })
    });
    const body = await response.json() as { thread: { id: string } };
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread.id;
  }, title);
}

test('Modern thread actions work from Kanban and list hosts', async ({ app }) => {
  const { window } = app;
  const originalTitle = 'Card action parity probe';
  const renamedTitle = 'Renamed parity probe';
  const threadId = await createThread(window, originalTitle);

  await window.locator('[data-testid="nav-agents"]').click();
  const card = window.locator('.agent-card.is-thread', { hasText: originalTitle });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click({ button: 'right' });

  const menu = window.getByTestId('thread-context-menu');
  await expect(menu).toContainText('Pin');
  await expect(menu).toContainText('Mark read');
  await expect(menu).toContainText('Rename');
  await menu.getByRole('button', { name: 'Rename' }).click();
  const modal = window.locator('.prompt-modal');
  await expect(modal).toBeVisible();
  await modal.getByLabel('Title').fill(renamedTitle);
  await modal.getByRole('button', { name: 'Rename' }).click();

  await expect.poll(async () => window.evaluate(async (id) => {
    return (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.title;
  }, threadId)).toBe(renamedTitle);
  await expect(window.locator('.agent-card.is-thread', { hasText: renamedTitle })).toBeVisible();

  await window.locator('.agent-card.is-thread', { hasText: renamedTitle }).click({ button: 'right' });
  await window.getByTestId('thread-context-menu').getByRole('button', { name: 'Pin' }).click();
  await expect.poll(async () => window.evaluate(async (id) => {
    return (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.pinnedAt !== null;
  }, threadId)).toBe(true);

  await window.locator('.agent-card.is-thread', { hasText: renamedTitle }).click({ button: 'right' });
  await window.getByTestId('thread-context-menu').getByRole('button', { name: 'Mark read' }).click();
  await expect.poll(async () => window.evaluate(async (id) => {
    const thread = (await (await fetch(`/api/v1/threads/${id}`)).json()).thread;
    return thread.lastReadSeq === thread.maxSeq;
  }, threadId)).toBe(true);

  await window.locator('.agent-card.is-thread', { hasText: renamedTitle }).click({ button: 'right' });
  await window.getByTestId('thread-context-menu').getByRole('button', { name: 'Mark unread' }).click();
  await expect.poll(async () => window.evaluate(async (id) => {
    return (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.lastReadSeq;
  }, threadId)).toBe(-1);
  await expect(window.locator('.agent-card.is-thread', { hasText: renamedTitle }).getByTestId('thread-unread-indicator')).toBeVisible();

  await window.locator('.agent-card.is-thread', { hasText: renamedTitle }).click({ button: 'right' });
  await window.getByTestId('thread-context-menu').getByRole('button', { name: 'Mark read' }).click();
  await expect.poll(async () => window.evaluate(async (id) => {
    const thread = (await (await fetch(`/api/v1/threads/${id}`)).json()).thread;
    return thread.lastReadSeq === thread.maxSeq;
  }, threadId)).toBe(true);

  await window.getByLabel('List view').click();
  const listRow = window.locator('.agent-monitor-row.is-thread', { hasText: renamedTitle });
  await expect(listRow).toBeVisible({ timeout: 15_000 });
  const pinnedGroup = window.locator('.agent-monitor-group', { hasText: /^Pinned/ });
  await expect(pinnedGroup).toContainText(renamedTitle);
  await listRow.click({ button: 'right' });
  const listMenu = window.getByTestId('thread-context-menu');
  await expect(listMenu).toContainText('Mark unread');
  await expect(listMenu).toContainText('Unpin');
  await listMenu.getByRole('button', { name: 'Mark unread' }).click();
  await expect(listRow.getByTestId('thread-unread-indicator')).toBeVisible();
  await listRow.click({ button: 'right' });
  await expect(window.getByTestId('thread-context-menu')).toContainText('Mark read');
});

test('Thread menu changes the phone notification level and the server gates on it', async ({ app }) => {
  const { window } = app;
  const title = 'Notification level probe';
  const threadId = await createThread(window, title);

  const readLevel = (id: string) =>
    window.evaluate(async (threadId) => {
      const state = await (await fetch(`/api/v1/threads/${threadId}/notification-level`)).json();
      const verdict = await (
        await fetch(`/api/v1/threads/${threadId}/notification-verdict?kind=turn-finished`)
      ).json();
      return { own: state.own, effective: state.effective, send: verdict.send };
    }, id);

  await window.locator('[data-testid="nav-agents"]').click();
  const card = window.locator('.agent-card.is-thread', { hasText: title });
  await expect(card).toBeVisible({ timeout: 15_000 });
  expect(await readLevel(threadId)).toEqual({ own: 'inherit', effective: 'all', send: true });

  await card.click({ button: 'right' });
  const menu = window.getByTestId('thread-context-menu');
  const control = menu.getByTestId('thread-notification-level');
  await expect(control).toHaveAccessibleName('Notifications: All activity');
  await control.click();
  await menu.getByRole('menuitemradio', { name: 'Muted' }).click();

  await expect.poll(() => readLevel(threadId)).toEqual({ own: 'muted', effective: 'muted', send: false });
  await expect(control).toHaveAccessibleName('Notifications: Muted');
  await expect(menu.getByRole('menuitemradio', { name: 'Muted' })).toHaveAttribute('aria-checked', 'true');

  // The menu reopens on what the server holds, and "Default" clears the override.
  await window.keyboard.press('Escape');
  await card.click({ button: 'right' });
  await expect(window.getByTestId('thread-context-menu').getByTestId('thread-notification-level')).toHaveAccessibleName(
    'Notifications: Muted'
  );
  await window.getByTestId('thread-notification-level').click();
  await window.getByRole('menuitemradio', { name: 'Default' }).click();
  await expect.poll(() => readLevel(threadId)).toEqual({ own: 'inherit', effective: 'all', send: true });
});
