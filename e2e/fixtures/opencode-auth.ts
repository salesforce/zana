import { cpSync, existsSync, lstatSync, mkdirSync, statSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';

/** Copy native auth/config into the isolated HOME without executing copied plugins. */
export function seedOpenCodeAuthState(home: string, sourceHome = homedir()): boolean {
  let seeded = false;
  for (const parts of [['.config', 'opencode'], ['.local', 'share', 'opencode']]) {
    const source = join(sourceHome, ...parts), destination = join(home, ...parts);
    if (!existsSync(source)) continue;
    try {
      mkdirSync(join(destination, '..'), { recursive: true });
      cpSync(source, destination, {
        recursive: true,
        dereference: true,
        // Exclude plugin trees before descent; copy file links as private bytes.
        filter: (path) => {
          if (['plugin', 'plugins'].includes(relative(source, path).split(sep)[0])) return false;
          if (!lstatSync(path).isSymbolicLink()) return true;
          try { return statSync(path).isFile(); } catch { return false; }
        }
      });
      seeded = true;
    } catch {
      // Optional live tests report unusable or absent native authentication.
    }
  }
  // Match the existing CLI auth fixture: expose only the auth daemon socket.
  const socket = join(sourceHome, '.devbar', 'devbar.sock');
  if (existsSync(socket)) {
    try {
      mkdirSync(join(home, '.devbar'), { recursive: true, mode: 0o700 });
      symlinkSync(socket, join(home, '.devbar', 'devbar.sock'));
    } catch { /* Optional auth helper. Never expose its parent directory. */ }
  }
  return seeded;
}
