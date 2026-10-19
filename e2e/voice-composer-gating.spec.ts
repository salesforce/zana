import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

// The mic must follow Settings → Experimental → Voice input in the agent composer, and when on but
// not set up it must stay disabled with the specific reason (not a generic "daemon" message).
async function openThread(app: { window: import('@playwright/test').Page }, home: string): Promise<void> {
  const project = join(home, 'voice-gating-project');
  mkdirSync(project);
  const threadId = await app.window.evaluate(async (path) => {
    const added = await window.cc.projects.add(path);
    if (!added.ok) throw new Error('Cannot add fixture project');
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: added.value.id, providerId: 'fake', input: 'Voice gating' }) });
    const body = await response.json();
    return (body.thread ?? body.value).id as string;
  }, project);
  await app.window.goto(`${new URL(app.window.url()).origin}/threads/${threadId}`);
  await expect(app.window.getByTestId('thread-command-input')).toBeVisible();
}

const mic = (page: import('@playwright/test').Page) => page.locator('.voice-input-btn');

test('agent composer shows no mic while dictation is off in Experimental', async ({ app, home }) => {
  await openThread(app, home);
  await expect(mic(app.window)).toHaveCount(0);
});

test.describe('dictation on', () => {
  test.use({ initialConfig: { sponsorPromptDismissed: true, voiceInputEnabled: true } });

  test('mic is disabled with the credentials reason when the host has no Codex login', async ({ app, home }) => {
    await app.window.route('**/api/v1/system/voice-status', (route) =>
      route.fulfill({ json: { enabled: false, reason: 'auth_missing' } }));
    await openThread(app, home);
    const options = app.window.getByRole('button', { name: 'Composer options', exact: true });
    if (await options.isVisible() && await options.getAttribute('aria-expanded') !== 'true') await options.click();
    const button = mic(app.window);
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('aria-label', /codex login/);
    await expect(app.window.locator('[data-tooltip*="codex login"]')).toHaveCount(1);
  });

  test('mic is enabled when the host reports ready', async ({ app, home }) => {
    await app.window.route('**/api/v1/system/voice-status', (route) => route.fulfill({ json: { enabled: true, reason: null } }));
    await app.window.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => new MediaStream() });
      Object.defineProperty(window, 'MediaRecorder', { value: class { static isTypeSupported() { return true; } } });
    });
    await openThread(app, home);
    const options = app.window.getByRole('button', { name: 'Composer options', exact: true });
    if (await options.isVisible() && await options.getAttribute('aria-expanded') !== 'true') await options.click();
    await expect(app.window.getByRole('button', { name: 'Start voice input', exact: true })).toBeEnabled();
  });

  test.describe('unstubbed host status', () => {
    // Empty OPENAI_API_KEY so a developer's shell key cannot make the isolated HOME look ready.
    test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1', OPENAI_API_KEY: '' } });

    test('mic reflects the real /system/voice-status for a HOME with no ~/.codex', async ({ app, home }) => {
      await openThread(app, home);
      const status = await app.window.evaluate(async () =>
        (await fetch('/api/v1/system/voice-status')).json() as Promise<{ enabled: boolean; reason?: string | null }>);
      // Never ready: the isolated HOME has no Codex login. Which reason depends on whether the
      // fixture's local host-daemon has connected yet.
      expect(status.enabled).toBe(false);
      expect(['auth_missing', 'no_host']).toContain(status.reason);
      const options = app.window.getByRole('button', { name: 'Composer options', exact: true });
      if (await options.isVisible() && await options.getAttribute('aria-expanded') !== 'true') await options.click();
      const button = mic(app.window);
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('aria-label', status.reason === 'auth_missing' ? /codex login/ : /Host daemon is not connected/);
    });
  });
});
