import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test as base, expect } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';

// Use the real Pi CLI, including its argument validator and injected tools.
// Only model responses are deterministic; plugin/server/renderer paths are production code.
const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const agentDir = join(home, '.pi', 'agent');
    mkdirSync(join(agentDir, 'extensions'), { recursive: true });
    writeFileSync(join(agentDir, 'extensions', 'question-fixture.ts'), `
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
export default function(pi) {
  const normal = { questions: [{ question: 'Which option do you prefer?', options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }] };
  const cases = {
    A: normal,
    B: { questions: JSON.stringify([{ question: 'Which option should I pick?', options: ['A', 'B', 'C'] }]) },
    C: { questions: [
      { header: 'Color', question: 'Pick colors', multiSelect: true, options: [{ label: 'Red', description: 'warm' }, { label: 'Blue', description: 'cool' }, { label: 'Green' }] },
      { question: 'Pick a size', options: ['S', 'M', 'L'] }
    ] },
    D: { questions: [] },
    E: normal
  };
  pi.registerProvider('question-fixture', {
    baseUrl: 'http://127.0.0.1:1', apiKey: 'fixture-only', api: 'question-fixture-api',
    models: [{ id: 'test', name: 'Question fixture', input: ['text'], reasoning: false,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 1024 }],
    streamSimple(model, context) {
      const last = context.messages.at(-1);
      const done = last?.role === 'toolResult';
      const user = context.messages.findLast(message => message.role === 'user');
      const input = typeof user.content === 'string' ? user.content : user.content.map(part => part.text ?? '').join(' ');
      const key = input.match(/CASE_([A-E])/)[1];
      const reply = done ? 'RESULT_' + key + ': ' + last.content.map(part => part.text ?? '').join(' ') : '';
      const content = done ? [{ type: 'text', text: reply }] : [{ type: 'toolCall', id: 'ask-' + key, name: 'ask_user_question', arguments: cases[key] }];
      const message = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id,
        stopReason: done ? 'stop' : 'toolUse', timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: 'start', partial: message });
        if (done) {
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: reply, partial: message });
          stream.push({ type: 'text_end', contentIndex: 0, content: reply, partial: message });
        } else {
          stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
          stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall: content[0], partial: message });
        }
        stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end();
      });
      return stream;
    }
  });
}
`);
    const cli = resolve(import.meta.dirname, '../plugins/provider-pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js');
    await use({ PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1',
      ZCC_PI_BRIDGE_COMMAND: process.execPath, ZCC_PI_BRIDGE_ARGS: JSON.stringify([cli]) });
  }
});

test('Pi question cards normalize legacy input, render details, reject empty input, and cancel', async ({ app, home }) => {
  test.setTimeout(120_000);
  const window = app.window;
  // Deliberately no wait for the ask-user-question plugin: it activates after
  // provider-pi, and thread creation itself must wait for plugin startup so
  // the first thread after launch is offered ask_user_question.
  await waitForThreadProvider(window, 'pi');
  const path = join(home, 'questions-project');
  mkdirSync(path);
  const projectId = await window.evaluate(async path => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    return project.value.id;
  }, path);
  let id: string;
  const banner = window.getByTestId('thread-pending-banner');
  const timeline = window.getByTestId('thread-timeline');
  const idle = () => expect.poll(() => window.evaluate(async id => (await (await fetch('/api/v1/threads/' + id)).json()).thread.status, id), { timeout: 30_000 }).toBe('idle');
  // Independent threads keep each payload case isolated from previous conversation state.
  const ask = async (key: string) => {
    id = await window.evaluate(async ({ projectId, key }) => {
      const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, providerId: 'pi', model: 'question-fixture/test', permissionMode: 'full', reasoningLevel: 'none', input: 'CASE_' + key }) });
      const result = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(result));
      return result.thread.id as string;
    }, { projectId, key });
    await window.evaluate(id => { history.pushState({}, '', '/threads/' + id); dispatchEvent(new PopStateEvent('popstate')); }, id);
  };
  const submitted = async (selected: string) => {
    await banner.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(banner).toHaveCount(0);
    await expect(timeline).toContainText(selected);
    await idle();
  };

  await ask('A');
  await expect(banner).toContainText('Which option do you prefer?');
  const submit = banner.getByTestId('thread-pending-question-submit');
  await expect(submit).toHaveAttribute('title', process.platform === 'darwin' ? 'Submit (⌘↵)' : 'Submit (Ctrl+Enter)');
  await expect(submit).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
  // Ctrl+Enter / ⌘↵ submits from a focused option, like the Submit button.
  await banner.getByRole('button', { name: 'B', exact: true }).click();
  await window.keyboard.press('ControlOrMeta+Enter');
  await expect(banner).toHaveCount(0);
  await expect(timeline).toContainText('"selected":["B"]');
  await idle();

  await ask('B');
  await expect(banner).toContainText('Which option should I pick?');
  await banner.getByRole('button', { name: 'C', exact: true }).click();
  await submitted('"selected":["C"]');

  await ask('C');
  await expect(banner.getByRole('group', { name: 'Pick colors' })).toBeVisible();
  await expect(banner.getByTestId('thread-pending-question-step').first()).toHaveText('Color');
  await expect(banner).toHaveClass(/thread-pending-question-banner/);
  await expect(banner.getByText('warm', { exact: true })).toBeVisible();
  await expect(banner.getByText('cool', { exact: true })).toBeVisible();
  await banner.getByRole('button', { name: 'Red warm', exact: true }).click();
  await banner.getByRole('button', { name: 'Blue cool', exact: true }).click();
  await expect(banner.getByRole('button', { name: 'Red warm' })).toHaveAttribute('aria-pressed', 'true');
  await expect(banner.getByRole('button', { name: 'Blue cool' })).toHaveAttribute('aria-pressed', 'true');
  await banner.getByRole('button', { name: 'Next', exact: true }).click();
  await banner.getByRole('button', { name: 'M', exact: true }).click();
  await submitted('"selected":["Red","Blue"]');
  await expect(timeline).toContainText('"selected":["M"]');

  await ask('D');
  await expect(timeline).toContainText('RESULT_D:');
  await expect(timeline).toContainText('ask_user_question needs { "questions": [');
  await expect(banner).toHaveCount(0);
  await idle();

  await ask('E');
  await expect(banner).toContainText('Which option do you prefer?');
  await banner.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(timeline).toContainText('"outcome":"cancelled"');
  await expect(banner).toHaveCount(0);
  await idle();
});
