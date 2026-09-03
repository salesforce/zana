import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

const FALLBACK: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

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
    if (!existsSync(file)) return { ...FALLBACK };
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppConfig>;
    return { ...FALLBACK, ...parsed, version: 1 };
  } catch {
    return { ...FALLBACK };
  }
}
