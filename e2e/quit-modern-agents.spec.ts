import { test, expect } from './fixtures/app.js';
import { nativeDialogCalls, stubNativeDialogs } from './sdk/native-dialog.js';

test.use({
  initialConfig: { sponsorPromptDismissed: true, confirmQuitOnLiveSessions: true },
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  isolateBundledCatalog: true
});

test('quitting protects a Modern agent without a terminal and Cancel preserves its turn', async ({ app }) => {
  const thread = await app.window.evaluate(async () => {
    const project = (await (await fetch('/api/v1/projects')).json()).projects[0];
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, providerId: 'fake', title: 'Quit guard agent', input: 'delay:60000 quit guard' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread as { id: string };
  });
  const status = () => app.window.evaluate(async (id) =>
    (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, thread.id);
  await expect.poll(status).toBe('active');
  await stubNativeDialogs(app.electron, [1, 0]);
  await app.electron.evaluate(({ app }) => app.quit());
  await expect.poll(() => nativeDialogCalls(app.electron)).toHaveLength(1);
  expect((await nativeDialogCalls(app.electron))[0]).toMatchObject({
    message: 'Quit and end 1 running session?', buttons: ['Quit', 'Cancel'], defaultId: 1, cancelId: 1
  });
  expect(await status()).toBe('active');
  await expect(app.window.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  const closed = app.electron.waitForEvent('close');
  await app.electron.evaluate(({ app }) => app.quit());
  await closed;
});

test('an idle desktop quits without a confirmation', async ({ app }) => {
  await stubNativeDialogs(app.electron, [1]);
  const closed = app.electron.waitForEvent('close');
  await app.electron.evaluate(({ app }) => app.quit());
  await closed;
});

test('quits after the dev launcher disconnects its output pipes', async ({ app }) => {
  await stubNativeDialogs(app.electron, [0]);
  // Disconnect the parent's read ends while keeping Playwright's inspector alive.
  // This reproduces a dev app whose launcher has exited, without touching a live instance.
  const child = app.electron.process();
  child.stdout?.destroy();
  child.stderr?.destroy();
  const errors = await app.electron.evaluate(async () => {
    const failures: string[] = [];
    const monitor = (error: Error) => { failures.push(error.message); };
    process.on('uncaughtExceptionMonitor', monitor);
    try {
      // A runner may retain duplicate pipe handles. Also deliver the observed
      // native error so this proves bootstrap installed both guards in Electron.
      for (const stream of [process.stdout, process.stderr]) {
        stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      }
      process.stdout.write('direct disconnected stdout\n');
      process.stderr.write('direct disconnected stderr\n');
      console.log('disconnected dev stdout');
      console.warn('disconnected dev stderr');
      console.error('disconnected dev error');
      await new Promise(resolve => setTimeout(resolve, 100));
      return failures;
    } finally {
      process.off('uncaughtExceptionMonitor', monitor);
    }
  });
  expect(errors).toEqual([]);
  const closed = app.electron.waitForEvent('close');
  // Playwright normally reads the debugger-disconnect notice from stderr.
  // With stderr closed, close() explicitly detaches its inspector after app.quit().
  await app.electron.close();
  await closed;
});
