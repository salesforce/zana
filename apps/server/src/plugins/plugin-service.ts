import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketplaceInstallSpec } from './marketplace.js';
import {
  createMarketplaceStore,
  fetchMarketplaceIndex,
  marketplaceStorePath,
  resolveCatalogSource,
  type MarketplaceCatalogRow,
  type MarketplaceStore
} from './marketplace-store.js';
import {
  marketplaceSourceDisplay,
  materializeMarketplaceIndex,
  parseMarketplaceSource
} from './marketplace-source.js';
import {
  compareVersions,
  isPluginId,
  parsePluginSource,
  readPluginManifest,
  satisfiesRange,
  type ParsedPluginSource,
  type PluginMcpServerContribution,
  type PluginManifest
} from '@zana-ai/zcc-domain';
import { shimLegacyExtensionManifest } from '@zana-ai/zcc-plugin-sdk';
import {
  HOST_PLUGIN_SDK_VERSION,
  HOST_ZCC_VERSION,
  containsNativeAddon,
  createPluginApi,
  importServerFactory,
  resolveContainedEntry,
  runFactoryTimeBoxed,
  runPluginCli
} from './plugin-api.js';
import { discoverPluginSkillNames } from './plugin-skills.js';
import { BUILTIN_PLUGINS, OFFICIAL_PLUGINS, bundledPluginByName } from './builtin-registry.js';
import { defaultCloneGit, defaultFetchJson, defaultSpawnNpm } from './plugin-process.js';
import { readPluginLogTail } from './plugin-log.js';
import {
  createPluginStore,
  pluginStorePath,
  type InstalledPluginRow,
  type PluginStore
} from './plugin-store.js';
import {
  generatedSkillsRootPath,
  syncPluginCommandsSkill,
  type PluginCliContribution
} from './plugin-commands-skill.js';
import { syncPluginInstructionsSkill } from './plugin-instructions-skill.js';
import {
  builtinSkillsRootPath,
  collectPluginSkillDirectoryRoots,
  writeInjectedSkillRootManifest
} from './injected-skill-roots.js';
import type { PluginCliExecutionResult, PluginHttpRequest, PluginHttpResponse, PluginThreadEvent } from '@zana-ai/zcc-plugin-sdk/server';

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
  list(): InstalledPluginRow[];
  get(id: string): InstalledPluginRow | undefined;
  status(id: string): InstalledPluginRow['status'] | undefined;
  install(source: string, opts?: { enable?: boolean }): Promise<InstalledPluginRow>;
  enable(id: string): Promise<InstalledPluginRow>;
  disable(id: string): Promise<InstalledPluginRow>;
  remove(id: string): Promise<void>;
  reload(id: string): Promise<InstalledPluginRow>;
  reconcileBuiltins(): Promise<InstalledPluginRow[]>;
  start(): Promise<void>;
  snapshot(): PluginUiSnapshot[];
  agentContributions(): PluginAgentContribution[];
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
  addMarketplace(source: string): Promise<MarketplaceCatalogRow>;
  refreshMarketplace(source: string): Promise<MarketplaceCatalogRow>;
  removeMarketplace(source: string): Promise<boolean>;
  searchCatalog(query: string): Promise<CatalogSearchHit[]>;
  checkUpdates(): Promise<PluginUpdateRow[]>;
  applyUpdate(id: string): Promise<InstalledPluginRow>;
  cliContributions(): PluginCliContribution[];
  mentionProviders(): Array<{ pluginId: string; id: string; trigger?: string }>;
  runCliCommand(id: string, argv: string[]): Promise<PluginCliExecutionResult>;
  dispatchHttp(pluginId: string, request: PluginHttpRequest): Promise<PluginHttpResponse>;
  emitThreadEvent(event: PluginThreadEvent): Promise<void>;
  readLogs(id: string, tail?: number): Promise<string[]>;
}

export interface PluginUiSnapshot {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  provenance: InstalledPluginRow['provenance'];
  status: InstalledPluginRow['status'];
  appEntry: string | null;
  appUrl: string | null;
  npmResolvedVersion: string | null;
  gitResolvedCommit: string | null;
  source: string;
  projectTab: PluginManifest['projectTab'];
  skillNames: string[];
  mcpServers: PluginUiMcpServer[];
  extra: Record<string, unknown>;
  themes: PluginThemeSnapshot[];
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
    status: row.status,
    appUrl: row.appUrl,
    projectTab: row.projectTab
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
  spawnNpm?: (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  cloneGit?: (url: string, dest: string, spec: string) => Promise<{ commit: string }>;
  fetchJson?: (url: string) => Promise<unknown>;
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
}

interface LivePlugin {
  row: InstalledPluginRow;
  handle: Awaited<ReturnType<typeof createPluginApi>> | null;
  rpc: Map<string, (args: unknown) => unknown | Promise<unknown>>;
}

const NATIVE_ADDON_SKIP_DIRS = new Set(['node_modules', '.git']);

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (NATIVE_ADDON_SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else out.push(full.slice(root.length + 1).split(sep).join('/'));
    }
  };
  walk(root);
  return out;
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

function assertEngines(manifest: PluginManifest, hostVersion: string, sdkVersion: string): void {
  if (manifest.engines.zcc && !satisfiesRange(hostVersion, manifest.engines.zcc)) {
    throw new Error(`plugin requires zcc ${manifest.engines.zcc} (host ${hostVersion})`);
  }
  if (manifest.engines.zccPluginSdk && !satisfiesRange(sdkVersion, manifest.engines.zccPluginSdk)) {
    throw new Error(
      `plugin requires zccPluginSdk ${manifest.engines.zccPluginSdk} (host ${sdkVersion})`
    );
  }
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
  const store: PluginStore = createPluginStore({ file: pluginStorePath(opts.dataDir) });
  const marketplaces: MarketplaceStore = createMarketplaceStore({
    file: marketplaceStorePath(opts.dataDir)
  });
  const live = new Map<string, LivePlugin>();
  const hostVersion = opts.hostVersion ?? HOST_ZCC_VERSION;
  const sdkVersion = opts.pluginSdkVersion ?? HOST_PLUGIN_SDK_VERSION;
  const now = opts.now ?? Date.now;
  const kvRoot = join(opts.dataDir, 'plugins');
  const spawnNpm = opts.spawnNpm ?? defaultSpawnNpm;
  const cloneGit = opts.cloneGit ?? defaultCloneGit;
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  mkdirSync(kvRoot, { recursive: true });

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
    const out: Array<{ pluginId: string; id: string; trigger?: string }> = [];
    for (const [id, livePlugin] of live) {
      for (const provider of livePlugin.handle?.mentionProviders ?? []) {
        out.push({
          pluginId: id,
          id: provider.id,
          ...(provider.trigger ? { trigger: provider.trigger } : {})
        });
      }
    }
    return out;
  }

  function instructionContributions() {
    return [...live.entries()]
      .flatMap(([pluginId, current]) =>
        (current.handle?.extraInstructions ?? []).map((text) => ({ pluginId, text }))
      )
      .filter((row) => row.text.trim().length > 0);
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
      const directoryRoots = [builtinSkillsRootPath(), generatedSkillsRootPath(opts.dataDir)];
      for (const row of store.list()) {
        if (!row.enabled) continue;
        try {
          const manifest = loadManifestFromDir(row.rootDir);
          directoryRoots.push(
            ...collectPluginSkillDirectoryRoots({
              rootDir: row.rootDir,
              relativeRoots: manifest.skillsRootPaths,
              extraRoots: live.get(row.id)?.handle?.extraSkillRoots
            })
          );
        } catch {
          /* skip unreadable plugins */
        }
      }
      writeInjectedSkillRootManifest(opts.dataDir, directoryRoots);
    } catch (error) {
      console.error('[plugins] syncPluginCommandsSkill failed', error);
    }
  }

  function appUrlFor(row: InstalledPluginRow): string | null {
    if (!row.appEntry) return null;
    try {
      const root = resolveContainedEntry(row.rootDir, '.');
      const declared = row.appEntry;
      const served =
        /\.tsx?$/.test(declared)
          ? (() => {
              try {
                return resolveContainedEntry(row.rootDir, declared.replace(/\.tsx?$/, '.js'));
              } catch {
                return resolveContainedEntry(row.rootDir, declared);
              }
            })()
          : resolveContainedEntry(row.rootDir, declared);
      const entryPath = relative(root, served).split(sep).map(encodeURIComponent).join('/');
      return `/plugins/${encodeURIComponent(row.id)}/assets/${entryPath}?v=${row.updatedAt}`;
    } catch {
      return null;
    }
  }

  async function disposeOne(id: string): Promise<void> {
    const current = live.get(id);
    if (!current) return;
    live.delete(id);
    await current.handle?.dispose();
  }

  async function loadOne(row: InstalledPluginRow): Promise<void> {
    const previous = live.get(row.id);
    if (!row.enabled) {
      await disposeOne(row.id);
      const disabled = { ...row, status: 'disabled' as const };
      live.set(row.id, { row: disabled, handle: null, rpc: new Map() });
      await store.upsert(disabled);
      return;
    }
    if (!existsSync(row.rootDir)) {
      if (previous?.handle && previous.row.status === 'running') {
        const kept = {
          ...previous.row,
          status: 'running' as const,
          statusDetail: 'reload failed: plugin directory missing'
        };
        live.set(row.id, { ...previous, row: kept });
        await store.upsert(kept);
        return;
      }
      await disposeOne(row.id);
      const degraded = { ...row, status: 'degraded' as const, statusDetail: 'plugin directory missing' };
      live.set(row.id, { row: degraded, handle: null, rpc: new Map() });
      await store.upsert(degraded);
      return;
    }
    const files = listFiles(row.rootDir);
    if (containsNativeAddon(row.rootDir, files)) {
      await disposeOne(row.id);
      const degraded = { ...row, status: 'degraded' as const, statusDetail: 'native addons are not allowed' };
      live.set(row.id, { row: degraded, handle: null, rpc: new Map() });
      await store.upsert(degraded);
      return;
    }
    let configurationMessage: string | null = null;
    const handle = createPluginApi(row.id, join(kvRoot, row.id), {
      requestPluginInteraction: opts.requestPluginInteraction,
      interruptPluginInteractions: opts.interruptPluginInteractions,
      dataDir: opts.dataDir,
      onNeedsConfiguration: (message) => {
        configurationMessage = message;
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
        if (typeof handler === 'function') rpc.set(name, handler);
      }
    };
    try {
      if (row.serverEntry) {
        const entry = resolveContainedEntry(row.rootDir, row.serverEntry);
        const factory = await importServerFactory(entry, row.updatedAt, {
          fromSource: row.sourceKind === 'path'
        });
        await runFactoryTimeBoxed(factory, handle.api);
      }
      const running = {
        ...row,
        status: (configurationMessage ? 'needs-configuration' : 'running') as InstalledPluginRow['status'],
        statusDetail: configurationMessage
      };
      live.set(row.id, { row: running, handle, rpc });
      await store.upsert(running);
      if (previous && previous.handle && previous.handle !== handle) {
        await previous.handle.dispose();
      }
    } catch (error) {
      await handle.dispose();
      const detail = error instanceof Error ? error.message : String(error);
      if (previous?.handle && previous.row.status === 'running') {
        const kept = {
          ...previous.row,
          status: 'running' as const,
          statusDetail: `reload failed: ${detail}`
        };
        live.set(row.id, { ...previous, row: kept });
        await store.upsert(kept);
        return;
      }
      const degraded = { ...row, status: 'degraded' as const, statusDetail: detail };
      live.set(row.id, { row: degraded, handle: null, rpc: new Map() });
      await store.upsert(degraded);
    }
  }

  async function materialize(source: ParsedPluginSource): Promise<{
    rootDir: string;
    provenance: InstalledPluginRow['provenance'];
    sourceKind: InstalledPluginRow['sourceKind'];
    display: string;
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
      const dest = join(opts.dataDir, 'plugins', 'npm', source.name.replace('/', '__'));
      mkdirSync(dirname(dest), { recursive: true });
      rmSync(dest, { recursive: true, force: true });
      mkdirSync(dest, { recursive: true });
      const spec = source.spec ? `${source.name}@${source.spec}` : source.name;
      const result = await spawn(['install', spec, '--ignore-scripts', '--prefix', dest], dest);
      if (result.code !== 0) throw new Error(result.stderr || `npm install failed for ${spec}`);
      const pkgRoot = join(dest, 'node_modules', ...source.name.split('/'));
      if (!existsSync(pkgRoot)) throw new Error(`npm install did not produce ${source.name}`);
      const pkg = readJson(join(pkgRoot, 'package.json')) as { version?: string };
      return {
        rootDir: pkgRoot,
        provenance: 'direct',
        sourceKind: 'npm',
        display: `npm:${spec}`,
        npmResolvedVersion: pkg.version ?? source.spec ?? null,
        npmIntegrity: null,
        gitResolvedCommit: null,
        catalogMarketplace: null,
        catalogEntryId: null
      };
    }
    if (source.kind === 'git') {
      const clone = cloneGit;
      const dest = join(opts.dataDir, 'plugins', 'git', Buffer.from(source.url).toString('hex').slice(0, 24));
      rmSync(dest, { recursive: true, force: true });
      mkdirSync(dirname(dest), { recursive: true });
      const cloned = await clone(source.url, dest, source.spec);
      return {
        rootDir: dest,
        provenance: 'direct',
        sourceKind: 'git',
        display: `git:${source.url}@${source.spec}`,
        npmResolvedVersion: null,
        npmIntegrity: null,
        gitResolvedCommit: cloned.commit,
        catalogMarketplace: null,
        catalogEntryId: null
      };
    }
    throw new Error(`unsupported source ${source.kind}`);
  }

  async function installParsed(source: ParsedPluginSource, enable: boolean): Promise<InstalledPluginRow> {
    const materialized = await materialize(source);
    const manifest = loadManifestFromDir(materialized.rootDir);
    assertEngines(manifest, hostVersion, sdkVersion);
    const ts = now();
    const existing = store.get(manifest.id);
    const row: InstalledPluginRow = {
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
      rootDir: materialized.rootDir,
      serverEntry: manifest.serverEntry,
      appEntry: manifest.appEntry,
      npmResolvedVersion: materialized.npmResolvedVersion,
      npmIntegrity: materialized.npmIntegrity,
      gitResolvedCommit: materialized.gitResolvedCommit,
      catalogMarketplace: materialized.catalogMarketplace,
      catalogEntryId: materialized.catalogEntryId,
      installedAt: existing?.installedAt ?? ts,
      updatedAt: ts
    };
    await store.upsert(row);
    await loadOne(row);
    await emitCapabilities();
    await syncCliSkill();
    return store.get(manifest.id) ?? row;
  }

  function snapshot(): PluginUiSnapshot[] {
    return store.list().map((row) => {
      let skillNames: string[] = [];
      let mcpServers: PluginUiMcpServer[] = [];
      let extra: Record<string, unknown> = {};
      let projectTab: PluginManifest['projectTab'];
      let themes: PluginThemeSnapshot[] = [];
      try {
        const manifest = loadManifestFromDir(row.rootDir);
        skillNames = manifest.skillNames;
        extra = manifest.extra;
        projectTab = manifest.projectTab;
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
      }
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        icon: row.icon,
        enabled: row.enabled,
        provenance: row.provenance,
        status: row.status,
        appEntry: row.appEntry,
        appUrl: appUrlFor(row),
        npmResolvedVersion: row.npmResolvedVersion,
        gitResolvedCommit: row.gitResolvedCommit,
        source: row.source,
        projectTab,
        skillNames,
        mcpServers,
        extra,
        themes
      };
    });
  }

  return {
    list: () => store.list(),
    get: (id) => store.get(id),
    status: (id) => store.get(id)?.status,
    async install(source, options) {
      const parsed = parsePluginSource(source);
      if (parsed.kind === 'catalog') {
        const resolved = await resolveCatalogSource(
          parsed.marketplace,
          parsed.entryId,
          marketplaces.list(),
          fetchJson
        );
        const row = await installParsed(parsePluginSource(resolved), options?.enable !== false);
        const stamped = {
          ...row,
          provenance: 'catalog' as const,
          catalogMarketplace: parsed.marketplace,
          catalogEntryId: parsed.entryId,
          updatedAt: now()
        };
        await store.upsert(stamped);
        await emitAppsChanged();
        return stamped;
      }
      const row = await installParsed(parsed, options?.enable !== false);
      await emitAppsChanged();
      return row;
    },
    async enable(id) {
      const row = store.get(id);
      if (!row) throw new Error(`plugin not installed: ${id}`);
      const next = { ...row, enabled: true, updatedAt: now() };
      await store.upsert(next);
      await loadOne(next);
      await emitCapabilities();
      await syncCliSkill();
      const updated = store.get(id) ?? next;
      await emitAppsChanged();
      return updated;
    },
    async disable(id) {
      const row = store.get(id);
      if (!row) throw new Error(`plugin not installed: ${id}`);
      await disposeOne(id);
      const next = { ...row, enabled: false, status: 'disabled' as const, updatedAt: now() };
      await store.upsert(next);
      live.set(id, { row: next, handle: null, rpc: new Map() });
      await emitCapabilities();
      await emitAppsChanged();
      await syncCliSkill();
      return next;
    },
    async remove(id) {
      await disposeOne(id);
      const row = await store.remove(id);
      if (row && row.sourceKind !== 'path' && row.rootDir.startsWith(join(opts.dataDir, 'plugins'))) {
        rmSync(row.rootDir, { recursive: true, force: true });
      }
      await emitCapabilities();
      await emitAppsChanged();
      await syncCliSkill();
    },
    async reload(id) {
      const row = store.get(id);
      if (!row) throw new Error(`plugin not installed: ${id}`);
      // A reload must change the app URL too: browsers cache ESM modules by URL,
      // so a stable URL would keep evaluating the old renderer bundle.
      const next = { ...row, updatedAt: now() };
      await store.upsert(next);
      await loadOne(next);
      await emitCapabilities();
      await syncCliSkill();
      const updated = store.get(id) ?? next;
      await emitAppsChanged();
      return updated;
    },
    async reconcileBuiltins() {
      const installed: InstalledPluginRow[] = [];
      for (const def of BUILTIN_PLUGINS) {
        if (!def.autoInstall) continue;
        if (store.get(def.pluginId)) continue;
        try {
          installed.push(await installParsed({ kind: 'builtin', name: def.name }, def.defaultEnabled));
        } catch {
          /* bundled artifact may be absent in tests or a stripped build */
        }
      }
      return installed;
    },
    async start() {
      await migrateLegacySidecars(opts.dataDir, installParsed, store);
      await this.reconcileBuiltins();
      for (const row of store.list()) {
        if (!live.has(row.id)) await loadOne(row);
      }
      await emitCapabilities();
      await emitAppsChanged();
      await syncCliSkill();
    },
    snapshot,
    agentContributions,
    cliContributions,
    mentionProviders,
    async runCliCommand(id, argv) {
      const byId = live.get(id)?.handle;
      if (byId) return runPluginCli(byId, argv);
      const named = cliContributions().find((row) => row.name === id || row.pluginId === id);
      const handle = named ? live.get(named.pluginId)?.handle : undefined;
      if (!handle) throw new Error(`plugin not running: ${id}`);
      return runPluginCli(handle, argv);
    },
    async dispatchHttp(pluginId, request) {
      const routes = live.get(pluginId)?.handle?.httpRoutes ?? [];
      const route = routes.find((row) => row.method === request.method && row.path === request.path);
      if (!route) throw new Error(`unknown http ${pluginId} ${request.method} ${request.path}`);
      return route.handler(request);
    },
    async emitThreadEvent(event) {
      await Promise.all(
        [...live.values()].map((current) => current.handle?.emitThreadEvent(event) ?? Promise.resolve())
      );
    },
    async readLogs(id, tail = 100) {
      return readPluginLogTail(opts.dataDir, id, tail);
    },
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
      const handle = live.get(pluginId)?.handle;
      if (!handle) throw new Error(`plugin not running: ${pluginId}`);
      await handle.setSettings(values);
      await syncCliSkill();
    },
    listMarketplaces: () => marketplaces.list(),
    async addMarketplace(source) {
      const parsed = parseMarketplaceSource(source);
      const index = await materializeMarketplaceIndex(parsed, fetchJson);
      return marketplaces.add(marketplaceSourceDisplay(parsed), index);
    },
    async refreshMarketplace(source) {
      const parsed = parseMarketplaceSource(source);
      const display = marketplaceSourceDisplay(parsed);
      try {
        const index = await materializeMarketplaceIndex(parsed, fetchJson);
        return marketplaces.refresh(display, index);
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
    async checkUpdates() {
      const updates: PluginUpdateRow[] = [];
      for (const row of store.list()) {
        if (!row.catalogMarketplace || !row.catalogEntryId) continue;
        try {
          const spec = await resolveCatalogSource(
            row.catalogMarketplace,
            row.catalogEntryId,
            marketplaces.list(),
            fetchJson
          );
          const parsed = parsePluginSource(spec);
          const available =
            parsed.kind === 'npm' ? (parsed.spec ?? row.version) : row.gitResolvedCommit ?? row.version;
          if (parsed.kind === 'npm' && parsed.spec && compareVersions(parsed.spec, row.version) > 0) {
            updates.push({
              id: row.id,
              current: row.version,
              available: parsed.spec,
              marketplace: row.catalogMarketplace
            });
          } else if (available && available !== row.version && available !== row.gitResolvedCommit) {
            updates.push({
              id: row.id,
              current: row.npmResolvedVersion ?? row.version,
              available,
              marketplace: row.catalogMarketplace
            });
          }
        } catch {
          /* skip */
        }
      }
      return updates;
    },
    async applyUpdate(id) {
      const row = store.get(id);
      if (!row) throw new Error(`plugin not installed: ${id}`);
      if (row.catalogMarketplace && row.catalogEntryId) {
        const resolved = await resolveCatalogSource(
          row.catalogMarketplace,
          row.catalogEntryId,
          marketplaces.list(),
          fetchJson
        );
        const next = await installParsed(parsePluginSource(resolved), row.enabled);
        const stamped = {
          ...next,
          provenance: 'catalog' as const,
          catalogMarketplace: row.catalogMarketplace,
          catalogEntryId: row.catalogEntryId,
          updatedAt: now()
        };
        await store.upsert(stamped);
        await emitAppsChanged();
        return stamped;
      }
      const next = await installParsed(parsePluginSource(row.source), row.enabled);
      await emitAppsChanged();
      return next;
    }
  };
}

async function migrateLegacySidecars(
  dataDir: string,
  installParsed: (source: ParsedPluginSource, enable: boolean) => Promise<InstalledPluginRow>,
  store: PluginStore
): Promise<void> {
  const legacyRoot = join(dataDir, 'extensions');
  if (!existsSync(legacyRoot) || !statSync(legacyRoot).isDirectory()) return;
  let enabled: Record<string, boolean> = {};
  try {
    const raw = JSON.parse(readFileSync(join(legacyRoot, 'enabled.json'), 'utf8')) as {
      enabled?: Record<string, boolean>;
    };
    enabled = raw.enabled ?? {};
  } catch {
    /* optional */
  }
  let locals: Record<string, { workingDir?: string }> = {};
  try {
    locals = JSON.parse(readFileSync(join(legacyRoot, 'local.json'), 'utf8')) as typeof locals;
  } catch {
    /* optional */
  }
  for (const name of readdirSync(legacyRoot)) {
    if (name.endsWith('.json')) continue;
    const dir = join(legacyRoot, name);
    if (!statSync(dir).isDirectory()) continue;
    if (store.get(name)) continue;
    const localDir = locals[name]?.workingDir;
    const sourceDir = localDir && existsSync(localDir) ? localDir : dir;
    try {
      await installParsed({ kind: 'path', path: sourceDir }, enabled[name] !== false);
    } catch {
      /* skip unreadable legacy dirs */
    }
  }
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
  return (
    process.env.ZCC_DATA_DIR?.trim() ||
    process.env.ZCC_CENTER_DIR?.trim() ||
    join(homedir(), '.zcc')
  );
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
          tags: ['official']
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

export { BUILTIN_PLUGINS, OFFICIAL_PLUGINS, bundledPluginByName } from './builtin-registry.js';
export type { InstalledPluginRow } from './plugin-store.js';
