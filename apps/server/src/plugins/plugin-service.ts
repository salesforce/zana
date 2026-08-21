import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultCloneGit, defaultFetchJson, defaultSpawnNpm } from './plugin-process.js';
import {
  createMarketplaceStore,
  fetchMarketplaceIndex,
  marketplaceStorePath,
  resolveCatalogSource,
  type MarketplaceCatalogRow,
  type MarketplaceStore
} from './marketplace-store.js';
import {
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
  runFactoryTimeBoxed
} from './plugin-api.js';
import { discoverPluginSkillNames } from './plugin-skills.js';
import { BUILTIN_PLUGINS, bundledPluginByName } from './builtin-registry.js';
import {
  createPluginStore,
  pluginStorePath,
  type InstalledPluginRow,
  type PluginStore
} from './plugin-store.js';

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
  listMarketplaces(): MarketplaceCatalogRow[];
  addMarketplace(url: string): Promise<MarketplaceCatalogRow>;
}

export interface PluginUiSnapshot {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
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
}

interface LivePlugin {
  row: InstalledPluginRow;
  handle: Awaited<ReturnType<typeof createPluginApi>> | null;
  rpc: Map<string, (args: unknown) => unknown | Promise<unknown>>;
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
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
          skillsRootPaths: manifest.skillsRootPaths,
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

  function appUrlFor(row: InstalledPluginRow): string | null {
    if (!row.appEntry) return null;
    try {
      // Resolve first so the URL retains nested entry paths without trusting a
      // manifest path that could escape the installed plugin root.
      const root = resolveContainedEntry(row.rootDir, '.');
      const entry = resolveContainedEntry(row.rootDir, row.appEntry);
      const entryPath = relative(root, entry).split(sep).map(encodeURIComponent).join('/');
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
    await disposeOne(row.id);
    if (!row.enabled) {
      const disabled = { ...row, status: 'disabled' as const };
      live.set(row.id, { row: disabled, handle: null, rpc: new Map() });
      await store.upsert(disabled);
      return;
    }
    if (!existsSync(row.rootDir)) {
      const degraded = { ...row, status: 'degraded' as const, statusDetail: 'plugin directory missing' };
      live.set(row.id, { row: degraded, handle: null, rpc: new Map() });
      await store.upsert(degraded);
      return;
    }
    const files = listFiles(row.rootDir);
    if (containsNativeAddon(row.rootDir, files)) {
      const degraded = { ...row, status: 'degraded' as const, statusDetail: 'native addons are not allowed' };
      live.set(row.id, { row: degraded, handle: null, rpc: new Map() });
      await store.upsert(degraded);
      return;
    }
    const handle = createPluginApi(row.id, join(kvRoot, row.id));
    const rpc = new Map<string, (args: unknown) => unknown | Promise<unknown>>();
    const originalMethod = handle.api.rpc.method.bind(handle.api.rpc);
    handle.api.rpc.method = (name, handler) => {
      rpc.set(name, handler);
      originalMethod(name, handler);
    };
    try {
      if (row.serverEntry) {
        const entry = resolveContainedEntry(row.rootDir, row.serverEntry);
        const factory = await importServerFactory(entry);
        await runFactoryTimeBoxed(factory, handle.api);
      }
      const running = { ...row, status: 'running' as const, statusDetail: null };
      live.set(row.id, { row: running, handle, rpc });
      await store.upsert(running);
    } catch (error) {
      await handle.dispose();
      const degraded = {
        ...row,
        status: 'degraded' as const,
        statusDetail: error instanceof Error ? error.message : String(error)
      };
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
    return store.get(manifest.id) ?? row;
  }

  function snapshot(): PluginUiSnapshot[] {
    return store.list().map((row) => {
      let skillNames: string[] = [];
      let mcpServers: PluginUiMcpServer[] = [];
      let extra: Record<string, unknown> = {};
      let projectTab: PluginManifest['projectTab'];
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
      } catch {
        projectTab = undefined;
      }
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        icon: row.icon,
        enabled: row.enabled,
        status: row.status,
        appEntry: row.appEntry,
        appUrl: appUrlFor(row),
        npmResolvedVersion: row.npmResolvedVersion,
        gitResolvedCommit: row.gitResolvedCommit,
        source: row.source,
        projectTab,
        skillNames,
        mcpServers,
        extra
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
    },
    snapshot,
    agentContributions,
    async callRpc(pluginId, method, args) {
      const current = live.get(pluginId);
      const handler = current?.rpc.get(method);
      if (!handler) throw new Error(`unknown rpc ${pluginId}.${method}`);
      return handler(args);
    },
    listMarketplaces: () => marketplaces.list(),
    async addMarketplace(url) {
      const index = await fetchMarketplaceIndex(url, fetchJson);
      return marketplaces.add(url, index);
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
  return process.env.ZCC_CENTER_DIR ?? join(homedir(), '.zcc');
}

export { BUILTIN_PLUGINS, OFFICIAL_PLUGINS, bundledPluginByName } from './builtin-registry.js';
export type { InstalledPluginRow } from './plugin-store.js';
