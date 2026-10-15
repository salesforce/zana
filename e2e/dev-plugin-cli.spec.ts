import { execFile } from 'node:child_process';
import { cpSync, existsSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { closeApp, launchApp, test, expect, type AppHandle } from './fixtures/app.js';

test('dev Electron CLI uses the external product runtime with complete output and scope', async ({ home }) => {
  test.setTimeout(90_000);
  const received: unknown[] = [];
  const output = 'SDK-backed dev CLI '.repeat(1024);
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/v1/plugins/contributions') {
      response.end(JSON.stringify({ cliCommands: [{ pluginId: 'dev-fixture', name: 'dev-fixture' }] }));
    } else if (request.url === '/api/v1/plugins/dev-fixture/cli') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push(JSON.parse(Buffer.concat(chunks).toString()));
      // Cross both the old ten-second server and fifteen-second CLI deadlines.
      await new Promise(resolve => setTimeout(resolve, 16_000));
      response.end(JSON.stringify({ exitCode: 0, stdout: output, stderr: '' }));
    } else {
      response.setHeader('content-type', 'text/html');
      response.end('<div id="root"><h1>Dev product runtime</h1></div>');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  let app: AppHandle | undefined;
  try {
    app = await launchApp(home, { env: { ELECTRON_RENDERER_URL: url, ZCC_SERVER_URL: url } });
    await expect(app.window.getByRole('heading', { name: 'Dev product runtime' })).toBeVisible();
    await expect.poll(() => existsSync(join(home, '.zcc/control.sock'))).toBe(true);
    const cli = join(home, 'cli');
    cpSync(resolve('packages/cli/dist'), cli, { recursive: true, dereference: true });
    const result = await promisify(execFile)(process.execPath, [join(cli, 'bin/zcc'), 'dev-fixture', 'run', '--json'], {
      cwd: home, timeout: 35_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, HOME: home, ZCC_DATA_DIR: join(home, '.zcc'), ZCC_SERVER_URL: url,
        NO_COLOR: undefined, FORCE_COLOR: undefined,
        ZCC_SESSION_ID: undefined, ZCC_SESSION_TOKEN: undefined, ZCC_THREAD_ID: 'dev-thread', ZCC_PROJECT_ID: 'dev-project',
        BB_THREAD_ID: undefined, BB_PROJECT_ID: undefined }
    });
    expect(result.stdout.trimEnd()).toBe(output.trimEnd());
    expect(result.stderr).toBe('');
    expect(received).toEqual([{ argv: ['run', '--json'], threadId: 'dev-thread', projectId: 'dev-project', cwd: realpathSync(home) }]);
  } finally {
    if (app) await closeApp(app.electron);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
