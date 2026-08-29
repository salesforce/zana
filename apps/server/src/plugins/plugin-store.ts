import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue } from '../durable-store.js';

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
}

interface PluginStoreFile {
  version: 1;
  plugins: InstalledPluginRow[];
}

export interface PluginStore {
  list(): InstalledPluginRow[];
  get(id: string): InstalledPluginRow | undefined;
  upsert(row: InstalledPluginRow): Promise<InstalledPluginRow>;
  remove(id: string): Promise<InstalledPluginRow | undefined>;
}

export function createPluginStore(opts: { file: string }): PluginStore {
  const queue = createSerializedTransactionQueue();

  function read(): PluginStoreFile {
    if (!existsSync(opts.file)) return { version: 1, plugins: [] };
    try {
      const parsed = JSON.parse(readFileSync(opts.file, 'utf8')) as PluginStoreFile;
      if (parsed?.version !== 1 || !Array.isArray(parsed.plugins)) return { version: 1, plugins: [] };
      return parsed;
    } catch {
      return { version: 1, plugins: [] };
    }
  }

  function write(file: PluginStoreFile): void {
    mkdirSync(dirname(opts.file), { recursive: true });
    atomicDurableWrite(opts.file, Buffer.from(`${JSON.stringify(file, null, 2)}\n`, 'utf8'));
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
        const file = read();
        const next = file.plugins.filter((item) => item.id !== row.id);
        next.push(row);
        next.sort((a, b) => a.id.localeCompare(b.id));
        write({ version: 1, plugins: next });
        return row;
      });
    },
    remove(id) {
      return queue.run(async () => {
        const file = read();
        const existing = file.plugins.find((row) => row.id === id);
        write({ version: 1, plugins: file.plugins.filter((row) => row.id !== id) });
        return existing;
      });
    }
  };
}

export function pluginStorePath(dataDir: string): string {
  return join(dataDir, 'plugins', 'installed.json');
}
