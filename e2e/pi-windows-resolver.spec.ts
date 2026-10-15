import { mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test as base, expect } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';

const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const fakeNpm = join(home, 'fake-npm');
    const pkgDir = join(fakeNpm, 'node_modules', '@earendil-works', 'pi-coding-agent');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(fakeNpm, 'pi.cmd'), '@ECHO off\r\n');

    const fakeRpcUrl = pathToFileURL(
      fileURLToPath(new URL('../plugins/provider-pi/src/bridge/fake-pi-rpc.mjs', import.meta.url))
    ).href;
    writeFileSync(join(pkgDir, 'cli.js'), `import ${JSON.stringify(fakeRpcUrl)};\n`);
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ bin: { pi: 'cli.js' } })
    );

    await use({
      PATH: `${fakeNpm}${delimiter}${process.env.PATH ?? ''}`
    });
  }
});

test.describe('Windows Pi resolver without ZCC_PI_BRIDGE_COMMAND', () => {
  test.skip(process.platform !== 'win32', 'Windows-only built-Electron resolver test');

  test('resolves Pi from PATH shim and completes fd 3/4 channel round-trip in the built app', async ({ app }) => {
    test.setTimeout(120_000);
    const { window, home } = app;
    await waitForThreadProvider(window, 'pi');
    const projectPath = join(home, 'pi-resolver-project');
    mkdirSync(projectPath);

    const choice = {
      method: 'select',
      title: 'Windows resolver selection',
      message: 'Testing fd 3/4 round trip',
      options: ['Accept', 'Reject']
    };

    const threadId = await window.evaluate(async ({ path, input }) => {
      const project = await window.cc.projects.add(path);
      if (!project.ok) throw new Error(project.message);
      const response = await fetch('/api/v1/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: project.value.id,
          providerId: 'pi',
          model: 'fake-provider/fake-model',
          permissionMode: 'full',
          input
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(body));
      return body.thread.id as string;
    }, { path: projectPath, input: `/ui ${JSON.stringify(choice)}` });

    const pending = () => window.evaluate(async id => {
      const response = await fetch(`/api/v1/threads/${id}/interactions`);
      if (!response.ok) throw new Error(`Interaction query failed: ${response.status}`);
      return await response.json();
    }, threadId);

    // Channel (fd 3/4) message must arrive, populating pending interaction
    await expect.poll(async () => (await pending())?.length, { timeout: 30_000 }).toBe(1);

    await window.evaluate(id => {
      history.pushState({}, '', `/threads/${id}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, threadId);

    const banner = window.getByTestId('thread-pending-banner');
    const timeline = window.getByTestId('thread-timeline');
    await expect(banner).toContainText(choice.title);
    await banner.getByRole('radio', { name: /Accept/ }).check();
    await banner.getByRole('button', { name: 'Submit', exact: true }).click();

    // Verify response was sent back through fd 4 to Pi
    await expect(timeline).toContainText('UI said: {"type":"extension_ui_response","id":"ui-1","value":"Accept"}');
    await expect(banner).toHaveCount(0);
    await expect.poll(async () => (await pending()).length).toBe(0);
  });
});
