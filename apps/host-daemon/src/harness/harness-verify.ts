/**
 * Verification is declared beside each harness registration. This runner only
 * executes the common bounded version probe and projects renderer-safe rows.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import type { AppConfig, HarnessFamily, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import { augmentPath } from '../env.js';
import { HARNESS_REGISTRATIONS } from './registry.js';

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

/**
 * Resolve a basename harness command against PATH. Finder/Dock and the
 * electron-vite sandbox often omit `~/.local/bin`, so `execFile('claude')`
 * returns ENOENT even when the CLI is installed. Absolute overrides that
 * exist stay as-is; a missing override (stale `harnesses.byId.*.binary`)
 * falls back to PATH search by basename so CLI Agents still launch.
 */
export function resolveHarnessCommand(command: string, pathEnv = process.env.PATH): string {
  if (!command) return command;
  const original = command;
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    if (existsSync(command)) return command;
    command = command.replace(/.*[/\\]/, '') || command;
  }
  for (const dir of (pathEnv ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return original;
}

/** Extract one exact numeric CLI version; ranges and aliases are deliberately unsupported. */
export function normalizeHarnessVersion(output: string): string | undefined {
  return output.match(/(?:^|[^0-9])v?(\d+\.\d+\.\d+)(?:[^0-9]|$)/)?.[1];
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
  return row.normalizedVersion
    ?? (row.version ? normalizeHarnessVersion(row.version) : undefined)
    ?? row.version;
}

export async function installedHarnessVersion(
  config: AppConfig,
  adapterId: string
): Promise<string | undefined> {
  return verifiableHarnessVersion(
    (await verifyHarnesses(config)).find(({ family }) => family === adapterId)
  );
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

/** Verify every registered binary harness against its registration metadata. */
export async function verifyHarnesses(config: AppConfig): Promise<HarnessVerifyResult[]> {
  const searchPath = augmentPath(process.env.PATH);
  const registrations = HARNESS_REGISTRATIONS.filter((registration) => registration.verification !== undefined);
  return Promise.all(registrations.map(async (registration): Promise<HarnessVerifyResult> => {
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
    return {
      family: registration.id as HarnessFamily,
      label: registration.label,
      binary: command,
      enabled,
      alwaysEnabled: verification.alwaysEnabled === true,
      installed: probe.ok,
      version: probe.ok ? probe.out : undefined,
      normalizedVersion: probe.ok ? normalizeHarnessVersion(probe.out) : undefined,
      installHint: verification.installHint
    };
  }));
}
