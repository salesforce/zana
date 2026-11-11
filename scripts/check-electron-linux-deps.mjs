import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

// Hosted Linux runners already carry Electron's native libraries and Xvfb.
// Check the installed binary rather than downloading unrelated browser fonts.
export function checkElectronLinuxDeps({
  platform = process.platform,
  electronPath = () => require('electron'),
  execute = spawnSync,
  log = console.log,
  error = console.error,
} = {}) {
  try {
    if (platform !== 'linux') throw new Error('Electron dependency check requires Linux');
    const binary = electronPath();
    if (typeof binary !== 'string' || !binary.trim()) throw new Error('Electron executable path is missing');
    const run = (command, args) => {
      const result = execute(command, args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024 });
      if (result.error || result.status !== 0) {
        throw new Error(`${command} failed: ${result.error?.message || result.stderr?.trim() || `exit ${result.status}`}`);
      }
      return result.stdout || '';
    };
    run('xvfb-run', ['--help']);
    const libraries = run('ldd', [binary]);
    if (!libraries.trim()) throw new Error('ldd returned no Electron library information');
    if (/\bnot found\b/.test(libraries)) throw new Error(`Electron libraries are missing:\n${libraries.trim()}`);
    log('Verified Xvfb and Electron shared libraries; real app tests remain required.');
    return 0;
  } catch (cause) {
    error(`Linux Electron dependency check failed: ${cause.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = checkElectronLinuxDeps();
}
