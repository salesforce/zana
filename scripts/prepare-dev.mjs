import { REPO_ROOT, runCommand, withBuildLock } from './electron-build-workspace.mjs';

process.exitCode = await withBuildLock(REPO_ROOT, () => runCommand('pnpm', ['run', 'dev:prepare'], {
  cwd: REPO_ROOT,
  shell: process.platform === 'win32'
}));
