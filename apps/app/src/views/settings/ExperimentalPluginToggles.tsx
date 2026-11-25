import { useState } from 'react';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
import { CheckboxField } from '@/components/settings/FormFields';
import { product } from '@/lib/product-client';
import { useInstalledPlugins } from '@/plugins/installed-plugin-store';
import { reconcilePluginApps } from '@/plugins/plugin-app-loader';
import { useUi } from '@/store';
import { refreshPluginAppsAfterToggle, reportPluginEnabledFailure } from '../extensions/plugin-row-enabled';

function ExperimentalPluginToggle({ plugin }: { plugin: PluginAppEntry }) {
  const [pending, setPending] = useState<boolean | null>(null);

  async function toggle(enabled: boolean) {
    setPending(enabled);
    try {
      const result = await product.pluginApps.setEnabled(plugin.id, enabled);
      if (result.ok) {
        await refreshPluginAppsAfterToggle(() => product.pluginApps.list(), reconcilePluginApps);
      } else {
        reportPluginEnabledFailure(result, useUi.getState().pushToast);
      }
    } catch (error) {
      useUi.getState().pushToast(error instanceof Error ? error.message : 'Failed to update plugin', 'error');
    } finally {
      setPending(null);
    }
  }

  return <CheckboxField searchId={`experimental.plugin.${plugin.id}`} label={plugin.name}
    help={plugin.description} checked={pending ?? plugin.enabled} disabled={pending !== null} onChange={toggle} />;
}

export function ExperimentalPluginToggles() {
  const { plugins } = useInstalledPlugins();
  return <>{plugins.filter(plugin => plugin.experimental).map(plugin =>
    <ExperimentalPluginToggle key={plugin.id} plugin={plugin} />
  )}</>;
}
