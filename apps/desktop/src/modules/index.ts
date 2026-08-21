/**
 * Main-process module registry — lists each module's main module. Core's boot
 * runs `setupAll` over this array and the IPC layer dispatches `modules:call`
 * against it. Add a compiled-in main module = one line.
 *
 * First-party disk plugins live under `plugins/` and load at runtime through
 * discovery → consent → the plugin host. They must not appear here.
 */
import type { MainModule } from '@zana-ai/zcc-extension-sdk/main';

export const MAIN_MODULES: MainModule[] = [];
