import { lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { isWithin } from '@zana-ai/zcc-path-confine';
import { CliDiscoveryCommandSchema, CliDiscoveryResultSchema, type CliDiscoveryResult } from '@zana-ai/zcc-contracts/cli-discovery';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { harnessFamilyOf } from '@zana-ai/zcc-domain/launch-provider';
import { providerFor, registrationFor } from './harness/registry.js';
import { harnessEnabledFromProbe, installedHarnessVersion } from './harness/harness-verify.js';

/** Runs with this daemon's HOME, binaries and credentials. The server supplies
 * only a registered checkout boundary, never another machine's config/env. */
export async function discoverCliOnHost(raw: unknown, config: AppConfig, deps = {
  providerFor, installedHarnessVersion
}): Promise<CliDiscoveryResult> {
  const request = CliDiscoveryCommandSchema.parse(raw);
  if (!isAbsolute(request.root) || !isAbsolute(request.cwd) || !(await lstat(request.root)).isDirectory()) {
    throw new Error('CLI discovery requires an absolute directory root');
  }
  const root = await realpath(request.root);
  const cwd = await realpath(request.cwd);
  const rootStat = await stat(root), cwdStat = await stat(cwd);
  if (!isWithin(cwd, root) || !cwdStat.isDirectory()) {
    throw new Error('CLI discovery path is outside the registered checkout');
  }
  const localConfig = { ...config, nativeAgentDiscoveryEnabled: request.nativeAgentDiscoveryEnabled };
  const provider = deps.providerFor(request.profile);
  let result: unknown;
  if (request.query === 'version') {
    const version = await deps.installedHarnessVersion(localConfig,
      harnessFamilyOf(request.profile) || provider.adapter.descriptor.id);
    const verification = registrationFor(request.profile)?.verification;
    const enabled = harnessEnabledFromProbe({
      alwaysEnabled: verification?.alwaysEnabled,
      configEnabled: verification?.enabledConfigKey
        ? localConfig[verification.enabledConfigKey as keyof AppConfig] as boolean | undefined
        : undefined,
      installed: Boolean(version)
    });
    result = { query: 'version', version: enabled ? version : undefined };
  } else if (request.query === 'roles') {
    result = { query: 'roles', roles: [...await provider.discoverRoleTargets?.({ cwd, config: localConfig }) ?? []] };
  } else {
    const models = await provider.discoverModelTargets?.({ cwd, config: localConfig });
    result = { query: 'models', ...(models ? { models: [...models] } : {}) };
  }
  const currentRoot = await stat(request.root), currentCwd = await stat(request.cwd);
  if (await realpath(request.root) !== root || await realpath(request.cwd) !== cwd
    || currentRoot.dev !== rootStat.dev || currentRoot.ino !== rootStat.ino
    || currentCwd.dev !== cwdStat.dev || currentCwd.ino !== cwdStat.ino) {
    throw new Error('CLI discovery directory changed during the probe');
  }
  return CliDiscoveryResultSchema.parse(result);
}
