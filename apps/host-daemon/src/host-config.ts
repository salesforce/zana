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

export function hostConfigPath(dataDir: string): string {
  return join(dataDir, 'config.json');
}

function resolveHostConfigDir(dataDir?: string, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = dataDir?.trim();
  if (explicit) return explicit;
  const fromEnv = env.ZCC_DATA_DIR?.trim();
  if (fromEnv) return fromEnv;
  return join(homedir(), '.zcc');
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
