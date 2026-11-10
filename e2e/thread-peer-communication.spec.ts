import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { stubNativeDialogs } from './sdk/native-dialog.js';

test.use({ isolateBundledCatalog: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true } });

test('threads and CLI Agents discover peers, queue messages and preserve source and stop authority', async ({ app }, testInfo) => {
  test.setTimeout(180_000);
  const { window, home } = app;
  const root = join(realpathSync(home), 'peer-project'); mkdirSync(root);
  const agent = makeFakeAgentBinary({ script: `
if [ "$1" = "--version" ]; then echo '2.1.220 (fake)'; exit 0; fi
printf '%s' "$ZCC_MCP_URL" > .peer-mcp-url
stty -icanon -echo
exec cat > .peer-cli-input
` });
  let sessionId: string | undefined;
  const request = (path: string, body?: unknown) => window.evaluate(async ({ path, body }) => {
    const response = await fetch(`/api/v1/${path}`, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(result)}`);
    return result;
  }, { path, body });
  const prompt = (name: string, args: unknown) => `call_tool:${name} tool_args:${Buffer.from(JSON.stringify(args)).toString('base64url')}`;
  const idle = async (id: string) => expect.poll(async () => (await request(`threads/${id}`)).thread.status, { timeout: 30_000 }).toBe('idle');
  const sendTool = async (id: string, name: string, args: unknown) => {
    await request(`threads/${id}/send`, { input: prompt(name, args), mode: 'auto' });
    await idle(id);
  };
  const navigate = async (id: string) => window.evaluate(id => {
    history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate'));
  }, id);
  try {
    await window.evaluate(binary => window.cc.config.set({ claudeBinary: binary }), agent.path);
    const ids = await window.evaluate(async path => {
      const project = await window.cc.projects.add(path);
      if (!project.ok) throw new Error(project.message);
      const session = await window.cc.terminals.create({ projectId: project.value.id, profile: 'claude', cols: 80, rows: 24 });
      if (!session.ok) throw new Error(session.message);
      return { projectId: project.value.id, sessionId: session.value.id };
    }, root);
    sessionId = ids.sessionId;
    await expect.poll(() => existsSync(join(root, '.peer-mcp-url'))).toBe(true);
    const mcpUrl = readFileSync(join(root, '.peer-mcp-url'), 'utf8');
    const call = async (name: string, args = {}) => {
      const response = await fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.error, JSON.stringify(body)).toBeUndefined();
      expect(body.result.isError, JSON.stringify(body)).not.toBe(true);
      return body.result.content[0].text as string;
    };
    await call('register_agent', { handle: 'cli-reviewer' });
    const sender = (await request('threads', { projectId: ids.projectId, providerId: 'fake', title: 'Builder', input: prompt('register_agent', { handle: 'builder' }) })).thread.id;
    await idle(sender);
    const recipient = (await request('threads', { projectId: ids.projectId, providerId: 'fake', title: 'Reviewer', input: 'delay:14000 working on review' })).thread.id;
    const peers = JSON.parse(await call('list_agents'));
    expect(peers).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: sender, kind: 'thread', handle: 'builder' })]));
    expect(JSON.parse(await call('find_agent', { handle: 'builder' }))).toEqual([expect.objectContaining({ sessionId: sender })]);

    const pending = async (id: string) => (await request(`threads/${id}/peer-messages`)).items;
    const reviews = window.getByTestId('thread-peer-reviews');
    const approve = async (id: string, cli = false) => {
      await navigate(id);
      await stubNativeDialogs(app.electron, [1]);
      await reviews.getByRole('button', { name: cli ? 'Deliver to CLI Agent' : 'Deliver to thread' }).click();
    };
    await window.evaluate(() => { history.pushState({}, '', '/settings/experimental'); dispatchEvent(new PopStateEvent('popstate')); });
    const flag = window.getByRole('switch', { name: 'Enable thread communication' });
    await expect(flag).toHaveAttribute('aria-checked', 'true');

    await sendTool(sender, 'agent_send', { to: recipient, message: 'Please check the queue transition.' });
    expect((await request(`threads/${recipient}/next-turn`)).items).toEqual([]);
    expect(JSON.stringify(await request(`threads/${recipient}/events?limit=100`))).not.toContain('Please check the queue transition.');
    await navigate(recipient);
    await expect(reviews).toContainText('Please check the queue transition.');
    await window.screenshot({ path: testInfo.outputPath('thread-peer-review.png') });
    await stubNativeDialogs(app.electron, [0]);
    await reviews.getByRole('button', { name: 'Deliver to thread' }).click();
    await expect(reviews.getByRole('alert')).toContainText('cancelled');
    expect((await pending(recipient))[0].status).toBe('pending');
    await approve(recipient);
    await expect(window.getByTestId('thread-user-text').filter({ hasText: 'Please check the queue transition.' })).toBeVisible({ timeout: 30_000 });
    const bubble = window.getByTestId('thread-user-text').filter({ hasText: 'Please check the queue transition.' });
    await expect(bubble).not.toContainText('[zcc message');
    await window.screenshot({ path: testInfo.outputPath('thread-peer-delivery.png') });
    await bubble.getByRole('link', { name: 'builder' }).click();
    await expect.poll(() => window.evaluate(() => location.pathname)).toBe(`/threads/${sender}`);
    await idle(recipient);

    // Neither peer identity nor a delivery approval can be asserted by renderer/agent JSON.
    const forged = await window.evaluate(async () => (await fetch('/api/v1/thread-peers/tool', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caller: { sessionId: 'forged', projectId: 'forged', kind: 'cli-agent', displayName: 'Forged' }, name: 'list_agents', input: {} })
    })).status);
    expect(forged).toBe(403);
    const largeMessage = `The CLI bridge reached the thread. ${'x'.repeat(10_000)} END PEER PAYLOAD`;
    await call('agent_send', { to: 'builder', message: largeMessage });
    await expect(reviews).toContainText('END PEER PAYLOAD');
    expect(JSON.stringify(await request(`threads/${sender}/events?limit=100`))).not.toContain('END PEER PAYLOAD');
    const selected = (await pending(sender))[0];
    const unsigned = await window.evaluate(async ({ sender, selected }) => (await fetch(`/api/v1/threads/${sender}/peer-messages/${selected.id}/send`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmed: true, expectedUpdatedAt: selected.updatedAt })
    })).status, { sender, selected });
    expect(unsigned).toBe(403);
    await approve(sender);
    await expect.poll(async () => JSON.stringify(await request(`threads/${sender}/events?limit=100`))).toContain('END PEER PAYLOAD');
    await idle(sender);

    const reply = `Thread reply reached the CLI. ${'🌍'.repeat(5000)} END CLI PAYLOAD`;
    await sendTool(sender, 'agent_send', { to: 'cli-reviewer', message: reply });
    expect(JSON.parse(await call('agent_inbox'))).toEqual([]);
    await expect(reviews).toContainText('END CLI PAYLOAD');
    // A real lifecycle hook makes the fake PTY idle, then the normal IPC delivers.
    expect((await fetch(new URL(`/hook/stop/${ids.projectId}/${ids.sessionId}`, mcpUrl), { method: 'POST' })).ok).toBe(true);
    await expect.poll(() => window.evaluate(async id => (await window.cc.terminals.agentStatusSnapshot()).find(([sessionId]) => sessionId === id)?.[1], ids.sessionId)).toBe('idle');
    await approve(sender, true);
    await expect.poll(() => existsSync(join(root, '.peer-cli-input')) && readFileSync(join(root, '.peer-cli-input'), 'utf8').includes(reply), { timeout: 15_000, message: 'the CLI receives the complete reviewed UTF-8 payload' }).toBe(true);
    expect(JSON.parse(await call('agent_inbox'))).toEqual([]); // no duplicate mailbox delivery

    // Stop and ordinary user resume never approve a pending peer message.
    await request(`threads/${recipient}/send`, { input: 'delay:30000 stop this review', mode: 'auto' });
    await request(`threads/${recipient}/stop`, {}); await idle(recipient);
    await sendTool(sender, 'agent_send', { to: recipient, message: 'Wait for the user to resume.' });
    await navigate(recipient);
    await expect(reviews.getByRole('button', { name: 'Deliver to thread' })).toBeDisabled();
    expect((await request(`threads/${recipient}/next-turn`)).items).toEqual([]);
    await request(`threads/${recipient}/send`, { input: 'Resume the review now.', mode: 'auto' }); await idle(recipient);
    expect((await pending(recipient))[0].status).toBe('pending');
    expect(JSON.stringify(await request(`threads/${recipient}/events?limit=100`))).not.toContain('Wait for the user to resume.');

    // Turning off blocks cached tools and pending delivery; off/on does not grant consent.
    await window.evaluate(() => { history.pushState({}, '', '/settings/experimental'); dispatchEvent(new PopStateEvent('popstate')); });
    await flag.click(); await expect(flag).toHaveAttribute('aria-checked', 'false');
    await sendTool(sender, 'agent_send', { to: recipient, message: 'Must be blocked by the host.' });
    expect(await pending(recipient)).toHaveLength(1);
    await navigate(recipient); await expect(reviews.getByRole('button', { name: 'Deliver to thread' })).toBeDisabled();
    await window.evaluate(() => { history.pushState({}, '', '/settings/experimental'); dispatchEvent(new PopStateEvent('popstate')); });
    await flag.click(); await expect(flag).toHaveAttribute('aria-checked', 'true');
    await approve(recipient);
    await expect.poll(async () => JSON.stringify(await request(`threads/${recipient}/events?limit=100`))).toContain('Wait for the user to resume.');
    await idle(recipient);
    await sendTool(sender, 'agent_send', { to: recipient, message: 'Discard without starting a turn.' });
    await navigate(recipient); await reviews.getByRole('button', { name: 'Discard' }).click();
    await expect(reviews).toHaveCount(0);
    expect(JSON.stringify(await request(`threads/${recipient}/events?limit=100`))).not.toContain('Discard without starting a turn.');
  } finally {
    if (sessionId) await window.evaluate(id => window.cc.terminals.close(id), sessionId).catch(() => undefined);
    agent.cleanup();
  }
});
