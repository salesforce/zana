import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from './fixtures/app.js';
import { stubNativeDialogs, stubOpenDialog } from './sdk/native-dialog.js';
import { captureElectronScreenshot } from './fixtures/native-screenshot.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '0', FIXTURE_HOST_OWNED_KEY: 'host-value' } });

test('provider readiness and user-triggered sign-in cross the production Electron boundary without changing gateway settings', async ({ app, home }, info) => {
  test.setTimeout(120_000);
  const win = app.window;
  const dir = join(home, 'provider-auth-fixture'); mkdirSync(dir);
  const statePath = join(dir, 'auth-state.json');
  const state = { ready: false, gatewayUrl: 'https://gateway.example/anthropic', apiKeyHelper: 'fixture-helper', customConfig: '/fixture/config' };
  writeFileSync(statePath, JSON.stringify(state));
  const login = join(dir, 'login.cjs');
  writeFileSync(login, `const fs = require('node:fs');
    console.log('Fixture sign-in: press Enter to complete.');
    process.stdin.once('data', () => {
      const path = ${JSON.stringify(statePath)};
      const state = JSON.parse(fs.readFileSync(path, 'utf8'));
      fs.writeFileSync(path, JSON.stringify({ ...state, ready: true }));
      console.log('Fixture sign-in complete.'); process.exit(0);
    });`);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const command = `${quote(process.execPath)} ${quote(login)}`;
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@zcc-ext/provider-auth-fixture', version: '0.1.0', type: 'module', engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' }, zcc: { name: 'Provider auth fixture', description: 'Isolated authentication fixture', branding: { icon: 'KeyRound' }, server: './server.mjs', host: './host.mjs', extra: { threadProvider: true } } }));
  writeFileSync(join(dir, 'server.mjs'), `export default function (zcc) {
    for (const [id, displayName] of [['auth-gateway-fixture', 'Gateway fixture'], ['auth-login-fixture', 'Login fixture'], ['auth-key-fixture', 'Key fixture']]) {
      zcc.agents.experimental_registerProvider({ id, displayName, visibility: 'installed', capabilities: {
        supportsServiceTier: false, fork: 'none', supportsManualCompaction: false,
        supportsThreadArchive: false, supportsThreadRename: false, permissionModes: ['full']
      } });
    }
  }`);
  writeFileSync(join(dir, 'host.mjs'), `import { readFileSync } from 'node:fs';
    export const experimental_providerBridge = { experimental_apiVersion: 1, handleLine(line) {
      const request = JSON.parse(line); if (request.id === undefined) return;
      let result;
      if (request.method === 'initialize') result = { protocolVersion: 2, capabilities: { grammarVersions: [3, 3] } };
      else if (request.method === 'provider/health') {
        const gateway = request.params.providerId === 'auth-gateway-fixture';
        const state = JSON.parse(readFileSync(${JSON.stringify(statePath)}, 'utf8'));
        result = { supported: true, health: {
          status: (request.params.providerId === 'auth-key-fixture' ? process.env.FIXTURE_NATIVE_API_KEY === 'fixture-native-key' && process.env.FIXTURE_HOST_OWNED_KEY === 'host-value' : gateway || state.ready) ? 'ready' : 'unauthenticated',
          statusMessage: gateway ? 'Enterprise gateway credentials configured.' : null,
          accountEmail: null, planLabel: null, installedVersion: '1.0.0', minimumSupportedVersion: null,
          canInstall: false, canUpdate: false, loginCommand: gateway ? null : ${JSON.stringify(command)},
          padding: 'x'.repeat(20000)
        } };
      } else if (request.method === 'model/list') result = { models: [], selectedOnlyModels: [] };
      else result = { supported: false };
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
    } };
    export default { experimental_apiVersion: 1, contract: {}, handlers: {} };`);
  await stubOpenDialog(app.electron, [[dir]]); await stubNativeDialogs(app.electron, [0, 0, 0]);
  const installed = await win.evaluate(() => window.cc.extensions.install({ kind: 'localDir' }));
  expect(installed, JSON.stringify(installed)).toMatchObject({ ok: true });
  const readiness = await win.evaluate(async () => {
    const response = await fetch('/api/v1/system/providers/auth-gateway-fixture/health');
    return { status: response.status, body: await response.json() };
  });
  expect(readiness, JSON.stringify(readiness)).toMatchObject({ status: 200, body: { result: { supported: true, health: { status: 'ready' } } } });
  await win.evaluate(() => { history.pushState({}, '', '/settings/harness'); dispatchEvent(new PopStateEvent('popstate')); });
  await win.getByRole('button', { name: 'Configure Gateway fixture', exact: true }).click();
  const gateway = win.getByLabel('Gateway fixture authentication', { exact: true });
  await expect(gateway.getByText('Credentials ready')).toBeVisible({ timeout: 30_000 });
  await expect(gateway.getByRole('button', { name: /Sign in/ })).toHaveCount(0);
  await win.getByRole('button', { name: 'Configure Login fixture', exact: true }).click();
  const signIn = win.getByLabel('Login fixture authentication', { exact: true });
  await expect(signIn.getByText('Sign-in required')).toBeVisible({ timeout: 30_000 });
  await signIn.getByRole('button', { name: 'Sign in to Login fixture' }).click();
  await expect(signIn.locator('.xterm-screen')).toBeVisible();
  // Xterm paints to a canvas, so assert the real PTY transcript separately.
  await expect.poll(() => win.evaluate(async () => {
    const { sessions } = await (await fetch('/api/v1/terminals')).json();
    const session = sessions.find((row: any) => row.providerSignIn?.providerId === 'auth-login-fixture');
    return session ? (await (await fetch(`/api/v1/terminals/${session.id}/output`)).json()).text : '';
  })).toContain('Fixture sign-in: press Enter to complete.');
  await captureElectronScreenshot(app.electron, win, info.outputPath('provider-sign-in.png'));
  await signIn.locator('.xterm-helper-textarea').press('Enter');
  await expect(signIn.getByText('Credentials ready')).toBeVisible({ timeout: 30_000 });
  await expect(signIn.locator('.xterm-screen')).toHaveCount(0);
  const sessions = await win.evaluate(async () => (await (await fetch('/api/v1/terminals')).json()).sessions);
  expect(sessions.filter((row: any) => row.providerSignIn?.providerId === 'auth-login-fixture')).toEqual([expect.objectContaining({ status: 'exited' })]);
  const { readFileSync } = await import('node:fs');
  expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({ ...state, ready: true });
  // Real Settings -> product API -> enrolled daemon -> encrypted file -> native
  // provider child. Only disposable fixture keys are ever entered here.
  const environment = win.getByRole('region', { name: 'API keys and environment' });
  await expect(environment.getByRole('button', { name: 'Save variable', exact: true })).toBeDisabled();
  await win.getByRole('button', { name: 'Configure Key fixture', exact: true }).click();
  const keyProvider = win.getByLabel('Key fixture authentication', { exact: true });
  await expect(keyProvider.getByText('Sign-in required')).toBeVisible();
  await environment.getByLabel('Environment variable name').fill('FIXTURE_NATIVE_API_KEY');
  await environment.getByLabel('Environment variable value').fill('fixture-native-key');
  await environment.getByRole('button', { name: 'Save variable', exact: true }).click();
  await expect(environment.getByText('Saved on this machine', { exact: true })).toBeVisible();
  await expect(environment.getByLabel('Environment variable value')).toHaveValue('');
  await environment.getByLabel('Environment variable name').fill('FIXTURE_HOST_OWNED_KEY');
  await environment.getByLabel('Environment variable value').fill('saved-override-must-not-win');
  await environment.getByRole('button', { name: 'Save variable', exact: true }).click();
  await expect(environment.getByText('Machine environment takes priority', { exact: true })).toBeVisible();
  await keyProvider.getByRole('button', { name: 'Check Key fixture credentials' }).click();
  await expect(keyProvider.getByText('Credentials ready')).toBeVisible({ timeout: 30_000 });
  const encryptedPath = join(home, '.zcc', 'machine-environment.enc');
  expect(readFileSync(encryptedPath, 'utf8')).not.toContain('fixture-native-key');
  const publicEnvironment = await win.evaluate(async () => {
    const hosts = await (await fetch('/api/v1/hosts')).json();
    const hostId = (hosts.hosts ?? hosts).find((host: any) => host.isPrimary).id;
    return (await (await fetch(`/api/v1/system/machines/${hostId}/environment`)).json());
  });
  expect(JSON.stringify(publicEnvironment)).not.toContain('fixture-native-key');
  await environment.scrollIntoViewIfNeeded();
  await captureElectronScreenshot(app.electron, win, info.outputPath('provider-api-keys.png'));
  await environment.getByRole('button', { name: 'Remove FIXTURE_NATIVE_API_KEY', exact: true }).click();
  await environment.getByRole('button', { name: 'Remove variable', exact: true }).click();
  await expect(environment.getByText(/Saved variable removed/)).toBeVisible();
  await keyProvider.getByRole('button', { name: 'Check Key fixture credentials' }).click();
  await expect(keyProvider.getByText('Sign-in required')).toBeVisible({ timeout: 30_000 });
  await environment.getByRole('button', { name: 'Remove FIXTURE_HOST_OWNED_KEY', exact: true }).click();
  await environment.getByRole('button', { name: 'Remove variable', exact: true }).click();
  await expect(environment.getByText('No variables saved here.', { exact: false })).toBeVisible();
  expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({ ...state, ready: true });
  await captureElectronScreenshot(app.electron, win, info.outputPath('provider-authentication.png'));
});

test('optional live regressions use a disposable app and HOME', async ({ app, home }, info) => {
  test.skip(process.env.ZCC_AUTH_RUN_LIVE_CHECKS !== '1', 'Opt in to the wider live regression suites.');
  test.setTimeout(600_000);
  const failures: string[] = [];
  const suites = process.env.ZCC_AUTH_LIVE_SUITES === 'memory' ? ['live:memory'] : ['live:mode-reasoning', 'live:memory'];
  // Never target the user's active desktop, even when a regression suite fails.
  for (const suite of suites) {
    let transcript: string;
    try {
      const output = await promisify(execFile)('pnpm', [suite], {
        cwd: process.cwd(), timeout: 240_000, maxBuffer: 2 * 1024 * 1024,
        // The app/host keep their fixture HOME. The HTTP-only test client uses
        // explicit isolated data/URL scope; retain the runner's package store.
        env: { ...process.env, ZCC_DATA_DIR: join(home, '.zcc'),
          ZCC_SERVER_URL: new URL(app.window.url()).origin, ZCC_SESSION_ID: undefined, ZCC_SESSION_TOKEN: undefined },
      });
      transcript = output.stdout + output.stderr;
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      transcript = (failed.stdout ?? '') + (failed.stderr ?? '') + String(error);
      failures.push(suite);
    }
    const logPath = info.outputPath(`${suite.replace(':', '-')}.log`);
    writeFileSync(logPath, transcript);
    await info.attach(`${suite}.log`, { path: logPath, contentType: 'text/plain' });
    await info.attach(`${suite}-result.json`, { body: JSON.stringify({ failed: failures.includes(suite) }), contentType: 'application/json' });
  }
  expect(failures, 'See attached live suite output; the authentication flow is tested separately.').toEqual([]);
});
