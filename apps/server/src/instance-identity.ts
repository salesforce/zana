import { randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Ownership and mode bits are only meaningful on POSIX; Windows keeps the symlink, size, file-type and content checks. */
const posixPermissions = (): boolean => process.platform !== 'win32' && typeof process.getuid === 'function';
const NO_FOLLOW = (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** Stable product identity, independent of a daemon's per-connection instanceId. */
export function readProductInstanceId(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const base = realpathSync(dataDir), root = lstatSync(base);
  if (!root.isDirectory() || posixPermissions() && (root.uid !== process.getuid!() || (root.mode & 0o022) !== 0)) throw new Error('Invalid product instance directory');
  const file = join(base, 'product-instance.json');
  const read = (): string => {
    const handle = openSync(file, constants.O_RDONLY | NO_FOLLOW);
    try {
      const info = fstatSync(handle);
      if (!info.isFile() || info.nlink !== 1 || info.size > 1024 || posixPermissions() && (info.uid !== root.uid || (info.mode & 0o7777) !== 0o600)) throw new Error('Invalid product instance identity');
      const bytes = Buffer.alloc(1025);
      let length = 0;
      while (length < bytes.length) {
        const count = readSync(handle, bytes, length, bytes.length - length, length);
        if (!count) break;
        length += count;
      }
      if (length !== info.size) throw new Error('Invalid product instance identity');
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
      if (!value || typeof value !== 'object' || Object.keys(value).join(',') !== 'id' || !('id' in value) || typeof value.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id)) throw new Error('Invalid product instance identity');
      return value.id;
    } finally { closeSync(handle); }
  };
  try { return read(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  try {
    lstatSync(join(base, 'peer-pairs'));
    throw new Error('Product instance identity missing after peer initialization');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ id: randomUUID() }) + '\n', { flag: 'wx', mode: 0o600 });
    const handle = openSync(temporary, constants.O_RDONLY);
    try { fsyncSync(handle); } finally { closeSync(handle); }
    // Publish a complete file without overwriting another process's winner.
    try { linkSync(temporary, file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  } finally { rmSync(temporary, { force: true }); }
  // Directories cannot be opened or fsynced on Windows; the file itself was already synced.
  if (process.platform !== 'win32') {
    const directory = openSync(base, constants.O_RDONLY);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
  return read();
}
