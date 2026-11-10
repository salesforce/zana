import { useState, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { notificationSoundProvider, notificationSoundsEnabled, type AppConfig } from '@zana-ai/zcc-domain/product';
import { CheckboxField, Field, Section } from '../../components/settings/FormFields.js';
import { listNotificationSoundProviders, subscribePluginSlots } from '../../plugins/plugin-slots.js';
import { PluginSlotBoundary } from '../../plugins/PluginSlotBoundary.js';
import { getPluginDetailRoutePath } from '../../lib/route-paths.js';
import { AgentSoundSettings } from './AgentSoundSettings.js';
import { soundProviderKey } from '../../plugins/notification-sounds.js';
import { PopoverPicklist } from '../../components/ui/PopoverPicklist.js';
import './notification-sounds.css';

export function NotificationsSettingsView({ config, onUpdate }: {
  config: AppConfig;
  onUpdate(patch: Partial<AppConfig>): Promise<void>;
}) {
  const providers = useSyncExternalStore(subscribePluginSlots, listNotificationSoundProviders, listNotificationSoundProviders);
  const [params, setParams] = useSearchParams();
  const active = notificationSoundProvider(config);
  const inspecting = params.get('provider') ?? active;
  const provider = providers.find(row => soundProviderKey(row) === inspecting);
  const available = active === 'builtin' || providers.some(row => soundProviderKey(row) === active);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async (patch: Partial<AppConfig>) => {
    setBusy(true); setError('');
    try { await onUpdate(patch); return true; }
    catch { setError('Could not save sound settings. Your previous settings are still in use.'); return false; }
    finally { setBusy(false); }
  };
  const choose = async (key: string) => {
    // A provider change is not permission to start playing sounds.
    if (await save({ notificationSoundProvider: key, notificationSoundsEnabled: false })) setParams({}, { replace: true });
  };
  const Component = provider?.component;
  return <>
    <Section anchorId="agent-sounds" title="Sounds" help="Chimes and your own audio work out of the box. Plugins can add other sound experiences.">
      <CheckboxField label="Play notification sounds" searchId="notifications.sounds-enabled"
        help={available ? 'Off still allows previews. Provider settings and imported sounds are kept.' : 'The selected provider is unavailable. Enable its plugin or choose another provider.'}
        checked={available && notificationSoundsEnabled(config)} disabled={busy || !available}
        onChange={value => void save({ notificationSoundsEnabled: value })} />
      <Field label="Sound provider" searchId="notifications.sound-provider" help="One provider plays at a time. Switching providers turns playback off.">
        <PopoverPicklist ariaLabel="Sound provider" value={active} disabled={busy} searchPlaceholder="Search sound providers…"
          emptyHint="No sound providers match your search." onChange={value => void choose(value)}
          options={[{ value: 'builtin', label: 'Chimes & custom audio', description: 'Built-in chimes and your MP3, WAV, or OGG files' },
            ...providers.map(row => ({ value: soundProviderKey(row), label: row.title, description: row.description })),
            ...(!available ? [{ value: active, label: 'Unavailable provider' }] : [])]} />
      </Field>
      {inspecting !== active && <div className="notification-sound-notice">
        <p>Configuring {provider?.title ?? 'an unavailable provider'}. Your active sound provider has not changed.</p>
        {provider && <button className="btn" disabled={busy} onClick={() => void choose(inspecting)}>Use {provider.title}</button>}
        <button className="btn" onClick={() => setParams({}, { replace: true })}>Back to active provider</button>
      </div>}
      {error && <p role="alert" className="settings-help">{error}</p>}
    </Section>
    {inspecting === 'builtin' ? <><AgentSoundSettings config={config} onUpdate={async patch => {
      // Preserve the master when editing an old profile with implicit chime enablement.
      await save({ ...patch, notificationSoundsEnabled: notificationSoundsEnabled(config) });
    }} />
      <div className="notification-sound-plugins"><div><h3>Want a different sound experience?</h3><p className="settings-help">Optional plugins add themed voices, sound collections, and custom rules.</p></div>
        <Link to="/extensions/plugins/browse">Explore plugins →</Link></div></> : Component && provider ?
      <section className="notification-sound-provider" aria-label={provider.title}>
        <div className="notification-sound-provider-heading"><div><h2>{provider.title}</h2>{provider.description && <p className="settings-help">{provider.description}</p>}</div>
          <Link to={getPluginDetailRoutePath(provider.pluginId, { view: 'installed' })}>Manage plugin</Link></div>
        <PluginSlotBoundary key={`${provider.pluginId}:${provider.id}:${provider.generation}`} pluginId={provider.pluginId} generation={provider.generation}>
          <Component pluginId={provider.pluginId} />
        </PluginSlotBoundary>
      </section> : <p role="status" className="settings-help">This sound provider is not available. Its settings are retained; no other provider will play in its place.</p>}
  </>;
}
