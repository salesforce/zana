import { lstat, opendir, realpath } from 'node:fs/promises';
import { within, windowText } from '../native-conversation-index.js';

export async function nativePath(root: string, path: string): Promise<string> {
  const base = await realpath(root);
  const canonical = await realpath(path);
  if (!within(base, canonical) || (await lstat(path)).isSymbolicLink()) throw new Error('Native history path escaped its store');
  return canonical;
}

export async function nativeJson(root: string, path: string): Promise<Record<string, any>> {
  const read = await windowText(await nativePath(root, path), 256 * 1024);
  if (read.size > 256 * 1024) throw new Error('Native metadata is too large');
  const value = JSON.parse(read.text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native metadata');
  return value;
}

export async function nativeDirectories(root: string, path: string, signal: AbortSignal, limit = 10_000): Promise<string[]> {
  let directory;
  try { directory = await opendir(await nativePath(root, path)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const names: string[] = [];
  let visited = 0;
  for await (const item of directory) {
    if (signal.aborted || ++visited > limit) break;
    if (item.isDirectory()) names.push(item.name);
  }
  return names;
}
