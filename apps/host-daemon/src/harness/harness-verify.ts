/**
 * Verification is declared beside each harness registration. This runner only
 * executes the common bounded version probe and projects renderer-safe rows.
 */

import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import type { AppConfig, HarnessFamily, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import { augmentPath, augmentPathWithNodePrefixes, fallbackDirs, nodePrefixBinDirs } from '../env.js';
import { HARNESS_REGISTRATIONS } from './registry.js';
import {
  UNVERSIONED_HARNESS,
  comparableCliVersion,
  resolveProbedHarnessVersion
} from './version-floor.js';

export {
  UNVERSIONED_HARNESS,
  comparableCliVersion,
  harnessPackageVersion,
  normalizeHarnessVersion,
  resolveProbedHarnessVersion,
  versionFloorDecision
} from './version-floor.js';

function runVersion(
  cmd: string,
  args: readonly string[],
  searchPath: string,
  timeoutMs = 8_000
): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, [...args], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PATH: searchPath }
    }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout ?? '').trim() || String(stderr ?? '').trim() });
    });
  });
}

function isExecutableFile(candidatePath: string): boolean {
  try {
    accessSync(candidatePath, constants.X_OK);
    return statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

function wellKnownHarnessPaths(command: string, home: string): string[] {
  return [
    ...fallbackDirs(home).map((dir) => join(dir, command)),
    ...nodePrefixBinDirs(home).map((dir) => join(dir, command)),
    join(home, `.${command}`, 'local', command)
  ];
}

export interface ResolveHarnessCommandOptions {
  home?: string;
  uid?: number;
}

/**
 * Resolve a basename harness command against PATH, then well-known native
 * install locations. Finder/Dock and the electron-vite sandbox often omit
 * `~/.local/bin`, so `execFile('claude')` returns ENOENT even when the CLI is
 * installed. Absolute overrides that exist and are executable stay as-is; a
 * missing or non-executable override (stale `harnesses.byId.*.binary`) falls
 * back to PATH search by basename so CLI Agents still launch.
 */
export function resolveHarnessCommand(
  command: string,
  pathEnv = process.env.PATH,
  options: ResolveHarnessCommandOptions = {}
): string {
  if (!command) return command;
  const original = command;
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    if (isExecutableFile(command)) return command;
    command = command.replace(/.*[/\\]/, '') || command;
  }
  for (const dir of (pathEnv ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (isExecutableFile(candidate)) return candidate;
  }
  const uid = options.uid ?? process.getuid?.();
  if (uid === 0) return original;
  const home = options.home ?? homedir();
  for (const candidate of wellKnownHarnessPaths(command, home)) {
    if (isExecutableFile(candidate)) return candidate;
  }
  return original;
}

/**
 * Structured launch preflight needs a version string. Prefer the parsed
 * semver; if the probe succeeded but the banner is non-numeric, still treat
 * the harness as present so CLI Agents are not blocked while threads work.
 */
export function verifiableHarnessVersion(
  row: Pick<HarnessVerifyResult, 'installed' | 'normalizedVersion' | 'version'> | undefined
): string | undefined {
  if (!row?.installed) return undefined;
  return comparableCliVersion(row.normalizedVersion)
    ?? comparableCliVersion(row.version)
    ?? UNVERSIONED_HARNESS;
}

/**
 * Launch preflight only needs the selected family. Probe that one CLI instead
 * of waiting on every registered `--version` (the Settings roster API).
 */
export async function installedHarnessVersion(
  config: AppConfig,
  adapterId: string
): Promise<string | undefined> {
  return verifiableHarnessVersion(await verifyHarness(config, adapterId));
}

/** Share one in-flight/completed lookup per adapter for a single launch. */
export function memoizeInstalledVersion(
  lookup: (adapterId: string) => Promise<string | undefined>
): (adapterId: string) => Promise<string | undefined> {
  const pending = new Map<string, Promise<string | undefined>>();
  return (adapterId) => {
    const existing = pending.get(adapterId);
    if (existing) return existing;
    const next = lookup(adapterId);
    pending.set(adapterId, next);
    return next;
  };
}

/**
 * Presence is enough to activate a harness, matching BB's installed-ACP-agent
 * rule: a found CLI is usable unless the operator explicitly hid it. Unset
 * config + installed ⇒ on. Explicit `false` stays off. Explicit `true` keeps
 * the enabled-but-missing Settings state.
 */
export function harnessEnabledFromProbe(input: {
  alwaysEnabled?: boolean;
  configEnabled?: boolean;
  installed: boolean;
}): boolean {
  if (input.alwaysEnabled === true) return true;
  if (input.configEnabled === false) return false;
  if (input.configEnabled === true) return true;
  return input.installed;
}

async function verifyHarnessRegistration(
  registration: (typeof HARNESS_REGISTRATIONS)[number],
  config: AppConfig,
  searchPath: string
): Promise<HarnessVerifyResult> {
  const verification = registration.verification!;
  const profile = registration.defaultProfileId ?? registration.profiles[0]!.id;
  const { command: launchCommand } = registration.implementation.resolveLaunch(profile, config, false);
  const command = resolveHarnessCommand(launchCommand, searchPath);
  const probe = await runVersion(command, verification.versionArgs, searchPath);
  const configEnabled = verification.enabledConfigKey !== undefined
    ? config[verification.enabledConfigKey as keyof AppConfig] as boolean | undefined
    : undefined;
  const enabled = harnessEnabledFromProbe({
    alwaysEnabled: verification.alwaysEnabled,
    configEnabled,
    installed: probe.ok
  });
  const normalizedVersion = probe.ok
    ? resolveProbedHarnessVersion(probe.out, command, nodePrefixBinDirs())
    : undefined;
  return {
    family: registration.id as HarnessFamily,
    label: registration.label,
    binary: command,
    enabled,
    alwaysEnabled: verification.alwaysEnabled === true,
    installed: probe.ok,
    version: normalizedVersion,
    normalizedVersion,
    installHint: verification.installHint
  };
}

function verificationSearchPath(): string {
  return augmentPathWithNodePrefixes(augmentPath(process.env.PATH));
}

async function verifyHarness(
  config: AppConfig,
  adapterId: string
): Promise<HarnessVerifyResult | undefined> {
  const registration = HARNESS_REGISTRATIONS.find(
    (candidate) => candidate.id === adapterId && candidate.verification !== undefined
  );
  if (!registration) return undefined;
  return verifyHarnessRegistration(registration, config, verificationSearchPath());
}

/** Verify every registered binary harness against its registration metadata. */
export async function verifyHarnesses(config: AppConfig): Promise<HarnessVerifyResult[]> {
  const searchPath = verificationSearchPath();
  const registrations = HARNESS_REGISTRATIONS.filter((registration) => registration.verification !== undefined);
  return Promise.all(
    registrations.map((registration) => verifyHarnessRegistration(registration, config, searchPath))
  );
}
