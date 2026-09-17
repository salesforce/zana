import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { COMPOSER_LAUNCH_SURFACES_REV, type AppConfig } from '@zana-ai/zcc-domain/product';
import { DEFAULT_TERMINAL_THEME } from '@zana-ai/zcc-domain/terminal-themes';
import { atomicDurableWrite, DurableWriteConflictError } from '../../durable-store.js';

export { DurableWriteConflictError };

export interface ConfigSnapshot {
  config: AppConfig;
  hash: string | null;
}

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

/** Never persist or serve a pair that hides both Modern and CLI Agent.
 *  Rev {@link COMPOSER_LAUNCH_SURFACES_REV} also resets leftover CLI-only
 *  (Modern+Team off from the old healer) to all-on once. */
export function ensureComposerLaunchSurfaces<T extends Partial<AppConfig>>(config: T): T {
  let next = config;
  if (next.composerShowCliAgent === false && next.composerShowModern === false) {
    next = {
      ...next,
      composerShowCliAgent: true,
      composerShowModern: true,
      composerShowAutonomousTeam: true,
      teamJobLaunchEnabled: true
    };
  }
  if (
    next.composerLaunchSurfacesRev !== COMPOSER_LAUNCH_SURFACES_REV
    && next.composerShowModern === false
    && next.composerShowAutonomousTeam === false
    && next.teamJobLaunchEnabled === false
  ) {
    next = {
      ...next,
      composerShowCliAgent: true,
      composerShowModern: true,
      composerShowAutonomousTeam: true,
      teamJobLaunchEnabled: true
    };
  }
  if (next.composerLaunchSurfacesRev !== COMPOSER_LAUNCH_SURFACES_REV) {
    next = { ...next, composerLaunchSurfacesRev: COMPOSER_LAUNCH_SURFACES_REV };
  }
  return next;
}

function composerLaunchSurfacesDiffer(before: Partial<AppConfig>, after: Partial<AppConfig>): boolean {
  return before.composerShowCliAgent !== after.composerShowCliAgent
    || before.composerShowModern !== after.composerShowModern
    || before.composerShowAutonomousTeam !== after.composerShowAutonomousTeam
    || before.teamJobLaunchEnabled !== after.teamJobLaunchEnabled
    || before.composerLaunchSurfacesRev !== after.composerLaunchSurfacesRev;
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
    projectViews: {},
    agentsBoardView: 'board',
    inboxGrouping: 'project',
    autoModeEnabled: true,
    tmuxScope: 'all',
    menubarPopoverEnabled: true,
    localExtensionHotReloadEnabled: true,
    trustZccToolsEnabled: true,
    injectProductGuidance: true,
    injectRemoteInstructions: true,
    injectBundledSkills: true,
    remoteDefaultPath: '',
    composerShowCliAgent: true,
    composerShowModern: true,
    composerShowAutonomousTeam: true,
    teamJobLaunchEnabled: true,
    executionClaimRecoveryObserveEnabled: true,
    executionClaimRecoveryEnforceEnabled: true,
    executionPlanStartupGraceMs: 300_000
  });

  const hydrate = (raw: Partial<AppConfig>): AppConfig =>
    ensureComposerLaunchSurfaces(
      deps.projectConfigCompatibility({ ...fallback(), ...deps.normalizeConfig(raw), version: 1 })
    );

  const applyOptionalResets = (next: AppConfig, patch: Partial<AppConfig>, normalizedPatch: Partial<AppConfig>): AppConfig => {
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
    return next;
  };

  return {
    getConfig(): AppConfig {
      const disk = readJsonRaw<Partial<AppConfig>>({});
      const stored = deps.normalizeConfig(disk.value);
      const merged = deps.projectConfigCompatibility({ ...fallback(), ...stored, version: 1 });
      const healed = ensureComposerLaunchSurfaces(merged);
      if (disk.hash !== null && composerLaunchSurfacesDiffer(merged, healed)) {
        try {
          writeConfig(deps.canonicalConfigForWrite(healed), disk.hash);
        } catch {
          /* still serve the healed view if another writer won the file */
        }
      }
      return healed;
    },
    snapshot(): ConfigSnapshot {
      const disk = readJsonRaw<Partial<AppConfig>>({});
      return { config: hydrate(disk.value), hash: disk.hash };
    },
    replaceConfig(next: AppConfig, expectedHash: string | null): AppConfig {
      const normalized = ensureComposerLaunchSurfaces({
        ...hydrate({}),
        ...deps.normalizeConfig(next),
        version: 1 as const
      });
      writeConfig(deps.canonicalConfigForWrite(normalized), expectedHash);
      return normalized;
    },
    setConfig(patch: Partial<AppConfig>): AppConfig {
      const disk = readJsonRaw<Partial<AppConfig>>({});
      const current = hydrate(disk.value);
      const normalizedPatch = deps.normalizeConfig(patch);
      const next = applyOptionalResets(
        ensureComposerLaunchSurfaces({ ...current, ...normalizedPatch, version: 1 as const }),
        patch,
        normalizedPatch
      );
      writeConfig(deps.canonicalConfigForWrite(next), disk.hash);
      return next;
    }
  };
}
