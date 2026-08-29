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
      expect.objectContaining({ op: 'plugin.cli', args: { id: 'hello', argv: ['world'] } })
    );
  });
});

