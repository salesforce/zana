import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue } from '../durable-store.js';
import type { ToolPolicyClassification } from './plugin-tool-policy-state.js';
import type { PluginSourceIntent } from './plugin-update-resolver.js';
import {
  classifyDeclaredToolPolicy,
  persistKnownTrueMonotonically,
  resolveActivatedToolPolicy
} from './plugin-tool-policy-state.js';

export type PluginSourceKind = 'path' | 'builtin' | 'npm' | 'git';
export type PluginProvenance = 'builtin' | 'direct' | 'catalog';
export type PluginStatus = 'running' | 'disabled' | 'degraded' | 'needs-configuration';

export interface InstalledPluginRow {
  id: string;
  version: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  status: PluginStatus;
  statusDetail: string | null;
  provenance: PluginProvenance;
  sourceKind: PluginSourceKind;
  source: string;
  sourceIntent?: PluginSourceIntent;
  rootDir: string;
  serverEntry: string | null;
  appEntry: string | null;
  npmResolvedVersion: string | null;
  npmIntegrity: string | null;
  gitResolvedCommit: string | null;
  catalogMarketplace: string | null;
  catalogEntryId: string | null;
  installedAt: number;
  updatedAt: number;
  toolPolicy?: ToolPolicyClassification;
  lastActivationFailure?: { version: string; at: number; detail: string };
  /** A clean official runtime retained until the app itself is upgraded. */
  bundledRecoveryVersion?: string;
}

interface PluginStoreFile {
  version: 1;
  plugins: InstalledPluginRow[];
}

export type PluginStoreReadStatus = 'valid-empty' | 'loaded' | 'missing-known' | 'corrupt';

export type PluginStoreReadResult =
  | { status: 'valid-empty' | 'loaded'; file: PluginStoreFile }
  | { status: 'missing-known' | 'corrupt'; error: string };

export interface PluginStore {
  list(): InstalledPluginRow[];
  get(id: string): InstalledPluginRow | undefined;
  upsert(row: InstalledPluginRow): Promise<InstalledPluginRow>;
  remove(id: string): Promise<InstalledPluginRow | undefined>;
  readStrict(): PluginStoreReadResult;
}

export function createPluginStore(opts: { file: string; knownExisting?: boolean }): PluginStore {
  const queue = createSerializedTransactionQueue();
  let knownExisting = opts.knownExisting === true || existsSync(opts.file);

  function read(): PluginStoreFile {
    const result = readStrict();
    if (result.status === 'loaded' || result.status === 'valid-empty') return result.file;
    return { version: 1, plugins: [] };
  }

  function readForWrite(): PluginStoreFile {
    const result = readStrict();
    if (result.status === 'loaded' || result.status === 'valid-empty') return result.file;
    if ('error' in result) throw new Error(`cannot modify plugin registry: ${result.error}`);
    throw new Error('cannot modify plugin registry');
  }

  function readStrict(): PluginStoreReadResult {
    if (!existsSync(opts.file)) {
      if (knownExisting) {
        return { status: 'missing-known', error: 'plugin registry missing after it existed' };
      }
      return { status: 'valid-empty', file: { version: 1, plugins: [] } };
    }
    knownExisting = true;
    try {
      const parsed = JSON.parse(readFileSync(opts.file, 'utf8')) as PluginStoreFile;
      if (parsed?.version !== 1 || !Array.isArray(parsed.plugins)) {
        return { status: 'corrupt', error: 'plugin registry is not a v1 plugin list' };
      }
      return { status: 'loaded', file: parsed };
    } catch (error) {
      return {
        status: 'corrupt',
        error: error instanceof Error ? error.message : 'plugin registry is unreadable'
      };
    }
  }

  function write(file: PluginStoreFile): void {
    mkdirSync(dirname(opts.file), { recursive: true });
    atomicDurableWrite(opts.file, Buffer.from(`${JSON.stringify(file, null, 2)}\n`, 'utf8'));
    knownExisting = true;
  }

  return {
    list() {
      return read().plugins;
    },
    get(id) {
      return read().plugins.find((row) => row.id === id);
    },
    upsert(row) {
      return queue.run(async () => {
        const file = readForWrite();
        const next = file.plugins.filter((item) => item.id !== row.id);
        next.push(row);
        next.sort((a, b) => a.id.localeCompare(b.id));
        write({ version: 1, plugins: next });
        return row;
      });
    },
    remove(id) {
      return queue.run(async () => {
        const file = readForWrite();
        const existing = file.plugins.find((row) => row.id === id);
        write({ version: 1, plugins: file.plugins.filter((item) => item.id !== id) });
        return existing;
      });
    },
    readStrict
  };
}

export function pluginStorePath(dataDir: string): string {
  return join(dataDir, 'plugins', 'installed.json');
}

export function classifyInstalledToolPolicy(row: {
  enabled: boolean;
  serverEntry: string | null;
  toolPolicy?: ToolPolicyClassification;
  declared?: boolean;
}): ToolPolicyClassification {
  const next = classifyDeclaredToolPolicy({
    declared: row.declared,
    hasServer: Boolean(row.serverEntry)
  });
  return persistKnownTrueMonotonically({
    existing: row.toolPolicy,
    next: row.toolPolicy ?? next,
    enabled: row.enabled
  });
}

export function classifyActivatedToolPolicy(row: {
  enabled: boolean;
  serverEntry: string | null;
  toolPolicy?: ToolPolicyClassification;
  declared?: boolean;
  registeredHandler: boolean;
}): ToolPolicyClassification {
  return resolveActivatedToolPolicy({
    existing: row.toolPolicy,
    declared: row.declared,
    hasServer: Boolean(row.serverEntry),
    registeredHandler: row.registeredHandler,
    enabled: row.enabled
  });
}
