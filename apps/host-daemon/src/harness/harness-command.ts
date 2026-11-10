/**
 * Pure harness command resolution (no registry import), shared by verification,
 * spawn-time resolution and the Codex hook-trust identity check.
 */

import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { augmentPath, augmentPathWithNodePrefixes, fallbackDirs, nodePrefixBinDirs } from '../env.js';

function isExecutableFile(candidatePath: string): boolean {
  try {
    accessSync(candidatePath, constants.X_OK);
    return statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

function wellKnownHarnessPaths(command: string, home: string): string[] {
  return [
    ...fallbackDirs(home).map((dir) => join(dir, command)),
    ...nodePrefixBinDirs(home).map((dir) => join(dir, command)),
    join(home, `.${command}`, 'local', command)
  ];
}

export interface ResolveHarnessCommandOptions {
  home?: string;
  uid?: number;
}

/**
 * Resolve a basename harness command against PATH, then well-known native
 * install locations. Finder/Dock and the electron-vite sandbox often omit
 * `~/.local/bin`, so `execFile('claude')` returns ENOENT even when the CLI is
 * installed. Absolute overrides that exist and are executable stay as-is; a
 * missing or non-executable override (stale `harnesses.byId.*.binary`) falls
 * back to PATH search by basename so CLI Agents still launch.
 */
export function resolveHarnessCommand(
  command: string,
  pathEnv = process.env.PATH,
  options: ResolveHarnessCommandOptions = {}
): string {
  if (!command) return command;
  const original = command;
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    if (isExecutableFile(command)) return command;
    command = command.replace(/.*[/\\]/, '') || command;
  }
  const names = process.platform === 'win32' && !/\.(exe|cmd|bat|com)$/i.test(command)
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((ext) => command + ext.toLowerCase())
    : [command];
  for (const dir of (pathEnv ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir.replace(/^"|"$/g, ''), name);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  const uid = options.uid ?? process.getuid?.();
  if (uid === 0) return original;
  const home = options.home ?? homedir();
  for (const candidate of names.flatMap((name) => wellKnownHarnessPaths(name, home))) {
    if (isExecutableFile(candidate)) return candidate;
  }
  return original;
}

export function verificationSearchPath(): string {
  return augmentPathWithNodePrefixes(augmentPath(process.env.PATH));
}
