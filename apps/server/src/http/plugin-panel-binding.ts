import type { JsonObject } from '@zana-ai/zcc-domain/thread-runtime';
import type { PluginService } from '../plugins/plugin-service.js';
import { ThreadCreateError } from './thread-create.js';

const PANEL_MAX_CHARS = 256;

export interface PluginPanelBinding {
  originPluginId: string;
  pluginMetadata: JsonObject;
}

/**
 * A thread started from a plugin page's side-panel Agent tab. The renderer only
 * names the plugin and panel; main checks the plugin is running and writes the
 * metadata itself, so a caller cannot forge another plugin's namespace values.
 */
export function resolvePluginPanelBinding(
  body: Record<string, unknown>,
  plugins: Pick<PluginService, 'status'> | undefined
): PluginPanelBinding | undefined {
  const raw = body.pluginPanel;
  if (raw === undefined) return undefined;
  if (body.originPluginId !== undefined || body.pluginMetadata !== undefined || body.origin !== undefined) {
    throw new ThreadCreateError(400, 'invalid-input', 'pluginPanel cannot be combined with origin or pluginMetadata');
  }
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const pluginId = typeof rec?.pluginId === 'string' ? rec.pluginId.trim() : '';
  const panel = typeof rec?.panel === 'string' ? rec.panel.trim() : '';
  if (!pluginId || pluginId === 'sdk' || !panel || panel.length > PANEL_MAX_CHARS) {
    throw new ThreadCreateError(400, 'invalid-input', 'pluginPanel needs a pluginId and panel');
  }
  if (plugins?.status(pluginId) !== 'running') {
    throw new ThreadCreateError(409, 'plugin-unavailable', `plugin ${pluginId} is not running`);
  }
  return { originPluginId: pluginId, pluginMetadata: { panelAgent: { panel } } };
}
