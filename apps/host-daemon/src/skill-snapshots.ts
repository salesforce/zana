import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { AgentRuntimeSkillRoot } from '@zana-ai/zcc-agent-runtime';
import { expandDirectoryRootsToRuntimeSkillRoots, readInjectedSkillDirectoryRoots, readBuiltinSkillTargets } from './injected-skill-roots.js';
import { discoverNativeSkillRoots } from './native-skill-discovery.js';

export const SKILL_SNAPSHOT_MAX_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 10_000;
const MAX_SNAPSHOTS = 32;
type CapturedFile = { path: string; content: Buffer; mode: number };

/** Immutable, content-addressed catalogs, retained until their owning runtime shuts down. */
export function createSkillSnapshotStore(dataDir: string) {
  const parent = join(dataDir, 'runtime-skill-snapshots');
  const root = join(parent, `${process.pid}-${randomUUID()}`);
  const retained = new Map<object, Set<string>>();
  const catalogs = new Map<string, AgentRuntimeSkillRoot[]>();
  let serial: Promise<unknown> = Promise.resolve();
  let initialized = false;
  let disposed = false;
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = serial.then(fn);
    serial = result.catch(() => undefined);
    return result;
  }
  async function prune() {
    const active = new Set([...retained.values()].flatMap(ids => [...ids]));
    for (const id of catalogs.keys()) {
      if (active.has(id)) continue;
      await rm(join(root, id), { recursive: true, force: true });
      catalogs.delete(id);
    }
  }
  return {
    capture(owner: object): Promise<AgentRuntimeSkillRoot[]> {
      return exclusive(async () => {
        if (disposed) throw new Error('Skill snapshot store is closed');
        if (!initialized) {
          await mkdir(root, { recursive: true, mode: 0o700 });
          // A daemon crash leaves immutable files behind. Never touch a live daemon's catalog.
          for (const entry of await readdir(parent, { withFileTypes: true })) {
            const match = /^(\d+)-[a-f0-9-]{36}$/.exec(entry.name);
            if (!entry.isDirectory() || !match || join(parent, entry.name) === root) continue;
            try { process.kill(Number(match[1]), 0); }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ESRCH') await rm(join(parent, entry.name), { recursive: true, force: true });
            }
          }
          initialized = true;
        }
        const sources = readInjectedSkillDirectoryRoots(dataDir);
        const builtinTargets = readBuiltinSkillTargets(dataDir);
        if (sources.length > 64) throw new Error('Too many injected skill roots');
        const files: CapturedFile[] = [];
        let bytes = 0;
        let entries = 0;
        const hash = createHash('sha256').update(JSON.stringify(sources));
        for (const [index, source] of sources.entries()) {
          const base = await realpath(source);
          const walk = async (dir: string, prefix: string, depth: number, anchor = base): Promise<void> => {
            if (depth > 16) throw new Error('Skill snapshot directory nesting exceeds the limit');
            const children = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
            for (const entry of children) {
              if (++entries > MAX_FILES) throw new Error('Skill snapshot has too many files');
              const path = await realpath(join(dir, entry.name));
              const dest = join(prefix, entry.name);
              if (depth === 0 && entry.isSymbolicLink() && builtinTargets.has(path)) {
                await walk(path, dest, depth + 1, path);
                continue;
              }
              const within = relative(anchor, path);
              if (within === '..' || within.startsWith(`..${sep}`)) throw new Error('Skill snapshot symlink escapes its root');
              if (entry.isDirectory()) { await walk(path, dest, depth + 1, anchor); continue; }
              const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
              try {
                const stat = await handle.stat();
                if (!stat.isFile()) throw new Error('Skill snapshot contains a non-file entry');
                if (bytes + stat.size > SKILL_SNAPSHOT_MAX_BYTES) throw new Error('Skill snapshot exceeds 64 MiB');
                const buffer = Buffer.allocUnsafe(stat.size + 1);
                let size = 0;
                while (size < buffer.length) {
                  const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
                  if (!bytesRead) break;
                  size += bytesRead;
                }
                if (size > stat.size) throw new Error('Skill file changed while taking snapshot');
                const content = buffer.subarray(0, size);
                bytes += content.length;
                if (bytes > SKILL_SNAPSHOT_MAX_BYTES) throw new Error('Skill snapshot exceeds 64 MiB');
                const mode = stat.mode & 0o100 ? 0o700 : 0o600;
                hash.update(JSON.stringify([dest, mode, content.length])).update(content);
                files.push({ path: dest, content, mode });
              } finally { await handle.close(); }
            }
          };
          await walk(base, String(index), 0);
        }
        const id = hash.digest('hex');
        let roots = catalogs.get(id);
        if (!roots) {
          await prune();
          if (catalogs.size >= MAX_SNAPSHOTS) throw new Error('Too many skill revisions are in use; stop old threads before updating again');
          const temporary = join(root, `.tmp-${randomUUID()}`);
          try {
            await mkdir(temporary, { mode: 0o700 });
            for (const [index] of sources.entries()) await mkdir(join(temporary, String(index)), { mode: 0o700 });
            for (const file of files) {
              const target = join(temporary, file.path);
              await mkdir(join(target, '..'), { recursive: true, mode: 0o700 });
              const handle = await open(target, 'wx', file.mode);
              try { await handle.writeFile(file.content); } finally { await handle.close(); }
            }
            await rename(temporary, join(root, id));
          } finally { await rm(temporary, { recursive: true, force: true }); }
          roots = expandDirectoryRootsToRuntimeSkillRoots(sources.map((_, index) => join(root, id, String(index))));
          catalogs.set(id, roots);
        }
        const owned = retained.get(owner) ?? new Set<string>();
        owned.add(id);
        retained.set(owner, owned);
        return [...roots, ...discoverNativeSkillRoots()];
      });
    },
    release(owner: object): Promise<void> {
      return exclusive(async () => { retained.delete(owner); await prune(); });
    },
    dispose(): Promise<void> {
      return exclusive(async () => {
        disposed = true;
        retained.clear();
        catalogs.clear();
        await rm(root, { recursive: true, force: true });
      });
    }
  };
}
