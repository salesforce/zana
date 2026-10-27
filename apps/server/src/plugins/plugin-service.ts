import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, watch } from 'node:fs';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { resolveZccDataDir } from '@zana-ai/zcc-host-daemon/host-config';
import { fileURLToPath } from 'node:url';
import { scanPluginFiles } from './plugin-file-scan.js';
import { createIsolatedPluginRuntime } from './isolated-plugin-runtime.js';
import { canonicalPluginPath, createPluginActivationStore, type PluginActivationJournal } from './plugin-activation-store.js';
import { marketplaceInstallSpec, type MarketplaceEntry } from './marketplace.js';
import {
  createMarketplaceStore,
  fetchMarketplaceIndex,
  marketplaceStorePath,
  resolveCatalogEntry,
  type MarketplaceCatalogRow,
  type MarketplaceStore
} from './marketplace-store.js';
import {
  marketplaceSourceDisplay,
  marketplaceSourcesEqual,
  materializeMarketplaceIndex,
  materializeMarketplaceSource,
  parseMarketplaceSource
} from './marketplace-source.js';
import {
  DEFAULT_MARKETPLACE_SEED_TIMEOUT_MS,
  resolveCommunityMarketplaceSource,
  resolveInternalMarketplaceSource,
  resolveOfficialMarketplaceUrl
} from './default-marketplaces.js';
import {
  formatPluginRequireCycle,
  isPluginId,
  parsePluginSource,
  parsePluginOverviewMarkdown,
  readPluginManifest,
  sortPluginsByRequires,
  type ParsedPluginSource,
  type PluginMcpServerContribution,
  type PluginManifest
} from '@zana-ai/zcc-domain';
import { resolveContainedReal } from '@zana-ai/zcc-path-confine';
import { shimLegacyExtensionManifest } from '@zana-ai/zcc-plugin-sdk';
import {
  HOST_PLUGIN_SDK_VERSION,
  HOST_ZCC_VERSION,
  containsNativeAddon,
  createPluginApi,
  mentionTriggersOf,
  resolveContainedEntry,
  runPluginCli
} from './plugin-api.js';
import {
  PLUGIN_MENTION_RESOLVE_TIMEOUT_MS,
  splitPluginMentionItemId,
  withDeadline
} from './plugin-mentions.js';
import { callPluginHostRpc, disposePluginHostWorkers } from './plugin-host-rpc.js';
import { parseRemoteEnvironmentNames } from '../services/hosts/remote-environment.js';
import { PluginHostArtifactRegistry } from './plugin-host-artifact-registry.js';
import { loadPluginHostArtifactSnapshot } from './plugin-host-artifact.js';
import { registerThreadProvider, trackThreadProviderStartup } from '../services/threads/thread-provider-catalog.js';
import { discoverPluginSkillNames } from './plugin-skills.js';
import {
  BUILTIN_PLUGINS,
  OFFICIAL_PLUGINS,
  RECLAIM_UNINSTALLED_AUTOINSTALL_IDS,
  bundledPluginByName,
  isRetiredFirstPartyPluginId
} from './builtin-registry.js';
import { defaultCloneGit, defaultFetchJson, defaultSpawnNpm } from './plugin-process.js';
import { readPluginLogTail } from './plugin-log.js';
import {
  classifyInstalledToolPolicy,
  classifyActivatedToolPolicy,
  createPluginStore,
  pluginStorePath,
  type InstalledPluginRow,
  type PluginStore
} from './plugin-store.js';
import {
  TOOL_POLICY_INVENTORY_UNAVAILABLE_REASON,
  TOOL_POLICY_NOT_READY_REASON,
  TOOL_POLICY_STAMP_CHANGED_REASON,
  captureToolPolicyStamp,
  createToolPolicyInventoryState,
  persistKnownTrueMonotonically,
  requiredPolicyPluginIds,
  sameToolPolicyStamp,
  type ToolPolicyClassification,
  type ToolPolicyDecisionStamp,
  type ToolPolicyInventoryEntry
} from './plugin-tool-policy-state.js';
import { createPluginUninstalledStore, pluginUninstalledPath } from './plugin-uninstalled.js';
import {
  generatedSkillsRootPath,
  syncPluginCommandsSkill,
  type PluginCliContribution
} from './plugin-commands-skill.js';
import { syncPluginInstructionsSkill } from './plugin-instructions-skill.js';
import {
  BUILTIN_SKILL_OWNER,
  collectPluginSkillDirectoryRoots,
  selectBuiltinSkillDirectoryRoots,
  writeInjectedSkillRootManifest
} from './injected-skill-roots.js';
import { applyBundledPosthogApiKey } from '../bundled-posthog-api-key.js';
import type {
  PluginAgentConfigureContext,
  PluginAgentToolContext,
  PluginCliExecutionResult,
  PluginHttpRequest,
  PluginHttpResponse,
  PluginThreadEvent,
  PluginDispatchAdmissionRequest,
  PluginToolPolicyRequest,
  PluginToolPolicyDecision
} from '@zana-ai/zcc-plugin-sdk/server';
import type { ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import {
  deepFreezePluginMetadata,
  parsePersistedPluginMetadata
} from '@zana-ai/zcc-domain/thread-runtime';
import {
  listThreadPluginMetadataRows
} from '@zana-ai/zcc-db';
import {
  invokePluginAgentTool,
  resolvePluginSessionTools,
  type PluginAgentToolSource,
  type PluginSessionTools
} from './plugin-agent-tools.js';
import semver from 'semver';
import { runPluginSourceCommand } from './plugin-source-command.js';
import { createPluginUpdateStore } from './plugin-update-store.js';
import { installedSourceIntent, pluginUpdateFingerprint, pluginEngineProblems, resolvePluginUpdate, type PluginSourceIntent, type PluginUpdateCheck, type PluginUpdateResolver, type PluginUpdateCandidate } from './plugin-update-resolver.js';
import { PLUGIN_UPDATE_CHECK_INTERVAL_MS, startPluginUpdateSweep } from './plugin-updates.js';
import { assertBundledPluginInstall, bundledPluginById, bundledPluginSourceNotice, reconcileBundledPluginMetadata } from './bundled-plugin-policy.js';
import { buildPluginApp, buildPluginServer, buildPluginHost, getPluginBuildToolchain, createPluginDevLoop } from '@zana-ai/zcc-plugin-build';
import { createPluginServicesRegistry } from '@zana-ai/zcc-plugin-sdk/server';
import { createSerializedTransactionQueue } from '../durable-store.js';
import type { PluginRecoveryState } from '@zana-ai/zcc-domain/product';
import { copyRecoveryRollbackRuntime, createOfficialPluginRecovery } from './plugin-recovery-runtime.js';

export interface CatalogSearchHit {
  marketplace: string;
  id: string;
  displayName: string;
  description: string;
  source: string;
}

export interface PluginUpdateRow {
  id: string;
  current: string;
  available: string;
  marketplace: string;
}

export interface PluginService {
  emitHostEvent(event: import('./plugin-api.js').PluginHostEvent): Promise<void>;
  list(): InstalledPluginRow[];
  get(id: string): InstalledPluginRow | undefined;
  status(id: string): InstalledPluginRow['status'] | undefined;
  install(source: string, opts?: { enable?: boolean }): Promise<InstalledPluginRow>;
  enable(id: string): Promise<InstalledPluginRow>;
  disable(id: string): Promise<InstalledPluginRow>;
  remove(id: string): Promise<void>;
  reload(id: string): Promise<InstalledPluginRow>;
  hardReload(): Promise<PluginRecoveryState>;
  recoveryStatus(): PluginRecoveryState;
  refreshSafeMode(): Promise<void>;
  refreshDevelopmentMode(): Promise<void>;
  reconcileBuiltins(): Promise<InstalledPluginRow[]>;
  start(): Promise<void>;
  /** Release the periodic catalog-update sweep. Safe to call more than once. */
  stop(): void;
  snapshot(): PluginUiSnapshot[];
  appUrl(id: string): string | null;
  agentContributions(): PluginAgentContribution[];
  sessionTools(ctx: PluginAgentConfigureContext): Promise<PluginSessionTools>;
  invokeAgentTool(args: {
    name: string;
    input: unknown;
    ctx: PluginAgentToolContext;
  }): Promise<ToolCallResponse>;
  callRpc(pluginId: string, method: string, args: unknown): Promise<unknown>;
  getSettings(pluginId: string): {
    descriptors: Record<string, import('@zana-ai/zcc-plugin-sdk/server').PluginSettingDescriptor>;
    values: Record<string, import('@zana-ai/zcc-plugin-sdk/server').PluginSettingValue | undefined>;
  };
  setSettings(
    pluginId: string,
    values: Record<string, import('@zana-ai/zcc-plugin-sdk/server').PluginSettingValue | undefined>
  ): Promise<void>;
  listMarketplaces(): MarketplaceCatalogRow[];
  addMarketplace(source: string, opts?: { official?: boolean }): Promise<MarketplaceCatalogRow>;
  refreshMarketplace(source: string): Promise<MarketplaceCatalogRow>;
  removeMarketplace(source: string): Promise<boolean>;
  searchCatalog(query: string): Promise<CatalogSearchHit[]>;
  checkUpdates(): Promise<PluginUpdateRow[]>;
  applyUpdate(id: string): Promise<InstalledPluginRow>;
  applyAllUpdates(): Promise<{ updated: string[]; failed: Array<{ id: string; message: string }> }>;
  cliContributions(): PluginCliContribution[];
  mentionProviders(): Array<{
    pluginId: string;
    id: string;
    label: string;
    trigger?: string;
    triggers: string[];
  }>;
  resolveMention(args: {
    pluginId: string;
    itemId: string;
  }): Promise<{ ok: true; context: string } | { ok: false; error: string }>;
  evaluateProjectTabAvailability(args: {
    pluginId: string;
    tabId: string;
    projectId: string;
  }): Promise<import('@zana-ai/zcc-domain').ProjectTabAvailabilityContract>;
  runCliCommand(id: string, argv: string[], context?: { projectId?: string; threadId?: string; cwd?: string }): Promise<PluginCliExecutionResult>;
  dispatchHttp(pluginId: string, request: PluginHttpRequest): Promise<PluginHttpResponse>;
  dispatchPeer(pluginId: string, method: string, request: import('@zana-ai/zcc-plugin-sdk/server').PluginPeerRequest): Promise<unknown>;
  emitThreadEvent(event: PluginThreadEvent): Promise<void>;
  admitDispatch(request: PluginDispatchAdmissionRequest): Promise<import('@zana-ai/zcc-domain').DispatchAdmissionDecision>;
  decideToolPolicy(request: PluginToolPolicyRequest): Promise<PluginToolPolicyDecision>;
  /**
   * One consistent view of the native tool-policy inventory once startup has
   * settled: a single strict registry read joined with this service's sealed
   * live generations. Fail-closed; never a reason to skip policy.
   */
  toolPolicyReadiness(): Promise<PluginToolPolicyReadiness>;
  readLogs(id: string, tail?: number): Promise<string[]>;
  /** Rewrite injected-skill-roots.json for the current bundled-skill opt-outs. */
  syncInjectedSkillRoots(): Promise<void>;
}

export interface PluginToolPolicyReadinessEntry {
  pluginId: string;
  toolPolicy: ToolPolicyClassification;
  status: InstalledPluginRow['status'];
  sealed: boolean;
}

export interface PluginToolPolicyReadiness {
  ready: boolean;
  /** Enabled plugins whose classification is not known-false. */
  required: PluginToolPolicyReadinessEntry[];
  reason?: string;
}

export interface PluginUiSnapshot {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  provenance: InstalledPluginRow['provenance'];
  sourceKind: InstalledPluginRow['sourceKind'];
  status: InstalledPluginRow['status'];
  appEntry: string | null;
  appUrl: string | null;
  npmResolvedVersion: string | null;
  gitResolvedCommit: string | null;
  source: string;
  projectTab: PluginManifest['projectTab'];
  peers: boolean;
  skillNames: string[];
  mcpServers: PluginUiMcpServer[];
  extra: Record<string, unknown>;
  themes: PluginThemeSnapshot[];
  statusDetail: string | null;
  cliNames: string[];
  availableVersion?: string;
  updateCheck?: import('@zana-ai/zcc-domain/product').PluginUpdateStatus;
  updatePolicy?: import('@zana-ai/zcc-domain/product').PluginUpdatePolicy;
}

export interface PluginThemeSnapshot {
  pluginId: string;
  id: string;
  name: string;
  description?: string;
  cssUrl: string;
}

/** Redacted renderer DTO — no install path, source string, or secrets. */
export function toPluginAppSnapshot(row: PluginUiSnapshot) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    enabled: row.enabled,
    provenance: row.provenance,
    sourceKind: row.sourceKind,
    ...(row.extra.threadProvider === true || row.extra.ptyHarness === true
      ? { collection: 'coding-agents' as const }
      : {}),
    status: row.status,
    statusDetail: row.statusDetail,
    appUrl: row.appUrl,
    ...(row.updateCheck ? { updateCheck: row.updateCheck } : {}),
    ...(row.updatePolicy ? { updatePolicy: row.updatePolicy } : {}),
    ...(row.availableVersion ? { availableVersion: row.availableVersion } : {}),
    projectTab: row.projectTab,
    ...(row.peers ? { peers: true } : {}),
    skillNames: row.skillNames,
    mcpServers: row.mcpServers.map((server) => ({
      name: server.name,
      type: server.type,
      ...(server.alwaysOn ? { alwaysOn: true } : {})
    })),
    cliNames: row.cliNames
  };
}

export interface PluginUiMcpServer {
  name: string;
  type: string;
  command?: string;
  args?: string[];
  url?: string;
  envKeys?: string[];
  alwaysOn?: boolean;
}

export interface PluginAgentContribution {
  id: string;
  enabled: boolean;
  rootDir: string;
  skillsRootPaths: string[];
  skillNames: string[];
  mcpServers: PluginMcpServerContribution[];
  extra: Record<string, unknown>;
}

export interface PluginServiceOptions {
  dataDir: string;
  bundledRoot: string;
  hostVersion?: string;
  pluginSdkVersion?: string;
  now?: () => number;
  activationStabilizationMs?: number;
  spawnNpm?: (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  cloneGit?: (url: string, dest: string, spec: string) => Promise<{ commit: string; refKind?: 'branch' | 'tag' | 'commit' }>;
  updateResolver?: Partial<PluginUpdateResolver>;
  fetchJson?: (url: string) => Promise<unknown>;
  /** Internal transport seam for official compiled recovery artifacts. */
  recoveryFetch?: typeof fetch;
  onAgentCapabilitiesChanged?: (contributors: PluginAgentContribution[]) => void | Promise<void>;
  /** Notify the runtime bridge after a plugin's visible app state changes. */
  onAppsChanged?: (apps: PluginUiSnapshot[]) => void | Promise<void>;
  requestPluginInteraction?: (args: {
    pluginId: string;
    threadId: string;
    rendererId: string;
    title: string;
    payload: import('@zana-ai/zcc-domain/thread-runtime').JsonValue;
    timeoutMs: number;
    signal?: AbortSignal;
  }) => Promise<import('@zana-ai/zcc-plugin-sdk/server').PluginInteractionResult>;
  interruptPluginInteractions?: (pluginId: string) => void;
  consumePluginApproval?: (args: { pluginId: string; token: string; binding: unknown }) => boolean;
  getInteraction?: (args: { pluginId: string; interactionId: string }) => Promise<
    import('@zana-ai/zcc-domain').InteractionContract | null
  >;
  upsertInteraction?: (args: {
    pluginId: string;
    projectId: string;
    correlationId: string;
    kind: string;
    payload: import('@zana-ai/zcc-domain').ContractJson;
  }) => Promise<import('@zana-ai/zcc-domain').InteractionContract>;
  acknowledgeInteraction?: (
    args: { pluginId: string } & import('@zana-ai/zcc-domain').InteractionAcknowledgement
  ) => Promise<import('@zana-ai/zcc-domain').InteractionContract>;
  cancelInteraction?: (
    args: { pluginId: string } & import('@zana-ai/zcc-domain').InteractionAcknowledgement
  ) => Promise<import('@zana-ai/zcc-domain').InteractionContract>;
  spawnThread?: (args: import('@zana-ai/zcc-plugin-sdk/server').PluginSdkThreadSpawnArgs & { pluginId: string }) => Promise<{ id: string }>;
  getThread?: (args: { pluginId: string; threadId: string }) => Promise<
    import('@zana-ai/zcc-plugin-sdk/server').PluginSdkThreadSummary | null
  >;
  listThreadEvents?: (args: {
    pluginId: string;
    threadId: string;
    limit?: number;
    types?: readonly string[];
    order?: 'asc' | 'desc';
  }) => Promise<import('@zana-ai/zcc-plugin-sdk/server').PluginSdkThreadEventRow[]>;
  sendThread?: (args: {
    pluginId: string;
    threadId: string;
    prompt: string;
    visibility?: 'visible' | 'agent-only';
    mode?: 'start' | 'auto' | 'steer' | 'queue-if-active' | 'steer-if-active';
  }) => Promise<{ id: string }>;
  stopThread?: (args: { pluginId: string; threadId: string }) => Promise<{ ok: true }>;
  threadOutput?: (args: { pluginId: string; threadId: string }) => Promise<
    import('@zana-ai/zcc-plugin-sdk/server').PluginSdkThreadOutput
  >;
  defaultExecutionOptions?: (args: { pluginId: string; threadId: string }) => Promise<
    import('@zana-ai/zcc-plugin-sdk/server').PluginSdkExecutionOptions
  >;
  getEnvironment?: (args: { pluginId: string; environmentId: string }) => Promise<
    import('@zana-ai/zcc-plugin-sdk/server').PluginSdkEnvironment
  >;
  readWorkspaceFile?: (args: {
    pluginId: string;
    hostId: string;
    path: string;
    rootPath: string;
  }) => Promise<import('@zana-ai/zcc-plugin-sdk/server').PluginSdkFileReadResult>;
  listProviders?: (args: { pluginId: string; environmentId?: string }) => Promise<
    import('@zana-ai/zcc-plugin-sdk/server').PluginSdkProviderInfo[]
  >;
  loadProviderModels?: (args: {
    pluginId: string;
    environmentId?: string;
    hostId?: string;
    providerId: string;
  }) => Promise<import('@zana-ai/zcc-plugin-sdk/server').PluginSdkModelCatalog>;
  archiveThread?: (args: { pluginId: string; threadId: string }) => Promise<{ id: string }>;
  forkThread?: (args: {
    pluginId: string;
    threadId: string;
    sourceSeqEnd?: number;
    visibility?: 'visible' | 'hidden';
    agentContextSeed?: unknown[];
    title?: string;
  }) => Promise<{ id: string }>;
  listThreads?: (args: {
    pluginId: string;
    includeHidden?: boolean;
    originKind?: 'fork';
    originPluginId?: string;
    archived?: boolean;
    limit?: number;
    offset?: number;
  }) => Promise<import('@zana-ai/zcc-plugin-sdk/server').PluginSdkThreadSummary[]>;
  listQueuedMessages?: (args: { pluginId: string; threadId: string }) => Promise<Array<{ id: string }>>;
  createQueuedMessage?: (args: {
    pluginId: string;
    threadId: string;
    input: unknown[];
    senderThreadId?: string;
  }) => Promise<{ id: string }>;
  unarchiveThread?: (args: { pluginId: string; threadId: string }) => Promise<{ id: string }>;
  getPluginMetadata?: (args: {
    pluginId: string;
    threadId: string;
  }) => Promise<import('@zana-ai/zcc-domain/thread-runtime').JsonObject>;
  updatePluginMetadata?: (args: {
    pluginId: string;
    threadId: string;
    set: import('@zana-ai/zcc-domain/thread-runtime').JsonObject;
    remove: readonly string[];
  }) => Promise<import('@zana-ai/zcc-domain/thread-runtime').JsonObject>;
  pushInbox?: (args: { pluginId: string; projectId: string; comments: string }) => Promise<{ id: string }>;
  listProjects?: (args: { pluginId: string }) => Promise<Array<{ id: string; name: string; path?: string; icon?: import('@zana-ai/zcc-domain').ProjectIcon }>>;
  registerPersonas?: (pluginId: string, personas: readonly import('@zana-ai/zcc-domain/product').PersonaInput[]) => void;
  registerTeams?: (pluginId: string, teams: readonly import('@zana-ai/zcc-domain/product').TeamInput[]) => void;
  productContext?: import('../http/product-context.js').ProductHttpContext;
  /** Shared live host-artifact map; omitted tests get a private registry. */
  pluginHostArtifacts?: PluginHostArtifactRegistry;
  /**
   * When true, watch installed builtin plugin source dirs and rebuild+reload
   * on change. Also permits explicit local path installs of bundled identities.
   * Startup default from ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD at attach.
   * The saved development setting takes precedence; remote
   * sources cannot replace bundled identities, including in development.
   */
  watchBuiltinPluginSources?: boolean;
  /**
   * Host-contributed agent tool source (not a plugin) — surfaced ahead of
   * plugin tools in `agentToolSources()`. Used for the Modern team-launch
   * forwarder, whose tools reach Electron-main's loopback MCP route.
   */
  hostAgentToolSource?: PluginAgentToolSource;
  /** Live AppConfig so bundled-skill injection can honor operator opt-outs. */
  getAppConfig?: () => {
    injectBundledSkills?: boolean;
    disabledBundledSkills?: string[];
    inAppAgentTerminalsEnabled?: boolean;
    pluginSafeMode?: boolean;
    pluginDevelopmentEnabled?: boolean;
  };
}

interface LivePlugin {
  unavailableProviders?: Array<{ unregister(): void }>;
  row: InstalledPluginRow;
  handle: Awaited<ReturnType<typeof createPluginApi>> | null;
  rpc: Map<string, (args: unknown) => unknown | Promise<unknown>>;
  isBusy?: () => boolean;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function loadManifestFromDir(rootDir: string): PluginManifest {
  const pkgPath = join(rootDir, 'package.json');
  let manifest: PluginManifest;
  if (existsSync(pkgPath)) {
    const pkg = readJson(pkgPath) as { zcc?: unknown };
    if (pkg.zcc) {
      manifest = readPluginManifest(pkg);
      manifest.skillNames = discoverPluginSkillNames(rootDir, manifest.skillsRootPaths);
      return manifest;
    }
  }
  const legacyPath = join(rootDir, 'extension.json');
  if (existsSync(legacyPath)) {
    const legacy = readJson(legacyPath) as Parameters<typeof shimLegacyExtensionManifest>[0];
    const dirName = rootDir.split(/[/\\]/).pop() ?? 'plugin';
    manifest = readPluginManifest(shimLegacyExtensionManifest(legacy, dirName));
    manifest.skillNames = discoverPluginSkillNames(rootDir, manifest.skillsRootPaths);
    return manifest;
  }
  throw new Error(`no package.json zcc block or extension.json in ${rootDir}`);
}

/**
 * Leftover MainModule dirs (`extension.json`, no `package.json` `zcc` block).
 * A real plugin — including a path install of an official plugin for
 * `zcc plugin dev` — has the `zcc` block and must not be treated as leftover.
 */
export function isLegacyExtensionJsonPluginRoot(rootDir: string): boolean {
  const pkgPath = join(rootDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = readJson(pkgPath) as { zcc?: unknown };
      if (pkg.zcc) return false;
    } catch {
      /* unreadable package.json is not a zcc plugin */
    }
  }
  return existsSync(join(rootDir, 'extension.json'));
}

function assertEngines(manifest: PluginManifest, hostVersion: string, sdkVersion: string): void {
  const problems = pluginEngineProblems(manifest.engines, hostVersion, sdkVersion);
  if (problems.length) throw new Error(problems.join('; '));
}

function resolveBundledDir(bundledRoot: string, name: string): string {
  const candidates = [
    join(bundledRoot, name),
    join(bundledRoot, '..', 'plugins', name),
    join(bundledRoot, '..', 'extensions', name)
  ];
  const found = candidates.find((dir) => existsSync(dir));
  if (!found) throw new Error(`bundled plugin "${name}" is not on disk`);
  return found;
}

export function createPluginService(opts: PluginServiceOptions): PluginService {
  const developmentEnabled = () => opts.getAppConfig?.().pluginDevelopmentEnabled ?? opts.watchBuiltinPluginSources === true;
  applyBundledPosthogApiKey();
  const store: PluginStore = createPluginStore({ file: pluginStorePath(opts.dataDir) });
  const uninstalled = createPluginUninstalledStore({ file: pluginUninstalledPath(opts.dataDir) });
  const marketplaces: MarketplaceStore = createMarketplaceStore({
    file: marketplaceStorePath(opts.dataDir)
  });
  const live = new Map<string, LivePlugin>();
  const serverRuntimes = new Set<ReturnType<typeof createIsolatedPluginRuntime>>();
  const updateChecks = createPluginUpdateStore(join(opts.dataDir, 'plugins', 'update-checks.json'));
  let pendingUpdateCheck: Promise<PluginUpdateRow[]> | undefined;
  let hardReloadRunning = false;
  let recoveryState: PluginRecoveryState = { phase: 'idle', total: 0, restored: [], skipped: [], failed: [] };
  let pendingCheckOverdueOnly = false;
  const hostVersion = opts.hostVersion ?? HOST_ZCC_VERSION;
  const sdkVersion = opts.pluginSdkVersion ?? HOST_PLUGIN_SDK_VERSION;
  const now = opts.now ?? Date.now;
  const kvRoot = join(opts.dataDir, 'plugins');
  const sourceCommands = new AbortController();
  const spawnNpm = opts.spawnNpm ?? ((args: string[], cwd: string) => defaultSpawnNpm(args, cwd, sourceCommands.signal));
  const cloneGit = opts.cloneGit ?? ((url: string, dest: string, spec: string) => defaultCloneGit(url, dest, spec, sourceCommands.signal));
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const hostArtifacts = opts.pluginHostArtifacts ?? new PluginHostArtifactRegistry();
  mkdirSync(kvRoot, { recursive: true });
  const activations = createPluginActivationStore(opts.dataDir);
  const activating = new Map<string, { failure?: Error; unsafeWriters?: boolean }>();
  const recoveryBlocked = new Set<string>();
  const updatingPlugins = new Set<string>();
  const activationInterrupts = new Map<string, () => void>();
  let recovering: Promise<void> | undefined;
  const lifecycleTails = new Map<string, Promise<void>>();
  function withLifecycle<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = lifecycleTails.get(id) ?? Promise.resolve();
    const result = previous.then(() => {
      if (stopped) throw new Error('plugin service is stopped');
      if (recoveryBlocked.has(id)) throw new Error('Plugin recovery requires a restart before further changes');
      return action();
    });
    const tail = result.then(() => undefined, () => undefined);
    lifecycleTails.set(id, tail);
    void tail.then(() => { if (lifecycleTails.get(id) === tail) lifecycleTails.delete(id); });
    return result;
  }
  let updateSweep: { stop(): void } | null = null;
  const builtinWatchers = new Map<string, { rootDir: string; loop: ReturnType<typeof createPluginDevLoop>; close(): void }>();
  const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const recoveryAttempts = new Map<string, number>();
  const MAX_WATCHDOG_RECOVERY_ATTEMPTS = 3;
  const WATCHDOG_FAILURE_MESSAGE = 'Plugin event loop stopped responding';
  const WATCHDOG_RECOVERY_BASE_DELAY_MS = 1_000;
  let lifecycleGeneration = 0;
  let starting: Promise<void> | null = null;
  let stopped = false;
  let started = false;
  const servicesRegistry = createPluginServicesRegistry();
  const promotionQueue = createSerializedTransactionQueue();
  const lifecycleEpochs = new Map<string, number>();
  // OBL-004: retry with the same invocationId must return the same decision rather
  // than re-invoking plugin handlers. Map insertion order supplies bounded FIFO eviction.
  const toolPolicyDecisions = new Map<string, {
    stamp: ToolPolicyDecisionStamp;
    decision: Promise<PluginToolPolicyDecision>;
  }>();
  const TOOL_POLICY_DECISIONS_MAX = 500;
  const toolPolicyInventory = createToolPolicyInventoryState();
  const toolPolicySealed = new Set<string>();
  const toolPolicyPendingTrue = new Map<string, Promise<void>>();
  const pendingToolPolicy = new Map<string, ToolPolicyClassification>();
  let toolPolicyReadFailure: string | null = null;

  function refreshToolPolicyInventory(): void {
    const result = store.readStrict();
    if ('error' in result) {
      toolPolicyReadFailure = result.error;
      toolPolicyInventory.retainAfterError(result.error);
      return;
    }
    toolPolicyReadFailure = null;
    const file = result.file;
    const rows = new Map<string, ToolPolicyInventoryEntry>(file.plugins.map((row) => [row.id, {
      pluginId: row.id,
      enabled: row.enabled,
      hasServer: Boolean(row.serverEntry),
      toolPolicy: classifyRowToolPolicy(row)
    }]));
    for (const [pluginId, toolPolicy] of pendingToolPolicy) {
      const row = rows.get(pluginId);
      if (row) rows.set(pluginId, { ...row, toolPolicy });
      else rows.set(pluginId, { pluginId, enabled: true, hasServer: true, toolPolicy });
    }
    toolPolicyInventory.replace({
      source: result.status === 'valid-empty' ? 'valid-empty' : 'loaded',
      entries: [...rows.values()]
    });
  }

  function classifyRowToolPolicy(row: InstalledPluginRow, declared?: boolean): ToolPolicyClassification {
    return classifyInstalledToolPolicy({
      enabled: row.enabled,
      serverEntry: row.serverEntry,
      toolPolicy: row.toolPolicy,
      declared
    });
  }

  function withToolPolicy(row: InstalledPluginRow, declared?: boolean): InstalledPluginRow {
    const stored = store.get(row.id)?.toolPolicy;
    return {
      ...row,
      toolPolicy: classifyInstalledToolPolicy({
        enabled: row.enabled,
        serverEntry: row.serverEntry,
        toolPolicy: stored === 'true' ? stored : row.toolPolicy,
        declared
      })
    };
  }

  function currentGenerationIds(): Map<string, string | null> {
    const ids = new Map<string, string | null>();
    for (const [id, current] of live) {
      const ready = Boolean(
        current.handle
        && toolPolicySealed.has(id)
        && current.handle.toolPolicyHandlers.length === 1
        && (current.row.toolPolicy === 'true' || current.row.toolPolicy === 'unknown')
      );
      ids.set(id, ready ? `${id}:${current.row.updatedAt}` : null);
    }
    return ids;
  }

  function currentToolPolicyStamp(): ToolPolicyDecisionStamp {
    return captureToolPolicyStamp(toolPolicyInventory.snapshot(), currentGenerationIds());
  }

  function inventoryBlocksAllow(): PluginToolPolicyDecision | null {
    if (toolPolicyReadFailure) {
      return { action: 'deny', reason: TOOL_POLICY_INVENTORY_UNAVAILABLE_REASON };
    }
    const snapshot = toolPolicyInventory.snapshot();
    for (const pluginId of requiredPolicyPluginIds(snapshot)) {
      const current = live.get(pluginId);
      const entry = snapshot.entries.find((item) => item.pluginId === pluginId);
      if (!current?.handle || !toolPolicySealed.has(pluginId)) {
        return { action: 'deny', reason: `${TOOL_POLICY_NOT_READY_REASON}: ${pluginId}` };
      }
      if (entry?.toolPolicy === 'true' && current.handle.toolPolicyHandlers.length !== 1) {
        return { action: 'deny', reason: `${TOOL_POLICY_NOT_READY_REASON}: ${pluginId}` };
      }
    }
    return null;
  }

  async function toolPolicyReadiness(): Promise<PluginToolPolicyReadiness> {
    // Builtin activation rewrites rows from `unknown` to sealed; reading
    // mid-startup would mix pre- and post-activation rows.
    if (starting) await starting.catch(() => undefined);
    if (stopped) return { ready: false, required: [], reason: 'plugin service is stopped' };
    const result = store.readStrict();
    if ('error' in result) {
      return { ready: false, required: [], reason: `${TOOL_POLICY_INVENTORY_UNAVAILABLE_REASON}: ${result.error}` };
    }
    const required = result.file.plugins
      .filter((row) => row.enabled && (row.toolPolicy === 'true' || (row.toolPolicy !== 'false' && Boolean(row.serverEntry))))
      .map((row): PluginToolPolicyReadinessEntry => {
        const current = live.get(row.id);
        return {
          pluginId: row.id,
          toolPolicy: row.toolPolicy ?? 'unknown',
          status: row.status,
          sealed: Boolean(current?.handle && toolPolicySealed.has(row.id) && current.handle.toolPolicyHandlers.length === 1)
        };
      });
    const blocked = required.filter((entry) => entry.toolPolicy !== 'true' || entry.status !== 'running' || !entry.sealed);
    return blocked.length === 0
      ? { ready: true, required }
      : {
          ready: false,
          required,
          reason: `${blocked.map((entry) => `${entry.pluginId} (${entry.toolPolicy}, ${entry.status}${entry.sealed ? '' : ', unsealed'})`).join(', ')}`
        };
  }

  function denyCachedAllow(reason: string): PluginToolPolicyDecision {
    return { action: 'deny', reason };
  }

  async function persistLearnedTrue(id: string): Promise<void> {
    const row = store.get(id);
    if (!row) return;
    const next = persistKnownTrueMonotonically({
      existing: row.toolPolicy,
      next: 'true',
      enabled: row.enabled
    });
    if (row.toolPolicy === next) return;
    await store.upsert({ ...row, toolPolicy: next, updatedAt: now() });
    const current = live.get(id);
    if (current) current.row = { ...current.row, toolPolicy: next };
    refreshToolPolicyInventory();
  }

  function persistLearnedTrueDuringActivation(id: string): void {
    if (toolPolicyPendingTrue.has(id)) return;
    const pending = persistLearnedTrue(id)
      .catch((error) => {
        console.error(`[plugins] failed to persist tool policy for ${id}`, error);
        throw error;
      })
      .finally(() => toolPolicyPendingTrue.delete(id));
    // Activation awaits this promise below. Observe it immediately as well so a
    // failed synchronous store write never becomes an unhandled rejection.
    void pending.catch(() => undefined);
    toolPolicyPendingTrue.set(id, pending);
  }

  refreshToolPolicyInventory();

  const lifecycleEpoch = (id: string): number => lifecycleEpochs.get(id) ?? 0;
  const bumpLifecycleEpoch = (id: string): void => {
    activationInterrupts.get(id)?.();
    lifecycleEpochs.set(id, lifecycleEpoch(id) + 1);
  };
  const isCurrent = (id: string, epoch: number, handle?: LivePlugin['handle']): boolean =>
    !stopped && lifecycleEpoch(id) === epoch && (!handle || live.get(id)?.handle === handle);
  const cancelRecovery = (id: string, resetAttempts = true): void => {
    const timer = recoveryTimers.get(id);
    if (timer) clearTimeout(timer);
    recoveryTimers.delete(id);
    if (resetAttempts) recoveryAttempts.delete(id);
  };
  const scheduleWatchdogRecovery = (id: string): void => {
    if (stopped || recoveryTimers.has(id) || !store.get(id)?.enabled) return;
    const attempt = recoveryAttempts.get(id) ?? 0;
    if (attempt >= MAX_WATCHDOG_RECOVERY_ATTEMPTS) return;
    recoveryAttempts.set(id, attempt + 1);
    const timer = setTimeout(() => {
      recoveryTimers.delete(id);
      if (stopped || !store.get(id)?.enabled) return;
      void service.reload(id).then((row) => {
        if (row.status === 'degraded') scheduleWatchdogRecovery(id);
      }).catch((error) => {
        console.error(`[plugins] automatic recovery failed for ${id}:`, error instanceof Error ? error.message : error);
        scheduleWatchdogRecovery(id);
      });
    }, WATCHDOG_RECOVERY_BASE_DELAY_MS * 2 ** attempt);
    timer.unref();
    recoveryTimers.set(id, timer);
  };

  async function waitForStartup(): Promise<void> {
    if (starting) await starting;
    await ensureActivationRecovery();
    if (stopped) throw new Error('plugin service is stopped');
  }

  function removeUnreferencedGeneration(root: string) {
    const generation = managedGenerationDirectory(opts.dataDir, root);
    if (generation && !store.list().some(row => managedGenerationDirectory(opts.dataDir, row.rootDir) === generation)) removeManagedGeneration(opts.dataDir, root);
  }
  function ensureActivationRecovery(): Promise<void> {
    return recovering ??= (async () => {
      for (let journal of await activations.list()) {
        const current = store.get(journal.previous.id);
        if (journal.phase === 'committed' || journal.phase === 'restored') {
          removeUnreferencedGeneration(journal.phase === 'committed' ? journal.previous.rootDir : journal.candidate.rootDir);
          await activations.finish(journal);
          continue;
        }
        // An acknowledged removal or a different installation supersedes recovery.
        if (!current || current.installedAt !== journal.previous.installedAt) {
          removeUnreferencedGeneration(journal.candidate.rootDir);
          await activations.finish(journal);
          continue;
        }
        if (![journal.previous.rootDir, journal.candidate.rootDir].includes(current.rootDir)) throw new Error('Plugin registration changed outside its pending activation; recovery requires attention');
        journal = await activations.phase(journal, 'restoring');
        await activations.restore(journal);
        await store.upsert({ ...journal.previous, enabled: current.enabled,
          toolPolicy: current.toolPolicy === 'true' ? 'true' : journal.previous.toolPolicy,
          lastActivationFailure: { version: journal.candidate.version, at: now(), detail: 'Interrupted update recovered; previous plugin-owned state restored.' } });
        journal = await activations.phase(journal, 'restored');
        removeUnreferencedGeneration(journal.candidate.rootDir);
        await activations.finish(journal);
      }
      await activations.pruneGenerations(store.list().map(row => row.rootDir));
      refreshToolPolicyInventory();
    })();
  }

  function closeUpdateAdmission(row: InstalledPluginRow): () => void {
    const current = live.get(row.id);
    if (current?.isBusy?.()) throw new Error('Plugin has an active call; retry its update when it finishes');
    const resume = hostArtifacts.beginUpdate(row.id);
    try {
      const providers = current?.handle?.providerDeclarations.map(provider => provider.id) ?? [];
      if (providers.length && opts.productContext?.db) {
        const active = opts.productContext.db.sqlite.prepare(`SELECT 1 FROM threads t
          WHERE t.provider_id IN (${providers.map(() => '?').join(',')})
          AND (t.status IN ('starting', 'active', 'stopping') OR EXISTS
            (SELECT 1 FROM thread_open_sessions s WHERE s.thread_id = t.id)) LIMIT 1`).get(...providers);
        if (active) throw new Error('Plugin has open provider sessions. Close those sessions before updating; active turns are preserved.');
      }
      updatingPlugins.add(row.id);
      return () => { updatingPlugins.delete(row.id); resume(); };
    } catch (error) { resume(); throw error; }
  }

  function requiresOf(row: InstalledPluginRow): string[] {
    try {
      return loadManifestFromDir(row.rootDir).requires;
    } catch {
      return [];
    }
  }

  function firstMissingRequiredPlugin(row: InstalledPluginRow): string | null {
    for (const id of requiresOf(row)) {
      const required = live.get(id);
      if (!required?.handle || !required.row.enabled) return id;
    }
    return null;
  }

  function isMissingPluginDetail(detail: string | null | undefined): boolean {
    return typeof detail === 'string' && detail.startsWith('needs plugin:');
  }

  async function applyMissingRequiredPluginStatus(): Promise<void> {
    for (const [id, current] of live) {
      if (!current.row.enabled || !current.handle) continue;
      if (current.row.status === 'degraded') continue;
      const missing = firstMissingRequiredPlugin(current.row);
      const missingDetail = missing ? `needs plugin: ${missing}` : null;
      const existingMissing = isMissingPluginDetail(current.row.statusDetail);
      if (missing) {
        if (current.row.status !== 'running' && !existingMissing) continue;
        if (current.row.status === 'needs-configuration' && current.row.statusDetail === missingDetail) {
          continue;
        }
        const next = {
          ...current.row,
          status: 'needs-configuration' as const,
          statusDetail: missingDetail
        };
        live.set(id, { ...current, row: next });
        await store.upsert(next);
      } else if (existingMissing) {
        const next = { ...current.row, status: 'running' as const, statusDetail: null };
        live.set(id, { ...current, row: next });
        await store.upsert(next);
      }
    }
  }

  function agentContributions(): PluginAgentContribution[] {
    return store.list().map((row) => {
      try {
        const manifest = loadManifestFromDir(row.rootDir);
        return {
          id: row.id,
          enabled: row.enabled,
          rootDir: row.rootDir,
          skillsRootPaths: [
            ...manifest.skillsRootPaths,
            ...(live.get(row.id)?.handle?.extraSkillRoots ?? [])
          ],
          skillNames: manifest.skillNames,
          mcpServers: manifest.mcpServers,
          extra: manifest.extra
        };
      } catch {
        return {
          id: row.id,
          enabled: false,
          rootDir: row.rootDir,
          skillsRootPaths: [],
          skillNames: [],
          mcpServers: [],
          extra: {}
        };
      }
    });
  }

  async function emitCapabilities(): Promise<void> {
    try {
      await opts.onAgentCapabilitiesChanged?.(agentContributions());
    } catch {
      /* capability sync is best-effort and must not wedge plugin lifecycle */
    }
  }

  async function emitAppsChanged(): Promise<void> {
    try {
      await opts.onAppsChanged?.(snapshot());
    } catch {
      /* Renderer updates are advisory and must not wedge plugin lifecycle. */
    }
  }

  function cliContributions(): PluginCliContribution[] {
    const out: PluginCliContribution[] = [];
    for (const [id, livePlugin] of live) {
      const registration = livePlugin.handle?.cli.registration;
      if (!registration) continue;
      out.push({
        pluginId: id,
        name: registration.name,
        summary: registration.summary,
        commands: registration.commands ?? []
      });
    }
    return out.sort((left, right) => left.pluginId.localeCompare(right.pluginId));
  }

  function mentionProviders() {
    const out: Array<{
      pluginId: string;
      id: string;
      label: string;
      trigger?: string;
      triggers: string[];
    }> = [];
    for (const [id, livePlugin] of live) {
      for (const provider of livePlugin.handle?.mentionProviders ?? []) {
        const triggers = mentionTriggersOf(provider);
        out.push({
          pluginId: id,
          id: provider.id,
          label: provider.label,
          trigger: triggers[0],
          triggers
        });
      }
    }
    return out;
  }

  async function resolveMention(args: {
    pluginId: string;
    itemId: string;
  }): Promise<{ ok: true; context: string } | { ok: false; error: string }> {
    const livePlugin = live.get(args.pluginId);
    if (!livePlugin?.handle) {
      return { ok: false, error: `plugin "${args.pluginId}" is not running` };
    }
    const split = splitPluginMentionItemId(args.itemId);
    const providerId = split?.providerId;
    const nativeId = split?.nativeId ?? args.itemId.trim();
    const provider = livePlugin.handle.mentionProviders.find((row) => row.id === providerId)
      ?? (!split ? livePlugin.handle.mentionProviders.find((row) => row.id === args.itemId.trim()) : undefined);
    if (!provider || typeof provider.resolve !== 'function') {
      return { ok: false, error: `unknown mention provider "${providerId ?? args.itemId}"` };
    }
    try {
      const result = await withDeadline(
        Promise.resolve(provider.resolve(nativeId)),
        PLUGIN_MENTION_RESOLVE_TIMEOUT_MS,
        `mention resolve ${args.pluginId}/${provider.id}`
      );
      const context = typeof result?.context === 'string' ? result.context.trim() : '';
      if (!context) return { ok: false, error: 'mention resolve returned empty context' };
      return { ok: true, context };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function evaluateProjectTabAvailability(args: {
    pluginId: string;
    tabId: string;
    projectId: string;
  }): Promise<import('@zana-ai/zcc-domain').ProjectTabAvailabilityContract> {
    const livePlugin = live.get(args.pluginId);
    const registration = livePlugin?.handle?.projectTabAvailability.find((row) => row.tabId === args.tabId);
    if (!registration) return { available: true };
    try {
      const result = await withDeadline(
        Promise.resolve(registration.evaluate({ projectId: args.projectId })),
        PLUGIN_MENTION_RESOLVE_TIMEOUT_MS,
        `project tab availability ${args.pluginId}/${args.tabId}`
      );
      return { available: Boolean(result?.available), ...(result?.reason ? { reason: result.reason } : {}) };
    } catch (error) {
      return {
        available: false,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  }

  function instructionContributions() {
    return [...live.entries()]
      .flatMap(([pluginId, current]) =>
        (current.handle?.extraInstructions ?? []).map((text) => ({ pluginId, text }))
      )
      .filter((row) => row.text.trim().length > 0);
  }

  function withPluginMetadata(
    sources: PluginAgentToolSource[],
    ctx: PluginAgentConfigureContext
  ): PluginAgentToolSource[] {
    const db = opts.productContext?.db;
    const threadId = ctx.threadId;
    if (!db || !threadId) {
      return sources.map((source) => ({
        ...source,
        pluginMetadata: deepFreezePluginMetadata({})
      }));
    }
    const rows = listThreadPluginMetadataRows(
      db,
      threadId,
      sources.map((source) => source.pluginId)
    );
    const byId = new Map(rows.map((row) => [row.pluginId, row.metadataJson]));
    return sources.map((source) => {
      const raw = byId.get(source.pluginId);
      if (raw === undefined) {
        return { ...source, pluginMetadata: deepFreezePluginMetadata({}) };
      }
      const parsed = parsePersistedPluginMetadata(raw);
      if (parsed === undefined) {
        console.warn(
          `Ignoring corrupt plugin metadata for thread ${threadId}, plugin ${source.pluginId}`
        );
        return { ...source, pluginMetadata: deepFreezePluginMetadata({}) };
      }
      return {
        ...source,
        pluginMetadata: deepFreezePluginMetadata(structuredClone(parsed))
      };
    });
  }

  function agentToolSources(): PluginAgentToolSource[] {
    const pluginSources = [...live.entries()]
      .filter(([, current]) => current.handle)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([pluginId, current]) => ({
        pluginId,
        name: store.get(pluginId)?.name,
        description: store.get(pluginId)?.description,
        tools: current.handle!.agentTools,
        configurers: current.handle!.agentConfigurers,
        extraInstructions: current.handle!.extraInstructions,
        extraInstructionProviders: current.handle!.extraInstructionProviders
      }));
    // Host source first so its tool names win the dedupe in
    // resolvePluginSessionTools over any collision from a plugin.
    return opts.hostAgentToolSource ? [opts.hostAgentToolSource, ...pluginSources] : pluginSources;
  }

  async function configuredInstructions(): Promise<Array<{ pluginId: string; text: string }>> {
    const out: Array<{ pluginId: string; text: string }> = [];
    for (const [pluginId, current] of live.entries()) {
      for (const provider of current.handle?.agentConfigurers ?? []) {
        try {
          const result = await provider({});
          const text = result?.instructions?.trim();
          if (text) out.push({ pluginId, text });
        } catch {
          /* one misbehaving configure() must not block the rest */
        }
      }
    }
    return out;
  }

  async function syncCliSkill(): Promise<void> {
    try {
      await syncPluginCommandsSkill(opts.dataDir, cliContributions());
      await syncPluginInstructionsSkill(opts.dataDir, [
        ...instructionContributions(),
        ...(await configuredInstructions())
      ]);
      const config = opts.getAppConfig?.() ?? {};
      const owners: Record<string, string> = {};
      const directoryRoots = [
        ...selectBuiltinSkillDirectoryRoots({
          dataDir: opts.dataDir,
          injectBundledSkills: config.injectBundledSkills,
          disabledBundledSkills: [
            ...(config.disabledBundledSkills ?? []),
            ...(config.inAppAgentTerminalsEnabled === true ? [] : ['zcc-terminal'])
          ]
        }),
        generatedSkillsRootPath(opts.dataDir)
      ];
      for (const root of directoryRoots) owners[root] = BUILTIN_SKILL_OWNER;
      for (const row of store.list()) {
        if (!row.enabled) continue;
        try {
          const manifest = loadManifestFromDir(row.rootDir);
          const roots = collectPluginSkillDirectoryRoots({
            rootDir: row.rootDir,
            relativeRoots: manifest.skillsRootPaths,
            extraRoots: live.get(row.id)?.handle?.extraSkillRoots
          });
          for (const root of roots) owners[root] ??= row.id;
          directoryRoots.push(...roots);
        } catch {
          /* skip unreadable plugins */
        }
      }
      writeInjectedSkillRootManifest(opts.dataDir, directoryRoots, owners);
    } catch (error) {
      console.error('[plugins] syncPluginCommandsSkill failed', error);
    }
  }

  /**
   * Source plugins declare `zcc.app` as `.tsx`. The renderer cannot import
   * TypeScript, so a one-shot `buildPluginApp` writes the `.js` sibling. A
   * missing renderer is an activation failure: fresh installs degrade and
   * replacement candidates leave the active generation untouched.
   */
  async function ensureCompiledApp(row: InstalledPluginRow): Promise<void> {
    const declared = row.appEntry;
    if (!declared) return;
    const compiledRel = declared.replace(/\.tsx?$/, '.js');
    if (/\.tsx?$/.test(declared) && (row.sourceKind === 'path' || !existsSync(join(row.rootDir, compiledRel)))) {
      try {
        // Production ignores this. Built-Electron E2E injects a deterministic
        // slow toolchain boundary without weakening worker startup deadlines.
        const e2eBuildDelayMs = process.env.ZCC_E2E_PLUGIN_BUILD_DELAY_MS;
        if (e2eBuildDelayMs && /^\d{1,6}$/.test(e2eBuildDelayMs)) {
          await new Promise<void>((resolve) => setTimeout(resolve, Number(e2eBuildDelayMs)));
        }
        await buildPluginApp(row.rootDir, hostVersion, { minify: false, sourcemap: true, toolchain: await getPluginBuildToolchain(opts.dataDir) });
      } catch (error) {
        const detail = (error instanceof Error ? error.message : String(error))
          .replaceAll(row.rootDir, '<plugin>')
          .slice(0, 500);
        throw new Error(`renderer build failed: ${detail}`);
      }
    }
    if (!existsSync(join(row.rootDir, compiledRel))) {
      throw new Error(`renderer asset missing: ${compiledRel}`);
    }
  }

  function appUrlFor(row: InstalledPluginRow): string | null {
    if (!row.appEntry) return null;
    try {
      const root = resolveContainedEntry(row.rootDir, '.');
      const declared = row.appEntry;
      // Renderer `import(appUrl)` cannot execute TypeScript. Vite's transform
      // pipeline also claims `.ts`/`.tsx` URLs (`?import`) and 404s them before
      // the product-server proxy. Serve the compiled `.js` sibling, or nothing.
      const served = /\.tsx?$/.test(declared)
        ? resolveContainedEntry(row.rootDir, declared.replace(/\.tsx?$/, '.js'))
        : resolveContainedEntry(row.rootDir, declared);
      if (/\.tsx?$/.test(served) || !existsSync(served) || !statSync(served).isFile()) return null;
      const entryPath = relative(root, served).split(sep).map(encodeURIComponent).join('/');
      return `/plugins/${encodeURIComponent(row.id)}/assets/${entryPath}?v=${row.updatedAt}`;
    } catch {
      return null;
    }
  }

  async function disposeOne(id: string, strict = false): Promise<void> {
    toolPolicySealed.delete(id);
    pendingToolPolicy.delete(id);
    refreshToolPolicyInventory();
    const current = live.get(id);
    if (!current) {
      hostArtifacts.delete(id);
      return;
    }
    live.delete(id);
    const artifact = hostArtifacts.peek(id);
    if (artifact && opts.productContext) await disposePluginHostWorkers(opts.productContext, id, artifact.generation);
    hostArtifacts.delete(id);
    current.unavailableProviders?.forEach((provider) => provider.unregister());
    await current.handle?.dispose({ strict });
    // A disposed plugin's contributed personas/teams must not outlive it as zombies.
    opts.registerPersonas?.(id, []);
    opts.registerTeams?.(id, []);
  }

  async function loadOne(row: InstalledPluginRow, isActive: () => boolean = () => !stopped): Promise<void> {
    if (!isActive()) return;
    let declared: boolean | undefined;
    try {
      declared = loadManifestFromDir(row.rootDir).toolPolicy;
    } catch {
      declared = undefined;
    }
    row = withToolPolicy(row, declared);
    if (row.enabled && (row.toolPolicy === 'true' || row.toolPolicy === 'unknown')) {
      pendingToolPolicy.set(row.id, row.toolPolicy);
      refreshToolPolicyInventory();
    }
    if (!live.get(row.id) && row.enabled && (row.toolPolicy === 'true' || row.toolPolicy === 'unknown')) {
      await store.upsert(row);
      refreshToolPolicyInventory();
    }
    const previous = live.get(row.id);
    const safeModeBlocked = opts.getAppConfig?.().pluginSafeMode === true && row.sourceKind !== 'builtin';
    if (!row.enabled || safeModeBlocked) {
      await disposeOne(row.id);
      const disabled = { ...row, status: 'disabled' as const, statusDetail: safeModeBlocked ? 'Suspended by plugin safe mode' : null };
      live.set(row.id, { row: disabled, handle: null, rpc: new Map() });
      await store.upsert(withToolPolicy(disabled, declared));
      refreshToolPolicyInventory();
      await applyMissingRequiredPluginStatus();
      return;
    }
    if (!existsSync(row.rootDir)) {
      if (previous?.handle && previous.row.status === 'running') {
        throw new Error('plugin directory missing');
      }
      await disposeOne(row.id);
      const degraded = { ...row, status: 'degraded' as const, statusDetail: 'plugin directory missing' };
      live.set(row.id, { row: withToolPolicy(degraded, declared), handle: null, rpc: new Map() });
      await store.upsert(withToolPolicy(degraded, declared));
      refreshToolPolicyInventory();
      return;
    }
    try {
      if (row.sourceKind === 'path') {
        const manifest = loadManifestFromDir(row.rootDir);
        if (manifest.id !== row.id) throw new Error('plugin identity changed; reinstall with the new identity');
        assertEngines(manifest, hostVersion, sdkVersion);
        row = { ...row, version: manifest.version, appEntry: manifest.appEntry, serverEntry: manifest.serverEntry };
      }
      await ensureCompiledApp(row);
      if (!isActive()) return;
    } catch (error) {
      if (!isActive()) return;
      const detail = error instanceof Error ? error.message : String(error);
      if (previous?.handle && previous.row.status === 'running') throw error;
      await disposeOne(row.id);
      const degraded = { ...row, status: 'degraded' as const, statusDetail: detail };
      live.set(row.id, { row: withToolPolicy(degraded, declared), handle: null, rpc: new Map() });
      await store.upsert(withToolPolicy(degraded, declared));
      refreshToolPolicyInventory();
      return;
    }
    let files: string[];
    try { files = await scanPluginFiles(row.rootDir); if (!isActive()) return; }
    catch (error) {
      if (!isActive()) return;
      if (previous?.handle && previous.row.status === 'running') throw error;
      await disposeOne(row.id);
      const degraded = { ...row, status: 'degraded' as const, statusDetail: error instanceof Error ? error.message : String(error) };
      live.set(row.id, { row: withToolPolicy(degraded, declared), handle: null, rpc: new Map() });
      await store.upsert(withToolPolicy(degraded, declared));
      refreshToolPolicyInventory();
      return;
    }
    if (containsNativeAddon(row.rootDir, files)) {
      if (previous?.handle && previous.row.status === 'running') {
        throw new Error('native addons are not allowed');
      }
      await disposeOne(row.id);
      const degraded = { ...row, status: 'degraded' as const, statusDetail: 'native addons are not allowed' };
      live.set(row.id, { row: withToolPolicy(degraded, declared), handle: null, rpc: new Map() });
      await store.upsert(withToolPolicy(degraded, declared));
      refreshToolPolicyInventory();
      return;
    }
    let hostEntry: string | null = null;
    let serverEntry = row.serverEntry;
    let remoteEnvironmentNames: string[] = [];
    try {
      const manifest = loadManifestFromDir(row.rootDir);
      hostEntry = manifest.hostEntry;
      if (manifest.serverEntry) serverEntry = manifest.serverEntry;
      remoteEnvironmentNames = parseRemoteEnvironmentNames(manifest.extra);
    } catch {
      hostEntry = null;
    }
    let hostArtifact: Awaited<ReturnType<typeof loadPluginHostArtifactSnapshot>> = null;
    let hostArtifactProblem: string | undefined;
    try {
      hostArtifact = await loadPluginHostArtifactSnapshot({
        pluginId: row.id,
        rootDir: row.rootDir,
        hostEntry,
        sourceKind: row.sourceKind,
        rebuildBuiltin: developmentEnabled() && !row.bundledRecoveryVersion,
        zccVersion: hostVersion,
        dataDir: opts.dataDir
      });
      if (!isActive()) return;
    } catch (error) {
      if (!isActive()) return;
      const detail = error instanceof Error ? error.message : String(error);
      if (previous?.handle && previous.row.status === 'running') throw error;
      // Read provider declarations even when the bridge cannot run. Existing
      // threads keep their provider identity and receive an actionable error.
      hostArtifactProblem = detail;
    }
    let configurationMessage: string | null = null;
    let activationFailure: Error | null = null;
    let runtime: ReturnType<typeof createIsolatedPluginRuntime> | undefined;
    const handle = createPluginApi(row.id, join(kvRoot, row.id), {
      toolPolicyRegistrationAllowed: () => {
        const active = live.get(row.id)?.handle;
        return !toolPolicySealed.has(row.id) || !active || active !== handle;
      },
      onToolPolicyRegister: () => {
        persistLearnedTrueDuringActivation(row.id);
      },
      providerUnavailableReason: hostArtifactProblem,
      requestPluginInteraction: opts.requestPluginInteraction,
      interruptPluginInteractions: opts.interruptPluginInteractions,
      consumePluginApproval: opts.consumePluginApproval,
      getInteraction: opts.getInteraction,
      upsertInteraction: opts.upsertInteraction,
      acknowledgeInteraction: opts.acknowledgeInteraction,
      cancelInteraction: opts.cancelInteraction,
      spawnThread: opts.spawnThread,
      getThread: opts.getThread,
      listThreadEvents: opts.listThreadEvents,
      sendThread: opts.sendThread,
      stopThread: opts.stopThread,
      threadOutput: opts.threadOutput,
      defaultExecutionOptions: opts.defaultExecutionOptions,
      getEnvironment: opts.getEnvironment,
      readWorkspaceFile: opts.readWorkspaceFile,
      listProviders: opts.listProviders,
      loadProviderModels: opts.loadProviderModels,
      archiveThread: opts.archiveThread,
      forkThread: opts.forkThread,
      listThreads: opts.listThreads,
      listQueuedMessages: opts.listQueuedMessages,
      createQueuedMessage: opts.createQueuedMessage,
      unarchiveThread: opts.unarchiveThread,
      getPluginMetadata: opts.getPluginMetadata,
      updatePluginMetadata: opts.updatePluginMetadata,
      pushInbox: opts.pushInbox,
      listProjects: opts.listProjects,
      registerPersonas: opts.registerPersonas,
      registerTeams: opts.registerTeams,
      productContext: opts.productContext,
      remoteEnvironmentNames,
       hostCall: opts.productContext ? async (method, input, hostId, signal, timeoutMs, projectId) => {
        // Resolve only this plugin's active generation; renderer input cannot
        // choose an artifact or invoke another plugin's host entry.
        const artifact = hostArtifacts.get(row.id);
        if (!artifact || artifact.generation !== hostArtifact?.generation) throw new Error('Plugin host generation is unavailable');
         let projectRoot: string | undefined;
         if (projectId) {
           const project = opts.productContext!.projects.list().find((candidate) => candidate.id === projectId);
           if (!project) throw new Error('unrecognized projectId');
           try {
             projectRoot = realpathSync(project.path);
           } catch {
             throw new Error('project root is unavailable');
           }
         }
         return callPluginHostRpc(opts.productContext!, { pluginId: row.id, artifact, method, input, hostId, signal, timeoutMs, projectRoot });
      } : undefined,
      dataDir: opts.dataDir,
      onNeedsConfiguration: (message) => {
        configurationMessage = message;
      },
      services: servicesRegistry,
      isAgentToolNameTaken: (name) => {
        for (const [id, current] of live) {
          if (current.handle?.agentTools.some((tool) => tool.name === name)) return id;
        }
        return undefined;
      },
      hostEntryPath: (() => {
        try {
          const manifest = loadManifestFromDir(row.rootDir);
          return manifest.hostEntry
            ? resolveContainedEntry(row.rootDir, manifest.hostEntry)
            : null;
        } catch {
          return null;
        }
      })()
    });
    const rpc = new Map<string, (args: unknown) => unknown | Promise<unknown>>();
    const originalMethod = handle.api.rpc.method.bind(handle.api.rpc);
    handle.api.rpc.method = (name, handler) => {
      rpc.set(name, handler);
      originalMethod(name, handler);
    };
    const originalRegister = handle.api.rpc.register.bind(handle.api.rpc);
    handle.api.rpc.register = (contract, handlers) => {
      originalRegister(contract, handlers);
      for (const [name, handler] of Object.entries(handlers)) {
        if (typeof handler === 'function') {
          rpc.set(name, handler as (args: unknown) => unknown);
        }
      }
    };
    try {
      if (serverEntry) {
        const entry = resolveContainedEntry(row.rootDir, serverEntry);
        runtime = createIsolatedPluginRuntime({
          api: handle.api, entry, generation: row.updatedAt,
          admitCall: () => {
            if (updatingPlugins.has(row.id)) throw new Error('Plugin update in progress; retry when it completes');
          },
          databasePath: join(kvRoot, row.id, 'data.db'),
          onFailure: error => {
            const transaction = activating.get(row.id);
            if (transaction) { transaction.failure = error; return; }
            if (live.get(row.id)?.handle !== handle) {
              activationFailure = error;
              return;
            }
            const epoch = lifecycleEpoch(row.id);
            void withLifecycle(row.id, async () => {
              if (!isCurrent(row.id, epoch, handle)) return;
              await disposeOne(row.id);
              if (!isCurrent(row.id, epoch) || store.get(row.id)?.enabled === false) return;
              const degraded = withToolPolicy({ ...row, status: 'degraded' as const, statusDetail: error.message }, declared);
              live.set(row.id, { row: degraded, handle: null, rpc: new Map() });
              await store.upsert(degraded);
              refreshToolPolicyInventory();
              if (!isCurrent(row.id, epoch)) return;
              if (error.message === WATCHDOG_FAILURE_MESSAGE) scheduleWatchdogRecovery(row.id);
              await emitCapabilities();
              if (!isCurrent(row.id, epoch)) return;
              await emitAppsChanged();
            }).catch(error => console.error('Plugin failure cleanup failed', error));
          }
        });
        serverRuntimes.add(runtime);
        const activeRuntime = runtime;
        handle.onQuiesce(async () => { await activeRuntime.dispose(); serverRuntimes.delete(activeRuntime); });
        await runtime.started;
      if (activationFailure) throw activationFailure;
      if (!isActive()) {
        await handle.dispose();
        return;
      }
      }
      if (hostArtifactProblem) throw new Error(hostArtifactProblem);
      await toolPolicyPendingTrue.get(row.id);
      if (declared === true && handle.toolPolicyHandlers.length !== 1) {
        throw new Error('declared tool policy is missing a handler');
      }
      if (declared === false && handle.toolPolicyHandlers.length > 0) {
        await persistLearnedTrue(row.id);
        throw new Error('plugin declared no tool policy but registered a handler');
      }
      const classified = {
        ...row,
        serverEntry,
        toolPolicy: classifyActivatedToolPolicy({
          enabled: row.enabled,
          serverEntry,
          toolPolicy: row.toolPolicy,
          declared,
          registeredHandler: handle.toolPolicyHandlers.length === 1
        })
      };
      const running = {
        ...classified,
        status: (configurationMessage ? 'needs-configuration' : 'running') as InstalledPluginRow['status'],
        statusDetail: configurationMessage ?? bundledPluginSourceNotice(row, developmentEnabled())
          ?? (row.lastActivationFailure ? `Update to ${row.lastActivationFailure.version} failed: ${row.lastActivationFailure.detail}` : null)
      };
      if (!isActive()) {
        await handle.dispose();
        return;
      }
      await store.upsert(running);
      if (!isActive()) {
        await handle.dispose();
        return;
      }
      const previousArtifact = hostArtifacts.peek(row.id);
      if (previousArtifact && opts.productContext) await disposePluginHostWorkers(opts.productContext, row.id, previousArtifact.generation);
      if (!isActive()) {
        await handle.dispose();
        return;
      }
      if (activationFailure) throw activationFailure;
      toolPolicySealed.add(row.id);
      pendingToolPolicy.delete(row.id);
      live.set(row.id, { row: running, handle, rpc, isBusy: runtime?.isBusy });
      refreshToolPolicyInventory();
      cancelRecovery(row.id);
      if (hostArtifact) hostArtifacts.set(row.id, hostArtifact);
      else hostArtifacts.delete(row.id);
      if (previous && previous.handle && previous.handle !== handle) {
        await previous.handle.dispose();
      }
      previous?.unavailableProviders?.forEach((provider) => provider.unregister());
      await applyMissingRequiredPluginStatus();
    } catch (error) {
      pendingToolPolicy.delete(row.id);
      try { await handle.dispose({ strict: activating.has(row.id) }); }
      catch (disposeError) {
        const transaction = activating.get(row.id);
        if (transaction) transaction.unsafeWriters = true;
        throw disposeError;
      }
      if (!isActive()) return;
      const detail = error instanceof Error ? error.message : String(error);
      if (previous?.handle && previous.row.status === 'running') throw error;
      await disposeOne(row.id);
      const unavailableProviders = handle.providerDeclarations.map((declaration) =>
        registerThreadProvider(row.id, declaration, hostEntry, detail));
      const degraded = withToolPolicy({ ...row, status: 'degraded' as const, statusDetail: detail }, declared);
      live.set(row.id, { row: degraded, handle: null, rpc: new Map(), unavailableProviders });
      await store.upsert(degraded);
      refreshToolPolicyInventory();
    }
  }

  const updateResolver: PluginUpdateResolver = {
    async npmVersions(intent) {
      const spec = intent.specKind === 'default' ? '*' : intent.spec;
      const result = await spawnNpm(['view', `${intent.name}@${spec}`, 'version', 'engines', 'dist.integrity', '--json',
        ...(intent.registry ? ['--registry', intent.registry] : [])], opts.dataDir);
      if (result.code !== 0) throw new Error('npm registry is unavailable or the recorded selector no longer exists');
      try { return JSON.parse(result.stdout); } catch { throw new Error('npm returned malformed package metadata'); }
    },
    async gitRefs(url) {
      const result = await runPluginSourceCommand('git', ['ls-remote', '--', url, 'HEAD', 'refs/heads/*', 'refs/tags/*'], opts.dataDir, { signal: sourceCommands.signal });
      if (result.code !== 0) throw new Error('Git source is unavailable');
      return result.stdout;
    },
    async gitManifest(intent, commit) {
      const cloned = await cloneGitTree(intent.url, `commit:${commit}`, intent.subdir);
      try {
        if (cloned.commit !== commit) throw new Error('Git candidate commit does not match its ref');
        try { return loadManifestFromDir(cloned.rootDir); } catch { throw new Error('Git candidate manifest is invalid'); }
      } finally { removeManagedGeneration(opts.dataDir, cloned.rootDir); }
    },
    ...opts.updateResolver
  };

  function currentCheck(row: InstalledPluginRow): PluginUpdateCheck | undefined {
    const check = updateChecks.get(row.id);
    return check?.fingerprint === pluginUpdateFingerprint(row, hostVersion, sdkVersion) ? check : undefined;
  }
  function updateSnapshot(row: InstalledPluginRow) {
    const updatePolicy: import('@zana-ai/zcc-domain/product').PluginUpdatePolicy = row.sourceKind === 'builtin' ? 'bundled'
      : row.sourceKind === 'path' ? 'local' : bundledPluginById(row.id) ? 'migration-required' : 'independent';
    if (updatePolicy !== 'independent') return { updatePolicy };
    const check = currentCheck(row);
    if (!check) return { updatePolicy };
    return {
      updatePolicy,
      updateCheck: { checkedAt: check.checkedAt, outcome: check.outcome, ...(check.detail ? { detail: check.detail } : {}),
        ...(check.blocked ? { blocked: check.blocked } : {}) },
      ...(check.outcome === 'available' && check.candidate ? { availableVersion: check.candidate.version } : {})
    };
  }
  async function checkOneUpdate(row: InstalledPluginRow): Promise<PluginUpdateCheck> {
    const generation = lifecycleGeneration;
    let check: PluginUpdateCheck;
    try {
      const intent = installedSourceIntent(row);
      if (!intent) throw new Error('Plugin has no recorded update source');
      check = await resolvePluginUpdate({ row, intent, resolver: updateResolver, hostVersion, sdkVersion, now: now() });
    } catch (error) {
      check = { fingerprint: pluginUpdateFingerprint(row, hostVersion, sdkVersion), checkedAt: now(), outcome: 'unavailable',
        detail: error instanceof Error ? error.message.slice(0, 1024) : 'Plugin source check failed' };
    }
    const installed = store.get(row.id);
    if (!stopped && generation === lifecycleGeneration && installed && pluginUpdateFingerprint(installed, hostVersion, sdkVersion) === check.fingerprint) {
      await updateChecks.set(row.id, check, store.list().map((item) => item.id));
    }
    return check;
  }
  function checkInstalledUpdates(overdueOnly: boolean): Promise<PluginUpdateRow[]> {
    if (pendingUpdateCheck) return !overdueOnly && pendingCheckOverdueOnly
      ? pendingUpdateCheck.then(() => checkInstalledUpdates(false)) : pendingUpdateCheck;
    const run = (async () => {
      const generation = lifecycleGeneration;
      const rows = store.list().slice(0, 256).filter((row) => !bundledPluginById(row.id) && (row.sourceKind === 'npm' || row.sourceKind === 'git'));
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
        while (index < rows.length && !stopped) {
          const row = rows[index++]!;
          const saved = currentCheck(row);
          if (!overdueOnly || !saved || now() - saved.checkedAt >= PLUGIN_UPDATE_CHECK_INTERVAL_MS) await checkOneUpdate(row);
        }
      }));
      if (!stopped && lifecycleGeneration === generation) await emitAppsChanged();
      return rows.flatMap((row) => {
        const installed = store.get(row.id);
        const check = installed && currentCheck(installed);
        return check?.outcome === 'available' && check.candidate
          ? [{ id: row.id, current: row.npmResolvedVersion ?? row.version, available: check.candidate.version, marketplace: row.catalogMarketplace ?? '' }] : [];
      });
    })();
    pendingCheckOverdueOnly = overdueOnly;
    pendingUpdateCheck = run;
    void run.finally(() => { if (pendingUpdateCheck === run) pendingUpdateCheck = undefined; }).catch(() => undefined);
    return run;
  }

  async function materialize(source: ParsedPluginSource, recordedIntent?: PluginSourceIntent, candidate?: PluginUpdateCandidate, fresh = false): Promise<{
    rootDir: string;
    provenance: InstalledPluginRow['provenance'];
    sourceKind: InstalledPluginRow['sourceKind'];
    display: string;
    sourceIntent?: PluginSourceIntent;
    npmResolvedVersion: string | null;
    npmIntegrity: string | null;
    gitResolvedCommit: string | null;
    catalogMarketplace: string | null;
    catalogEntryId: string | null;
  }> {
    if (source.kind === 'path') {
      const rootDir = resolve(source.path);
      if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
        throw new Error(`path is not a directory: ${source.path}`);
      }
      return {
        rootDir,
        provenance: 'direct',
        sourceKind: 'path',
        display: `path:${rootDir}`,
        npmResolvedVersion: null,
        npmIntegrity: null,
        gitResolvedCommit: null,
        catalogMarketplace: null,
        catalogEntryId: null
      };
    }
    if (source.kind === 'builtin') {
      const def = bundledPluginByName(source.name);
      if (!def) throw new Error(`unknown builtin/official plugin "${source.name}"`);
      const rootDir = resolveBundledDir(opts.bundledRoot, def.name);
      return {
        rootDir,
        provenance: def.autoInstall ? 'builtin' : 'direct',
        sourceKind: 'builtin',
        display: `builtin:${def.name}`,
        npmResolvedVersion: null,
        npmIntegrity: null,
        gitResolvedCommit: null,
        catalogMarketplace: null,
        catalogEntryId: null
      };
    }
    if (source.kind === 'npm') {
      const spawn = spawnNpm;
      let dest = join(opts.dataDir, 'plugins', 'generations', randomUUID(), 'npm');
      mkdirSync(dirname(dest), { recursive: true });
      mkdirSync(dest, { recursive: true });
      // npm derives lockfile keys from real cwd; keep --prefix on that same path.
      dest = realpathSync(dest);
      const spec = source.spec ? `${source.name}@${source.spec}` : source.name;
      const sourceIntent = recordedIntent?.kind === 'npm' ? { ...recordedIntent } : { kind: 'npm' as const, name: source.name, spec: source.spec,
        specKind: semver.valid(source.spec) ? 'exact' as const : source.spec && semver.validRange(source.spec) ? 'range' as const : source.spec ? 'tag' as const : 'default' as const };
      const freshCache = fresh ? join(dirname(dest), 'npm-recovery-cache') : undefined;
      try {
        if (!sourceIntent.registry && !opts.spawnNpm) {
          const scope = source.name.startsWith('@') ? source.name.split('/')[0] : undefined;
          let configured = scope ? await spawn(['config', 'get', `${scope}:registry`], dest) : undefined;
          if (!configured || configured.code !== 0 || !configured.stdout.trim() || configured.stdout.trim() === 'undefined') configured = await spawn(['config', 'get', 'registry'], dest);
          if (configured.code !== 0 || !/^https?:\/\//.test(configured.stdout.trim())) throw new Error('Cannot determine npm registry');
          sourceIntent.registry = configured.stdout.trim();
        }
        const result = await spawn(['install', spec, '--ignore-scripts', '--package-lock=true', '--no-audit', '--no-fund', '--prefix', dest,
          ...(freshCache ? ['--cache', freshCache, '--prefer-online'] : []), ...(sourceIntent.registry ? ['--registry', sourceIntent.registry] : [])], dest);
        if (result.code !== 0) throw new Error(result.stderr || `npm install failed for ${spec}`);
        const pkgRoot = join(dest, 'node_modules', ...source.name.split('/'));
        if (!existsSync(pkgRoot)) throw new Error(`npm install did not produce ${source.name}`);
        const pkg = readJson(join(pkgRoot, 'package.json')) as { version?: string };
        const lockPath = join(dest, 'package-lock.json');
        const lock = existsSync(lockPath) ? readJson(lockPath) as { packages?: Record<string, { integrity?: string }> } : undefined;
        const integrity = lock?.packages?.[`node_modules/${source.name}`]?.integrity ?? null;
        if (candidate && (candidate.version !== pkg.version || candidate.integrity !== integrity)) throw new Error('npm candidate version or integrity changed since the check');
        return {
          rootDir: pkgRoot,
          provenance: 'direct',
          sourceKind: 'npm',
          display: `npm:${sourceIntent.name}@${sourceIntent.spec}`,
          sourceIntent,
          npmResolvedVersion: pkg.version ?? source.spec ?? null,
          npmIntegrity: integrity,
          gitResolvedCommit: null,
          catalogMarketplace: null,
          catalogEntryId: null
        };
      } catch (error) {
        removeManagedGeneration(opts.dataDir, dest);
        throw error;
      } finally {
        if (freshCache) await rm(freshCache, { recursive: true, force: true });
      }
    }
    if (source.kind === 'git') {
      const sourceIntent: Extract<PluginSourceIntent, { kind: 'git' }> = recordedIntent?.kind === 'git'
        ? { ...recordedIntent } : { kind: 'git', url: source.url, selector: source.selector, subdir: source.subdir };
      let selected = candidate;
      if (!selected && sourceIntent.selector.kind === 'range') {
        const initial = await resolvePluginUpdate({ row: { id: '', version: '', sourceKind: 'git', source: '', gitResolvedCommit: null } as InstalledPluginRow,
          intent: sourceIntent, resolver: updateResolver, hostVersion, sdkVersion, now: now() });
        if (initial.outcome !== 'available' || !initial.candidate) throw new Error(initial.detail ?? 'No compatible Git release is available');
        selected = initial.candidate;
      }
      const cloned = await cloneGitTree(source.url, selected?.commit ? `commit:${selected.commit}` : source.spec, sourceIntent.subdir);
      if (selected?.commit && cloned.commit !== selected.commit) {
        removeManagedGeneration(opts.dataDir, cloned.rootDir);
        throw new Error('Git candidate commit changed since the check');
      }
      if (selected?.tag) sourceIntent.resolvedTag = selected.tag;
      if (!candidate) sourceIntent.refKind = cloned.refKind;
      return {
        rootDir: cloned.rootDir, provenance: 'direct', sourceKind: 'git',
        display: `git:${sourceIntent.url}@${sourceIntent.selector.kind === 'range' ? `semver:${sourceIntent.selector.range}` : sourceIntent.selector.ref}`,
        sourceIntent, npmResolvedVersion: null, npmIntegrity: null, gitResolvedCommit: cloned.commit,
        catalogMarketplace: null, catalogEntryId: null
      };
    }
    throw new Error(`unsupported source ${source.kind}`);
  }

  async function cloneGitTree(
    url: string,
    spec: string,
    subdir?: string
  ): Promise<{ rootDir: string; commit: string; refKind?: 'branch' | 'tag' | 'commit' }> {
    const dest = join(opts.dataDir, 'plugins', 'generations', randomUUID(), 'git');
    mkdirSync(dirname(dest), { recursive: true });
    try {
      const cloned = await cloneGit(url, dest, spec);
      if (!subdir) return { rootDir: dest, ...cloned };
      const contained = await resolveContainedReal(dest, subdir);
      if (!contained) throw new Error(`marketplace git subdir is not contained: ${subdir}`);
      return { rootDir: contained, ...cloned };
    } catch (error) {
      removeManagedGeneration(opts.dataDir, dest);
      throw error;
    }
  }

  async function materializeMarketplaceEntry(entry: MarketplaceEntry): Promise<Awaited<ReturnType<typeof materialize>>> {
    if (entry.source.npm) return materialize(parsePluginSource(`npm:${entry.source.npm.package}@${entry.source.npm.range}`));
    const git = entry.source.git;
    if (!git) throw new Error(`marketplace entry ${entry.id} has no installable source`);
    const spec = git.range ? `semver:${git.range}` : git.ref ?? 'HEAD';
    const selector = git.range ? { kind: 'range' as const, range: git.range, tagPrefix: git.tagPrefix ?? '' }
      : { kind: 'ref' as const, ref: git.ref ?? 'HEAD' };
    return materialize({ kind: 'git', url: git.url, spec, selector }, { kind: 'git', url: git.url, selector, subdir: git.subdir });
  }

  async function installParsed(
    source: ParsedPluginSource,
    enable: boolean,
    overrides: Partial<Pick<InstalledPluginRow, 'provenance' | 'catalogMarketplace' | 'catalogEntryId'>> = {}
  ): Promise<InstalledPluginRow> {
    return installFromMaterialized(await materialize(source), enable, overrides);
  }

  async function installFromMaterialized(
    materialized: Awaited<ReturnType<typeof materialize>>,
    enable: boolean,
    overrides: Partial<Pick<InstalledPluginRow, 'provenance' | 'catalogMarketplace' | 'catalogEntryId' | 'bundledRecoveryVersion'>> = {},
    expectedId?: string,
    expectedEpoch?: number,
    expectedFingerprint?: string
  ): Promise<InstalledPluginRow> {
    let id: string;
    try {
      await ensureActivationRecovery();
      id = loadManifestFromDir(materialized.rootDir).id;
    } catch (error) {
      if (materialized.sourceKind === 'git' || materialized.sourceKind === 'npm') removeUnreferencedGeneration(materialized.rootDir);
      throw error;
    }
    let entered = false;
    try {
      return await promotionQueue.run(() => withLifecycle(id, () => {
        entered = true;
        return promoteMaterialized(materialized, enable, overrides, expectedId, expectedEpoch, expectedFingerprint);
      }));
    } catch (error) {
      if (!entered && (materialized.sourceKind === 'git' || materialized.sourceKind === 'npm')) removeUnreferencedGeneration(materialized.rootDir);
      throw error;
    }
  }

  async function promoteMaterialized(
    materialized: Awaited<ReturnType<typeof materialize>>,
    enable: boolean,
    overrides: Partial<Pick<InstalledPluginRow, 'provenance' | 'catalogMarketplace' | 'catalogEntryId' | 'bundledRecoveryVersion'>>,
    expectedId?: string,
    expectedEpoch?: number,
    expectedFingerprint?: string
  ): Promise<InstalledPluginRow> {
    let manifest: PluginManifest;
    try {
      if (stopped) throw new Error('plugin service is stopped');
      manifest = loadManifestFromDir(materialized.rootDir);
      assertEngines(manifest, hostVersion, sdkVersion);
      assertBundledPluginInstall({
        id: manifest.id,
        sourceKind: materialized.sourceKind,
        source: materialized.display,
        development: developmentEnabled()
      });
      if (expectedId && manifest.id !== expectedId) {
        throw new Error(`plugin identity changed during update: expected ${expectedId}, received ${manifest.id}`);
      }
      if (expectedId && expectedEpoch !== undefined && lifecycleEpoch(expectedId) !== expectedEpoch) {
        throw new Error(`plugin lifecycle changed during update: ${expectedId}`);
      }
      if (expectedFingerprint && (!store.get(manifest.id) || pluginUpdateFingerprint(store.get(manifest.id)!, hostVersion, sdkVersion) !== expectedFingerprint)) {
        throw new Error('Plugin registration changed while waiting to activate; check again');
      }
      if (!expectedId && store.get(manifest.id) && (materialized.sourceKind === 'git' || materialized.sourceKind === 'npm')) {
        throw new Error(`Plugin already installed; use zcc plugin update ${manifest.id} to update it, or remove it before changing its source`);
      }
    } catch (error) {
      // Only remote materialization creates a disposable candidate. A path
      // may point at an existing installation, including a managed generation.
      if ((materialized.sourceKind === 'git' || materialized.sourceKind === 'npm') &&
          !store.list().some((row) => resolve(row.rootDir) === resolve(materialized.rootDir))) {
        removeManagedGeneration(opts.dataDir, materialized.rootDir);
      }
      throw error;
    }
    const ts = now();
    const epoch = expectedEpoch ?? lifecycleEpoch(manifest.id);
    const existing = store.get(manifest.id);
    if (materialized.sourceKind === 'builtin' && existing && existing.sourceKind !== 'builtin' &&
        !(overrides.bundledRecoveryVersion === hostVersion && isManagedGeneration(opts.dataDir, materialized.rootDir)) &&
        (!existsSync(existing.rootDir) || realpathSync(existing.rootDir) !== realpathSync(materialized.rootDir)) &&
        !isLegacyExtensionJsonPluginRoot(existing.rootDir) &&
        !(existing.sourceKind === 'path' && developmentEnabled())) {
      throw new Error(`Migration required. ${bundledPluginSourceNotice(existing, false)}`);
    }
    const row: InstalledPluginRow = withToolPolicy({
      id: manifest.id,
      version: manifest.version,
      name: manifest.name,
      description: manifest.description,
      icon: manifest.branding.icon ?? 'Puzzle',
      enabled: enable,
      status: 'disabled',
      statusDetail: null,
      provenance: materialized.provenance,
      sourceKind: materialized.sourceKind,
      source: materialized.display,
      sourceIntent: materialized.sourceIntent,
      rootDir: materialized.rootDir,
      serverEntry: manifest.serverEntry,
      appEntry: manifest.appEntry,
      npmResolvedVersion: materialized.npmResolvedVersion,
      npmIntegrity: materialized.npmIntegrity,
      gitResolvedCommit: materialized.gitResolvedCommit,
      catalogMarketplace: materialized.catalogMarketplace,
      catalogEntryId: materialized.catalogEntryId,
      installedAt: existing?.installedAt ?? ts,
      updatedAt: ts,
      toolPolicy: existing?.toolPolicy,
      ...overrides
    }, manifest.toolPolicy);
    await uninstalled.forget(manifest.id);
    if (existing && row.bundledRecoveryVersion) {
      const backupRoot = await copyRecoveryRollbackRuntime(opts.dataDir, existing.rootDir);
      const previous: InstalledPluginRow = { ...existing, rootDir: backupRoot, sourceKind: 'builtin',
        source: row.source, bundledRecoveryVersion: hostVersion };
      try {
        // A crash before candidate activation must still name the managed
        // previous generation recorded by the durable rollback journal.
        await store.upsert(previous);
        await activateManaged(previous, row, expectedEpoch);
        removeUnreferencedGeneration(existing.rootDir);
      } finally { if (!recoveryBlocked.has(row.id)) removeUnreferencedGeneration(backupRoot); }
      await emitCapabilities();
      await syncCliSkill();
      return store.get(row.id)!;
    }
    if (existing && (existing.sourceKind === 'git' || existing.sourceKind === 'npm') &&
        (row.sourceKind === 'git' || row.sourceKind === 'npm')) {
      await activateManaged(existing, row, expectedEpoch);
      await emitCapabilities();
      await syncCliSkill();
      return store.get(row.id)!;
    }
    // A candidate reload must not overwrite a last-good row before it seals.
    // The live generation remains authoritative until candidate promotion.
    if (!existing) {
      await store.upsert(row);
      refreshToolPolicyInventory();
    }
    try {
      await loadOne(row, () => isCurrent(row.id, epoch));
    } catch (error) {
      if (existing && resolve(existing.rootDir) !== resolve(row.rootDir)) {
        removeUnreferencedGeneration(row.rootDir);
      }
      throw error;
    }
    if (existing && resolve(existing.rootDir) !== resolve(row.rootDir)) {
      removeUnreferencedGeneration(existing.rootDir);
    }
    await emitCapabilities();
    await syncCliSkill();
    return store.get(manifest.id) ?? row;
  }

  async function activateManaged(previous: InstalledPluginRow, row: InstalledPluginRow, expectedEpoch?: number) {
    let resume: (() => void) | undefined;
    let journal: PluginActivationJournal | undefined;
    let finished = false;
    const transaction: { failure?: Error; unsafeWriters?: boolean } = {};
    const isActive = () => !stopped && (expectedEpoch === undefined || lifecycleEpoch(row.id) === expectedEpoch);
    try {
      resume = closeUpdateAdmission(previous);
      try { await disposeOne(row.id, true); }
      catch (error) {
        recoveryBlocked.add(row.id);
        await store.upsert({ ...previous, status: 'degraded', statusDetail: 'Plugin writers could not be stopped; restart before updating.' });
        throw error;
      }
      try {
        journal = await activations.prepare(previous, row, now());
      }
      catch (error) {
        if (!stopped) await loadOne(previous);
        throw error;
      }
      activating.set(row.id, transaction);
      try {
        if (!isActive()) throw new Error('Plugin lifecycle changed before activation');
        await loadOne(row, isActive);
        if (!isActive()) throw new Error('Plugin lifecycle changed during activation');
        const activated = store.get(row.id);
        if (transaction.failure || activated?.status === 'degraded') throw transaction.failure ?? new Error(activated?.statusDetail ?? 'Plugin activation failed');
        if (row.enabled) {
          await new Promise<void>(resolve => {
            const finish = () => { clearTimeout(timer); activationInterrupts.delete(row.id); sourceCommands.signal.removeEventListener('abort', finish); resolve(); };
            const timer = setTimeout(finish, opts.activationStabilizationMs ?? 1000);
            activationInterrupts.set(row.id, finish);
            sourceCommands.signal.addEventListener('abort', finish, { once: true });
            if (sourceCommands.signal.aborted) finish();
          });
        }
        if (transaction.failure || !isActive()) throw transaction.failure ?? new Error('Plugin lifecycle changed during activation');
        journal = await activations.phase(journal, 'committed');
      } catch (error) {
        if (transaction.unsafeWriters) throw new Error('Plugin writers could not be stopped; restart to recover the pending update');
        await disposeOne(row.id, true); // Worker termination and KV teardown finish before restoration.
        journal = await activations.phase(journal, 'restoring');
        await activations.restore(journal);
        const detail = (error instanceof Error ? error.message : String(error)).replaceAll(row.rootDir, '<plugin>').slice(0, 500);
        const restored = { ...previous, toolPolicy: store.get(row.id)?.toolPolicy === 'true' ? 'true' as const : previous.toolPolicy,
          lastActivationFailure: { version: row.version, at: now(), detail } };
        await store.upsert(restored);
        if (!stopped) {
          await loadOne(restored);
          if (store.get(row.id)?.status === 'degraded') throw new Error('Previous plugin failed to reload; activation recovery remains pending');
        }
        journal = await activations.phase(journal, 'restored');
        removeUnreferencedGeneration(row.rootDir);
        await activations.finish(journal);
        finished = true;
        await emitCapabilities(); await emitAppsChanged();
        throw new Error(`Update to ${row.version} failed and was rolled back: ${detail}`);
      } finally { activating.delete(row.id); }
      removeUnreferencedGeneration(previous.rootDir);
      await activations.finish(journal);
      finished = true;
    } finally {
      if (journal && !finished) recoveryBlocked.add(row.id);
      if (!recoveryBlocked.has(row.id)) resume?.();
      // Never delete a generation required by a pending recovery journal.
      if (!journal) removeUnreferencedGeneration(row.rootDir);
    }
  }

  function snapshot(): PluginUiSnapshot[] {
    return store.list().map((row) => {
      const sourceNotice = bundledPluginSourceNotice(row, developmentEnabled());
      const storedDetail = row.statusDetail === bundledPluginSourceNotice(row, false) ? null : row.statusDetail;
      const statusDetail = sourceNotice && storedDetail && !storedDetail.includes(sourceNotice)
        ? `${storedDetail}\n${sourceNotice}`
        : storedDetail ?? sourceNotice;
      let skillNames: string[] = [];
      let mcpServers: PluginUiMcpServer[] = [];
      let extra: Record<string, unknown> = {};
      let projectTab: PluginManifest['projectTab'];
      let peers = false;
      let themes: PluginThemeSnapshot[] = [];
      let name = row.name;
      let description = row.description;
      let icon = row.icon;
      try {
        const manifest = loadManifestFromDir(row.rootDir);
        name = manifest.name;
        description = manifest.description;
        icon = manifest.branding.icon ?? row.icon;
        skillNames = manifest.skillNames;
        extra = manifest.extra;
        projectTab = manifest.projectTab;
        peers = manifest.peers;
        mcpServers = manifest.mcpServers.map((server) => ({
          name: server.name,
          type: server.type,
          command: server.command,
          args: server.args,
          url: server.url,
          envKeys: server.env ? Object.keys(server.env) : undefined,
          alwaysOn: server.alwaysOn
        }));
        themes = (manifest.themes ?? []).flatMap((theme) => {
          try {
            const root = resolveContainedEntry(row.rootDir, '.');
            const css = resolveContainedEntry(row.rootDir, theme.css);
            const cssPath = relative(root, css).split(sep).map(encodeURIComponent).join('/');
            return [{
              pluginId: row.id,
              id: theme.id,
              name: theme.name,
              ...(theme.description ? { description: theme.description } : {}),
              cssUrl: `/plugins/${encodeURIComponent(row.id)}/assets/${cssPath}?v=${row.updatedAt}`
            }];
          } catch {
            return [];
          }
        });
      } catch {
        projectTab = undefined;
        peers = false;
      }
      return {
        id: row.id,
        name,
        description,
        icon,
        enabled: row.enabled,
        provenance: row.provenance,
        sourceKind: row.sourceKind,
        status: row.status === 'running' && !live.get(row.id)?.handle ? 'degraded' : row.status,
        appEntry: row.appEntry,
        appUrl: live.get(row.id)?.handle ? appUrlFor(row) : null,
        npmResolvedVersion: row.npmResolvedVersion,
        gitResolvedCommit: row.gitResolvedCommit,
        source: row.source,
        projectTab,
        peers,
        skillNames,
        mcpServers,
        extra,
        themes,
        statusDetail,
        cliNames: live.get(row.id)?.handle?.cli.registration
          ? [live.get(row.id)!.handle!.cli.registration!.name]
          : [],
        ...updateSnapshot(row)
      };
    });
  }

  function matchingMarketplace(source: string) {
    return marketplaces.list().find(
      (row) => marketplaceSourcesEqual(row.source, source) || (row.url != null && marketplaceSourcesEqual(row.url, source))
    );
  }

  async function seedOfficialMarketplace(): Promise<void> {
    const url = resolveOfficialMarketplaceUrl();
    if (!url) return;
    if (matchingMarketplace(url)) return;
    try {
      const parsed = parseMarketplaceSource(url);
      const index = await materializeMarketplaceIndex(parsed, fetchJson);
      await marketplaces.add(marketplaceSourceDisplay(parsed), index, { official: true });
      await emitAppsChanged();
    } catch {
      /* fail-soft: bundled Browse still works offline */
    }
  }

  async function seedMarketplaceSource(raw: string | null): Promise<void> {
    if (!raw) return;
    let parsed;
    try {
      parsed = parseMarketplaceSource(raw);
    } catch {
      return;
    }
    const display = marketplaceSourceDisplay(parsed);
    const existing = matchingMarketplace(display);
    if (existing?.cachedIndex) {
      if (!existing.official) {
        try {
          await marketplaces.add(existing.source, existing.cachedIndex, { official: true });
          await emitAppsChanged();
        } catch {
          /* fail-soft */
        }
      }
      return;
    }
    try {
      const index = await materializeMarketplaceIndex(parsed, fetchJson, {
        timeoutMs: DEFAULT_MARKETPLACE_SEED_TIMEOUT_MS,
        nonInteractive: true
      });
      await marketplaces.add(display, index, { official: true });
      await emitAppsChanged();
    } catch {
      /* Unreachable catalogs must not prevent startup or affect other catalogs. */
    }
  }

  async function seedDefaultMarketplaces(): Promise<void> {
    await seedOfficialMarketplace();
    for (const raw of [resolveCommunityMarketplaceSource(), resolveInternalMarketplaceSource()]) {
      if (!raw) continue;
      let kind: ReturnType<typeof parseMarketplaceSource>['kind'];
      try {
        kind = parseMarketplaceSource(raw).kind;
      } catch {
        continue;
      }
      const pending = seedMarketplaceSource(raw);
      if (kind === 'git') void pending;
      else await pending;
    }
  }

  async function retireRetiredFirstPartyPlugins(): Promise<void> {
    const ids = new Set<string>();
    for (const row of store.list()) {
      if (isRetiredFirstPartyPluginId(row.id)) ids.add(row.id);
    }
    const legacyRoot = join(opts.dataDir, 'extensions');
    if (existsSync(legacyRoot) && statSync(legacyRoot).isDirectory()) {
      for (const name of readdirSync(legacyRoot)) {
        if (name.endsWith('.json') || !isRetiredFirstPartyPluginId(name)) continue;
        ids.add(name);
      }
    }
    for (const id of ids) {
      if (isLocalSidecar(opts.dataDir, id)) continue;
      await disposeOne(id);
      const row = await store.remove(id);
      live.delete(id);
      refreshToolPolicyInventory();
      await uninstalled.add(id);
      if (row && row.rootDir.startsWith(join(opts.dataDir, 'plugins') + sep)) {
        rmSync(row.rootDir, { recursive: true, force: true });
      }
      removeInstalledPluginCopy(opts.dataDir, id);
      removeLeftoverSidecar(opts.dataDir, id);
    }
  }

  /**
   * Official (and builtin) catalog ids used to be leftover `extension.json`
   * MainModules. Those rows occupy the id, so Browse thinks the plugin is
   * already installed and the UI calls RPCs the MainModule never registered.
   * Replace that occupier with the bundled plugin on reconcile. Do not touch
   * a real `package.json` `zcc` path install (`zcc plugin dev`) and do not
   * auto-install an official plugin the user never had.
   */
  async function reclaimBundledIdsFromLegacyOccupiers(): Promise<void> {
    for (const def of [...BUILTIN_PLUGINS, ...OFFICIAL_PLUGINS]) {
      const row = store.get(def.pluginId);
      if (!row) continue;
      if (uninstalled.has(def.pluginId)) continue;
      if (isLocalSidecar(opts.dataDir, def.pluginId)) continue;
      let bundledDir: string | null = null;
      try {
        bundledDir = resolveBundledDir(opts.bundledRoot, def.name);
      } catch {
        continue;
      }
      if (resolve(row.rootDir) === resolve(bundledDir)) continue;
      if (!isLegacyExtensionJsonPluginRoot(row.rootDir)) continue;
      try {
        await installParsed({ kind: 'builtin', name: def.name }, row.enabled);
        console.info(
          `[plugins] replaced leftover extension.json occupier ${def.pluginId} with builtin:${def.name}`
        );
      } catch (error) {
        console.error(
          `[plugins] failed to replace leftover ${def.pluginId} with builtin:${def.name}:`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  function startBuiltinSourceWatchers(): void {
    const rows = stopped || hardReloadRunning || !developmentEnabled() ? []
      : store.list().filter(row => row.sourceKind === 'builtin' && !row.bundledRecoveryVersion && existsSync(row.rootDir));
    const roots = new Map(rows.map(row => [row.id, row.rootDir]));
    for (const [id, watcher] of builtinWatchers) {
      if (roots.get(id) === watcher.rootDir) continue;
      watcher.close();
      builtinWatchers.delete(id);
    }
    for (const row of rows) {
      if (builtinWatchers.has(row.id)) continue;
      const rootDir = row.rootDir;
      const pluginId = row.id;
      const hasApp = Boolean(row.appEntry);
      const hasServer = Boolean(row.serverEntry) && !/\.tsx?$/.test(row.serverEntry ?? '');
      const loop = createPluginDevLoop({
        pluginId,
        hasApp,
        hasServer,
        targets: async () => {
          const manifest = loadManifestFromDir(rootDir);
          return {
            hasApp: Boolean(manifest.appEntry),
            hasServer: Boolean(manifest.serverEntry) && !/\.tsx?$/.test(manifest.serverEntry ?? ''),
            hasHost: Boolean(manifest.hostEntry)
          };
        },
        buildApp: async () => {
          await buildPluginApp(rootDir, hostVersion, { minify: false, sourcemap: true, toolchain: await getPluginBuildToolchain(opts.dataDir) });
        },
        buildServer: async () => {
          await buildPluginServer(rootDir, hostVersion, { minify: false, sourcemap: true, toolchain: await getPluginBuildToolchain(opts.dataDir) });
        },
        buildHost: async () => { await buildPluginHost(rootDir, hostVersion, await getPluginBuildToolchain(opts.dataDir)); },
        reloadPlugin: async () => {
          if (developmentEnabled() && !stopped && builtinWatchers.get(pluginId)?.loop === loop) await service.reload(pluginId);
        },
        log: (line) => {
          console.info(`[plugins] ${line}`);
        }
      });
      const watcher = watch(rootDir, { recursive: true }, (_event, filename) => {
        if (developmentEnabled() && builtinWatchers.get(pluginId)?.loop === loop && typeof filename === 'string' && filename.length > 0) {
          loop.handleChange(relative(rootDir, join(rootDir, filename)));
        }
      });
      builtinWatchers.set(pluginId, {
        rootDir,
        loop,
        close() {
          loop.dispose();
          watcher.close();
        }
      });
    }
  }

  let safeModeRefresh: Promise<void> = Promise.resolve();
  let appliedSafeMode = opts.getAppConfig?.().pluginSafeMode === true;
  let developmentModeRefresh: Promise<void> = Promise.resolve();
  let appliedDevelopmentMode = developmentEnabled();
  const service: PluginService = {
    recoveryStatus: () => structuredClone(recoveryState),
    async hardReload() {
      await waitForStartup();
      if (hardReloadRunning) return service.recoveryStatus();
      const inventory = store.readStrict();
      if ('error' in inventory) throw new Error(`Cannot recover plugins: ${inventory.error}`);
      const rows = inventory.file.plugins;
      if (rows.length > 256) throw new Error('Plugin recovery supports at most 256 installed plugins per run');
      hardReloadRunning = true;
      recoveryState = { phase: 'running', total: rows.length, restored: [], skipped: [], failed: [] };
      startBuiltinSourceWatchers();
      const official = createOfficialPluginRecovery({ dataDir: opts.dataDir, hostVersion,
        signal: sourceCommands.signal, fetcher: opts.recoveryFetch });
      void (async () => {
        const { ordered, cycles } = sortPluginsByRequires(rows.map(row => ({ id: row.id, requires: requiresOf(row), row })));
        const candidates = [...ordered.map(node => node.row), ...cycles.map(node => node.plugin.row)];
        for (const row of candidates) {
          if (stopped) break;
          recoveryState.current = row.id;
          let root: string | undefined;
          try {
            const definition = bundledPluginById(row.id);
            if (!definition && row.sourceKind !== 'git' && row.sourceKind !== 'npm') {
              recoveryState.skipped.push({ id: row.id, message: 'Local-only plugin has no recorded published source' });
              continue;
            }
            cancelRecovery(row.id);
            const epoch = lifecycleEpoch(row.id);
            const fingerprint = pluginUpdateFingerprint(row, hostVersion, sdkVersion);
            let materialized: Awaited<ReturnType<typeof materialize>>;
            if (definition) {
              // A recovery runtime is still an official bundled identity. Ordinary
              // marketplace installs remain unable to claim these reserved ids.
              root = await official(row.id);
              materialized = { rootDir: root, sourceKind: 'builtin', provenance: row.provenance,
                display: `builtin:${definition.name}`, npmResolvedVersion: null, npmIntegrity: null,
                gitResolvedCommit: null, catalogMarketplace: null, catalogEntryId: null };
            } else {
              const intent = installedSourceIntent(row);
              if (!intent) throw new Error('Plugin has no recorded recovery source');
              const pinned = intent.kind === 'npm' ? intent.specKind === 'exact'
                : intent.selector.kind === 'ref' && (intent.refKind === 'tag' || intent.refKind === 'commit' || /^[a-f0-9]{7,40}$/i.test(intent.selector.ref));
              // Compare against an empty installation to also fetch an unchanged
              // version. Preserve recorded sources and explicit version pins.
              const check = pinned ? undefined : await resolvePluginUpdate({
                row: { ...row, version: '0.0.0-0', npmResolvedVersion: null, gitResolvedCommit: null },
                intent: intent.kind === 'git' ? { ...intent, resolvedTag: undefined } : intent,
                resolver: updateResolver, hostVersion, sdkVersion, now: now()
              });
              if (check && check.outcome !== 'available') throw new Error(check.detail ?? `Recovery source is ${check.outcome}`);
              const candidate = check?.candidate ?? (intent.kind === 'npm' && row.npmIntegrity
                ? { version: row.npmResolvedVersion ?? row.version, integrity: row.npmIntegrity } : undefined);
              const parsed: ParsedPluginSource = intent.kind === 'npm'
                ? { kind: 'npm', name: intent.name, spec: candidate?.version ?? intent.spec, specKind: candidate ? 'exact' : intent.specKind }
                : { kind: 'git', url: intent.url, selector: intent.selector,
                    spec: candidate?.commit ? `commit:${candidate.commit}` : row.gitResolvedCommit ? `commit:${row.gitResolvedCommit}` : intent.selector.kind === 'ref' ? intent.selector.ref : `semver:${intent.selector.range}` };
              materialized = await materialize(parsed, intent, candidate, true);
              root = materialized.rootDir;
            }
            // Validate before any plugin code executes, even for disabled plugins.
            const manifest = loadManifestFromDir(materialized.rootDir);
            assertEngines(manifest, hostVersion, sdkVersion);
            if (manifest.id !== row.id) throw new Error('Recovery source changed plugin identity');
            await scanPluginFiles(materialized.rootDir);
            await ensureCompiledApp({ ...row, sourceKind: materialized.sourceKind, rootDir: materialized.rootDir, appEntry: manifest.appEntry });
            await loadPluginHostArtifactSnapshot({ pluginId: row.id, rootDir: materialized.rootDir,
              hostEntry: manifest.hostEntry, sourceKind: materialized.sourceKind, zccVersion: hostVersion, dataDir: opts.dataDir });
            await installFromMaterialized(materialized, row.enabled, {
              provenance: row.provenance, catalogMarketplace: row.catalogMarketplace, catalogEntryId: row.catalogEntryId,
              ...(definition ? { bundledRecoveryVersion: hostVersion } : {})
            }, row.id, epoch, fingerprint);
            recoveryState.restored.push(row.id);
          } catch (error) {
            recoveryState.failed.push({ id: row.id, message: (error instanceof Error ? error.message : String(error)).slice(0, 1000) });
          } finally { if (root && !recoveryBlocked.has(row.id)) removeUnreferencedGeneration(root); }
        }
      })().catch(error => {
        recoveryState.failed.push({ id: 'recovery', message: error instanceof Error ? error.message : String(error) });
      }).finally(() => {
        hardReloadRunning = false;
        recoveryState.phase = 'complete';
        delete recoveryState.current;
        if (!stopped) {
          startBuiltinSourceWatchers();
          void emitAppsChanged().catch(() => {});
        }
      });
      return service.recoveryStatus();
    },
    refreshDevelopmentMode() {
      const refresh = developmentModeRefresh.then(async () => {
        await waitForStartup();
        const enabled = developmentEnabled();
        if (enabled === appliedDevelopmentMode) return;
        if (started) startBuiltinSourceWatchers();
        appliedDevelopmentMode = enabled;
        await emitAppsChanged();
      });
      developmentModeRefresh = refresh.catch(() => {});
      return refresh;
    },
    refreshSafeMode() {
      const refresh = safeModeRefresh.then(async () => {
        const safeMode = opts.getAppConfig?.().pluginSafeMode === true;
        if (safeMode === appliedSafeMode) return;
        const { ordered } = sortPluginsByRequires(store.list().map(row => ({ id: row.id, requires: requiresOf(row), row })));
        for (const node of ordered) {
          const row = store.get(node.id);
          if (row?.sourceKind !== 'builtin') await withLifecycle(node.id, async () => { const current = store.get(node.id); if (current) await loadOne(current); });
        }
        await applyMissingRequiredPluginStatus();
        await emitCapabilities();
        await emitAppsChanged();
        await syncCliSkill();
        appliedSafeMode = safeMode;
      });
      safeModeRefresh = refresh.catch(() => {});
      return refresh;
    },
    list: () => store.list(),
    get: (id) => store.get(id),
    status: (id) => store.get(id)?.status,
    async install(source, options) {
      await ensureActivationRecovery();
      if (stopped) throw new Error('plugin service is stopped');
      const bundled = bundledPluginByName(source.trim());
      const parsed = bundled ? { kind: 'builtin' as const, name: bundled.name } : parsePluginSource(source);
      if (parsed.kind === 'catalog') {
        const entry = await resolveCatalogEntry(
          parsed.marketplace,
          parsed.entryId,
          marketplaces.list(),
          fetchJson
        );
        const stamped = await installFromMaterialized(
          await materializeMarketplaceEntry(entry),
          options?.enable !== false,
          {
          provenance: 'catalog' as const,
          catalogMarketplace: parsed.marketplace,
            catalogEntryId: parsed.entryId
          }
        );
        await emitAppsChanged();
        return stamped;
      }
      const row = await installParsed(parsed, options?.enable !== false);
      if (started) startBuiltinSourceWatchers();
      await emitAppsChanged();
      return row;
    },
    async enable(id) {
      await waitForStartup();
      bumpLifecycleEpoch(id);
      cancelRecovery(id);
      return withLifecycle(id, async () => {
      const row = store.get(id);
      if (!row) throw new Error(`plugin not installed: ${id}`);
      const next = withToolPolicy({ ...row, enabled: true, updatedAt: now() });
      await store.upsert(next);
      refreshToolPolicyInventory();
      await loadOne(next);
      await emitCapabilities();
      await syncCliSkill();
      const updated = store.get(id) ?? next;
      await emitAppsChanged();
      return updated;
      });
    },
    async disable(id) {
      bumpLifecycleEpoch(id);
      cancelRecovery(id);
      await ensureActivationRecovery();
      return withLifecycle(id, async () => {
      const row = store.get(id);
      if (!row) throw new Error(`plugin not installed: ${id}`);
      await disposeOne(id);
      const next = withToolPolicy({ ...row, enabled: false, status: 'disabled' as const, updatedAt: now() });
      await store.upsert(next);
      live.delete(id);
      refreshToolPolicyInventory();
      await applyMissingRequiredPluginStatus();
      await emitCapabilities();
      await emitAppsChanged();
      await syncCliSkill();
      return next;
      });
    },
    async remove(id) {
      bumpLifecycleEpoch(id);
      cancelRecovery(id);
      await ensureActivationRecovery();
      return withLifecycle(id, async () => {
      await disposeOne(id);
      const row = await store.remove(id);
      if (started) startBuiltinSourceWatchers();
      live.delete(id);
      refreshToolPolicyInventory();
      await uninstalled.add(id);
      if (row) {
        if (isManagedGeneration(opts.dataDir, row.rootDir)) {
          removeUnreferencedGeneration(row.rootDir);
        } else if (row.rootDir.startsWith(join(opts.dataDir, 'plugins') + sep)) {
          rmSync(row.rootDir, { recursive: true, force: true });
        }
      }
      removeLeftoverSidecar(opts.dataDir, id);
      await applyMissingRequiredPluginStatus();
      await emitCapabilities();
      await emitAppsChanged();
      await syncCliSkill();
      });
    },
    async reload(id) {
      await waitForStartup();
      cancelRecovery(id);
      bumpLifecycleEpoch(id);
      const row = store.get(id);
      if (!row) throw new Error(`plugin not installed: ${id}`);
      assertBundledPluginInstall({ id, sourceKind: row.sourceKind, source: row.source, development: developmentEnabled() });
      const epoch = lifecycleEpoch(id);
      const overrides = {
        provenance: row.provenance,
        catalogMarketplace: row.catalogMarketplace,
        catalogEntryId: row.catalogEntryId,
        bundledRecoveryVersion: row.bundledRecoveryVersion
      };
      // Reload the installed artifact; mutable remote refs only move through Update.
      const source = row.sourceKind === 'git' || row.sourceKind === 'npm' || row.bundledRecoveryVersion
        ? { rootDir: row.rootDir, sourceKind: row.sourceKind, provenance: row.provenance, display: row.source,
            sourceIntent: row.sourceIntent, npmResolvedVersion: row.npmResolvedVersion, npmIntegrity: row.npmIntegrity,
            gitResolvedCommit: row.gitResolvedCommit, catalogMarketplace: row.catalogMarketplace, catalogEntryId: row.catalogEntryId }
        : await materialize(parsePluginSource(row.source));
      const next = await installFromMaterialized(source, row.enabled, overrides, id, epoch, pluginUpdateFingerprint(row, hostVersion, sdkVersion));
      if (started) startBuiltinSourceWatchers();
      await emitCapabilities();
      await syncCliSkill();
      await emitAppsChanged();
      return next;
    },
    async reconcileBuiltins() {
      for (const id of RECLAIM_UNINSTALLED_AUTOINSTALL_IDS) {
        if (uninstalled.hasReclaimed(id)) continue;
        if (uninstalled.has(id)) await uninstalled.forget(id);
        await uninstalled.markReclaimed(id);
      }
      for (const row of store.list()) {
        if (row.sourceKind !== 'builtin') continue;
        if (isRetiredFirstPartyPluginId(row.id)) continue;
        const definition = bundledPluginById(row.id);
        if (!definition) continue;
        if (row.bundledRecoveryVersion === hostVersion && isManagedGeneration(opts.dataDir, row.rootDir)) continue;
        try {
          const materialized = await materialize({ kind: 'builtin', name: definition.name });
          const manifest = loadManifestFromDir(materialized.rootDir);
          assertEngines(manifest, hostVersion, sdkVersion);
          const next = reconcileBundledPluginMetadata(row, materialized.rootDir, manifest, now());
          if (next !== row) {
            if (live.has(row.id)) await installFromMaterialized(materialized, row.enabled, {}, row.id);
            else await store.upsert(next);
          }
        } catch (error) {
          console.error(`[plugins] failed to reconcile bundled plugin ${row.id}:`, error instanceof Error ? error.message : error);
        }
      }
      await reclaimBundledIdsFromLegacyOccupiers();
      const installed: InstalledPluginRow[] = [];
      for (const def of BUILTIN_PLUGINS) {
        if (!def.autoInstall) continue;
        if (uninstalled.has(def.pluginId)) continue;
        if (store.get(def.pluginId)) continue;
        try {
          installed.push(await installParsed({ kind: 'builtin', name: def.name }, def.defaultEnabled));
        } catch (error) {
          console.error(
            `[plugins] failed to auto-install builtin ${def.pluginId}:`,
            error instanceof Error ? error.message : error
          );
        }
      }
      return installed;
    },
    async start() {
      if (starting) return starting;
      if (stopped) return;
      const generation = ++lifecycleGeneration;
      const isActive = () => !stopped && lifecycleGeneration === generation;
      starting = (async () => {
      await ensureActivationRecovery();
      if (!isActive()) return;
      await retireRetiredFirstPartyPlugins();
      if (!isActive()) return;
      await this.reconcileBuiltins();
      if (!isActive()) return;
      await seedDefaultMarketplaces();
      if (!isActive()) return;
      const pending = store.list().filter((row) => !live.has(row.id));
      const { ordered, cycles } = sortPluginsByRequires(
        pending.map((row) => ({ id: row.id, requires: requiresOf(row), row }))
      );
      for (const cycle of cycles) {
        if (!isActive()) return;
        const detail = `plugin requires cycle: ${formatPluginRequireCycle(cycle.cycle)}`;
        const degraded = { ...cycle.plugin.row, status: 'degraded' as const, statusDetail: detail };
        live.set(cycle.plugin.id, { row: degraded, handle: null, rpc: new Map() });
        await store.upsert(degraded);
      }
      for (const node of ordered) {
        if (!isActive()) return;
        if (!live.has(node.id)) {
          const epoch = lifecycleEpoch(node.id);
          await loadOne(node.row, () => isActive() && lifecycleEpoch(node.id) === epoch);
        }
      }
      if (!isActive()) return;
      await applyMissingRequiredPluginStatus();
      if (!isActive()) return;
      await emitCapabilities();
      if (!isActive()) return;
      await emitAppsChanged();
      if (!isActive()) return;
      await syncCliSkill();
      if (!isActive()) return;
      updateSweep?.stop();
      updateSweep = startPluginUpdateSweep({
        checkUpdates: () => service.checkUpdates()
      });
      startBuiltinSourceWatchers();
      appliedDevelopmentMode = developmentEnabled();
      started = true;
      void checkInstalledUpdates(true).catch(() => undefined);
      })();
      trackThreadProviderStartup(starting);
      return starting;
    },
    stop() {
      stopped = true;
      sourceCommands.abort();
      started = false;
      lifecycleGeneration++;
      toolPolicySealed.clear();
      refreshToolPolicyInventory();
      for (const timer of recoveryTimers.values()) clearTimeout(timer);
      recoveryTimers.clear();
      recoveryAttempts.clear();
      for (const runtime of serverRuntimes) runtime.dispose();
      serverRuntimes.clear();
      for (const current of live.values()) void current.handle?.dispose().catch(() => {});
      for (const watcher of builtinWatchers.values()) watcher.close();
      builtinWatchers.clear();
      updateSweep?.stop();
      updateSweep = null;
    },
    snapshot,
    appUrl(id) {
      const row = store.get(id);
      return row && live.get(id)?.handle ? appUrlFor(row) : null;
    },
    agentContributions,
    sessionTools(ctx) {
      return resolvePluginSessionTools(withPluginMetadata(agentToolSources(), ctx), ctx);
    },
    invokeAgentTool(args) {
      return invokePluginAgentTool(agentToolSources(), args.name, args.input, args.ctx);
    },
    cliContributions,
    mentionProviders,
    resolveMention,
    evaluateProjectTabAvailability,
    async runCliCommand(id, argv, context) {
      const byId = live.get(id)?.handle;
      if (byId) return runPluginCli(byId, argv, context);
      const named = cliContributions().find((row) => row.name === id || row.pluginId === id);
      const handle = named ? live.get(named.pluginId)?.handle : undefined;
      if (!handle) throw new Error(`plugin not running: ${id}`);
      return runPluginCli(handle, argv, context);
    },
    async dispatchHttp(pluginId, request) {
      const routes = live.get(pluginId)?.handle?.httpRoutes ?? [];
      const route = routes.find((row) => row.method === request.method && row.path === request.path);
      if (!route) throw new Error(`unknown http ${pluginId} ${request.method} ${request.path}`);
      return route.handler(request);
    },
    async dispatchPeer(pluginId, method, request) {
      const handler = live.get(pluginId)?.handle?.peerHandlers.get(method);
      if (!handler) throw new Error(`unknown peer ${pluginId} ${method}`);
      return handler(request);
    },
    async emitHostEvent(event) {
      const artifact = hostArtifacts.get(event.pluginId);
      if (!artifact || artifact.generation !== event.generation) return;
      await live.get(event.pluginId)?.handle?.emitHostEvent(event);
    },
    async emitThreadEvent(event) {
      await Promise.all(
        [...live.values()].map((current) => current.handle?.emitThreadEvent(event) ?? Promise.resolve())
      );
    },
    async admitDispatch(request) {
      const reviews = [...live.values()].flatMap((current) =>
        (current.handle?.dispatchAdmissionHandlers ?? []).map(async (handler) => {
          try {
            const decision: unknown = await handler(request);
            if (!decision || typeof decision !== 'object') throw new Error('invalid dispatch admission decision');
            const result = decision as Record<string, unknown>;
            if (result.action === 'reject' && typeof result.message === 'string') {
              return { action: 'reject', message: result.message, pluginId: current.row.id } as const;
            }
            if (result.action === 'wait' && typeof result.reason === 'string' && typeof result.overrideable === 'boolean') {
              return { action: 'wait', reason: result.reason, overrideable: result.overrideable, pluginId: current.row.id } as const;
            }
            if (result.action === 'proceed') return { action: 'proceed' } as const;
            throw new Error('invalid dispatch admission decision');
          } catch (error) {
            console.warn(`[plugins] dispatch admission ${current.row.id} failed`, error);
            return { action: 'reject', message: `Plugin dispatch admission unavailable: ${current.row.id}` } as const;
          }
        })
      );
      try {
        // One deadline covers the whole fan-out, including any handler that never settles.
        // Never proceed or return an overrideable wait without every veto reviewed.
        const decisions = await withDeadline(Promise.all(reviews), 9_000, 'dispatch admission');
        return decisions.find((decision) => decision.action === 'reject')
          ?? decisions.find((decision) => decision.action === 'wait' && !decision.overrideable)
          ?? decisions.find((decision) => decision.action === 'wait')
          ?? { action: 'proceed' };
      } catch {
        return { action: 'reject', message: 'Plugin dispatch admission timed out' };
      }
    },
    toolPolicyReadiness,
    async decideToolPolicy(request) {
      // Scoped by thread: callers on different surfaces choose their own
      // invocation ids, and one must never replay a decision into another's thread.
      const key = JSON.stringify([request.threadId, request.invocationId]);
      const stamp = currentToolPolicyStamp();
      const blocked = inventoryBlocksAllow();
      if (blocked) {
        if (toolPolicyDecisions.size >= TOOL_POLICY_DECISIONS_MAX) {
          toolPolicyDecisions.delete(toolPolicyDecisions.keys().next().value!);
        }
        toolPolicyDecisions.set(key, { stamp, decision: Promise.resolve(blocked) });
        return blocked;
      }
      const cached = toolPolicyDecisions.get(key);
      if (cached) {
        const resolved = await cached.decision;
        if (resolved.action === 'deny') return resolved;
        if (!sameToolPolicyStamp(cached.stamp, stamp)) {
          const denied = denyCachedAllow(TOOL_POLICY_STAMP_CHANGED_REASON);
          toolPolicyDecisions.set(key, { stamp, decision: Promise.resolve(denied) });
          return denied;
        }
        return resolved;
      }
      const decision = (async () => {
        const before = currentToolPolicyStamp();
        const unready = inventoryBlocksAllow();
        if (unready) return unready;
        for (const current of live.values()) {
          for (const handler of current.handle?.toolPolicyHandlers ?? []) {
            try {
              const decision: unknown = await withDeadline(
                Promise.resolve().then(() => handler(request)),
                PLUGIN_MENTION_RESOLVE_TIMEOUT_MS,
                `tool policy ${current.row.id}`
              );
              if (!decision || typeof decision !== 'object') throw new Error('invalid tool policy decision');
              const result = decision as Record<string, unknown>;
              if (result.action === 'deny' && typeof result.reason === 'string') {
                return { action: 'deny', reason: result.reason } as const;
              }
              if (result.action !== 'allow') throw new Error('invalid tool policy decision');
            } catch (error) {
              console.warn(`[plugins] tool policy ${current.row.id} failed`, error);
              return { action: 'deny', reason: `Plugin tool policy unavailable: ${current.row.id}` } as const;
            }
          }
        }
        const after = currentToolPolicyStamp();
        if (!sameToolPolicyStamp(before, after) || inventoryBlocksAllow()) {
          return { action: 'deny', reason: TOOL_POLICY_STAMP_CHANGED_REASON } as const;
        }
        return { action: 'allow' } as const;
      })();
      if (toolPolicyDecisions.size >= TOOL_POLICY_DECISIONS_MAX) {
        toolPolicyDecisions.delete(toolPolicyDecisions.keys().next().value!);
      }
      toolPolicyDecisions.set(key, { stamp, decision });
      try {
        return await decision;
      } catch (error) {
        toolPolicyDecisions.delete(key);
        throw error;
      }
    },
    async readLogs(id, tail = 100) {
      return readPluginLogTail(opts.dataDir, id, tail);
    },
    syncInjectedSkillRoots: syncCliSkill,
    async callRpc(pluginId, method, args) {
      const current = live.get(pluginId);
      const handler = current?.rpc.get(method);
      if (!handler) throw new Error(`unknown rpc ${pluginId}.${method}`);
      return handler(args);
    },
    getSettings(pluginId) {
      return live.get(pluginId)?.handle?.getSettings() ?? { descriptors: {}, values: {} };
    },
    async setSettings(pluginId, values) {
      await waitForStartup();
      return withLifecycle(pluginId, async () => {
      const handle = live.get(pluginId)?.handle;
      if (!handle) throw new Error(`plugin not running: ${pluginId}`);
      await handle.setSettings(values);
      await syncCliSkill();
      });
    },
    listMarketplaces: () => marketplaces.list(),
    async addMarketplace(source, extra) {
      const parsed = parseMarketplaceSource(source);
      const materialized = await materializeMarketplaceSource(parsed, fetchJson);
      return marketplaces.add(marketplaceSourceDisplay(materialized.source), materialized.index, extra);
    },
    async refreshMarketplace(source) {
      const parsed = parseMarketplaceSource(source);
      const display = marketplaceSourceDisplay(parsed);
      try {
        const materialized = await materializeMarketplaceSource(parsed, fetchJson);
        return marketplaces.refresh(marketplaceSourceDisplay(materialized.source), materialized.index);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const row = await marketplaces.recordRefreshError(display, message);
        if (!row) throw error;
        return row;
      }
    },
    async removeMarketplace(source) {
      const parsed = parseMarketplaceSource(source);
      return marketplaces.remove(marketplaceSourceDisplay(parsed));
    },
    async searchCatalog(query) {
      const q = query.trim().toLowerCase();
      const hits: CatalogSearchHit[] = [];
      for (const def of [...BUILTIN_PLUGINS, ...OFFICIAL_PLUGINS]) {
        const hay = `${def.pluginId} ${def.name} ${def.category ?? ''}`.toLowerCase();
        if (!q || hay.includes(q)) {
          hits.push({
            marketplace: 'official',
            id: def.pluginId,
            displayName: def.name,
            description: `builtin:${def.name}`,
            source: `builtin:${def.name}`
          });
        }
      }
      for (const catalog of marketplaces.list()) {
        try {
          const index = catalog.cachedIndex
            ?? await fetchMarketplaceIndex(catalog.source, fetchJson);
          for (const plugin of index.plugins) {
            const hay = `${plugin.id} ${plugin.displayName} ${plugin.description}`.toLowerCase();
            if (!q || hay.includes(q)) {
              hits.push({
                marketplace: catalog.name,
                id: plugin.id,
                displayName: plugin.displayName,
                description: plugin.description,
                source: marketplaceInstallSpec(plugin)
              });
            }
          }
        } catch {
          /* skip unreachable catalogs */
        }
      }
      return hits;
    },
    checkUpdates() { return checkInstalledUpdates(false); },
    async applyUpdate(id) {
      await waitForStartup();
      const row = store.get(id);
      if (!row) throw new Error(`plugin not installed: ${id}`);
      if (bundledPluginById(id)) throw new Error(bundledPluginSourceNotice(row, false) ?? `Plugin "${id}" updates with Zana releases. Update Zana to receive its new version.`);
      if (row.sourceKind !== 'git' && row.sourceKind !== 'npm') throw new Error('This plugin has no independent remote update source');
      const intent = installedSourceIntent(row);
      if (!intent) throw new Error('Plugin has no recorded update source');
      // Revalidate mutable tags and compatibility before accepting the checked identity.
      const previous = currentCheck(row);
      const check = await checkOneUpdate(row);
      if (previous?.outcome === 'available' && JSON.stringify(previous.candidate) !== JSON.stringify(check.candidate)) {
        await emitAppsChanged();
        throw new Error('The available release changed; review the refreshed check before updating again');
      }
      if (check.outcome !== 'available' || !check.candidate) throw new Error(check.detail ?? `Plugin update is ${check.outcome}`);
      const epoch = lifecycleEpoch(id);
      const candidate = check.candidate;
      const parsed: ParsedPluginSource = intent.kind === 'npm'
        ? { kind: 'npm', name: intent.name, spec: candidate.version, specKind: 'exact' }
        : { kind: 'git', url: intent.url, spec: `commit:${candidate.commit}`, selector: intent.selector };
      const materialized = await materialize(parsed, intent, candidate);
      if (!store.get(id) || pluginUpdateFingerprint(store.get(id)!, hostVersion, sdkVersion) !== check.fingerprint) {
        removeManagedGeneration(opts.dataDir, materialized.rootDir);
        throw new Error('Plugin changed while preparing its update; check again');
      }
      const next = await installFromMaterialized(materialized, store.get(id)!.enabled, {
        provenance: row.provenance, catalogMarketplace: row.catalogMarketplace, catalogEntryId: row.catalogEntryId
      }, id, epoch, check.fingerprint);
      await emitAppsChanged();
      return next;
    },
    async applyAllUpdates() {
      const candidates = await service.checkUpdates();
      const updated: string[] = [];
      const failed = store.list().flatMap(row => {
        const check = !bundledPluginById(row.id) && currentCheck(row);
        return check && check.outcome === 'unavailable' ? [{ id: row.id, message: check.detail ?? 'Plugin source check failed' }] : [];
      });
      for (const candidate of candidates) {
        try { await service.applyUpdate(candidate.id); updated.push(candidate.id); }
        catch (error) { failed.push({ id: candidate.id, message: error instanceof Error ? error.message : 'Plugin update failed' }); }
      }
      return { updated, failed };
    }
  };
  return service;
}

function removeInstalledPluginCopy(dataDir: string, id: string): void {
  if (!isPluginId(id)) return;
  const copy = join(dataDir, 'plugins', id);
  if (!existsSync(copy) || !statSync(copy).isDirectory()) return;
  rmSync(copy, { recursive: true, force: true });
}

function removeManagedGeneration(dataDir: string, rootDir: string): void {
  const generation = managedGenerationDirectory(dataDir, rootDir);
  if (generation) rmSync(generation, { recursive: true, force: true });
}

function managedGenerationDirectory(dataDir: string, rootDir: string): string | undefined {
  const root = resolve(dataDir, 'plugins', 'generations');
  const generationsRoot = canonicalPluginPath(root);
  const candidate = canonicalPluginPath(rootDir);
  if (!candidate.startsWith(`${generationsRoot}${sep}`)) return;
  const relativePath = relative(generationsRoot, candidate);
  const generation = relativePath.split(sep)[0];
  if (!generation) return;
  return join(generationsRoot, generation);
}

function isManagedGeneration(dataDir: string, rootDir: string): boolean {
  return managedGenerationDirectory(dataDir, rootDir) !== undefined;
}

function isLocalSidecar(dataDir: string, id: string): boolean {
  try {
    const locals = JSON.parse(readFileSync(join(dataDir, 'extensions', 'local.json'), 'utf8')) as {
      [key: string]: { workingDir?: string };
    };
    const workingDir = locals[id]?.workingDir;
    return typeof workingDir === 'string' && workingDir.length > 0;
  } catch {
    return false;
  }
}

/** Drop a leftover `~/.zcc/extensions/<id>` copy so discovery cannot resurrect it. */
function removeLeftoverSidecar(dataDir: string, id: string): void {
  if (!isPluginId(id) || isLocalSidecar(dataDir, id)) return;
  const sidecar = join(dataDir, 'extensions', id);
  if (!existsSync(sidecar) || !statSync(sidecar).isDirectory()) return;
  rmSync(sidecar, { recursive: true, force: true });
}

export function defaultBundledRoot(): string {
  if (process.env.ZCC_BUNDLED_PLUGINS_DIR) return process.env.ZCC_BUNDLED_PLUGINS_DIR;
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const resourcesPath =
    typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0
      ? process.resourcesPath
      : null;
  const candidates = [
    resourcesPath ? join(resourcesPath, 'plugins') : null,
    resourcesPath ? join(resourcesPath, 'extensions') : null,
    join(process.cwd(), 'plugins'),
    join(moduleDir, '../../../../plugins'),
    join(moduleDir, '../../../plugins'),
    join(process.cwd(), 'extensions')
  ].filter((dir): dir is string => !!dir);
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0]!;
}

export function defaultPluginDataDir(): string {
  return resolveZccDataDir();
}

/**
 * Catalog metadata for one first-party plugin the app ships under `plugins/`.
 * Same shape `listMarketplace` already accepts for bundled disk extensions, so
 * Browse extensions can union the two without a second row type.
 */
export interface BundledPluginCatalogEntry {
  id: string;
  version: string;
  apiRange: string;
  title: string;
  icon?: string;
  description?: string;
  author?: string;
  permissions: string[];
  skillNames?: string[];
  mcpServers?: Array<{ name: string; alwaysOn?: boolean }>;
  extra?: Record<string, unknown>;
  tags?: string[];
  category?: string;
  overview?: string;
}

/**
 * Enumerate first-party plugins from the bundled plugins root (`package.json`
 * `zcc` block). Browse uses this as the shipped-with-the-app floor (offline,
 * zero network). Community catalogs layer on top. Extension-agnostic (Rule 6):
 * iterates dirs; never names a concrete id. Returns `[]` when the root is
 * missing. Never throws.
 */
export function listBundledPluginCatalog(
  bundledRoot = defaultBundledRoot(),
  log?: (context: string, err?: unknown) => void
): BundledPluginCatalogEntry[] {
  const out: BundledPluginCatalogEntry[] = [];
  try {
    if (!existsSync(bundledRoot) || !statSync(bundledRoot).isDirectory()) return out;
    const names = readdirSync(bundledRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
    for (const name of names) {
      const dir = join(bundledRoot, name);
      const pkgPath = join(dir, 'package.json');
      if (!existsSync(pkgPath)) continue;
      try {
        const manifest = readPluginManifest(JSON.parse(readFileSync(pkgPath, 'utf8')));
        // Dir name must match the derived id so a mismatched package cannot be
        // offered under another id (same guard installFromBundled uses).
        if (manifest.id !== name) continue;
        const overviewPath = join(dir, 'PLUGIN_OVERVIEW.md');
        let overview: string | undefined;
        if (existsSync(overviewPath)) {
          const parsed = parsePluginOverviewMarkdown(readFileSync(overviewPath, 'utf8'));
          if (parsed.ok) overview = parsed.overview;
        }
        out.push({
          id: manifest.id,
          version: manifest.version,
          apiRange: '',
          title: manifest.name,
          icon: manifest.branding.icon,
          description: manifest.description,
          permissions: [],
          skillNames: discoverPluginSkillNames(dir, manifest.skillsRootPaths),
          mcpServers: manifest.mcpServers.map((server) => ({
            name: server.name,
            alwaysOn: server.alwaysOn
          })),
          extra: Object.keys(manifest.extra).length > 0 ? manifest.extra : undefined,
          tags: ['official'],
          category: bundledPluginByName(name)?.category,
          ...(overview ? { overview } : {})
        });
      } catch (err) {
        log?.(`listBundledPluginCatalog:${name}`, err);
      }
    }
  } catch (err) {
    log?.('listBundledPluginCatalog', err);
  }
  return out;
}

/**
 * Install a first-party plugin from the bundled plugins root. Returns `null`
 * when `id` is not a plugin package there, so the caller can fall through to
 * the legacy `extension.json` installer. Main maps id → the app-owned dir
 * (Rule 1); a renderer-supplied id is never treated as a path.
 */
export async function installBundledPlugin(
  id: string,
  opts: { dataDir?: string; bundledRoot?: string } = {}
): Promise<{ ok: true; value: { id: string } } | { ok: false; code: string; message: string } | null> {
  if (!isPluginId(id)) return null;
  const bundledRoot = opts.bundledRoot ?? defaultBundledRoot();
  const dataDir = opts.dataDir ?? defaultPluginDataDir();
  const dir = join(bundledRoot, id);
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    const manifest = readPluginManifest(JSON.parse(readFileSync(pkgPath, 'utf8')));
    if (manifest.id !== id) {
      return { ok: false, code: 'NOT_FOUND', message: `No bundled plugin "${id}"` };
    }
  } catch {
    return null;
  }
  const service = createPluginService({ dataDir, bundledRoot });
  if (service.get(id)) return { ok: true, value: { id } };
  try {
    const source = bundledPluginByName(id) ? `builtin:${id}` : dir;
    const row = await service.install(source);
    return { ok: true, value: { id: row.id } };
  } catch (err) {
    return {
      ok: false,
      code: 'INSTALL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

export {
  BUNDLED_PLUGINS,
  BUILTIN_PLUGINS,
  OFFICIAL_PLUGINS,
  bundledPluginByName
} from './builtin-registry.js';
export type { InstalledPluginRow } from './plugin-store.js';
