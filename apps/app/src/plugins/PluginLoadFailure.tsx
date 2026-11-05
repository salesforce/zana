import { useRef, useState } from 'react';
import { reloadPluginApp } from './plugin-app-loader.js';
import './plugin-load-failure.css';

/** Core-owned recovery UI: it must work even when the plugin cannot import. */
export function PluginLoadFailure({ pluginId, name = pluginId, detail }: {
  pluginId: string;
  name?: string;
  detail: string;
}) {
  const busy = useRef(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = async () => {
    if (busy.current) return;
    busy.current = true;
    setReloading(true);
    setError(null);
    try {
      await reloadPluginApp(pluginId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      busy.current = false;
      setReloading(false);
    }
  };

  return <section className="plugin-load-failure" aria-label={`${name} load failure`}>
    <h2>{name} couldn’t load</h2>
    <p>The plugin’s interface could not be opened. After fixing the source or dependencies, reload to try again.</p>
    <details><summary>Technical details</summary><pre>{detail}</pre></details>
    <button type="button" className="settings-btn" disabled={reloading} onClick={() => void reload()}>
      {reloading ? 'Reloading…' : 'Reload plugin'}
    </button>
    <div role="status" aria-live="polite">{error ? <p className="modal-error">{error}</p> : null}</div>
  </section>;
}
