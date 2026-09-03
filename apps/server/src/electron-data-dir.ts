import { app } from 'electron';
import { resolveZccDataDir } from '@zana-ai/zcc-host-daemon/host-config';

/**
 * Electron-main data dir: honor `ZCC_DATA_DIR`, else `~/.zcc` under the
 * Electron home (E2E remaps that home via `ZCC_E2E_HOME`). Scratch workspace
 * stays `~/zcc-workspace` — only app state is isolated.
 */
export function electronZccDataDir(): string {
  return resolveZccDataDir(process.env, app.getPath('home'));
}
