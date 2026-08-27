import { product } from './product-client.js';
import { hasDesktopBridge } from './app-surface.js';

export const COMPOSER_COMMANDS_RELOAD_EVENT = 'zcc:reload-composer-commands';

export function requestComposerCommandsReload(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(COMPOSER_COMMANDS_RELOAD_EVENT));
}

export async function reloadComposerCommandCatalog(): Promise<{ ok: boolean; message: string }> {
  if (hasDesktopBridge()) {
    try {
      const res = await product.extensions.redeployCapabilities();
      requestComposerCommandsReload();
      if (!res.ok) return { ok: false, message: res.message ?? 'Reload failed' };
      const okCount = res.value.skills.filter((row) => row.ok).length;
      return {
        ok: true,
        message: `Reloaded ${okCount}/${res.value.skills.length} skills · synced MCP for ${res.value.mcpProjects} project${res.value.mcpProjects === 1 ? '' : 's'}`
      };
    } catch (error) {
      requestComposerCommandsReload();
      return { ok: false, message: error instanceof Error ? error.message : 'Reload failed' };
    }
  }
  requestComposerCommandsReload();
  return { ok: true, message: 'Refreshed the / menu from installed plugins' };
}
