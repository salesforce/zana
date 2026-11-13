import { execFile } from 'node:child_process';
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test, expect, launchApp } from './fixtures/app.js';

const exec = promisify(execFile);
test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { npm_config_registry: 'https://registry.npmjs.org/', ZCC_FAKE_PROVIDER: '1' } });

test('packaged CLI creates, exercises, reloads, and diagnoses a plugin in built Electron', async ({ app: initialApp, home }) => {
  test.setTimeout(240_000);
  let app = initialApp;
  const tutorialHint = app.window.getByRole('button', { name: 'Dismiss tutorial hint', exact: true });
  async function dismissTutorialHint() {
    await app.window.removeLocatorHandler(tutorialHint);
    if (await tutorialHint.isVisible()) await tutorialHint.click();
    await app.window.addLocatorHandler(tutorialHint, async hint => {
      await hint.click();
    }, { times: 1 });
  }
  await dismissTutorialHint();
  const id = 'live-authoring-e2e';
  const copiedCli = join(home, 'cli');
  const shippedCli = await app.electron.evaluate(({ app }) => {
    return app.isPackaged ? `${process.resourcesPath}/zcc-cli/bin/zcc` : null;
  });
  if (!shippedCli) cpSync(resolve('packages/cli/dist'), copiedCli, { recursive: true, dereference: true });
  const cli = shippedCli ?? join(copiedCli, 'bin/zcc');
  expect(existsSync(cli)).toBe(true);
  const source = join(home, `zcc-plugin-${id}`);
  const env = {
    ...process.env, HOME: home, ZCC_DATA_DIR: join(home, '.zcc'),
    ZCC_SERVER_URL: new URL(app.window.url()).origin,
    ZCC_SESSION_ID: undefined, ZCC_SESSION_TOKEN: undefined,
    ZCC_SKIP_PLUGIN_NPM: '1', NODE_PATH: '', ESBUILD_BINARY_PATH: '',
    npm_config_registry: 'https://registry.npmjs.org/'
  };
  async function run(args: string[], cwd = source) {
    try {
      const result = await exec(process.execPath, [cli, ...args], { cwd, env, timeout: 150_000, maxBuffer: 2 * 1024 * 1024 });
      return { ...result, code: 0 };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number };
      return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? String(error), code: failure.code ?? 1 };
    }
  }
  const scaffold = await run(['plugin', 'new', id, '--app'], home);
  expect(scaffold.code, scaffold.stderr).toBe(0);
  const packagePath = join(source, 'package.json');
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
  // Shared plugin code can use pure SDK app helpers in its backend. The built
  // artifact must load in Electron even though this plugin has no node_modules.
  const serverPath = join(source, 'server.ts');
  writeFileSync(serverPath, `import { MAX_CONTEXT_REFERENCE_TEXT } from '@zana-ai/zcc-plugin-sdk/app';
if (MAX_CONTEXT_REFERENCE_TEXT !== 100_000) throw new Error('SDK helper was not bundled');
${readFileSync(serverPath, 'utf8')}`);
  const panelEntry = manifest.zcc.app;
  delete manifest.zcc.app;
  // Match plugins that declare compiled entries with editable TS siblings.
  manifest.zcc.server = './server.mjs';
  writeFileSync(packagePath, JSON.stringify(manifest));
  const compiled = await run(['plugin', 'build']);
  expect(compiled.code, compiled.stderr).toBe(0);
  const installed = await run(['plugin', 'install', '.']);
  expect(installed.code, installed.stderr).toBe(0);
  try {
    await expect(app.window.locator('.nav-item', { hasText: id })).toHaveCount(0);
    // A backend-only install grows a panel through ordinary development reload.
    manifest.zcc.app = panelEntry; manifest.version = '0.2.0';
    writeFileSync(packagePath, JSON.stringify(manifest));
    const addedPanel = await run(['plugin', 'dev', '--once']);
    expect(addedPanel.code, addedPanel.stderr).toBe(0);
    await app.window.locator('.nav-item', { hasText: id }).first().click();
    await expect(app.window.getByRole('heading', { name: id, exact: true })).toBeVisible();
    await expect(app.window.getByText('No todos yet', { exact: true })).toBeVisible();
    await app.window.getByRole('textbox', { name: 'Todo title' }).fill('Saved across reload');
    await app.window.getByRole('button', { name: 'Add', exact: true }).click();
    let todo = app.window.getByRole('checkbox', { name: 'Saved across reload' });
    await todo.click();
    await expect(todo).toBeChecked();
    const listed = await run(['plugin', 'run', id, 'list']);
    expect(listed.code, listed.stderr).toBe(0);
    expect(listed.stdout).toContain('[x] Saved across reload');

    // The freshly scaffolded SDK publisher and server resolver must orient a
    // generic side-panel agent without the user naming the plugin or its data.
    const canonicalTodos = await app.window.evaluate(async pluginId =>
      await window.cc.pluginApps.callRpc(pluginId, 'list', {}) as Array<{ id: string; title: string; done: boolean }>, id);
    expect(canonicalTodos).toHaveLength(1);
    await dismissTutorialHint();
    await app.window.getByTestId('plugin-panel-agent-show').click();
    const composer = app.window.getByTestId('panel-agent-tab-composer');
    const pagePrompt = 'What does this page contain?';
    await composer.getByTestId('thread-command-input').fill(pagePrompt);
    await expect(composer.getByTestId('thread-command-input')).toHaveText(pagePrompt);
    await expect(composer.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
    const createdResponse = app.window.waitForResponse(response =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/threads');
    await composer.getByTestId('thread-command-send').click();
    const created = await (await createdResponse).json() as { thread: { id: string } };
    const threadId = created.thread.id;
    const pageReply = app.window.getByTestId('panel-agent-tab-chat').getByTestId('thread-assistant-text').last();
    try {
      await expect(pageReply).toContainText(pagePrompt, { timeout: 30_000 });
    } catch (error) {
      // The UI hides a failed command's detail; surface it in the CI log.
      const timeline = await app.window.evaluate(async id =>
        await (await fetch(`/api/v1/threads/${id}/timeline`)).text(), threadId).catch(String);
      console.error(`[plugin-authoring-live] thread ${threadId} timeline: ${timeline.slice(0, 8_000)}`);
      throw error;
    }
    await expect(pageReply).toContainText(id);
    await expect(pageReply).toContainText('Todo list');
    await expect(pageReply).toContainText('page_context_read');
    await expect(pageReply).toContainText('todos');
    await expect(pageReply).not.toContainText(canonicalTodos[0]!.id);
    await expect(pageReply).not.toContainText('Saved across reload');
    await expect(pageReply).not.toContainText('"done":true');
    await expect(pageReply).not.toHaveAttribute('data-streaming', 'true');
    const chat = app.window.getByTestId('panel-agent-tab-chat');
    await expect(chat.getByTestId('thread-command-send')).toHaveAttribute('aria-label', 'Send');
    const readArgs = Buffer.from(JSON.stringify({ pluginId: id, providerId: 'page', itemId: 'todos' })).toString('base64url');
    await chat.getByTestId('thread-command-input').fill(`report_tool_result call_tool:page_context_read tool_args:${readArgs}`);
    await chat.getByTestId('thread-command-send').click();
    const readReply = chat.getByTestId('thread-assistant-text').nth(1);
    await expect(readReply).toContainText('Tool called: page_context_read', { timeout: 30_000 });
    await expect(readReply).toContainText(canonicalTodos[0]!.id);
    await expect(readReply).toContainText('Saved across reload');
    await expect.poll(() => app.window.evaluate(async id =>
      (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId)).toBe('idle');
    // Read raw assistant Markdown through the product API: rendering JSON as
    // Markdown consumes escapes needed to decode its nested tool result.
    const rawReply = await app.window.evaluate(async id => {
      const timeline = await (await fetch(`/api/v1/threads/${id}/timeline`)).json() as {
        rows: Array<{ kind: string; role?: string; text?: string }>
      };
      return timeline.rows.filter(row => row.kind === 'conversation' && row.role === 'assistant').at(-1)?.text;
    }, threadId);
    expect(rawReply).toContain('Tool called: page_context_read');
    const readResult = JSON.parse(rawReply!.replace(/^Tool called: page_context_read\s*/, '')) as {
      success: boolean; contentItems: Array<{ type: string; text?: string }>
    };
    expect(readResult.success).toBe(true);
    const resource = JSON.parse(readResult.contentItems.find(item => item.type === 'inputText')!.text!) as {
      ok: boolean; context: string
    };
    expect(resource.ok).toBe(true);
    expect(JSON.parse(resource.context)).toMatchObject({ page: 'Todo list', count: 1, todos: [canonicalTodos[0]] });
    expect(canonicalTodos[0]!.done).toBe(true);
    await expect(chat.getByTestId('thread-command-send')).toHaveAttribute('aria-label', 'Send');
    const missingArgs = Buffer.from(JSON.stringify({ pluginId: id, providerId: 'page', itemId: 'missing-todo-page' })).toString('base64url');
    await chat.getByTestId('thread-command-input').fill(`report_tool_result call_tool:page_context_read tool_args:${missingArgs}`);
    await chat.getByTestId('thread-command-send').click();
    const failedReply = chat.getByTestId('thread-assistant-text').nth(2);
    await expect(failedReply).toContainText('Tool called: page_context_read', { timeout: 30_000 });
    await expect(failedReply).toContainText('"success":false');
    await expect(failedReply).toContainText('Unknown page');
    await app.window.getByTestId('thread-secondary-hide').click();

    const appPath = join(source, 'app.tsx');
    const updated = readFileSync(appPath, 'utf8').replace(`>${id}</h2>`, '>Reload verified</h2>');
    writeFileSync(appPath, updated);
    const reloaded = await run(['plugin', 'dev', '--once']);
    expect(reloaded.code, reloaded.stderr).toBe(0);
    await expect(app.window.getByRole('heading', { name: 'Reload verified' })).toBeVisible();
    await expect(todo).toBeChecked();

    // A healthy backend is not proof that its browser bundle imported. Keep
    // known pages reachable and rebuild repaired source with the UI action.
    writeFileSync(appPath, `throw new Error('intentional UI import failure');\n${updated}`);
    const failedUi = await run(['plugin', 'dev', '--once']);
    expect(failedUi.code, failedUi.stderr).toBe(0);
    await expect(app.window.locator('.nav-item', { hasText: id })).toHaveCount(1);
    await expect(app.window.getByRole('heading', { name: `${id} couldn’t load` })).toBeVisible();
    await app.window.getByText('Technical details', { exact: true }).click();
    await expect(app.window.getByText('intentional UI import failure', { exact: true })).toBeVisible();
    writeFileSync(appPath, 'export default <broken');
    await app.window.getByRole('button', { name: 'Reload plugin', exact: true }).click();
    await expect(app.window.locator('.plugin-load-failure [role="status"]')).toContainText('renderer build failed');
    writeFileSync(appPath, updated);
    await app.window.getByRole('button', { name: 'Reload plugin', exact: true }).click();
    await expect(app.window.getByRole('heading', { name: 'Reload verified' })).toBeVisible();
    await expect(todo).toBeChecked();

    writeFileSync(appPath, 'export default <broken');
    const broken = await run(['plugin', 'dev', '--once']);
    expect(broken.code).toBe(1);
    expect(broken.stderr).toContain('app failed:');
    expect(broken.stdout).not.toContain('Reloaded');
    await expect(app.window.getByRole('heading', { name: 'Reload verified' })).toBeVisible();
    await expect(todo).toBeChecked();
    writeFileSync(appPath, updated);

    const server = readFileSync(serverPath, 'utf8');
    writeFileSync(serverPath, 'export default function () { throw new Error("intentional factory failure"); }');
    const factoryFailure = await run(['plugin', 'dev', '--once']);
    expect(factoryFailure.code).toBe(1);
    expect(factoryFailure.stderr).toContain('intentional factory failure');
    writeFileSync(serverPath, server);
    const recovered = await run(['plugin', 'dev', '--once']);
    expect(recovered.code, recovered.stderr).toBe(0);
    await expect(todo).toBeChecked();
    // Stop the isolated app before clearing its toolchain: Windows locks the
    // running esbuild executable. Restart with the persisted plugin and a cold
    // cache, then exercise the server's own rebuild/bootstrap path.
    await app.electron.close();
    const cacheRoot = join(home, '.zcc/plugins');
    for (const cache of readdirSync(cacheRoot).filter((name) => name.startsWith('toolchain-'))) {
      rmSync(join(cacheRoot, cache), { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
    app = await launchApp(home, {
      initialConfig: { sponsorPromptDismissed: true },
      env: { npm_config_registry: 'https://registry.npmjs.org/', ZCC_FAKE_PROVIDER: '1' }
    });
    env.ZCC_SERVER_URL = new URL(app.window.url()).origin;
    await app.window.locator('.nav-item', { hasText: id }).first().click();
    todo = app.window.getByRole('checkbox', { name: 'Saved across reload' });
    await expect(todo).toBeChecked();
    writeFileSync(appPath, updated.replace('Reload verified', 'Server build verified'));
    const serverRebuild = await run(['plugin', 'reload', id]);
    expect(serverRebuild.code, serverRebuild.stderr).toBe(0);
    if (shippedCli) expect(readdirSync(cacheRoot).filter((name) => name.startsWith('toolchain-'))).not.toEqual([]);
    await expect(app.window.getByRole('heading', { name: 'Server build verified' })).toBeVisible();
    await expect(todo).toBeChecked();
    const snapshot = await app.window.evaluate(async () => (await fetch('/api/v1/plugin-apps')).json());
    const row = snapshot.apps.find((entry: { id: string }) => entry.id === id);
    expect(row.sourceKind).toBe('path');
    expect(row).not.toHaveProperty('source');
    expect(row).not.toHaveProperty('rootDir');
    await app.window.locator('.nav-item').filter({ hasText: /^Plugins$/ }).click();
    await app.window.getByTestId('extensions-nav-installed').click();
    await app.window.getByLabel('Search installed plugins').fill(id);
    await expect(app.window.getByTestId(`plugin-row-${id}`)).toBeVisible();
    delete manifest.zcc.app;
    writeFileSync(packagePath, JSON.stringify(manifest));
    const removedPanel = await run(['plugin', 'dev', '--once']);
    expect(removedPanel.code, removedPanel.stderr).toBe(0);
    await expect(app.window.locator('.nav-item', { hasText: id })).toHaveCount(0);
  } finally {
    await run(['plugin', 'remove', id]);
    if (app !== initialApp) await app.electron.close();
  }
});
