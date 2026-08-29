import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isPluginId } from '@zana-ai/zcc-domain';
import { atomicDurableWrite, createSerializedTransactionQueue } from '../durable-store.js';

interface UninstalledFile {
  version: 1;
  ids: string[];
}

export function pluginUninstalledPath(dataDir: string): string {
  return join(dataDir, 'plugins', 'uninstalled.json');
}

export function createPluginUninstalledStore(opts: { file: string }): {
  has(id: string): boolean;
  add(id: string): Promise<void>;
  forget(id: string): Promise<void>;
} {
  const queue = createSerializedTransactionQueue();

  function read(): UninstalledFile {
    if (!existsSync(opts.file)) return { version: 1, ids: [] };
    try {
      const parsed = JSON.parse(readFileSync(opts.file, 'utf8')) as UninstalledFile;
      if (parsed?.version !== 1 || !Array.isArray(parsed.ids)) return { version: 1, ids: [] };
      return { version: 1, ids: parsed.ids.filter((id) => typeof id === 'string' && isPluginId(id)) };
    } catch {
      return { version: 1, ids: [] };
    }
  }

  function write(file: UninstalledFile): void {
    mkdirSync(dirname(opts.file), { recursive: true });
    atomicDurableWrite(opts.file, Buffer.from(`${JSON.stringify(file, null, 2)}\n`, 'utf8'));
  }

  return {
    has(id) {
      return read().ids.includes(id);
    },
    add(id) {
      if (!isPluginId(id)) return Promise.resolve();
      return queue.run(async () => {
        const file = read();
        if (file.ids.includes(id)) return;
        write({ version: 1, ids: [...file.ids, id].sort() });
      });
    },
    forget(id) {
      return queue.run(async () => {
        const file = read();
        write({ version: 1, ids: file.ids.filter((item) => item !== id) });
      });
    }
  };
}
