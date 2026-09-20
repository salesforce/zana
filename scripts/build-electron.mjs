import { join } from 'node:path';
import { buildElectron, REPO_ROOT, withBuildLock } from './electron-build-workspace.mjs';

process.exitCode = await withBuildLock(REPO_ROOT, () => buildElectron(REPO_ROOT, join(REPO_ROOT, 'out')));
