import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type AppHandle } from './fixtures/app.js';
test.use({
  e2e: true,
  initialConfig: { sponsorPromptDismissed: true },
  launchEnv: { ZCC_FAKE_PROVIDER: '1' },
  isolateBundledCatalog: true,
});
async function openThread(app: AppHandle) {
  const path = join(app.home, 'long-prompt-project');
  mkdirSync(path);
  const id = await app.window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.value.id,
        providerId: 'fake',
        input: 'Initial turn',
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  }, realpathSync(path));
  await app.window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, id);
  await expect(app.window.getByTestId('thread-assistant-text')).toContainText(
    'Response to: Initial turn',
  );
  await waitForCompletion(app, id);
  await expect(
    app.window.getByTestId('thread-assistant-text'),
  ).not.toHaveAttribute('data-streaming', 'true');
  return { detail: app.window.getByTestId('thread-detail'), threadId: id };
}

async function waitForCompletion(app: AppHandle, threadId: string) {
  await expect
    .poll(() =>
      app.window.evaluate(async (id) => {
        return (await (await fetch(`/api/v1/threads/${id}`)).json()).thread
          .status;
      }, threadId),
    )
    .toBe('idle');
}

test('selected reply becomes an editable composer annotation and persists in sent history', async ({
  app,
}) => {
  const { detail, threadId } = await openThread(app);
  await detail
    .locator('[data-thread-annotation-prose] p')
    .first()
    .evaluate((el) => {
      const r = document.createRange();
      r.setStart(el.firstChild!, 0);
      r.setEnd(el.firstChild!, el.firstChild!.textContent!.length);
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
    });
  await app.window
    .getByRole('button', { name: 'Annotate', exact: true })
    .click();
  await app.window
    .getByRole('textbox', { name: 'Your change', exact: true })
    .fill('Replace this introduction with a chat example.');
  await app.window
    .getByRole('button', { name: 'Add to composer', exact: true })
    .click();
  const inspect = detail.getByRole('button', {
    name: 'Inspect Response to: Initial turn',
  });
  await expect(inspect).toBeVisible();
  await inspect.click();
  await expect(
    app.window.getByRole('dialog', {
      name: 'Copied selection: Response to: Initial turn',
      exact: true,
    }),
  ).toContainText('Response to: Initial turn');
  await app.window
    .getByRole('textbox', { name: 'Edit annotation comment' })
    .fill('Use a shorter chat example.');
  await app.window
    .getByRole('button', { name: 'Save change', exact: true })
    .click();
  await detail.getByTestId('thread-command-send').click();
  await waitForCompletion(app, threadId);
  await expect(
    detail.getByTestId('thread-assistant-text').last(),
  ).toContainText('Use a shorter chat example.');
  await app.window.reload();
  await expect(
    detail.getByRole('button', { name: 'Inspect Response to: Initial turn' }),
  ).toBeVisible();
  await detail
    .getByRole('button', { name: 'Inspect Response to: Initial turn' })
    .click();
  await expect(
    app.window.getByRole('dialog', {
      name: 'Copied selection: Response to: Initial turn',
      exact: true,
    }),
  ).toContainText('Use a shorter chat example.');
  await expect(
    app.window.getByRole('link', { name: 'Show in thread' }),
  ).toHaveAttribute('href', new RegExp('/threads/' + threadId));
});

test('independent browser annotation plugin captures, edits and clears native page pins', async ({
  app,
  home,
}) => {
  test.setTimeout(120_000);
  const source = process.env.ZCC_ANNOTATIONS_PLUGIN_SOURCE;
  test.skip(
    !source,
    'Set ZCC_ANNOTATIONS_PLUGIN_SOURCE to the independent Agent Annotations source',
  );
  const {
    cpSync,
    mkdirSync: mkdir,
    readFileSync,
    writeFileSync,
    symlinkSync,
  } = await import('node:fs');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { resolve } = await import('node:path');
  const { createServer } = await import('node:http');
  const plugin = join(home, 'annotations-plugin');
  mkdir(plugin);
  const cliRoot = join(home, 'cli');
  cpSync(resolve('packages/cli/dist'), cliRoot, {
    recursive: true,
    dereference: true,
  });
  mkdir(join(plugin, 'node_modules'));
  symlinkSync(
    realpathSync(resolve('node_modules/zod')),
    join(plugin, 'node_modules/zod'),
    'junction',
  );
  for (const file of [
    'package.json',
    'app.tsx',
    'server.ts',
    'annotations.ts',
    'page-script.ts',
  ])
    cpSync(join(source!, file), join(plugin, file));
  const packageFile = join(plugin, 'package.json');
  const manifest = JSON.parse(readFileSync(packageFile, 'utf8'));
  delete manifest.devDependencies;
  writeFileSync(packageFile, JSON.stringify(manifest));
  const env = {
    ...process.env,
    HOME: home,
    ZCC_DATA_DIR: join(home, '.zcc'),
    ZCC_SERVER_URL: new URL(app.window.url()).origin,
    ZCC_SESSION_ID: undefined,
    ZCC_SESSION_TOKEN: undefined,
    ZCC_SKIP_PLUGIN_NPM: '1',
  };
  const run = promisify(execFile);
  await run(
    process.execPath,
    [join(cliRoot, 'bin/zcc'), 'plugin', 'install', '.'],
    { cwd: plugin, env, timeout: 90000 },
  );
  const { detail, threadId } = await openThread(app);
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      '<!doctype html><title>Annotation fixture</title><button id="review" style="margin:60px;padding:24px">Review proposal</button>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('missing port');
  const url = `http://127.0.0.1:${address.port}/`;
  const pageEval = (expression: string) =>
    app.window.evaluate(
      async ({ expression, threadId }) =>
        window.cc.browser.evaluate!({
          tabId: 'annotation-page',
          threadId,
          expression,
          world: 'main',
        }),
      { expression, threadId },
    );
  try {
    await app.electron.evaluate(
      async (_electron, { threadId, url }) => {
        const broker = (globalThis as any).__zccDesktopBrowserBroker;
        await broker.execute({
          ...broker.listInstances()[0],
          threadId,
          type: 'desktop.browser.create_tab',
          tabId: 'annotation-page',
          profile: { kind: 'personal' },
          url,
          presentation: 'reveal',
        });
      },
      { threadId, url },
    );
    await expect(
      app.window.getByRole('button', {
        name: 'Annotate elements',
        exact: true,
      }),
    ).toBeVisible();
    // Main authorizes scope; a renderer cannot execute against another thread's page.
    const denied = await app.window.evaluate(async () => {
      try {
        await window.cc.browser.evaluate!({
          tabId: 'annotation-page',
          threadId: 'wrong-thread',
          expression: '1',
        });
        return false;
      } catch {
        return true;
      }
    });
    expect(denied).toBe(true);
    await expect
      .poll(() => pageEval('document.readyState').catch(() => 'loading'))
      .toBe('complete');
    await app.window
      .getByRole('button', { name: 'Annotate elements', exact: true })
      .click();
    await expect
      .poll(() =>
        pageEval(
          '!!document.querySelector("bb-agent-annotations")?.shadowRoot',
        ),
      )
      .toBe(true);
    const clickTarget =
      'document.querySelector("#review").dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,clientX:90,clientY:90}))';
    await pageEval(clickTarget);
    await pageEval(
      `(()=>{const s=document.querySelector('bb-agent-annotations').shadowRoot;const t=s.querySelector('textarea');t.value='Make this blue';t.dispatchEvent(new Event('input',{bubbles:true}));t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));})()`,
    );
    const badge = detail.getByRole('button', { name: /Inspect 1\./ });
    await expect(badge).toBeVisible();
    await badge.click();
    await expect(
      app.window.getByRole('dialog', { name: /Copied selection: 1\./ }),
    ).toContainText('Make this blue');
    await expect(
      app.window.getByRole('dialog', { name: /Copied selection: 1\./ }),
    ).toContainText('#review');
    await app.window
      .getByRole('button', { name: 'Close selection preview' })
      .click();
    await pageEval(
      `document.querySelector('bb-agent-annotations').shadowRoot.querySelector('.pin').click()`,
    );
    await pageEval(
      `(()=>{const s=document.querySelector('bb-agent-annotations').shadowRoot;const t=s.querySelector('textarea');t.value='Make this green';t.dispatchEvent(new Event('input',{bubbles:true}));t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));})()`,
    );
    await expect
      .poll(async () => {
        await badge.click();
        const text = await app.window
          .getByRole('dialog', { name: /Copied selection: 1\./ })
          .textContent();
        await app.window
          .getByRole('button', { name: 'Close selection preview' })
          .click();
        return text;
      })
      .toContain('Make this green');
    await detail.getByTestId('thread-command-send').click();
    await waitForCompletion(app, threadId);
    await expect
      .poll(() =>
        pageEval(
          'document.querySelector("bb-agent-annotations").shadowRoot.querySelectorAll(".pin").length',
        ),
      )
      .toBe(0);
    await expect(
      detail.getByTestId('thread-assistant-text').last(),
    ).toContainText('Make this green');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
