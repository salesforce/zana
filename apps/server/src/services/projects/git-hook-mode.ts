import { closeSync, openSync, readSync } from 'node:fs';

/** Mirrors Git's Windows script detection; NTFS does not supply Unix executable bits. */
export function isExecutableGitHook(path: string, mode: number, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return (mode & 0o111) !== 0;
  if (/\.exe$/iu.test(path)) return true;
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const prefix = Buffer.alloc(2);
    return readSync(fd, prefix, 0, 2, 0) === 2 && prefix.toString() === '#!';
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
