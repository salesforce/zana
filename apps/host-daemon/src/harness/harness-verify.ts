/**
 * Verification is declared beside each harness registration. This runner only
 * executes the common bounded version probe and projects renderer-safe rows.
 */

import { execFile } from 'node:child_process';
import type { AppConfig, HarnessFamily, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
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
  const registrations = HARNESS_REGISTRATIONS.filter((registration) => registration.verification !== undefined);
  return Promise.all(registrations.map(async (registration): Promise<HarnessVerifyResult> => {
    const verification = registration.verification!;
    const profile = registration.defaultProfileId ?? registration.profiles[0]!.id;
    const { command } = registration.implementation.resolveLaunch(profile, config, false);
    const probe = await runVersion(command, verification.versionArgs);
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
