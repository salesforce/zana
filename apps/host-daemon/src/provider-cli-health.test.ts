import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CODEX_MINIMUM_SUPPORTED_VERSION,
  brewFormulaNameFromPath,
  classifyProviderCliUpdate,
  getProviderCliStatus,
  inspectProviderCli,
  latestVersionRespectingMinReleaseAge,
  parseNpmMinReleaseAgeMs,
  parseNpmViewLatest,
  ProviderCliInstallInProgressError,
  providerCliInstallDidNotTake,
  providerCliUpdateUnavailableReason,
  resetProviderCliInstallLockForTests,
  resolveProviderCliUpdateCommand,
  runProviderCliInstall,
  getProviderCliDefinition,
  shellExecTargetFromHead,
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

function successfulCloseSpawner(): ProviderCliInstallProcessSpawner {
  return {
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
}

function cliInspectBehavior(args: {
  executableName: string;
  executablePath: string | null;
  version: string | null;
  latest?: string;
  npmPrefix?: string;
  npmGlobalPackage?: string;
  npmGlobalVersion?: string | null;
}): (call: RunProviderCliCommandArgs) => FakeCommandBehavior {
  return (call) => {
    const key = commandKey(call);
    if (key.includes(`which ${args.executableName}`)) {
      return args.executablePath
        ? { stdout: `${args.executablePath}\n` }
        : { exitCode: 1, errorMessage: 'not found' };
    }
    if (key.includes(`${args.executableName} --version`)) {
      return args.version
        ? { stdout: `${args.version}\n` }
        : { exitCode: 1, errorMessage: 'not found' };
    }
    if (key.includes('view ')) return { stdout: `${args.latest ?? args.version ?? '1.0.0'}\n` };
    if (key.includes('prefix -g')) return { stdout: `${args.npmPrefix ?? '/usr/local'}\n` };
    if (key.includes('list -g')) {
      if (!args.npmGlobalPackage || args.npmGlobalVersion === null) return { stdout: '{}\n' };
      return {
        stdout: JSON.stringify({
          dependencies: { [args.npmGlobalPackage]: { version: args.npmGlobalVersion } }
        })
      };
    }
    return {};
  };
}

function isolatedFs(overrides: {
  pathExists?: (path: string) => boolean;
  resolvePath?: (path: string) => string;
  readFileHead?: (path: string) => string | null;
} = {}) {
  return {
    pathExists: overrides.pathExists ?? (() => false),
    resolvePath: overrides.resolvePath ?? ((path: string) => path),
    readFileHead: overrides.readFileHead ?? (() => null)
  };
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
      nodePlatform: 'darwin',
      ...isolatedFs()
    });
    expect(missingStatus.installed).toBe(false);
    expect(missingStatus.installAction?.kind).toBe('install');
    expect(missingStatus.minimumSupportedVersion).toBe(CODEX_MINIMUM_SUPPORTED_VERSION);

    const piDefinition = getProviderCliDefinition('pi');
    expect(piDefinition.minimumSupportedVersion).toBe('0.84.0');

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
      nodePlatform: 'darwin',
      ...isolatedFs()
    });
    expect(outdatedStatus.needsUpdate).toBe(true);
    expect(outdatedStatus.installAction).toMatchObject({
      kind: 'update',
      label: 'Update',
      command: 'codex update'
    });
    expect(outdatedStatus.versionUnsupported).toBe(false);

    const homebrewNpm = new FakeProviderCliCommandRunner((args) => {
      const key = commandKey(args);
      if (key.includes('which codex')) return { stdout: '/opt/homebrew/bin/codex\n' };
      if (key.includes('codex --version')) return { stdout: 'codex 0.145.0\n' };
      if (key.includes('view @openai/codex')) return { stdout: '0.152.1\n' };
      if (key.includes('prefix -g')) return { stdout: '/Users/grebmann/.devbar/pkgs/npm\n' };
      if (key.includes('list -g')) {
        return { stdout: JSON.stringify({ dependencies: { '@openai/codex': { version: '0.152.1' } } }) };
      }
      return {};
    });
    const homebrewNpmStatus = await inspectProviderCli({
      definition: getProviderCliDefinition('codex'),
      runner: homebrewNpm,
      nodePlatform: 'darwin',
      ...isolatedFs({
        pathExists: (path) => path === '/opt/homebrew/lib/node_modules/@openai/codex/package.json'
      })
    });
    expect(homebrewNpmStatus.installSource).toBe('external');
    expect(homebrewNpmStatus.installAction?.command).toBe('codex update');
    expect(homebrewNpmStatus.updateUnavailableReason).toBeNull();
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
    const status = await getProviderCliStatus({
      runner,
      nodePlatform: 'darwin',
      ...isolatedFs()
    });
    expect(Object.keys(status).sort()).toEqual(['claudeCode', 'codex', 'cursor', 'opencode', 'pi']);
    expect(status.codex?.versionUnsupported).toBe(true);
    expect(status.codex?.installAction?.kind).toBe('update');
    expect(status.pi?.displayName).toBe('PI');
    expect(status.opencode?.executableName).toBe('opencode');
  });

  it('collects install events and refuses a second concurrent install', async () => {
    let piInstalled = false;
    const piRunner = new FakeProviderCliCommandRunner((call) => cliInspectBehavior({
      executableName: 'pi',
      executablePath: piInstalled ? '/usr/local/bin/pi' : null,
      version: piInstalled ? '0.84.4' : null,
      latest: '0.84.4',
      npmGlobalPackage: '@earendil-works/pi-coding-agent',
      npmGlobalVersion: piInstalled ? '0.84.4' : null
    })(call));
    const spawner: ProviderCliInstallProcessSpawner = {
      spawn() {
        piInstalled = true;
        return successfulCloseSpawner().spawn({ command: 'npm', args: [] });
      }
    };
    const result = await runProviderCliInstall({
      provider: 'pi',
      actionKind: 'install',
      nodePlatform: 'darwin',
      runner: piRunner,
      installProcessSpawner: spawner,
      ...isolatedFs()
    });
    expect(result.events[0]).toMatchObject({ type: 'started', provider: 'pi' });
    expect(result.events.some((event) => event.type === 'completed' && event.success)).toBe(true);

    let spawned = false;
    let updated = false;
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
            releaseSecond = () => {
              updated = true;
              listener(0, null);
            };
          }
        };
      }
    };
    const codexRunner = new FakeProviderCliCommandRunner((call) => cliInspectBehavior({
      executableName: 'codex',
      executablePath: '/usr/local/bin/codex',
      version: updated ? '0.152.1' : '0.145.0',
      latest: '0.152.1',
      npmGlobalPackage: '@openai/codex',
      npmGlobalVersion: updated ? '0.152.1' : '0.145.0'
    })(call));
    const first = runProviderCliInstall({
      provider: 'codex',
      actionKind: 'update',
      nodePlatform: 'darwin',
      runner: codexRunner,
      installProcessSpawner: blocking,
      ...isolatedFs()
    });
    for (let i = 0; i < 50 && !spawned; i += 1) await Promise.resolve();
    expect(spawned).toBe(true);
    await expect(runProviderCliInstall({
      provider: 'cursor',
      actionKind: 'install',
      nodePlatform: 'darwin',
      runner: new FakeProviderCliCommandRunner(() => ({ exitCode: 1 })),
      installProcessSpawner: blocking,
      ...isolatedFs()
    })).rejects.toBeInstanceOf(ProviderCliInstallInProgressError);
    releaseSecond?.();
    await first;
  });

  it('runs the CLI self-update on the PATH binary', () => {
    const codex = resolveProviderCliUpdateCommand({
      definition: getProviderCliDefinition('codex'),
      executablePath: '/opt/homebrew/bin/codex'
    });
    expect(codex).toMatchObject({
      displayCommand: 'codex update',
      command: '/opt/homebrew/bin/codex',
      args: ['update']
    });
    const opencode = resolveProviderCliUpdateCommand({
      definition: getProviderCliDefinition('opencode'),
      executablePath: '/Users/grebmann/.local/bin/opencode'
    });
    expect(opencode).toMatchObject({
      displayCommand: 'opencode upgrade',
      command: '/Users/grebmann/.local/bin/opencode',
      args: ['upgrade']
    });
    const pi = resolveProviderCliUpdateCommand({
      definition: getProviderCliDefinition('pi'),
      executablePath: '/opt/homebrew/bin/pi'
    });
    expect(pi.displayCommand).toBe('pi update');
    expect(pi.command).toBe('/opt/homebrew/bin/pi');
  });

  it('aims Codex self-update at the Homebrew npm prefix, not the default npm prefix', async () => {
    let spawnedEnv: NodeJS.ProcessEnv | undefined;
    let updated = false;
    const runner = new FakeProviderCliCommandRunner((call) => cliInspectBehavior({
      executableName: 'codex',
      executablePath: '/opt/homebrew/bin/codex',
      version: updated ? '0.152.1' : '0.145.0',
      latest: '0.152.1',
      npmPrefix: '/Users/grebmann/.devbar/pkgs/npm',
      npmGlobalPackage: '@openai/codex',
      npmGlobalVersion: '0.152.1'
    })(call));
    const result = await runProviderCliInstall({
      provider: 'codex',
      actionKind: 'update',
      nodePlatform: 'darwin',
      runner,
      pathExists: (path) => path === '/opt/homebrew/lib/node_modules/@openai/codex/package.json',
      resolvePath: (path) => path,
      readFileHead: () => null,
      installProcessSpawner: {
        spawn(spawnArgs) {
          spawnedEnv = spawnArgs.env;
          updated = true;
          return successfulCloseSpawner().spawn(spawnArgs);
        }
      }
    });
    expect(result.events[0]).toMatchObject({ type: 'started', command: 'codex update' });
    expect(spawnedEnv?.npm_config_prefix).toBe('/opt/homebrew');
    expect(result.events.some((event) => event.type === 'completed' && event.success)).toBe(true);
  });

  it('does not treat a too-new npm latest as installable when min-release-age is set', () => {
    expect(parseNpmMinReleaseAgeMs('7')).toBe(7 * 86_400_000);
    expect(parseNpmMinReleaseAgeMs('7d')).toBe(7 * 86_400_000);
    expect(parseNpmMinReleaseAgeMs('null')).toBeNull();
    const now = Date.parse('2026-09-09T18:00:00.000Z');
    expect(latestVersionRespectingMinReleaseAge({
      absoluteLatest: '0.153.4',
      versionTimes: {
        created: '2025-01-01T00:00:00.000Z',
        modified: '2026-09-08T00:00:00.000Z',
        '0.152.1': '2026-08-20T00:00:00.000Z',
        '0.153.4': '2026-09-08T00:00:00.000Z'
      },
      minReleaseAgeMs: 7 * 86_400_000,
      nowMs: now
    })).toBe('0.152.1');
    const viewed = parseNpmViewLatest([
      JSON.stringify({
        version: '0.153.4',
        time: { '0.152.1': '2026-08-20T00:00:00.000Z', '0.153.4': '2026-09-08T00:00:00.000Z' }
      }),
      'npm warn Unknown project config "blockExoticSubdeps". This will stop working in the next major version of npm.'
    ].join('\n'));
    expect(viewed.version).toBe('0.153.4');
    expect(viewed.time?.['0.152.1']).toBe('2026-08-20T00:00:00.000Z');
  });

  it('fails an update that exits 0 but leaves the PATH CLI unchanged', async () => {
    const runner = new FakeProviderCliCommandRunner((call) => cliInspectBehavior({
      executableName: 'codex',
      executablePath: '/opt/homebrew/bin/codex',
      version: '0.145.0',
      latest: '0.152.1',
      npmPrefix: '/Users/grebmann/.devbar/pkgs/npm',
      npmGlobalPackage: '@openai/codex',
      npmGlobalVersion: '0.152.1'
    })(call));
    const result = await runProviderCliInstall({
      provider: 'codex',
      actionKind: 'update',
      nodePlatform: 'darwin',
      runner,
      installProcessSpawner: successfulCloseSpawner(),
      ...isolatedFs()
    });
    expect(result.events[0]).toMatchObject({
      type: 'started',
      command: 'codex update'
    });
    expect(result.events.some((event) => event.type === 'error' && event.message.includes('PATH still has 0.145.0'))).toBe(true);
    expect(result.events.some((event) => event.type === 'completed' && event.success)).toBe(false);
    expect(providerCliInstallDidNotTake({
      actionKind: 'update',
      before: {
        displayName: 'Codex',
        executablePath: '/opt/homebrew/bin/codex',
        installed: true,
        currentVersion: '0.145.0',
        latestVersion: '0.152.1',
        needsUpdate: true,
        npmGlobalPackageVersion: '0.145.0'
      },
      after: {
        displayName: 'Codex',
        executablePath: '/opt/homebrew/bin/codex',
        installed: true,
        currentVersion: '0.145.0',
        latestVersion: '0.152.1',
        needsUpdate: true,
        npmGlobalPackageVersion: '0.152.1'
      }
    })).toMatch(/PATH still has 0\.145\.0 at \/opt\/homebrew\/bin\/codex\. npm global has 0\.152\.1/);
  });

  it('treats an update as success only after the PATH version moves', async () => {
    let updated = false;
    const runner = new FakeProviderCliCommandRunner((call) => cliInspectBehavior({
      executableName: 'codex',
      executablePath: '/opt/homebrew/bin/codex',
      version: updated ? '0.152.1' : '0.145.0',
      latest: '0.152.1',
      npmPrefix: '/opt/homebrew',
      npmGlobalPackage: '@openai/codex',
      npmGlobalVersion: updated ? '0.152.1' : '0.145.0'
    })(call));
    const result = await runProviderCliInstall({
      provider: 'codex',
      actionKind: 'update',
      nodePlatform: 'darwin',
      runner,
      installProcessSpawner: {
        spawn() {
          updated = true;
          return successfulCloseSpawner().spawn({ command: 'codex', args: ['update'] });
        }
      },
      ...isolatedFs()
    });
    expect(result.events.some((event) => event.type === 'error')).toBe(false);
    expect(result.events.some((event) => event.type === 'completed' && event.success)).toBe(true);
  });

  it('hides Update when PATH already matches the newest version npm will install', async () => {
    const oldEnough = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const tooNew = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const runner = new FakeProviderCliCommandRunner((args) => {
      const key = commandKey(args);
      if (key.includes('which codex')) return { stdout: '/opt/homebrew/bin/codex\n' };
      if (key.includes('codex --version')) return { stdout: 'codex-cli 0.152.1\n' };
      if (key.includes('config get min-release-age')) {
        return {
          stdout: '7\n',
          stderr: 'npm warn Unknown project config "blockExoticSubdeps". This will stop working in the next major version of npm.\n'
        };
      }
      if (key.includes('view @openai/codex')) {
        return {
          stdout: JSON.stringify({
            version: '0.153.4',
            time: {
              created: oldEnough,
              modified: tooNew,
              '0.152.1': oldEnough,
              '0.153.4': tooNew
            }
          }),
          stderr: 'npm warn Unknown user config "always-auth". This will stop working in the next major version of npm.\n'
        };
      }
      if (key.includes('prefix -g')) return { stdout: '/opt/homebrew\n' };
      if (key.includes('list -g')) {
        return { stdout: JSON.stringify({ dependencies: { '@openai/codex': { version: '0.152.1' } } }) };
      }
      return {};
    });
    const status = await inspectProviderCli({
      definition: getProviderCliDefinition('codex'),
      runner,
      nodePlatform: 'darwin',
      ...isolatedFs()
    });
    expect(status.latestVersion).toBe('0.152.1');
    expect(status.needsUpdate).toBe(false);
    expect(status.installAction).toBeNull();
  });

  it('refuses Update when Homebrew owns the keg', async () => {
    const runner = new FakeProviderCliCommandRunner((call) => cliInspectBehavior({
      executableName: 'codex',
      executablePath: '/opt/homebrew/bin/codex',
      version: '0.145.0',
      latest: '0.152.1',
      npmPrefix: '/Users/me/.npm-prefix',
      npmGlobalPackage: '@openai/codex',
      npmGlobalVersion: '0.152.1'
    })(call));
    const cellar = '/opt/homebrew/Cellar/codex/0.145.0/bin/codex';
    const status = await inspectProviderCli({
      definition: getProviderCliDefinition('codex'),
      runner,
      nodePlatform: 'darwin',
      ...isolatedFs({
        resolvePath: (path) => path === '/opt/homebrew/bin/codex' ? cellar : path
      })
    });
    expect(status.installAction).toBeNull();
    expect(status.updateUnavailableReason).toBe(
      'Managed by Homebrew. Update with `brew upgrade codex`.'
    );

    let spawned = false;
    const result = await runProviderCliInstall({
      provider: 'codex',
      actionKind: 'update',
      nodePlatform: 'darwin',
      runner,
      installProcessSpawner: {
        spawn(spawnArgs) {
          spawned = true;
          return successfulCloseSpawner().spawn(spawnArgs);
        }
      },
      ...isolatedFs({
        resolvePath: (path) => path === '/opt/homebrew/bin/codex' ? cellar : path
      })
    });
    expect(spawned).toBe(false);
    expect(result.events.some((event) => event.type === 'started')).toBe(false);
    expect(result.events).toContainEqual({
      type: 'error',
      provider: 'codex',
      message: 'Managed by Homebrew. Update with `brew upgrade codex`.'
    });
  });

  it('refuses Update when PATH is a wrapper outside the install prefix', async () => {
    const wrapper = '/Users/me/.local/bin/opencode';
    const target = '/opt/vendor/pkgs/opencode/1.18.4/bin/opencode';
    const runner = new FakeProviderCliCommandRunner((call) => cliInspectBehavior({
      executableName: 'opencode',
      executablePath: wrapper,
      version: '1.18.4',
      latest: '1.19.0'
    })(call));
    const status = await inspectProviderCli({
      definition: getProviderCliDefinition('opencode'),
      runner,
      nodePlatform: 'darwin',
      ...isolatedFs({
        readFileHead: (path) => path === wrapper
          ? `#!/bin/sh\nexec "${target}" "$@"\n`
          : null
      })
    });
    expect(status.installAction).toBeNull();
    expect(status.updateUnavailableReason).toBe(
      `ZCC cannot update this CLI. PATH is ${wrapper} (resolves to ${target}).`
    );
  });

  it('reports a missed install when PATH still lacks the CLI', () => {
    expect(providerCliInstallDidNotTake({
      actionKind: 'install',
      before: {
        displayName: 'PI',
        executablePath: null,
        installed: false,
        currentVersion: null,
        latestVersion: '0.84.4',
        needsUpdate: false,
        npmGlobalPackageVersion: null
      },
      after: {
        displayName: 'PI',
        executablePath: null,
        installed: false,
        currentVersion: null,
        latestVersion: '0.84.4',
        needsUpdate: false,
        npmGlobalPackageVersion: null
      }
    })).toBe('PI is still not on PATH after install.');
  });
});

describe('provider CLI update classification', () => {
  it('treats npm laid into a Homebrew prefix as updatable', () => {
    expect(classifyProviderCliUpdate({
      executablePath: '/opt/homebrew/bin/codex',
      npmPackageName: '@openai/codex',
      nodePlatform: 'darwin',
      pathExists: (path) => path === '/opt/homebrew/lib/node_modules/@openai/codex/package.json',
      resolvePath: () => '/opt/homebrew/Cellar/node/24.0.0/bin/node',
      readFileHead: () => null
    })).toEqual({ kind: 'updatable', npmPrefix: '/opt/homebrew' });
  });

  it('names the Homebrew formula from Cellar and opt paths', () => {
    expect(brewFormulaNameFromPath('/opt/homebrew/Cellar/pi/0.85.1/bin/pi')).toBe('pi');
    expect(brewFormulaNameFromPath('/opt/homebrew/opt/pi/bin/pi')).toBe('pi');
    expect(brewFormulaNameFromPath('/usr/local/opt/codex/bin/codex')).toBe('codex');
    expect(providerCliUpdateUnavailableReason({
      kind: 'homebrewFormula',
      formula: 'pi'
    })).toBe('Managed by Homebrew. Update with `brew upgrade pi`.');
  });

  it('follows a shebang exec wrapper to an external tree', () => {
    const fromFile = '/Users/me/.local/bin/opencode';
    const target = '/opt/vendor/pkgs/opencode/1.18.4/bin/opencode';
    expect(shellExecTargetFromHead(`#!/bin/sh\nexec "${target}" "$@"\n`, fromFile)).toBe(target);
    expect(classifyProviderCliUpdate({
      executablePath: fromFile,
      npmPackageName: 'opencode-ai',
      nodePlatform: 'darwin',
      pathExists: () => false,
      resolvePath: (path) => path,
      readFileHead: () => `#!/bin/sh\nexec "${target}" "$@"\n`
    })).toEqual({
      kind: 'externalManaged',
      pathLabel: `${fromFile} (resolves to ${target})`
    });
    expect(shellExecTargetFromHead('#!/bin/sh\nexec ../wrapped/opencode "$@"\n', fromFile)).toBe(
      '/Users/me/.local/wrapped/opencode'
    );
    expect(classifyProviderCliUpdate({
      executablePath: '/opt/homebrew/bin/codex',
      npmPackageName: '@openai/codex',
      nodePlatform: 'darwin',
      pathExists: () => false,
      resolvePath: (path) => path,
      readFileHead: () => '#!/usr/bin/env node\n'
    })).toEqual({ kind: 'updatable', npmPrefix: null });
    expect(classifyProviderCliUpdate({
      executablePath: '/opt/homebrew/bin/pi',
      npmPackageName: '@earendil-works/pi-coding-agent',
      nodePlatform: 'darwin',
      pathExists: () => false,
      resolvePath: (path) => path,
      readFileHead: () => null
    })).toEqual({ kind: 'updatable', npmPrefix: null });
    expect(classifyProviderCliUpdate({
      executablePath: '/opt/homebrew/Cellar/codex/0.1.0/bin/codex',
      npmPackageName: '@openai/codex',
      nodePlatform: 'darwin',
      pathExists: () => false,
      resolvePath: (path) => path,
      readFileHead: () => null
    })).toEqual({ kind: 'homebrewFormula', formula: 'codex' });
    expect(classifyProviderCliUpdate({
      executablePath: null,
      npmPackageName: '@openai/codex',
      nodePlatform: 'darwin',
      pathExists: () => false,
      resolvePath: (path) => path,
      readFileHead: () => null
    })).toEqual({ kind: 'uninstalled' });
    expect(providerCliUpdateUnavailableReason({ kind: 'updatable', npmPrefix: null })).toBeNull();
    expect(providerCliUpdateUnavailableReason({
      kind: 'externalManaged',
      pathLabel: '/Users/me/.local/bin/opencode'
    })).toBe('ZCC cannot update this CLI. PATH is /Users/me/.local/bin/opencode.');
  });
});
