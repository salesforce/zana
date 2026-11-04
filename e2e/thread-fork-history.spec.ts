import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test as base, expect } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';

// Exercise checkpoint forks through the real installed Pi CLI and session files.
// Only the model is deterministic and offline; the full Electron/host/UI path runs.
const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const agentDir = join(home, '.pi', 'agent');
    mkdirSync(join(agentDir, 'extensions'), { recursive: true });
    writeFileSync(join(agentDir, 'extensions', 'fork-model.ts'), `
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
export default function(pi) {
  pi.registerProvider('fork-fixture', {
    baseUrl: 'http://127.0.0.1:1', apiKey: 'fixture-only', api: 'embedded-fixture-api',
    models: [{ id: 'test', name: 'Fork fixture', input: ['text'], reasoning: false,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 1024 }],
    streamSimple(model, context) {
      const user = context.messages.findLast(message => message.role === 'user');
      const input = typeof user?.content === 'string' ? user.content :
        (user?.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('');
      const previous = context.messages.filter(message => message.role === 'user').slice(0, -1)
        .map(message => typeof message.content === 'string' ? message.content :
          message.content.filter(part => part.type === 'text').map(part => part.text).join(''));
      const text = 'Response to: ' + input + (input.includes('Continue fork') ?
        ' | Fork context: first=' + Number(previous.some(text => text.includes('First fork marker'))) +
        ';second=' + Number(previous.some(text => text.includes('Second fork marker'))) : '');
      const stream = createAssistantMessageEventStream();
      const message = { role: 'assistant', content: [{ type: 'text', text }],
        api: model.api, provider: model.provider, model: model.id, stopReason: 'stop', timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      queueMicrotask(() => {
        stream.push({ type: 'start', partial: message });
        stream.push({ type: 'text_start', contentIndex: 0, partial: message });
        stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: message });
        stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: message });
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end();
      });
      return stream;
    }
  });
}
`);
    const cli = process.env.ZCC_E2E_PI_CLI ?? resolve(import.meta.dirname,
      '../plugins/provider-pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js');
    await use({ PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1',
      ZCC_PI_BRIDGE_COMMAND: process.execPath, ZCC_PI_BRIDGE_ARGS: JSON.stringify([cli]) });
  },
  initialConfig: [{ sponsorPromptDismissed: true }, { option: true }]
});

for (const anchor of ['tip', 'first reply', 'second reply'] as const) {
  test(`fork from ${anchor} preserves the selected completed history`, async ({ app }) => {
    test.setTimeout(90_000);
    const { window } = app;
    await waitForThreadProvider(window, 'pi');
    const id = await window.evaluate(async () => {
      const { projects } = await (await fetch('/api/v1/projects')).json();
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: projects[0].id, providerId: 'pi', model: 'fork-fixture/test', permissionMode: 'full', reasoningLevel: 'none', input: 'First fork marker' })
      });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()).thread.id as string;
    });
    const idle = (threadId: string) => window.evaluate(async threadId =>
      (await (await fetch(`/api/v1/threads/${threadId}`)).json()).thread.status, threadId);
    await expect.poll(() => idle(id)).toBe('idle');
    await window.evaluate(async id => {
      const response = await fetch(`/api/v1/threads/${id}/send`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'Second fork marker' })
      });
      if (!response.ok) throw new Error(await response.text());
    }, id);
    await expect.poll(() => idle(id)).toBe('idle');
    const types = await window.evaluate(async id => {
      const { events } = await (await fetch(`/api/v1/threads/${id}/events?limit=100`)).json();
      return events.map((event: { type: string }) => event.type);
    }, id);
    // Exercise actual host storage envelopes, rather than synthetic slash-only rows.
    expect(types.filter((type: string) => type === 'turn.completed')).toHaveLength(2);
    await window.evaluate(id => {
      history.pushState({}, '', `/threads/${id}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, id);
    const timeline = window.getByTestId('thread-timeline');
    await expect(timeline).toContainText('Response to: Second fork marker');
    let childId: string;
    if (anchor === 'tip') {
      childId = await window.evaluate(async id => {
        const response = await fetch(`/api/v1/threads/${id}/fork`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
        });
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()).thread.id as string;
      }, id);
      await window.evaluate(id => {
        history.pushState({}, '', `/threads/${id}`);
        dispatchEvent(new PopStateEvent('popstate'));
      }, childId);
    } else {
      const responsePromise = window.waitForResponse(response =>
        response.url().endsWith(`/threads/${id}/fork`) && response.request().method() === 'POST');
      const reply = timeline.locator('article').filter({ hasText: anchor === 'first reply' ? 'Response to: First fork marker' : 'Response to: Second fork marker' });
      await reply.hover();
      await reply.getByTestId('thread-fork-message').click();
      const response = await responsePromise;
      expect(response.ok()).toBe(true);
      childId = (await response.json()).thread.id;
    }
    await expect(timeline).toContainText('Response to: First fork marker');
    if (anchor === 'first reply') await expect(timeline).not.toContainText('Second fork marker');
    else await expect(timeline).toContainText('Response to: Second fork marker');
    const composer = window.getByTestId('thread-detail').getByTestId('thread-command-input');
    // Navigation keeps the same view mounted; wait for the new thread's
    // execution catalogue before interacting with its composer.
    const send = window.getByTestId('thread-detail').getByTestId('thread-command-send');
    await expect(window.getByRole('heading', { name: /\(fork\)/ })).toBeVisible();
    await composer.fill('Continue fork');
    await expect(send).toBeEnabled();
    const sent = window.waitForResponse(response =>
      response.url().endsWith(`/threads/${childId}/send`) && response.request().method() === 'POST');
    await send.click();
    const sentResponse = await sent;
    expect(sentResponse.ok()).toBe(true);
    expect(JSON.stringify(sentResponse.request().postDataJSON())).toContain('Continue fork');

    await expect(timeline).toContainText(`Response to: Continue fork | Fork context: first=1;second=${anchor === 'first reply' ? 0 : 1}`);
    await expect.poll(() => idle(childId)).toBe('idle');
    const child = await window.evaluate(async id =>
      (await (await fetch(`/api/v1/threads/${id}`)).json()).thread, childId);
    expect(child.parentThreadId).toBe(id);
    expect(child.providerThreadId).toBeTruthy();
    await expect(window.locator('.thread-status-badge.is-error')).toHaveCount(0);
  });
}
