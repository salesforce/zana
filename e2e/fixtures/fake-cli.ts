import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Whether the platform can deliver a catchable SIGTERM to a child.
 *
 * On POSIX, `child.kill('SIGTERM')` runs the child's handler, so a fixture can
 * record that the signal arrived and then resist it. On Windows, Node maps every
 * `kill` signal except 0 to TerminateProcess: the process ends at once and no
 * JavaScript handler runs, so "the signal arrived" cannot be observed there.
 */
export function canObserveSigterm(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'win32';
}

/**
 * Writes an executable fake CLI named `name` into `bin` that runs `body` as a
 * Node script, and returns the files written.
 *
 * POSIX keeps the original shape: one extensionless `#!<node>` file, so Linux
 * behaviour is unchanged. Windows cannot execute a shebang file, so it gets a
 * `<name>.mjs` script plus a `<name>.cmd` shim that forwards every argument.
 */
export function writeFakeCli(
  bin: string,
  name: string,
  body: string,
  options: { platform?: NodeJS.Platform; nodePath?: string } = {},
): string[] {
  const platform = options.platform ?? process.platform;
  const nodePath = options.nodePath ?? process.execPath;
  if (platform !== 'win32') {
    const file = join(bin, name);
    writeFileSync(file, `#!${nodePath}\n${body}`, { mode: 0o700 });
    return [file];
  }
  const script = join(bin, `${name}.mjs`);
  const shim = join(bin, `${name}.cmd`);
  writeFileSync(script, body);
  writeFileSync(shim, `@echo off\r\n"${nodePath}" "${script}" %*\r\n`);
  return [script, shim];
}
