import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { writeNodeStub } from './fixtures/aida-p2.js';
import { expect, test } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('Ask Zana ships in the sidebar, searches offline and preserves the draft through provider setup', async ({ app }) => {
  const { window: page } = app;
  const ask = page.getByTestId('nav-ask-zana/ask-zana');
  await expect(page.getByTestId('nav-docs')).toBeVisible();
  await expect(ask).toBeVisible();
  const entries = await page.getByRole('navigation', { name: 'Main navigation' })
    .locator('[data-sidebar-nav-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-testid')));
  expect(entries[entries.indexOf('nav-docs') + 1]).toBe('nav-ask-zana/ask-zana');

  await ask.click();
  await expect(page.getByRole('heading', { name: 'How can Zana help?' })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Search Zana help' });
  await page.context().setOffline(true);
  try {
    await input.fill('Why won’t Slack connect?');
    await input.press('Enter');
    await expect(page.getByText('Troubleshoot a Slack connection')).toBeVisible();
    await expect(page.getByText('Check your Slack account', { exact: true })).toBeVisible();
    await input.fill('How far away is Jupiter?');
    await input.press('Enter');
    await expect(page.getByRole('heading', { name: 'No matching guide' })).toBeVisible();
  } finally {
    await page.context().setOffline(false);
  }

  await input.fill('How do I schedule a weekly task?');
  await page.getByRole('button', { name: 'Connect an AI provider' }).click();
  await expect(page).toHaveURL(/\/settings\/harness/u);
  await expect(page.getByText('Your AI harnesses', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to app' }).click();
  await expect(input).toHaveValue('How do I schedule a weekly task?');
  await page.setViewportSize({ width: 780, height: 720 });
  await input.press('Enter');
  await expect(page.getByText('Schedule a recurring task', { exact: true })).toBeVisible();
});

test.describe('local signed-in provider', () => {
  test.skip(process.platform === 'win32', 'The controlled provider uses a POSIX executable fixture.');
  test.use({
    initialConfig: { sponsorPromptDismissed: true, defaultThreadProviderId: 'claude-code' },
    launchEnv: async ({ home }, use) => {
      const bin = join(home, 'ask-zana-bin');
      mkdirSync(bin);
      const binary = writeNodeStub(bin, 'claude', `
const fs = require('node:fs');
const readline = require('node:readline');
const state = ${JSON.stringify(join(home, 'ask-zana-provider-ready'))};
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('2.1.296 (Claude Code)');
} else if (args[0] === 'auth' && args[1] === 'login') {
  fs.writeFileSync(state, 'ready');
} else if (args.includes('--safe-mode')) {
  if (!fs.existsSync(state)) process.exit(1);
  const model = args[args.indexOf('--model') + 1];
  const prompt = JSON.parse(args.at(-1));
  const isolated = args[args.indexOf('--tools') + 1] === '' &&
    args.includes('--strict-mcp-config') && args.includes('--no-session-persistence') &&
    args.includes('--no-chrome') && process.cwd() !== ${JSON.stringify(home)};
  if (!isolated) process.exit(2);
  fs.appendFileSync(${JSON.stringify(join(home, 'ask-zana-provider-requests.jsonl'))},
    JSON.stringify({ model, question: prompt.question, recentTurns: prompt.recentTurns, guides: prompt.guides.map(g => g.id) }) + '\\n');
  console.log(JSON.stringify({ answer: 'Reply from ' + model, sourceIds: ['slack'] }));
} else if (args.includes('--input-format')) {
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const message = JSON.parse(line);
    if (message.type !== 'control_request') return;
    const result = message.request.subtype === 'initialize' ? {
      models: [
        { value: 'default', resolvedModel: 'claude-sonnet-fixture', displayName: 'Fixture Sonnet', description: 'Default' },
        { value: 'haiku', resolvedModel: 'claude-haiku-fixture', displayName: 'Fixture Haiku', description: 'Fast' }
      ], commands: [], agents: [],
      account: { apiProvider: 'firstParty', tokenSource: fs.existsSync(state) ? 'claude.ai' : 'none' }
    } : {};
    process.stdout.write(JSON.stringify({ type: 'control_response', response: {
      subtype: 'success', request_id: message.request_id, response: result
    } }) + '\\n');
  });
}
`);
      await use({
        ZCC_CLAUDE_CODE_EXECUTABLE: binary, ANTHROPIC_AUTH_TOKEN: '',
        PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`
      });
    }
  });

  test('uses shared credentials, sends a follow-up to the chosen model, and recovers from disconnect', async ({ app, home }) => {
    const { window: page } = app;
    const state = join(home, 'ask-zana-provider-ready');
    const ask = page.getByTestId('nav-ask-zana/ask-zana');
    await ask.click();
    const draft = 'Why won’t Slack connect?';
    await page.getByRole('textbox', { name: 'Search Zana help' }).fill(draft);
    await page.getByRole('button', { name: 'Connect an AI provider' }).click();
    await page.getByRole('button', { name: 'Configure Claude Code' }).click();
    const login = page.getByRole('button', { name: 'Sign in to Claude Code' });
    await expect(login).toBeVisible();
    await login.click();
    await expect.poll(() => existsSync(state)).toBe(true);
    await expect(page.getByText('Credentials ready', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Back to app' }).click();
    const input = page.getByRole('textbox', { name: 'Ask a question about Zana' });
    await expect(input).toHaveValue(draft);
    await input.press('Enter');
    await expect(page.getByText('Reply from claude-sonnet-fixture')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();

    const picker = page.getByRole('combobox', { name: /^Model/ });
    await picker.selectOption({ label: 'Fixture Haiku' });
    await expect(picker).toBeEnabled();
    await input.fill('Where is that setting?');
    await input.press('Enter');
    await expect(page.getByText('Reply from claude-haiku-fixture')).toBeVisible();
    const calls = readFileSync(join(home, 'ask-zana-provider-requests.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(calls.map(call => call.model)).toEqual(['claude-sonnet-fixture', 'claude-haiku-fixture']);
    expect(calls[1]).toMatchObject({ guides: ['slack'], recentTurns: [{ question: draft }] });

    unlinkSync(state);
    await input.fill('How do I connect Slack again?');
    await input.press('Enter');
    await expect(page.getByText('Troubleshoot a Slack connection').last()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search Zana help' })).toHaveValue('How do I connect Slack again?');
    writeFileSync(state, 'ready');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('Reply from claude-haiku-fixture')).toHaveCount(2);
  });
});
