/**
 * Verification is declared beside each harness registration. This runner only
 * executes the common bounded version probe and projects renderer-safe rows.
 */

import { execFile } from 'node:child_process';
import type { AppConfig, HarnessFamily, HarnessVerifyResult } from '../../shared/types.js';
import { HARNESS_REGISTRATIONS } from './registry.js';

function runVersion(cmd: string, args: readonly string[], timeoutMs = 8_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, [...args], { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout ?? '').trim() || String(stderr ?? '').trim() });
    });
  });
}

/** Extract one exact numeric CLI version; ranges and aliases are deliberately unsupported. */
export function normalizeHarnessVersion(output: string): string | undefined {
  return output.match(/(?:^|[^0-9])v?(\d+\.\d+\.\d+)(?:[^0-9]|$)/)?.[1];
}

/** Verify every registered binary harness against its registration metadata. */
export async function verifyHarnesses(config: AppConfig): Promise<HarnessVerifyResult[]> {
  const registrations = HARNESS_REGISTRATIONS.filter((registration) => registration.verification !== undefined);
  return Promise.all(registrations.map(async (registration): Promise<HarnessVerifyResult> => {
    const verification = registration.verification!;
    const profile = registration.defaultProfileId ?? registration.profiles[0]!.id;
    const { command } = registration.implementation.resolveLaunch(profile, config, false);
    const enabled = verification.alwaysEnabled === true
      || (verification.enabledConfigKey !== undefined && config[verification.enabledConfigKey as keyof AppConfig] === true);
    const probe = await runVersion(command, verification.versionArgs);
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
