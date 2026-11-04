import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, dismissConsentOverlays } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

for (const surface of ['thread', 'assistant'] as const) {
  test(`${surface} keeps typing focus when agent approvals arrive and finish`, async ({ app }) => {
    test.setTimeout(120_000);
    const win = app.window;
    const projectPath = join(app.home, 'focus-project');
    mkdirSync(projectPath);
    const projectId = await win.evaluate(async path => {
      const project = await window.cc.projects.add(path);
      if (!project.ok) throw new Error(project.message);
      return project.value.id;
    }, projectPath);
    await dismissConsentOverlays(win);
    let threadId: string;
    if (surface === 'thread') {
      threadId = await win.evaluate(async projectId => {
        const response = await fetch('/api/v1/threads', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId, providerId: 'fake', input: 'Initial turn' })
        });
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()).thread.id as string;
      }, projectId);
      await win.evaluate(id => {
        history.pushState({}, '', `/threads/${id}`);
        dispatchEvent(new PopStateEvent('popstate'));
      }, threadId);
    } else {
      expect(await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'pr-monitor' }))).toMatchObject({ ok: true });
      expect(await win.evaluate(() => window.cc.pluginApps.setEnabled('pr-monitor', true))).toMatchObject({ ok: true });
      await win.evaluate(async () => {
        for (const plugin of await window.cc.pluginApps.list()) {
          if (plugin.id.startsWith('harness-')) await window.cc.pluginApps.setEnabled(plugin.id, false);
        }
      });
      await win.getByRole('button', { name: /^PR Monitor/ }).click();
      await win.getByTestId('plugin-panel-agent-show').click();
      const composer = win.getByTestId('panel-agent-tab-composer');
      await composer.getByTestId('thread-command-input').fill('Initial turn');
      await composer.getByTestId('thread-command-send').click();
      await expect(win.getByTestId('panel-agent-tab-chat')).toBeVisible();
      threadId = await win.evaluate(() => {
        const key = Object.keys(localStorage).find(key => key.startsWith('zcc.secondaryPanel.plugin-panel:pr-monitor:'));
        const state = JSON.parse(localStorage.getItem(key!)!);
        return state.tabs.find((tab: { kind: string; threadId?: string }) => tab.kind === 'agent' && tab.threadId).threadId as string;
      });
    }
    const detail = surface === 'assistant' ? win.getByTestId('panel-agent-tab-chat') : win.getByTestId('thread-detail');
    await expect(detail.getByTestId('thread-assistant-text')).toContainText('Response to: Initial turn');
    // A second live agent keeps roster and activity updates flowing during typing.
    await win.evaluate(async projectId => {
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, providerId: 'fake', input: 'delay:60000 Background work' })
      });
      if (!response.ok) throw new Error(await response.text());
    }, projectId);
    const input = detail.getByTestId('thread-command-input');
    await input.fill('Keep my draft');
    await expect(input).toBeFocused();
    const auth = JSON.parse(readFileSync(join(app.home, '.zcc', 'auth.json'), 'utf8'));
    const hostRequest = async (path: string, body: unknown) => {
      const response = await fetch(new URL(`/internal/hosts/${path}`, win.url()), {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-zcc-host-id': auth.hostId, authorization: `Bearer ${auth.hostKey}` },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      expect(response.ok, JSON.stringify(result)).toBe(true);
      expect(result.outcome).not.toBe('rejected');
    };
    await hostRequest('interactive-request', {
      sessionId: threadId,
      interaction: {
        threadId, turnId: 'focus-turn', providerId: 'fake', providerThreadId: 'focus-provider', providerRequestId: 'focus-request',
        payload: { kind: 'approval', reason: 'Focus regression fixture', availableDecisions: ['allow_once', 'deny'],
          subject: { kind: 'command', itemId: 'focus-command', command: 'echo focus', cwd: projectPath, actions: [], sessionGrant: null } }
      }
    });
    await expect(detail.getByTestId('thread-pending-banner')).toBeVisible();
    await expect(input).toBeFocused();
    // Use the keyboard directly: locator.press would refocus the editor and hide the bug.
    await win.keyboard.type(' while agents run');
    await expect(input).toHaveText('Keep my draft while agents run');
    await hostRequest('interactive-request/interrupt', {
      sessionId: threadId, providerId: 'fake', threadIds: [threadId], reason: 'Focus fixture finished'
    });
    await expect(detail.getByTestId('thread-pending-banner')).toHaveCount(0);
    await expect(input).toBeFocused();
    await win.keyboard.type(' and finish');
    await expect(input).toHaveText('Keep my draft while agents run and finish');
  });
}
