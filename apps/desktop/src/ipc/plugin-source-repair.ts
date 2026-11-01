import { BrowserWindow, dialog } from 'electron';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';
import { isWithin } from '@zana-ai/zcc-path-confine';
import type { Result } from '@zana-ai/zcc-domain/product';
import type { RuntimeSupervisor } from '../runtime/runtime-supervisor.js';

/** Main owns the picker and confines its canonical result before granting access. */
export async function repairPluginSource(
  supervisor: RuntimeSupervisor | null | undefined,
  id: unknown,
  action: unknown,
  window: BrowserWindow | null
): Promise<Result<true>> {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(id) || (action !== 'locate' && action !== 'official')) {
    return { ok: false, code: 'BAD_REQUEST', message: 'Invalid plugin recovery request' };
  }
  if (!supervisor) return { ok: false, code: 'UNAVAILABLE', message: 'Plugin recovery requires the desktop runtime' };
  try {
    const plugin = (await supervisor.listPluginApps()).find(plugin => plugin.id === id);
    const choices = plugin?.sourceRecovery;
    if (!choices || (action === 'locate' ? !choices.canLocate : !choices.canSwitchOfficial)) {
      return { ok: false, code: 'UNAVAILABLE', message: 'Plugin source recovery is no longer available; refresh Plugins' };
    }
    let path: string | undefined;
    if (action === 'locate') {
      if (!window) return { ok: false, code: 'NO_WINDOW', message: 'No window to host the picker' };
      const picked = await dialog.showOpenDialog(window, { title: 'Locate moved plugin', properties: ['openDirectory'] });
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, code: 'CANCELED', message: 'Location selection canceled' };
      path = realpathSync(picked.filePaths[0]);
      const { store } = await import('@zana-ai/zcc-server/services/projects/store');
      const roots = [homedir(), store.getConfig().cloneRoot, ...store.listProjects().filter(project => !project.remote).map(project => project.path)];
      const allowed = roots.some(root => {
        if (!root || !isAbsolute(root)) return false;
        try { return isWithin(path!, realpathSync(root)); } catch { return false; }
      });
      if (!allowed) return { ok: false, code: 'BAD_SOURCE', message: 'Choose a plugin inside your home folder, clone folder or a registered local project' };
    }
    await supervisor.repairPlugin(id, path);
    return { ok: true, value: true };
  } catch (error) {
    return { ok: false, code: 'REPAIR_FAILED', message: error instanceof Error ? error.message : String(error) };
  }
}
