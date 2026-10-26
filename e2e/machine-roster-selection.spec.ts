import { test, expect } from './fixtures/app.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

test('a project keeps its bound machine when the client roster omits it', async ({ app, home }) => {
  const page = app.window;
  const root = join(home, 'bound-machine-project'); mkdirSync(root);
  const hosts = await page.evaluate(async () => fetch('/api/v1/hosts').then(response => response.json()));
  const primary = hosts.find((host: any) => host.isPrimary);
  expect(primary?.id).toBeTruthy();
  const registered = await page.evaluate(async ({ path, hostId }) => {
    const response = await fetch('/api/v1/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, hostId }) });
    return { status: response.status, body: await response.json() };
  }, { path: root, hostId: primary.id });
  expect(registered.status).toBe(200);
  expect(registered.body.project.hostId).toBe(primary.id);
  const attempts: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/threads') attempts.push(request.postData() ?? '');
  });
  // Model a stale/revoked roster at the client boundary without changing the
  // real daemon registration. Old defaultHostId silently picked this other row.
  await page.route('**/api/v1/hosts', route => route.fulfill({ json: [
    { ...primary, id: 'unrelated-primary', name: 'Other machine' },
    { ...primary, id: 'unrelated-secondary', isPrimary: false, name: 'Third machine' }
  ] }));
  await page.reload();
  await page.getByTestId('nav-home').click();
  const composer = page.locator('.thread-command-composer').first();
  await composer.getByRole('button', { name: 'Machine and project', exact: true }).click();
  await page.getByRole('navigation', { name: 'Machines' }).getByTitle('Unavailable machine', { exact: true }).click();
  await page.getByRole('listbox', { name: 'Machine and project' }).getByRole('option', { name: /Unavailable machine › bound-machine-project/ }).click();
  await expect(composer.getByRole('button', { name: 'Machine and project', exact: true })).toContainText('Unavailable machine');
  await composer.getByTestId('thread-command-input').fill('Keep this draft on its original machine');
  await expect(composer.getByTestId('thread-command-send')).toBeDisabled();
  await expect(composer.getByTestId('thread-command-input')).toContainText('Keep this draft on its original machine');
  expect(attempts).toEqual([]);
});
