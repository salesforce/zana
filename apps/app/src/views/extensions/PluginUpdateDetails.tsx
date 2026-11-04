import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';

export function pluginUpdateDelivery(plugin: Pick<PluginAppEntry, 'sourceKind' | 'updatePolicy'> | null | undefined) {
  const policy = plugin?.updatePolicy ?? (plugin?.sourceKind === 'builtin' ? 'bundled' : plugin?.sourceKind === 'path' ? 'local' : 'independent');
  return policy === 'bundled' ? 'Updates with Zana releases' : policy === 'local' ? 'Local development'
    : policy === 'migration-required' ? 'Migration required before updating' : 'Automatic checks; manual updates';
}

export function PluginUpdateDetails({ plugin }: { plugin: PluginAppEntry }) {
  const check = plugin.updateCheck;
  if (plugin.sourceKind !== 'git' && plugin.sourceKind !== 'npm') return null;
  if (plugin.updatePolicy === 'migration-required') return <section className="ext-plugin-section" data-testid="plugin-update-status">
    <h3>Updates</h3><p>Independent updates are blocked. Follow the migration guidance above.</p>
  </section>;
  return <section className="ext-plugin-section" data-testid="plugin-update-status">
    <h3>Updates</h3>
    <p>{!check ? 'This source has not been checked yet.' : check.outcome === 'available'
      ? `Version ${plugin.availableVersion} is available. Updates are applied manually.`
      : check.outcome === 'current' ? 'The installed release is current for its recorded source.'
      : check.outcome === 'pinned' ? 'This installation is pinned.'
      : check.outcome === 'incompatible' ? 'Newer releases require a different Zana or plugin SDK version.'
      : 'The source could not be checked. The installed plugin remains available.'}</p>
    {check ? <p className="settings-help">Last checked: {new Date(check.checkedAt).toLocaleString()}</p> : null}
    {check?.detail ? <p className="settings-help">{check.detail}</p> : null}
    {check?.blocked ? <p className="settings-help">Release {check.blocked.version}: {check.blocked.reasons.join('; ')}</p> : null}
  </section>;
}
