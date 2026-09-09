import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
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
export const PI_MINIMUM_SUPPORTED_VERSION = '0.84.0';

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

export type ProviderCliPathExists = (path: string) => boolean;
export type ProviderCliPathResolver = (path: string) => string;
export type ProviderCliFileHead = (path: string) => string | null;

function defaultResolvePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function defaultReadFileHead(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').slice(0, 8_192);
  } catch {
    return null;
  }
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
    minimumSupportedVersion: PI_MINIMUM_SUPPORTED_VERSION,
    installCommand: { kind: 'npmGlobal' },
    updateCommand: {
      commandKind: 'exec',
      displayCommand: 'pi update',
      command: 'pi',
      args: ['update']
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
      displayCommand: 'opencode upgrade',
      command: 'opencode',
      args: ['upgrade']
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

function firstNpmConfigValue(text: string): string | null {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !/^npm (warn|error|notice)\b/iu.test(line))
    ?? null;
}

function extractJsonValue(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const start = trimmed.search(/[{["]/u);
  if (start < 0) return null;
  const candidates = start === 0 ? [trimmed] : [trimmed.slice(start)];
  const lastBrace = trimmed.lastIndexOf('}');
  if (lastBrace > start) candidates.push(trimmed.slice(start, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Surrounding npm diagnostics are common on piped stdout/stderr.
    }
  }
  return null;
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

function nativeUpdateArgs(provider: ProviderCliKey): readonly string[] | null {
  if (provider === 'opencode') return ['upgrade'];
  if (provider === 'codex' || provider === 'claudeCode' || provider === 'cursor' || provider === 'pi') {
    return ['update'];
  }
  return null;
}

function npmPackageJsonPath(
  prefix: string,
  npmPackageName: string,
  nodePlatform: NodeJS.Platform
): string {
  return nodePlatform === 'win32'
    ? join(prefix, 'node_modules', npmPackageName, 'package.json')
    : join(prefix, 'lib', 'node_modules', npmPackageName, 'package.json');
}

export function npmInstallPrefixForExecutable(args: {
  executablePath: string | null;
  npmPackageName: string | null;
  nodePlatform: NodeJS.Platform;
  pathExists: ProviderCliPathExists;
}): string | null {
  if (!args.executablePath || !args.npmPackageName) return null;
  const executableDir = dirname(args.executablePath);
  const prefixes =
    args.nodePlatform === 'win32'
      ? [executableDir]
      : basename(executableDir) === 'bin'
        ? [dirname(executableDir)]
        : [];
  for (const prefix of prefixes) {
    if (args.pathExists(npmPackageJsonPath(prefix, args.npmPackageName, args.nodePlatform))) {
      return prefix;
    }
  }
  return null;
}

export function brewFormulaNameFromPath(path: string): string | null {
  const normalized = path.replace(/\\/gu, '/');
  return /(?:^|\/)Cellar\/([^/]+)\//u.exec(normalized)?.[1]
    ?? /(?:^|\/)opt\/homebrew\/opt\/([^/]+)\//u.exec(normalized)?.[1]
    ?? /(?:^|\/)usr\/local\/opt\/([^/]+)\//u.exec(normalized)?.[1]
    ?? null;
}

export function shellExecTargetFromHead(source: string, fromFile: string): string | null {
  if (!source.startsWith('#!')) return null;
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\s*exec\s+(?:"([^"]+)"|'([^']+)'|(\S+))/u.exec(line);
    const raw = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!raw) continue;
    return isAbsolute(raw) ? raw : resolve(dirname(fromFile), raw);
  }
  return null;
}

function unixInstallPrefixGuess(executablePath: string, nodePlatform: NodeJS.Platform): string | null {
  const executableDir = dirname(executablePath);
  if (nodePlatform === 'win32') return executableDir;
  return basename(executableDir) === 'bin' ? dirname(executableDir) : null;
}

export type ProviderCliUpdateClassification =
  | { kind: 'uninstalled' }
  | { kind: 'updatable'; npmPrefix: string | null }
  | { kind: 'homebrewFormula'; formula: string }
  | { kind: 'externalManaged'; pathLabel: string };

export function classifyProviderCliUpdate(args: {
  executablePath: string | null;
  npmPackageName: string | null;
  nodePlatform: NodeJS.Platform;
  pathExists: ProviderCliPathExists;
  resolvePath: ProviderCliPathResolver;
  readFileHead: ProviderCliFileHead;
}): ProviderCliUpdateClassification {
  if (!args.executablePath) return { kind: 'uninstalled' };
  const npmPrefix = npmInstallPrefixForExecutable({
    executablePath: args.executablePath,
    npmPackageName: args.npmPackageName,
    nodePlatform: args.nodePlatform,
    pathExists: args.pathExists
  });
  if (npmPrefix) return { kind: 'updatable', npmPrefix };
  const resolved = args.resolvePath(args.executablePath);
  const formula = brewFormulaNameFromPath(resolved) ?? brewFormulaNameFromPath(args.executablePath);
  if (formula) return { kind: 'homebrewFormula', formula };
  const head = args.readFileHead(args.executablePath);
  const target = head ? shellExecTargetFromHead(head, args.executablePath) : null;
  if (target) {
    const resolvedTarget = args.resolvePath(target);
    const prefix = unixInstallPrefixGuess(args.executablePath, args.nodePlatform);
    if (prefix && !isPathInsideDirectory(resolvedTarget, prefix)) {
      const pathLabel = resolvedTarget === args.executablePath
        ? args.executablePath
        : `${args.executablePath} (resolves to ${resolvedTarget})`;
      return { kind: 'externalManaged', pathLabel };
    }
  }
  return { kind: 'updatable', npmPrefix: null };
}

export function providerCliUpdateUnavailableReason(
  classification: ProviderCliUpdateClassification
): string | null {
  if (classification.kind === 'homebrewFormula') {
    return `Managed by Homebrew. Update with \`brew upgrade ${classification.formula}\`.`;
  }
  if (classification.kind === 'externalManaged') {
    return `ZCC cannot update this CLI. PATH is ${classification.pathLabel}.`;
  }
  return null;
}

const MS_PER_DAY = 86_400_000;

export function parseNpmMinReleaseAgeMs(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined' || trimmed === '0') return null;
  const suffixed = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/u.exec(trimmed);
  if (suffixed) {
    const amount = Number(suffixed[1]);
    const unit = suffixed[2];
    const ms =
      unit === 'ms' ? amount
        : unit === 's' ? amount * 1_000
          : unit === 'm' ? amount * 60_000
            : unit === 'h' ? amount * 3_600_000
              : amount * MS_PER_DAY;
    return ms > 0 ? ms : null;
  }
  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) {
    const days = Number(trimmed);
    return days > 0 ? days * MS_PER_DAY : null;
  }
  return null;
}

const npmViewLatestSchema = z.object({
  version: z.string().min(1).optional(),
  time: z.record(z.string(), z.unknown()).optional()
}).passthrough();

function stringTimeMap(time: Record<string, unknown> | undefined): Record<string, string> | null {
  if (!time) return null;
  const out: Record<string, string> = {};
  for (const [version, published] of Object.entries(time)) {
    if (typeof published === 'string' && published.length > 0) out[version] = published;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function parseNpmViewLatest(text: string): {
  version: string | null;
  time: Record<string, string> | null;
} {
  const parsedJson = extractJsonValue(text);
  if (parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson)) {
    const parsed = npmViewLatestSchema.safeParse(parsedJson);
    if (parsed.success) {
      return {
        version: parsed.data.version ? extractVersion(parsed.data.version) : extractVersion(text),
        time: stringTimeMap(parsed.data.time)
      };
    }
  }
  if (typeof parsedJson === 'string') {
    return { version: extractVersion(parsedJson), time: null };
  }
  return { version: extractVersion(text), time: null };
}

export function latestVersionRespectingMinReleaseAge(args: {
  absoluteLatest: string | null;
  versionTimes: Record<string, string> | null;
  minReleaseAgeMs: number | null;
  nowMs?: number;
}): string | null {
  if (!args.absoluteLatest) return null;
  if (!args.minReleaseAgeMs || !args.versionTimes) return args.absoluteLatest;
  const cutoff = (args.nowMs ?? Date.now()) - args.minReleaseAgeMs;
  const publishedAt = (version: string): number | null => {
    const raw = args.versionTimes?.[version];
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  };
  const absolutePublished = publishedAt(args.absoluteLatest);
  if (absolutePublished !== null && absolutePublished <= cutoff) return args.absoluteLatest;
  let best: string | null = null;
  for (const version of Object.keys(args.versionTimes)) {
    if (version === 'created' || version === 'modified') continue;
    if (!parseSemverCore(version) || version.includes('-')) continue;
    if (semverGt(version, args.absoluteLatest)) continue;
    const time = publishedAt(version);
    if (time === null || time > cutoff) continue;
    if (best === null || semverGt(version, best)) best = version;
  }
  return best;
}

export function resolveProviderCliUpdateCommand(args: {
  definition: ProviderCliDefinition;
  executablePath: string | null;
}): ProviderCliActionCommand {
  const nativeArgs = nativeUpdateArgs(args.definition.key);
  if (nativeArgs) {
    return {
      commandKind: 'exec',
      displayCommand: formatCommand(args.definition.executableName, nativeArgs),
      command: args.executablePath ?? args.definition.updateCommand.command,
      args: nativeArgs
    };
  }
  return args.definition.updateCommand;
}

export function providerCliInstallDidNotTake(args: {
  actionKind: ProviderCliInstallActionKind;
  before: Pick<
    ProviderCliStatus,
    | 'displayName'
    | 'executablePath'
    | 'installed'
    | 'currentVersion'
    | 'latestVersion'
    | 'needsUpdate'
    | 'npmGlobalPackageVersion'
  >;
  after: Pick<
    ProviderCliStatus,
    | 'displayName'
    | 'executablePath'
    | 'installed'
    | 'currentVersion'
    | 'latestVersion'
    | 'needsUpdate'
    | 'npmGlobalPackageVersion'
  >;
}): string | null {
  const pathLabel = args.after.executablePath ?? args.before.executablePath ?? args.after.displayName;
  if (args.actionKind === 'install') {
    return args.after.installed
      ? null
      : `${args.after.displayName} is still not on PATH after install.`;
  }
  if (!args.after.installed) {
    return `${args.after.displayName} is no longer on PATH after update.`;
  }
  const versionUnchanged =
    args.after.currentVersion !== null
    && args.before.currentVersion !== null
    && args.after.currentVersion === args.before.currentVersion;
  const stillBehindLatest =
    args.after.needsUpdate
    && args.after.latestVersion !== null
    && args.after.currentVersion !== null
    && semverLt(args.after.currentVersion, args.after.latestVersion);
  const updateMissedThePathBinary =
    stillBehindLatest
    || (versionUnchanged && (args.after.needsUpdate || args.after.latestVersion === null));
  if (!updateMissedThePathBinary) return null;
  const current = args.after.currentVersion ?? 'an unknown version';
  const npmHint =
    args.after.npmGlobalPackageVersion
    && args.after.npmGlobalPackageVersion !== args.after.currentVersion
      ? ` npm global has ${args.after.npmGlobalPackageVersion}.`
      : '';
  const latestHint = args.after.latestVersion ? ` Latest is ${args.after.latestVersion}.` : '';
  return (
    `PATH still has ${current} at ${pathLabel}.${npmHint}${latestHint} `
    + 'The update did not replace the CLI this machine launches.'
  );
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
  classification: ProviderCliUpdateClassification;
}): ProviderCliInstallAction | null {
  if (!args.installed) {
    const command = installActionCommand(args.definition, args.nodePlatform);
    return { kind: 'install', label: 'Install', commandKind: command.commandKind, command: command.displayCommand };
  }
  if (providerCliUpdateUnavailableReason(args.classification)) {
    return null;
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
      && (claudeCodeInstallMethod === null || claudeCodeInstallMethod === 'npm-global'))
    || (args.classification.kind === 'updatable' && args.classification.npmPrefix !== null);
  if ((args.needsUpdate || args.versionUnsupported) && canRunUpdate) {
    const command = resolveProviderCliUpdateCommand({
      definition: args.definition,
      executablePath: args.executablePath
    });
    return { kind: 'update', label: 'Update', commandKind: command.commandKind, command: command.displayCommand };
  }
  return null;
}

function resolveProviderCliActionCommand(args: {
  definition: ProviderCliDefinition;
  actionKind: ProviderCliInstallActionKind;
  executablePath: string | null;
  nodePlatform: NodeJS.Platform;
}): ProviderCliActionCommand {
  return args.actionKind === 'install'
    ? installActionCommand(args.definition, args.nodePlatform)
    : resolveProviderCliUpdateCommand({
      definition: args.definition,
      executablePath: args.executablePath
    });
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
  pathExists?: ProviderCliPathExists;
  resolvePath?: ProviderCliPathResolver;
  readFileHead?: ProviderCliFileHead;
}): Promise<ProviderCliStatus> {
  const pathExists = args.pathExists ?? existsSync;
  const resolvePath = args.resolvePath ?? defaultResolvePath;
  const readFileHead = args.readFileHead ?? defaultReadFileHead;
  const npmCommand = npmExecutableName(args.nodePlatform);
  const npmPackageName = args.definition.npmPackageName;
  const usesNpmReleaseLag = args.definition.key === 'codex' || args.definition.key === 'pi';
  const [whichResult, versionResult, latestResult, npmPrefixResult, npmListResult, claudeDoctorResult, minReleaseAgeResult] = await Promise.all([
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
          : ['view', npmPackageName, 'version', 'time', '--json'],
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
      : Promise.resolve(null),
    usesNpmReleaseLag
      ? args.runner.run({
        command: npmCommand,
        args: ['config', 'get', 'min-release-age'],
        timeoutMs: NPM_INSTALL_STATE_TIMEOUT_MS
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
    ? (() => {
      if (!latestResult || !isSuccessfulCommand(latestResult)) return null;
      const viewed = parseNpmViewLatest(latestResult.stdout);
      if (!usesNpmReleaseLag) return viewed.version;
      const minReleaseAgeMs = minReleaseAgeResult && isSuccessfulCommand(minReleaseAgeResult)
        ? parseNpmMinReleaseAgeMs(
          firstNpmConfigValue(minReleaseAgeResult.stdout)
          ?? firstNpmConfigValue(minReleaseAgeResult.stderr)
        )
        : null;
      return latestVersionRespectingMinReleaseAge({
        absoluteLatest: viewed.version,
        versionTimes: viewed.time,
        minReleaseAgeMs
      });
    })()
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
  const classification = classifyProviderCliUpdate({
    executablePath,
    npmPackageName,
    nodePlatform: args.nodePlatform,
    pathExists,
    resolvePath,
    readFileHead
  });
  const blockedReason = providerCliUpdateUnavailableReason(classification);
  const updateUnavailableReason =
    (needsUpdate || versionUnsupported) && blockedReason ? blockedReason : null;
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
      claudeCodeDoctorStatus,
      classification
    }),
    needsUpdate,
    versionUnsupported,
    updateUnavailableReason
  };
}

export async function getProviderCliStatus(args: {
  env?: NodeJS.ProcessEnv;
  runner?: ProviderCliCommandRunner;
  nodePlatform?: NodeJS.Platform;
  pathExists?: ProviderCliPathExists;
  resolvePath?: ProviderCliPathResolver;
  readFileHead?: ProviderCliFileHead;
} = {}): Promise<ProviderCliStatusResponse> {
  const runner = args.runner ?? createSpawnProviderCliCommandRunner(args.env);
  const nodePlatform = args.nodePlatform ?? process.platform;
  const entries = await Promise.all(
    providerCliKeyValues.map(async (key) => [
      key,
      await inspectProviderCli({
        definition: getProviderCliDefinition(key),
        runner,
        nodePlatform,
        pathExists: args.pathExists,
        resolvePath: args.resolvePath,
        readFileHead: args.readFileHead
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
        env: {
          ...(args.env ?? env),
          CI: '1',
          npm_config_update_notifier: 'false'
        },
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
  runner?: ProviderCliCommandRunner;
  pathExists?: ProviderCliPathExists;
  resolvePath?: ProviderCliPathResolver;
  readFileHead?: ProviderCliFileHead;
  installProcessSpawner?: ProviderCliInstallProcessSpawner;
}): Promise<{ events: ProviderCliInstallEvent[] }> {
  const nodePlatform = args.nodePlatform ?? process.platform;
  const definition = getProviderCliDefinition(args.provider);
  const pathExists = args.pathExists ?? existsSync;
  const resolvePath = args.resolvePath ?? defaultResolvePath;
  const readFileHead = args.readFileHead ?? defaultReadFileHead;
  const runner = args.runner ?? createSpawnProviderCliCommandRunner(args.env);
  const slot = reserveProviderCliInstall(args.provider);
  const events: ProviderCliInstallEvent[] = [];
  const spawner = args.installProcessSpawner ?? createSpawnProviderCliInstallProcessSpawner(args.env);
  let outputBytes = 0;

  try {
    const before = await inspectProviderCli({
      definition,
      runner,
      nodePlatform,
      pathExists,
      resolvePath,
      readFileHead
    });
    if (args.actionKind === 'update' && before.updateUnavailableReason) {
      events.push({
        type: 'error',
        provider: args.provider,
        message: before.updateUnavailableReason
      });
      return { events };
    }
    const actionCommand = resolveProviderCliActionCommand({
      definition,
      actionKind: args.actionKind,
      executablePath: before.executablePath,
      nodePlatform
    });
    events.push({
      type: 'started',
      provider: args.provider,
      command: actionCommand.displayCommand
    });
    const npmPrefix = args.actionKind === 'update'
      ? npmInstallPrefixForExecutable({
        executablePath: before.executablePath,
        npmPackageName: definition.npmPackageName,
        nodePlatform,
        pathExists
      })
      : null;
    let closeResult: { exitCode: number | null; signal: NodeJS.Signals | null } | null = null;
    const child = spawner.spawn({
      command: actionCommand.command,
      args: [...actionCommand.args],
      env: {
        ...(args.env ?? process.env),
        ...(npmPrefix ? { npm_config_prefix: npmPrefix } : {})
      }
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
        closeResult = { exitCode, signal };
        finish();
      });
    });
    if (closeResult) {
      const alreadyFailed = events.some((event) => event.type === 'error');
      let success = closeResult.exitCode === 0 && !alreadyFailed;
      if (success) {
        const after = await inspectProviderCli({
          definition,
          runner,
          nodePlatform,
          pathExists,
          resolvePath,
          readFileHead
        });
        const failure = providerCliInstallDidNotTake({
          actionKind: args.actionKind,
          before,
          after
        });
        if (failure) {
          events.push({ type: 'error', provider: args.provider, message: failure });
          success = false;
        }
      }
      events.push({
        type: 'completed',
        provider: args.provider,
        exitCode: closeResult.exitCode,
        signal: closeResult.signal,
        success
      });
    }
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
