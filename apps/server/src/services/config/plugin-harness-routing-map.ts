/**
 * The plugin-keyed AI-harness override map both stores keep beside Core's own
 * settings: Global in the app config, Default Project / Project in each
 * project's settings entry. One reader so both accept the same values.
 */
import { PluginHarnessOverrideSchema } from '@zana-ai/zcc-contracts/project-settings';
import type { PluginHarnessOverrideV1 } from '@zana-ai/zcc-domain/product';

export const PLUGIN_HARNESS_ROUTING_KEY = 'pluginHarnessRouting';

export type PluginHarnessRoutingMap = Record<string, PluginHarnessOverrideV1>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The override map stored on `holder`. Entries that fail the save-time schema
 * (hand-edited or partially written) are dropped, so a spawn never trusts them.
 */
export function pluginHarnessRoutingOf(holder: unknown): PluginHarnessRoutingMap {
  const map = isRecord(holder) ? holder[PLUGIN_HARNESS_ROUTING_KEY] : undefined;
  if (!isRecord(map)) return {};
  const valid: PluginHarnessRoutingMap = {};
  for (const [pluginId, value] of Object.entries(map)) {
    const parsed = PluginHarnessOverrideSchema.safeParse(value);
    if (parsed.success) valid[pluginId] = parsed.data as PluginHarnessOverrideV1;
  }
  return valid;
}
