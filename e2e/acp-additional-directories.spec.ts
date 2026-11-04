import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';

const fixtureBin = dirname(
  fileURLToPath(new URL('./fixtures/bin/opencode', import.meta.url)),
);
test.use({
  initialConfig: {
    sponsorPromptDismissed: true,
    opencodeBinary: join(fixtureBin, 'opencode'),
  },
  launchEnv: async ({ home }, use) =>
    use({
      PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_ACP_LOAD_SESSION: '1',
      FAKE_ACP_ADDITIONAL_DIRECTORIES: '1',
      FAKE_ACP_PROMPT_PREFIX: 'policy-probe:',
      FAKE_ACP_REQUEST_LOG: join(home, 'acp-requests.log'),
      // A permissive caller environment must not override the selected mode.
      OPENCODE_PERMISSION: '{"bash":"allow"}',
    }),
});

test('packaged ACP forwards host-approved thread storage on new and restored sessions', async ({
  app,
}) => {
  test.setTimeout(120_000);
  const { window, home } = app;
  await waitForThreadProvider(window, 'acp-opencode');
  const path = join(home, 'permission-project');
  mkdirSync(path);
  const threadId = await window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.value.id,
        providerId: 'acp-opencode',
        permissionMode: 'accept-edits',
        input: 'policy-probe:echo-permission-env',
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread.id as string;
  }, path);
  await window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  const timeline = window.getByTestId('thread-timeline');
  const policy = (outside: string) =>
    `permission:${JSON.stringify({ edit: 'allow', bash: outside, webfetch: outside, external_directory: outside })}`;
  await expect(timeline).toContainText(policy('ask'), { timeout: 30_000 });
  const idle = () =>
    expect
      .poll(() =>
        window.evaluate(
          async (id) =>
            (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status,
          threadId,
        ),
      )
      .toBe('idle');
  for (const permissionMode of ['full'] as const) {
    await idle();
    await window.evaluate(
      async ({ id, permissionMode }) => {
        const response = await fetch(`/api/v1/threads/${id}/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            input: 'policy-probe:echo-permission-env',
            permissionMode,
          }),
        });
        if (!response.ok) throw new Error(await response.text());
      },
      { id: threadId, permissionMode },
    );
    await idle();
  }
  await expect(timeline.getByText(policy('ask'), { exact: true })).toHaveCount(
    1,
  );
  await expect(timeline).toContainText(policy('allow'));
  await expect(timeline).not.toContainText('Provider error');
  const requests = existsSync(join(home, 'acp-requests.log'))
    ? readFileSync(join(home, 'acp-requests.log'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
  // Catalogue discovery opens a separate session without thread tools. Inspect
  // only the real thread sessions, which carry the host MCP server.
  const sessions = requests.filter(
    (request) =>
      ['session/new', 'session/load'].includes(request.method) &&
      request.params?.cwd &&
      realpathSync(request.params.cwd) === realpathSync(path) &&
      Array.isArray(request.params.mcpServers) &&
      request.params.mcpServers.length > 0,
  );
  expect(sessions.map((request) => request.method)).toEqual([
    'session/new',
    'session/load',
  ]);
  for (const session of sessions) {
    expect(session.params.additionalDirectories).toHaveLength(1);
    expect(session.params.additionalDirectories[0]).toMatch(
      /[/\\]thread-storage$/,
    );
    expect(session.params.additionalDirectories).not.toContain(path);
  }
});
