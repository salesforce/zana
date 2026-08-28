import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { DEFAULT_TERMINAL_THEME } from '@zana-ai/zcc-domain/terminal-themes';
import { atomicDurableWrite } from '../../durable-store.js';

export interface ConfigStoreDependencies {
  normalizeConfig(input: Partial<AppConfig>): Partial<AppConfig>;
  projectConfigCompatibility(config: AppConfig): AppConfig;
  canonicalConfigForWrite(config: AppConfig): AppConfig;
  harnessEnabled(config: AppConfig, id: NonNullable<AppConfig['defaultHarness']>): boolean;
}

export interface ConfigStoreOptions {
  homeDir: string;
  configFile: string;
}

/**
 * Electron-free owner for the app-config JSON file. Compatibility normalization
 * remains injectable while the legacy store facade continues to expose its
 * established getConfig/setConfig API during the runtime migration.
 */
export function createConfigStore(
  { homeDir: _homeDir, configFile }: ConfigStoreOptions,
  deps: ConfigStoreDependencies
) {
  const readJsonRaw = <T>(fallback: T): { value: T; hash: string | null } => {
    try {
      if (!existsSync(configFile)) return { value: fallback, hash: null };
      const bytes = readFileSync(configFile);
      return { value: JSON.parse(bytes.toString('utf8')) as T, hash: createHash('sha256').update(bytes).digest('hex') };
    } catch {
      return { value: fallback, hash: null };
    }
  };

  const writeConfig = (config: AppConfig, expectedHash: string | null): void => {
    const directory = dirname(configFile);
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
    atomicDurableWrite(configFile, Buffer.from(JSON.stringify(config, null, 2)), { expectedHash });
  };

  const fallback = (): AppConfig => ({
    version: 1,
    theme: 'dark',
    terminalTheme: DEFAULT_TERMINAL_THEME,
    shell: process.env.SHELL || '/bin/zsh',
    claudeBinary: 'claude',
    fontSize: 13,
    lastProjectId: null,
    workspaceModes: {},
    agentsBoardView: 'board',
    inboxGrouping: 'project',
    autoModeEnabled: true,
    tmuxScope: 'all',
    menubarPopoverEnabled: true,
    localExtensionHotReloadEnabled: true,
    trustZccToolsEnabled: true,
    remoteDefaultPath: ''
  });

  return {
    getConfig(): AppConfig {
      const stored = deps.normalizeConfig(readJsonRaw<Partial<AppConfig>>({}).value);
      return deps.projectConfigCompatibility({ ...fallback(), ...stored, version: 1 });
    },
    setConfig(patch: Partial<AppConfig>): AppConfig {
      const disk = readJsonRaw<Partial<AppConfig>>({});
      const current = deps.projectConfigCompatibility({ ...fallback(), ...deps.normalizeConfig(disk.value), version: 1 });
      const normalizedPatch = deps.normalizeConfig(patch);
      const next = { ...current, ...normalizedPatch, version: 1 as const };
      const optionalHarnessKeys = [
        'defaultHarness', 'harnessRouting', 'claudeAppendSystemPrompt',
        'claudeExtraArgs', 'claudeAddDirs', 'claudeAllowedTools',
        'claudeDeniedTools', 'defaultCodexSandbox', 'defaultCodexApproval',
        'defaultExecutionState', 'piProvider', 'piModel', 'piThinking'
      ] as const;
      for (const key of optionalHarnessKeys) {
        if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] === undefined) {
          delete next[key];
        }
      }
      for (const key of ['publicAppUrl', 'relayToken', 'relaySessionId'] as const) {
        if (Object.prototype.hasOwnProperty.call(patch, key) && !patch[key]) {
          delete next[key];
        }
        if (Object.prototype.hasOwnProperty.call(normalizedPatch, key) && !normalizedPatch[key]) {
          delete next[key];
        }
      }
      if (next.defaultHarness && !deps.harnessEnabled(next, next.defaultHarness)) {
        delete next.defaultHarness;
      }
      writeConfig(deps.canonicalConfigForWrite(next), disk.hash);
      return next;
    }
  };
}
