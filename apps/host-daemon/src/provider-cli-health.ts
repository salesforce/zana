import { spawn } from 'node:child_process';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import type {
  ProviderCliInstallAction,
  ProviderCliInstallActionKind,
  ProviderCliInstallEvent,
  ProviderCliInstallSource,
  ProviderCliKey,
  ProviderCliStatus,
  ProviderCliStatusResponse
} from '@zana-ai/zcc-host-daemon-contract/local';
import { providerCliKeyValues } from '@zana-ai/zcc-host-daemon-contract/local';

const COMMAND_CHECK_TIMEOUT_MS = 5_000;
const CLAUDE_DOCTOR_TIMEOUT_MS = 10_000;
const NPM_VIEW_TIMEOUT_MS = 15_000;
const NPM_INSTALL_STATE_TIMEOUT_MS = 5_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const INSTALL_OUTPUT_CAP = 512 * 1024;
const CLAUDE_CODE_INSTALL_SCRIPT_URL = 'https://claude.ai/install.sh';
const CURSOR_INSTALL_SCRIPT_URL = 'https://cursor.com/install';
export const CODEX_MINIMUM_SUPPORTED_VERSION = '0.136.0';

const npmGlobalListResponseSchema = z
  .object({
    dependencies: z.record(z.string(), z.object({ version: z.string().min(1) }).passthrough()).default({})
  })
  .passthrough();

const npmDistTagsSchema = z
  .object({
    latest: z.string().min(1),
    stable: z.string().min(1).optional()
  })
  .passthrough();

type ClaudeCodeInstallMethod = 'native' | 'npm-global' | 'package-manager' | 'unknown';

interface ClaudeCodeDoctorStatus {
  installMethod: ClaudeCodeInstallMethod | null;
  updateChannel: 'latest' | 'stable' | null;
}

interface ClaudeCodeDistTagVersions {
  latest: string;
  stable: string | null;
}

export interface ProviderCliDefinition {
  key: ProviderCliKey;
  displayName: string;
  executableName: string;
  npmPackageName: string | null;
  minimumSupportedVersion: string | null;
  installCommand: ProviderCliInstallCommandDefinition;
  updateCommand: ProviderCliActionCommand;
}

export interface ProviderCliCommandResult {
  command: string;
  args: readonly string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  errorMessage: string | null;
}

export interface RunProviderCliCommandArgs {
  command: string;
  args: readonly string[];
  timeoutMs: number;
}

export interface ProviderCliCommandRunner {
  run(args: RunProviderCliCommandArgs): Promise<ProviderCliCommandResult>;
}

interface ProviderCliActionCommand {
  commandKind: 'exec' | 'shell';
  displayCommand: string;
  command: string;
  args: readonly string[];
}

type ProviderCliInstallCommandDefinition =
  | Readonly<{ kind: 'npmGlobal' }>
  | Readonly<{ kind: 'downloadedShellScript'; scriptUrl: string }>;

export interface SpawnProviderCliInstallProcessArgs {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export interface ProviderCliInstallProcess {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill(signal: NodeJS.Signals): boolean;
  onError(listener: (error: Error) => void): void;
  onClose(listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): void;
}

export interface ProviderCliInstallProcessSpawner {
  spawn(args: SpawnProviderCliInstallProcessArgs): ProviderCliInstallProcess;
}

let activeProviderCliInstallProvider: ProviderCliKey | null = null;

export class ProviderCliInstallInProgressError extends Error {
  readonly provider: ProviderCliKey;

  constructor(provider: ProviderCliKey) {
    super(`Provider CLI install already running for ${provider}`);
    this.name = 'ProviderCliInstallInProgressError';
    this.provider = provider;
  }
}

const PROVIDER_CLI_DEFINITIONS = {
  codex: {
    key: 'codex',
    displayName: 'Codex',
    executableName: 'codex',
    npmPackageName: '@openai/codex',
    minimumSupportedVersion: CODEX_MINIMUM_SUPPORTED_VERSION,
    installCommand: { kind: 'npmGlobal' },
    updateCommand: {
      commandKind: 'exec',
      displayCommand: 'codex update',
      command: 'codex',
      args: ['update']
    }
  },
  claudeCode: {
    key: 'claudeCode',
    displayName: 'Claude Code',
    executableName: 'claude',
    npmPackageName: '@anthropic-ai/claude-code',
    minimumSupportedVersion: null,
    installCommand: { kind: 'downloadedShellScript', scriptUrl: CLAUDE_CODE_INSTALL_SCRIPT_URL },
    updateCommand: {
      commandKind: 'exec',
      displayCommand: 'claude update',
      command: 'claude',
      args: ['update']
    }
  },
  cursor: {
    key: 'cursor',
    displayName: 'Cursor',
    executableName: 'cursor-agent',
    npmPackageName: null,
    minimumSupportedVersion: null,
    installCommand: { kind: 'downloadedShellScript', scriptUrl: CURSOR_INSTALL_SCRIPT_URL },
    updateCommand: {
      commandKind: 'exec',
      displayCommand: 'cursor-agent update',
      command: 'cursor-agent',
      args: ['update']
    }
  },
  pi: {
    key: 'pi',
    displayName: 'PI',
    executableName: 'pi',
    npmPackageName: '@earendil-works/pi-coding-agent',
    minimumSupportedVersion: null,
    installCommand: { kind: 'npmGlobal' },
    updateCommand: {
      commandKind: 'exec',
      displayCommand: 'npm install -g @earendil-works/pi-coding-agent@latest',
      command: 'npm',
      args: ['install', '-g', '@earendil-works/pi-coding-agent@latest']
    }
  },
  opencode: {
    key: 'opencode',
    displayName: 'OpenCode',
    executableName: 'opencode',
    npmPackageName: 'opencode-ai',
    minimumSupportedVersion: null,
    installCommand: { kind: 'npmGlobal' },
    updateCommand: {
      commandKind: 'exec',
      displayCommand: 'npm install -g opencode-ai@latest',
      command: 'npm',
      args: ['install', '-g', 'opencode-ai@latest']
    }
  }
} satisfies Record<ProviderCliKey, ProviderCliDefinition>;

export function getProviderCliDefinition(provider: ProviderCliKey): ProviderCliDefinition {
  return PROVIDER_CLI_DEFINITIONS[provider];
}

function npmExecutableName(nodePlatform: NodeJS.Platform): string {
  return nodePlatform === 'win32' ? 'npm.cmd' : 'npm';
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args]
    .map((part) => (/^[A-Za-z0-9_./:@+-]+$/u.test(part) ? part : `'${part.replace(/'/gu, "'\\''")}'`))
    .join(' ');
}

function isSuccessfulCommand(result: ProviderCliCommandResult): boolean {
  return result.errorMessage === null && result.exitCode === 0;
}

function firstOutputLine(text: string): string | null {
  return text.split(/\r?\n/u).map((line) => line.trim()).find((line) => line.length > 0) ?? null;
}

function parseSemverCore(text: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(text);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function extractVersion(text: string): string | null {
  const match = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/u.exec(text);
  const candidate = match?.[1];
  return candidate && parseSemverCore(candidate) ? candidate : null;
}

function compareSemver(left: string, right: string): number {
  const a = parseSemverCore(left);
  const b = parseSemverCore(right);
  if (!a || !b) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]! ? 1 : -1;
  }
  return 0;
}

function semverGt(left: string, right: string): boolean {
  return compareSemver(left, right) > 0;
}

function semverLt(left: string, right: string): boolean {
  return compareSemver(left, right) < 0;
}

function parseNpmGlobalPackageVersion(text: string, npmPackageName: string): string | null {
  try {
    const parsed = npmGlobalListResponseSchema.safeParse(JSON.parse(text.trim()));
    return parsed.success ? parsed.data.dependencies[npmPackageName]?.version ?? null : null;
  } catch {
    return null;
  }
}

function parseClaudeCodeDistTagVersions(text: string): ClaudeCodeDistTagVersions | null {
  try {
    const parsed = npmDistTagsSchema.safeParse(JSON.parse(text.trim()));
    if (!parsed.success) return null;
    const latest = extractVersion(parsed.data.latest);
    if (!latest) return null;
    return {
      latest,
      stable: parsed.data.stable === undefined ? latest : extractVersion(parsed.data.stable)
    };
  } catch {
    return null;
  }
}

function parseClaudeCodeDoctorStatus(text: string): ClaudeCodeDoctorStatus {
  const runningMatch = /^Running:\s+([^\s(]+)/mu.exec(text);
  const channelMatch = /^Auto-update channel:\s+(latest|stable)\s*$/mu.exec(text);
  const rawInstallMethod = runningMatch?.[1];
  const installMethod: ClaudeCodeInstallMethod | null = rawInstallMethod
    ? rawInstallMethod === 'native' || rawInstallMethod === 'npm-global'
      ? rawInstallMethod
      : ['homebrew', 'winget', 'apt', 'dnf', 'apk'].includes(rawInstallMethod)
        ? 'package-manager'
        : 'unknown'
    : null;
  return {
    installMethod,
    updateChannel: channelMatch?.[1] === 'latest' || channelMatch?.[1] === 'stable' ? channelMatch[1] : null
  };
}

function needsProviderCliUpdate(args: {
  installed: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
}): boolean {
  if (!args.installed || !args.currentVersion || !args.latestVersion) return false;
  return semverGt(args.latestVersion, args.currentVersion);
}

function isProviderCliVersionUnsupported(args: {
  installed: boolean;
  currentVersion: string | null;
  minimumSupportedVersion: string | null;
}): boolean {
  if (!args.installed || !args.currentVersion || !args.minimumSupportedVersion) return false;
  return semverLt(args.currentVersion, args.minimumSupportedVersion);
}

function resolveClaudeCodeVersionStatus(args: {
  installed: boolean;
  currentVersion: string | null;
  distTags: ClaudeCodeDistTagVersions | null;
  updateChannel: ClaudeCodeDoctorStatus['updateChannel'];
}): { latestVersion: string | null; needsUpdate: boolean } {
  const latestVersion =
    args.updateChannel === null || args.distTags === null ? null : args.distTags[args.updateChannel];
  if (args.updateChannel !== null) {
    return {
      latestVersion,
      needsUpdate: needsProviderCliUpdate({
        installed: args.installed,
        currentVersion: args.currentVersion,
        latestVersion
      })
    };
  }
  const definitelyNeedsUpdate =
    args.installed
    && args.currentVersion !== null
    && args.distTags !== null
    && args.distTags.stable !== null
    && semverGt(args.distTags.latest, args.currentVersion)
    && semverGt(args.distTags.stable, args.currentVersion);
  return { latestVersion: null, needsUpdate: definitelyNeedsUpdate };
}

function npmInstallActionCommand(
  definition: ProviderCliDefinition,
  nodePlatform: NodeJS.Platform
): ProviderCliActionCommand {
  if (!definition.npmPackageName) {
    throw new Error(`${definition.displayName} CLI does not define an npm package installer.`);
  }
  const command = npmExecutableName(nodePlatform);
  const args = ['install', '-g', `${definition.npmPackageName}@latest`];
  return { commandKind: 'exec', displayCommand: formatCommand(command, args), command, args };
}

function shellInstallActionCommand(command: string): ProviderCliActionCommand {
  return { commandKind: 'shell', displayCommand: command, command: 'sh', args: ['-c', command] };
}

function downloadedShellScriptInstallActionCommand(scriptUrl: string): ProviderCliActionCommand {
  const command = [
    'tmp=$(mktemp "${TMPDIR:-/tmp}/provider-cli-install.XXXXXX")',
    'trap \'rm -f "$tmp"\' EXIT',
    `curl -fsSL ${formatCommand(scriptUrl, [])} -o "$tmp"`,
    'bash "$tmp"'
  ].join(' && ');
  return shellInstallActionCommand(command);
}

function installActionCommand(
  definition: ProviderCliDefinition,
  nodePlatform: NodeJS.Platform
): ProviderCliActionCommand {
  if (definition.installCommand.kind === 'npmGlobal') {
    return npmInstallActionCommand(definition, nodePlatform);
  }
  return downloadedShellScriptInstallActionCommand(definition.installCommand.scriptUrl);
}

function npmGlobalBinDirectory(npmGlobalPrefix: string, nodePlatform: NodeJS.Platform): string {
  return nodePlatform === 'win32' ? npmGlobalPrefix : join(npmGlobalPrefix, 'bin');
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  const relativePath = relative(resolve(directory), resolve(path));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function resolveProviderCliInstallSource(args: {
  installed: boolean;
  executablePath: string | null;
  npmGlobalPrefix: string | null;
  nodePlatform: NodeJS.Platform;
}): ProviderCliInstallSource {
  if (!args.installed) return 'notInstalled';
  if (!args.executablePath || !args.npmGlobalPrefix) return 'external';
  return isPathInsideDirectory(args.executablePath, npmGlobalBinDirectory(args.npmGlobalPrefix, args.nodePlatform))
    ? 'npmGlobal'
    : 'external';
}

function isDefaultClaudeCodeNativeExecutablePath(
  executablePath: string | null,
  nodePlatform: NodeJS.Platform
): boolean {
  if (!executablePath) return false;
  const normalizedPath = executablePath.replace(/\\/gu, '/');
  if (normalizedPath.endsWith('/.local/bin/claude')) return true;
  return nodePlatform === 'win32' && normalizedPath.endsWith('/.local/bin/claude.exe');
}

function buildInstallAction(args: {
  definition: ProviderCliDefinition;
  installed: boolean;
  executablePath: string | null;
  installSource: ProviderCliInstallSource;
  needsUpdate: boolean;
  versionUnsupported: boolean;
  nodePlatform: NodeJS.Platform;
  claudeCodeDoctorStatus: ClaudeCodeDoctorStatus | null;
}): ProviderCliInstallAction | null {
  if (!args.installed) {
    const command = installActionCommand(args.definition, args.nodePlatform);
    return { kind: 'install', label: 'Install', commandKind: command.commandKind, command: command.displayCommand };
  }
  const claudeCodeInstallMethod = args.claudeCodeDoctorStatus?.installMethod ?? null;
  const hasNativeClaudeCodeFallback =
    args.definition.key === 'claudeCode'
    && claudeCodeInstallMethod === null
    && args.installSource === 'external'
    && isDefaultClaudeCodeNativeExecutablePath(args.executablePath, args.nodePlatform);
  const canRunUpdate =
    args.definition.key !== 'claudeCode'
    || claudeCodeInstallMethod === 'native'
    || hasNativeClaudeCodeFallback
    || (args.installSource === 'npmGlobal'
      && (claudeCodeInstallMethod === null || claudeCodeInstallMethod === 'npm-global'));
  if ((args.needsUpdate || args.versionUnsupported) && canRunUpdate) {
    const command = args.definition.updateCommand;
    return { kind: 'update', label: 'Update', commandKind: command.commandKind, command: command.displayCommand };
  }
  return null;
}

function resolveProviderCliActionCommand(args: {
  definition: ProviderCliDefinition;
  actionKind: ProviderCliInstallActionKind;
  nodePlatform: NodeJS.Platform;
}): ProviderCliActionCommand {
  return args.actionKind === 'install'
    ? installActionCommand(args.definition, args.nodePlatform)
    : args.definition.updateCommand;
}

function createCommandResult(args: Omit<ProviderCliCommandResult, 'args'> & { commandArgs: readonly string[] }): ProviderCliCommandResult {
  return {
    command: args.command,
    args: args.commandArgs,
    stdout: args.stdout,
    stderr: args.stderr,
    exitCode: args.exitCode,
    signal: args.signal,
    errorMessage: args.errorMessage
  };
}

export async function runProviderCliCommand(
  args: RunProviderCliCommandArgs,
  env: NodeJS.ProcessEnv = process.env
): Promise<ProviderCliCommandResult> {
  return await new Promise((settle) => {
    let child;
    try {
      child = spawn(args.command, [...args.args], {
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      settle(createCommandResult({
        command: args.command,
        commandArgs: args.args,
        stdout: '',
        stderr: '',
        exitCode: null,
        signal: null,
        errorMessage: error instanceof Error ? error.message : String(error)
      }));
      return;
    }

    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (result: ProviderCliCommandResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      settle(result);
    };
    const timer = setTimeout(() => child.kill('SIGTERM'), args.timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (error) => {
      finish(createCommandResult({
        command: args.command,
        commandArgs: args.args,
        stdout,
        stderr,
        exitCode: null,
        signal: null,
        errorMessage: error.message
      }));
    });
    child.on('close', (exitCode, signal) => {
      finish(createCommandResult({
        command: args.command,
        commandArgs: args.args,
        stdout,
        stderr,
        exitCode,
        signal,
        errorMessage: null
      }));
    });
  });
}

export function createSpawnProviderCliCommandRunner(
  env: NodeJS.ProcessEnv = process.env
): ProviderCliCommandRunner {
  return { run: (args) => runProviderCliCommand(args, env) };
}

export async function inspectProviderCli(args: {
  definition: ProviderCliDefinition;
  runner: ProviderCliCommandRunner;
  nodePlatform: NodeJS.Platform;
}): Promise<ProviderCliStatus> {
  const npmCommand = npmExecutableName(args.nodePlatform);
  const npmPackageName = args.definition.npmPackageName;
  const [whichResult, versionResult, latestResult, npmPrefixResult, npmListResult, claudeDoctorResult] = await Promise.all([
    args.runner.run({
      command: args.nodePlatform === 'win32' ? 'where' : 'which',
      args: [args.definition.executableName],
      timeoutMs: COMMAND_CHECK_TIMEOUT_MS
    }),
    args.runner.run({
      command: args.definition.executableName,
      args: ['--version'],
      timeoutMs: COMMAND_CHECK_TIMEOUT_MS
    }),
    npmPackageName === null
      ? Promise.resolve(null)
      : args.runner.run({
        command: npmCommand,
        args: args.definition.key === 'claudeCode'
          ? ['view', npmPackageName, 'dist-tags', '--json']
          : ['view', npmPackageName, 'version'],
        timeoutMs: NPM_VIEW_TIMEOUT_MS
      }),
    args.runner.run({
      command: npmCommand,
      args: ['prefix', '-g'],
      timeoutMs: NPM_INSTALL_STATE_TIMEOUT_MS
    }),
    npmPackageName === null
      ? Promise.resolve(null)
      : args.runner.run({
        command: npmCommand,
        args: ['list', '-g', npmPackageName, '--depth=0', '--json'],
        timeoutMs: NPM_INSTALL_STATE_TIMEOUT_MS
      }),
    args.definition.key === 'claudeCode'
      ? args.runner.run({
        command: args.definition.executableName,
        args: ['doctor'],
        timeoutMs: CLAUDE_DOCTOR_TIMEOUT_MS
      })
      : Promise.resolve(null)
  ]);

  const executablePath = isSuccessfulCommand(whichResult) ? firstOutputLine(whichResult.stdout) : null;
  const installed = executablePath !== null || isSuccessfulCommand(versionResult);
  const currentVersion = isSuccessfulCommand(versionResult)
    ? extractVersion(`${versionResult.stdout}\n${versionResult.stderr}`)
    : null;
  const claudeCodeDoctorStatus = claudeDoctorResult
    ? parseClaudeCodeDoctorStatus(`${claudeDoctorResult.stdout}\n${claudeDoctorResult.stderr}`)
    : null;
  const claudeCodeDistTags =
    args.definition.key === 'claudeCode' && latestResult && isSuccessfulCommand(latestResult)
      ? parseClaudeCodeDistTagVersions(`${latestResult.stdout}\n${latestResult.stderr}`)
      : null;
  const claudeCodeVersionStatus = args.definition.key === 'claudeCode'
    ? resolveClaudeCodeVersionStatus({
      installed,
      currentVersion,
      distTags: claudeCodeDistTags,
      updateChannel: claudeCodeDoctorStatus?.updateChannel ?? null
    })
    : null;
  const latestVersion = claudeCodeVersionStatus === null
    ? latestResult && isSuccessfulCommand(latestResult)
      ? extractVersion(`${latestResult.stdout}\n${latestResult.stderr}`)
      : null
    : claudeCodeVersionStatus.latestVersion;
  const npmGlobalPrefix = isSuccessfulCommand(npmPrefixResult) ? firstOutputLine(npmPrefixResult.stdout) : null;
  const npmGlobalPackageVersion = npmListResult && npmPackageName
    ? parseNpmGlobalPackageVersion(`${npmListResult.stdout}\n${npmListResult.stderr}`, npmPackageName)
    : null;
  const installSource = resolveProviderCliInstallSource({
    installed,
    executablePath,
    npmGlobalPrefix,
    nodePlatform: args.nodePlatform
  });
  const needsUpdate = claudeCodeVersionStatus?.needsUpdate
    ?? needsProviderCliUpdate({ installed, currentVersion, latestVersion });
  const versionUnsupported = isProviderCliVersionUnsupported({
    installed,
    currentVersion,
    minimumSupportedVersion: args.definition.minimumSupportedVersion
  });
  return {
    displayName: args.definition.displayName,
    executableName: args.definition.executableName,
    executablePath,
    installed,
    installSource,
    currentVersion,
    latestVersion,
    minimumSupportedVersion: args.definition.minimumSupportedVersion,
    npmPackageName,
    npmGlobalPackageVersion,
    installAction: buildInstallAction({
      definition: args.definition,
      installed,
      executablePath,
      installSource,
      needsUpdate,
      versionUnsupported,
      nodePlatform: args.nodePlatform,
      claudeCodeDoctorStatus
    }),
    needsUpdate,
    versionUnsupported
  };
}

export async function getProviderCliStatus(args: {
  env?: NodeJS.ProcessEnv;
  runner?: ProviderCliCommandRunner;
  nodePlatform?: NodeJS.Platform;
} = {}): Promise<ProviderCliStatusResponse> {
  const runner = args.runner ?? createSpawnProviderCliCommandRunner(args.env);
  const nodePlatform = args.nodePlatform ?? process.platform;
  const entries = await Promise.all(
    providerCliKeyValues.map(async (key) => [
      key,
      await inspectProviderCli({
        definition: getProviderCliDefinition(key),
        runner,
        nodePlatform
      })
    ] as const)
  );
  return Object.fromEntries(entries) as ProviderCliStatusResponse;
}

export function createSpawnProviderCliInstallProcessSpawner(
  env: NodeJS.ProcessEnv = process.env
): ProviderCliInstallProcessSpawner {
  return {
    spawn(args) {
      const child = spawn(args.command, args.args, {
        env: args.env ?? env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return {
        stdout: child.stdout,
        stderr: child.stderr,
        kill(signal) {
          return child.kill(signal);
        },
        onError(listener) {
          child.on('error', listener);
        },
        onClose(listener) {
          child.on('close', (code, signal) => listener(code, signal));
        }
      };
    }
  };
}

function reserveProviderCliInstall(provider: ProviderCliKey): { provider: ProviderCliKey; released: boolean } {
  if (activeProviderCliInstallProvider !== null) {
    throw new ProviderCliInstallInProgressError(activeProviderCliInstallProvider);
  }
  activeProviderCliInstallProvider = provider;
  return { provider, released: false };
}

function releaseProviderCliInstall(slot: { provider: ProviderCliKey; released: boolean }): void {
  if (slot.released) return;
  slot.released = true;
  if (activeProviderCliInstallProvider === slot.provider) {
    activeProviderCliInstallProvider = null;
  }
}

export async function runProviderCliInstall(args: {
  provider: ProviderCliKey;
  actionKind: ProviderCliInstallActionKind;
  env?: NodeJS.ProcessEnv;
  nodePlatform?: NodeJS.Platform;
  installProcessSpawner?: ProviderCliInstallProcessSpawner;
}): Promise<{ events: ProviderCliInstallEvent[] }> {
  const nodePlatform = args.nodePlatform ?? process.platform;
  const definition = getProviderCliDefinition(args.provider);
  const actionCommand = resolveProviderCliActionCommand({
    definition,
    actionKind: args.actionKind,
    nodePlatform
  });
  const slot = reserveProviderCliInstall(args.provider);
  const events: ProviderCliInstallEvent[] = [{
    type: 'started',
    provider: args.provider,
    command: actionCommand.displayCommand
  }];
  const spawner = args.installProcessSpawner ?? createSpawnProviderCliInstallProcessSpawner(args.env);
  let outputBytes = 0;

  try {
    const child = spawner.spawn({
      command: actionCommand.command,
      args: [...actionCommand.args],
      ...(args.env ? { env: args.env } : {})
    });
    await new Promise<void>((settle, reject) => {
      let done = false;
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error) reject(error);
        else settle();
      };
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        events.push({
          type: 'error',
          provider: args.provider,
          message: `Provider CLI install timed out after ${INSTALL_TIMEOUT_MS}ms`
        });
        finish();
      }, INSTALL_TIMEOUT_MS);
      const pushOutput = (stream: 'stdout' | 'stderr', text: string) => {
        outputBytes += Buffer.byteLength(text);
        if (outputBytes > INSTALL_OUTPUT_CAP) {
          child.kill('SIGTERM');
          events.push({
            type: 'error',
            provider: args.provider,
            message: `Provider CLI install output exceeded ${INSTALL_OUTPUT_CAP} bytes`
          });
          finish();
          return;
        }
        events.push({ type: 'output', provider: args.provider, stream, text });
      };
      child.stdout.setEncoding?.('utf8');
      child.stdout.on('data', (chunk: string | Buffer) => pushOutput('stdout', String(chunk)));
      child.stderr.setEncoding?.('utf8');
      child.stderr.on('data', (chunk: string | Buffer) => pushOutput('stderr', String(chunk)));
      child.onError((error) => {
        events.push({ type: 'error', provider: args.provider, message: error.message });
        finish();
      });
      child.onClose((exitCode, signal) => {
        events.push({
          type: 'completed',
          provider: args.provider,
          exitCode,
          signal,
          success: exitCode === 0
        });
        finish();
      });
    });
  } catch (error) {
    events.push({
      type: 'error',
      provider: args.provider,
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    releaseProviderCliInstall(slot);
  }

  return { events };
}

export function resetProviderCliInstallLockForTests(): void {
  activeProviderCliInstallProvider = null;
}
