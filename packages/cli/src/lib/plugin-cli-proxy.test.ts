import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { RESERVED_ZCC_CLI_COMMANDS } from '@zana-ai/zcc-domain/thread-runtime';
import {
  findPluginCliCommand,
  pluginProxyCandidate
} from './plugin-cli-proxy.js';

const RUN_CLI_SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'run-cli.ts'), 'utf8');

function coreCommandsFromRunCli(): string[] {
  const names = new Set<string>(['help']);
  for (const match of RUN_CLI_SOURCE.matchAll(/\bcommand === '([a-z][a-z0-9-]*)'/g)) {
    names.add(match[1]!);
  }
  return [...names].sort();
}

describe('reserved zcc CLI command names', () => {
  it('every core top-level command is on the reserved list', () => {
    const reserved = new Set(RESERVED_ZCC_CLI_COMMANDS);
    for (const name of coreCommandsFromRunCli()) {
      expect(reserved, `"${name}" is missing from RESERVED_ZCC_CLI_COMMANDS`).toContain(name);
    }
  });

  it('the reserved list carries no stale entries', () => {
    const names = new Set(coreCommandsFromRunCli());
    for (const reserved of RESERVED_ZCC_CLI_COMMANDS) {
      expect(names, `"${reserved}" is reserved but not a core command`).toContain(reserved);
    }
  });
});

describe('explicit plugin transport and failures', () => {
  async function proxy(online: boolean, responses: unknown[]) {
    vi.resetModules();
    const callControlPlane = vi.fn();
    for (const response of responses) callControlPlane.mockResolvedValueOnce(response);
    vi.doMock('./control-client.js', () => ({ isAppRunning: () => online, callControlPlane }));
    return { ...await import('./plugin-cli-proxy.js'), callControlPlane };
  }
  it('uses the bounded long deadline for explicit commands and preserves JSON results', async () => {
    const value = { exitCode: 0, stdout: 'prepared', stderr: '' };
    const h = await proxy(true, [{ ok: true, value }]);
    const result = await h.runExplicitPluginCli('/data', 'fixture', ['open'], true);
    expect(JSON.parse(result.stdout)).toEqual(value);
    expect(h.callControlPlane).toHaveBeenCalledWith(expect.objectContaining({ op: 'plugin.cli', timeoutMs: 305_000 }));
  });
  it('surfaces a stopped app, authentication failures, and atomic output limits', async () => {
    const offline = await proxy(false, []);
    expect((await offline.runExplicitPluginCli('/data', 'fixture', [], false)).stderr).toContain('APP_NOT_RUNNING');
    const denied = await proxy(true, [{ ok: false, message: 'Denied' }]);
    expect((await denied.runExplicitPluginCli('/data', 'fixture', [], false)).stderr).toContain('Denied');
    const capped = await proxy(true, [{ ok: true, value: { exitCode: 1, stdout: 'partial', error: { code: 'plugin_cli_output_too_large', message: 'Narrow the query' } } }]);
    expect(await capped.runExplicitPluginCli('/data', 'fixture', [], false)).toEqual({ exitCode: 1, stdout: '', stderr: 'Error: Narrow the query\n' });
  });
  it('reports unavailable contributions and never dispatches an unknown command', async () => {
    const failed = await proxy(true, [{ ok: false, code: 'UNAVAILABLE' }]);
    expect((await failed.proxyPluginCliCommand('/data', 'fixture', [], false)).stderr).toContain('UNAVAILABLE');
    const missing = await proxy(true, [{ ok: true, value: {} }]);
    expect((await missing.proxyPluginCliCommand('/data', 'fixture', [], false)).stderr).toContain('No installed plugin');
    expect(missing.callControlPlane).toHaveBeenCalledTimes(1);
    const wrapped = await proxy(true, [{ ok: true, value: { cliCommands: [{ pluginId: 'fixture', name: 'fixture' }] } }, { ok: false, message: 'Worker stopped' }]);
    expect((await wrapped.proxyPluginCliCommand('/data', 'fixture', [], true)).stderr).toContain('Worker stopped');
    expect(wrapped.callControlPlane).toHaveBeenLastCalledWith(expect.objectContaining({ args: expect.objectContaining({ argv: ['--json'] }) }));
  });
});

describe('pluginProxyCandidate', () => {
  const known = new Set(RESERVED_ZCC_CLI_COMMANDS);

  it('returns unknown command names', () => {
    expect(pluginProxyCandidate('hello', known)).toBe('hello');
    expect(pluginProxyCandidate('tasks', known)).toBe('tasks');
  });

  it('never proxies flags, empty args, or core commands', () => {
    expect(pluginProxyCandidate(undefined, known)).toBeNull();
    expect(pluginProxyCandidate('', known)).toBeNull();
    expect(pluginProxyCandidate('--version', known)).toBeNull();
    expect(pluginProxyCandidate('-h', known)).toBeNull();
    expect(pluginProxyCandidate('plugin', known)).toBeNull();
    expect(pluginProxyCandidate('help', known)).toBeNull();
  });
});

describe('findPluginCliCommand', () => {
  it('matches by contributed name', () => {
    const contributions = [
      { pluginId: 'tasks', name: 'tasks', summary: 'Plan work' },
      { pluginId: 'hello', name: 'hello', summary: 'Say hello' }
    ];
    expect(findPluginCliCommand(contributions, 'hello')?.pluginId).toBe('hello');
    expect(findPluginCliCommand(contributions, 'missing')).toBeUndefined();
  });
});

describe('proxyPluginCliCommand', () => {
  it('asks the operator to open the app when it is not running', async () => {
    vi.resetModules();
    vi.doMock('./control-client.js', () => ({
      isAppRunning: () => false,
      callControlPlane: vi.fn()
    }));
    const { proxyPluginCliCommand } = await import('./plugin-cli-proxy.js');
    const result = await proxyPluginCliCommand('/tmp', 'hello', ['world'], false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not running/);
    expect(result.stderr).not.toMatch(/unknown command/);
  });

  it('posts plugin.cli when the app lists the contribution', async () => {
    vi.resetModules();
    const callControlPlane = vi.fn(async ({ op }: { op: string }) => {
      if (op === 'plugin.contributions') {
        return { ok: true, value: [{ pluginId: 'hello', name: 'hello', summary: 'Say hello' }] };
      }
      return { ok: true, value: { exitCode: 0, stdout: 'hi\n', stderr: '' } };
    });
    vi.doMock('./control-client.js', () => ({
      isAppRunning: () => true,
      callControlPlane
    }));
    const { proxyPluginCliCommand } = await import('./plugin-cli-proxy.js');
    const result = await proxyPluginCliCommand('/tmp', 'hello', ['world'], false);
    expect(result).toEqual({ exitCode: 0, stdout: 'hi\n', stderr: undefined });
    expect(callControlPlane).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'plugin.cli',
        timeoutMs: 305_000,
        args: expect.objectContaining({ id: 'hello', argv: ['world'], cwd: expect.any(String) })
      })
    );
  });
});
