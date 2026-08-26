import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CODEX_MINIMUM_SUPPORTED_VERSION,
  getProviderCliStatus,
  inspectProviderCli,
  ProviderCliInstallInProgressError,
  resetProviderCliInstallLockForTests,
  runProviderCliInstall,
  getProviderCliDefinition,
  type ProviderCliCommandResult,
  type ProviderCliCommandRunner,
  type ProviderCliInstallProcessSpawner,
  type RunProviderCliCommandArgs
} from './provider-cli-health.js';

interface FakeCommandBehavior {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  errorMessage?: string | null;
}

class FakeProviderCliCommandRunner implements ProviderCliCommandRunner {
  readonly calls: RunProviderCliCommandArgs[] = [];
  constructor(private readonly behavior: (args: RunProviderCliCommandArgs) => FakeCommandBehavior) {}
  async run(args: RunProviderCliCommandArgs): Promise<ProviderCliCommandResult> {
    this.calls.push(args);
    const result = this.behavior(args);
    return {
      command: args.command,
      args: args.args,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0,
      signal: null,
      errorMessage: result.errorMessage ?? null
    };
  }
}

function commandKey(args: RunProviderCliCommandArgs): string {
  return `${args.command} ${args.args.join(' ')}`;
}

afterEach(() => {
  resetProviderCliInstallLockForTests();
});

describe('provider CLI health', () => {
  it('reports an install action when Codex is missing and an update when a newer version is available', async () => {
    const missing = new FakeProviderCliCommandRunner((args) => {
      const key = commandKey(args);
      if (key.includes('which codex') || key.includes('--version')) {
        return { exitCode: 1, errorMessage: 'not found' };
      }
      if (key.includes('view @openai/codex version')) return { stdout: '0.149.1\n' };
      if (key.includes('prefix -g')) return { stdout: '/usr/local\n' };
      return { stdout: '{}\n' };
    });
    const missingStatus = await inspectProviderCli({
      definition: getProviderCliDefinition('codex'),
      runner: missing,
      nodePlatform: 'darwin'
    });
    expect(missingStatus.installed).toBe(false);
    expect(missingStatus.installAction?.kind).toBe('install');
    expect(missingStatus.minimumSupportedVersion).toBe(CODEX_MINIMUM_SUPPORTED_VERSION);

    const outdated = new FakeProviderCliCommandRunner((args) => {
      const key = commandKey(args);
      if (key.includes('which codex')) return { stdout: '/usr/local/bin/codex\n' };
      if (key.includes('codex --version')) return { stdout: 'codex 0.145.0\n' };
      if (key.includes('view @openai/codex version')) return { stdout: '0.149.1\n' };
      if (key.includes('prefix -g')) return { stdout: '/usr/local\n' };
      if (key.includes('list -g')) {
        return { stdout: JSON.stringify({ dependencies: { '@openai/codex': { version: '0.145.0' } } }) };
      }
      return {};
    });
    const outdatedStatus = await inspectProviderCli({
      definition: getProviderCliDefinition('codex'),
      runner: outdated,
      nodePlatform: 'darwin'
    });
    expect(outdatedStatus.needsUpdate).toBe(true);
    expect(outdatedStatus.installAction).toMatchObject({ kind: 'update', label: 'Update' });
    expect(outdatedStatus.versionUnsupported).toBe(false);
  });

  it('covers every ZCC harness family and flags an unsupported Codex version', async () => {
    const runner = new FakeProviderCliCommandRunner((args) => {
      const key = commandKey(args);
      if (key.startsWith('which ')) return { stdout: `/usr/local/bin/${args.args[0]}\n` };
      if (key.includes('--version')) {
        if (key.startsWith('codex ')) return { stdout: '0.100.0\n' };
        return { stdout: '1.2.3\n' };
      }
      if (key.includes('view ')) return { stdout: '1.2.3\n' };
      if (key.includes('prefix -g')) return { stdout: '/usr/local\n' };
      if (key.includes('list -g')) return { stdout: '{}\n' };
      if (key.includes('claude doctor')) return { stdout: 'Running: native\nAuto-update channel: latest\n' };
      return {};
    });
    const status = await getProviderCliStatus({ runner, nodePlatform: 'darwin' });
    expect(Object.keys(status).sort()).toEqual(['claudeCode', 'codex', 'cursor', 'opencode', 'pi']);
    expect(status.codex?.versionUnsupported).toBe(true);
    expect(status.codex?.installAction?.kind).toBe('update');
    expect(status.pi?.displayName).toBe('PI');
    expect(status.opencode?.executableName).toBe('opencode');
  });

  it('collects install events and refuses a second concurrent install', async () => {
    const spawner: ProviderCliInstallProcessSpawner = {
      spawn() {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        return {
          stdout,
          stderr,
          kill() { return true; },
          onError() {},
          onClose(listener) {
            queueMicrotask(() => {
              stdout.write('ok\n');
              stdout.end();
              stderr.end();
              listener(0, null);
            });
          }
        };
      }
    };
    const result = await runProviderCliInstall({
      provider: 'pi',
      actionKind: 'install',
      nodePlatform: 'darwin',
      installProcessSpawner: spawner
    });
    expect(result.events[0]).toMatchObject({ type: 'started', provider: 'pi' });
    expect(result.events.some((event) => event.type === 'completed' && event.success)).toBe(true);

    let spawned = false;
    let releaseSecond: (() => void) | undefined;
    const blocking: ProviderCliInstallProcessSpawner = {
      spawn() {
        spawned = true;
        return {
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          kill() { return true; },
          onError() {},
          onClose(listener) {
            releaseSecond = () => listener(0, null);
          }
        };
      }
    };
    const first = runProviderCliInstall({
      provider: 'codex',
      actionKind: 'update',
      nodePlatform: 'darwin',
      installProcessSpawner: blocking
    });
    await Promise.resolve();
    expect(spawned).toBe(true);
    await expect(runProviderCliInstall({
      provider: 'cursor',
      actionKind: 'install',
      nodePlatform: 'darwin',
      installProcessSpawner: blocking
    })).rejects.toBeInstanceOf(ProviderCliInstallInProgressError);
    releaseSecond?.();
    await first;
  });
});
