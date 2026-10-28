import { useRef, useState } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { product } from '../../lib/product-client.js';
import type { HubRow } from './installed-plugins.js';
import { installedRuntimeStatus } from './installed-row-status.js';

export function PluginAttention({ rows, issuesOnly, onReview }: {
  rows: HubRow[];
  issuesOnly: boolean;
  onReview: () => void;
}) {
  const count = rows.filter((row) => installedRuntimeStatus(row) !== null).length;
  const degraded = rows.flatMap((row) => row.plugin?.enabled && row.plugin.status === 'degraded' ? [row.plugin] : []);
  const busy = useRef(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [result, setResult] = useState<{ message: string; failures: string[] } | null>(null);

  const reload = async () => {
    if (busy.current || degraded.length === 0) return;
    busy.current = true;
    setResult(null);
    const failures: string[] = [];
    const accepted = new Set<string>();
    for (const [index, plugin] of degraded.entries()) {
      setProgress({ current: index + 1, total: degraded.length });
      try {
        const response = await product.pluginApps.reload(plugin.id);
        if (!response.ok) throw new Error(response.message ?? 'Reload failed');
        accepted.add(plugin.id);
      } catch (error) {
        failures.push(`${plugin.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // A reload acknowledgement alone does not prove that the runtime recovered.
    let reloaded = 0;
    try {
      const latest = await product.pluginApps.list();
      for (const plugin of degraded.filter((item) => accepted.has(item.id))) {
        const current = latest.find((item) => item.id === plugin.id);
        if (current?.status === 'running') reloaded++;
        else failures.push(`${plugin.name}: ${current?.statusDetail || (current?.status === 'needs-configuration' ? 'Needs setup' : 'Plugin is not running')}`);
      }
      setResult({ message: `${reloaded} plugin${reloaded === 1 ? '' : 's'} reloaded${failures.length ? `; ${failures.length} ${failures.length === 1 ? 'needs' : 'need'} attention` : ''}.`, failures });
    } catch (error) {
      setResult({ message: `Reload attempts finished. Could not verify plugin status: ${error instanceof Error ? error.message : String(error)}`, failures });
    } finally {
      busy.current = false;
      setProgress(null);
    }
  };

  return <>
    {count > 0 || progress ? <div className="ext-plugin-attention">
      <AlertTriangle size={19} aria-hidden="true" />
      <div><strong>{count} {count === 1 ? 'plugin needs' : 'plugins need'} attention</strong>
        <p>Review runtime issues and configuration requests.</p></div>
      {degraded.length > 0 || progress ? <button type="button" className="settings-btn" disabled={progress !== null}
        onClick={() => void reload()}>
        <RotateCw size={13} aria-hidden="true" className={progress ? 'ext-spin' : undefined} />
        {progress ? `Reloading ${progress.current} of ${progress.total}…` : `Reload degraded plugins (${degraded.length})`}
      </button> : null}
      {count > 0 ? <button type="button" className="settings-btn" aria-pressed={issuesOnly} onClick={onReview}>
        {issuesOnly ? 'Show all' : `Review ${count}`}
      </button> : null}
    </div> : null}
    <div role={progress || result ? 'status' : undefined} aria-label="Plugin reload status" aria-live="polite" aria-atomic="true">
      {progress ? <p className="settings-help">Reloading plugin {progress.current} of {progress.total}…</p> : null}
      {result ? <div className="ext-plugin-reload-result">
        <p>{result.message}</p>
        {result.failures.length > 0 ? <ul>{result.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul> : null}
      </div> : null}
    </div>
  </>;
}
