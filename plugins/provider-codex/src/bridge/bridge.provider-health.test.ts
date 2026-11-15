import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { experimental_createBridgeJsonRpcTestHarness as createHarness } from '@zana-ai/zcc-plugin-sdk/provider-bridge/testing';
vi.mock('@zana-ai/zcc-plugin-sdk/provider-bridge', async (original) => ({
  ...(await original<typeof import('@zana-ai/zcc-plugin-sdk/provider-bridge')>()),
  experimental_resolveExecutablePath: async () => '/fixture/codex',
  experimental_readCliVersion: async () => '0.150.0',
  experimental_commandOutput: async () => 'codex-cli 0.150.0',
  experimental_npmLatestVersion: async () => null,
  experimental_probeNpmGlobalPackage: async () => ({ npmBin: null, npmGlobalPackageVersion: null }),
}));
import { handleLine, experimental_killAllChildrenForTests } from './bridge.js';
let dir: string, harness: ReturnType<typeof createHarness>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zcc-codex-account-probe-'));
  const script = join(dir, 'account.cjs');
  await writeFile(script, `const fs = require('node:fs'); const rl = require('node:readline').createInterface({ input: process.stdin });
    rl.on('line', line => {
      const request = JSON.parse(line);
      if (request.method === 'account/read') fs.writeFileSync(${JSON.stringify(join(dir, 'request.json'))}, JSON.stringify({ params: request.params, home: process.env.CODEX_HOME }));
      const result = request.method === 'account/read'
        ? { account: { type: 'chatgpt', email: 'keyring@example.com', planType: null }, requiresOpenaiAuth: true, padding: 'x'.repeat(20000) }
        : {};
      process.stdout.write(JSON.stringify({ id: request.id, result }) + '\\n');
    });`);
  vi.stubEnv('ZCC_CODEX_BRIDGE_APP_SERVER_COMMAND', process.execPath);
  vi.stubEnv('ZCC_CODEX_BRIDGE_APP_SERVER_ARGS', JSON.stringify([script]));
  vi.stubEnv('CODEX_HOME', dir);
  harness = createHarness(handleLine);
});
afterEach(async () => { experimental_killAllChildrenForTests(); harness.restore(); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
it('asks the configured native app-server for its account without requesting tokens or refresh, and handles large replies', async () => {
  harness.sendRequest(1, 'provider/health', { providerId: 'codex' });
  const response = await harness.waitForResponse(1);
  expect(response.error).toBeUndefined();
  expect(response.result).toMatchObject({ health: { status: 'ready', accountEmail: 'keyring@example.com' } });
  expect(JSON.parse(await readFile(join(dir, 'request.json'), 'utf8'))).toEqual({ params: { refreshToken: false }, home: dir });
});

it('keeps usage and installation probes independent from native sign-in', async () => {
  harness.sendRequest(2, 'provider/usage', { providerId: 'codex' });
  expect((await harness.waitForResponse(2)).result).toMatchObject({ supported: true, usage: { status: 'unauthenticated' } });
  harness.sendRequest(3, 'provider/installation/status', { providerId: 'codex' });
  expect((await harness.waitForResponse(3)).result).toMatchObject({ installed: true, currentVersion: '0.150.0' });
  await expect(readFile(join(dir, 'request.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
