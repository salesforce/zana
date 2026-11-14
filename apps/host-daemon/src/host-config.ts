import { projectConfigCompatibility } from '@zana-ai/zcc-domain/harness-config-compatibility';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { defaultShellSetting, type DefaultShellSettingOptions } from '@zana-ai/zcc-process-utils';

const FALLBACK: Omit<AppConfig, 'shell'> = {
  version: 1,
  theme: 'dark',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

/** Windows keeps the old fixed value; elsewhere the first shell that exists. */
const WINDOWS_FALLBACK_SHELL = '/bin/zsh';
let fallbackShell: string | undefined;

/** The host's default `shell` when config.json has none. Resolved once per process. */
export function hostFallbackShell(probe?: Omit<DefaultShellSettingOptions, 'windows'>): string {
  if (probe) return defaultShellSetting({ windows: WINDOWS_FALLBACK_SHELL, ...probe });
  return (fallbackShell ??= defaultShellSetting({ windows: WINDOWS_FALLBACK_SHELL }));
}

/** Packaged / production data-dir name under HOME. */
export const ZCC_DATA_DIR_NAME = '.zcc';

/** Isolated `pnpm dev` data-dir name under HOME. */
export const ZCC_DEV_DATA_DIR_NAME = '.zcc-dev';

/**
 * Resolve the app state directory. `ZCC_DATA_DIR` (then `ZCC_CENTER_DIR`)
 * wins so `pnpm dev` can keep `~/.zcc-dev` while the packaged app owns `~/.zcc`.
 * Pass `home` when Electron remaps `app.getPath('home')` (E2E).
 */
export function resolveZccDataDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  const explicit = env.ZCC_DATA_DIR?.trim() || env.ZCC_CENTER_DIR?.trim();
  if (explicit) return explicit;
  return join(home, ZCC_DATA_DIR_NAME);
}

export function hostConfigPath(dataDir: string): string {
  return join(dataDir, 'config.json');
}

function resolveHostConfigDir(dataDir?: string, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = dataDir?.trim();
  if (explicit) return explicit;
  return resolveZccDataDir(env);
}

/** Read the host data-dir config at spawn time so Settings `claudeBinary` reaches PtyManager. */
export function loadHostAppConfig(dataDir?: string, env: NodeJS.ProcessEnv = process.env): AppConfig {
  try {
    const file = hostConfigPath(resolveHostConfigDir(dataDir, env));
    if (!existsSync(file)) return { ...FALLBACK, shell: hostFallbackShell() };
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppConfig>;
    return projectConfigCompatibility({ ...FALLBACK, shell: hostFallbackShell(), ...parsed, version: 1 });
  } catch {
    return { ...FALLBACK, shell: hostFallbackShell() };
  }
}
