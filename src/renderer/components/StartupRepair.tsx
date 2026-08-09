import { useState } from 'react';
import { AlertTriangle, FolderOpen, RefreshCw } from 'lucide-react';

export function StartupRepair() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const retry = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const state = await window.cc.startup.retry();
      if (state.mode === 'ready') window.location.reload();
      else setMessage('Repair is still required. Review diagnostics before retrying.');
    } catch {
      setMessage('Retry failed. Review diagnostics before retrying.');
    } finally {
      setBusy(false);
    }
  };

  const diagnostics = async () => {
    const result = await window.cc.startup.diagnostics().catch(() => ({ ok: false }));
    if (!result.ok) setMessage('Diagnostics folder could not be opened.');
  };

  return (
    <main className="startup-repair" aria-labelledby="startup-repair-title">
      <section className="startup-repair-card">
        <AlertTriangle className="startup-repair-icon" aria-hidden="true" />
        <p className="startup-repair-eyebrow">Startup paused</p>
        <h1 id="startup-repair-title">Routing settings need repair</h1>
        <p className="startup-repair-copy">
          Command Center stopped before loading projects or agents because routing settings could not be migrated safely.
          Your existing files and a migration backup remain available in diagnostics.
        </p>
        <details className="startup-repair-copy">
          <summary>How to repair routing settings</summary>
          <p>Open diagnostics and keep its migration backup and report. Retry migration after fixing disk permissions or available space. If retry still fails, quit without editing the migration journal and share diagnostics with support.</p>
        </details>
        {message && <p className="startup-repair-status" role="status">{message}</p>}
        <div className="startup-repair-actions">
          <button className="btn primary" type="button" onClick={() => void retry()} disabled={busy}>
            <RefreshCw size={14} className={busy ? 'spin' : undefined} aria-hidden="true" />
            {busy ? 'Retrying...' : 'Retry migration'}
          </button>
          <button className="btn" type="button" onClick={() => void diagnostics()} disabled={busy}>
            <FolderOpen size={14} aria-hidden="true" />
            Open diagnostics
          </button>
          <button className="btn" type="button" onClick={() => void window.cc.startup.quit()} disabled={busy}>
            Quit
          </button>
        </div>
      </section>
    </main>
  );
}

export function StartupError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <main className="startup-repair" aria-labelledby="startup-error-title">
      <section className="startup-repair-card">
        <AlertTriangle className="startup-repair-icon" aria-hidden="true" />
        <p className="startup-repair-eyebrow">Startup failed</p>
        <h1 id="startup-error-title">Command Center could not start</h1>
        <p className="startup-repair-copy">
          Startup state could not be loaded. Retry the check or quit and relaunch Command Center.
        </p>
        <p className="startup-repair-status" role="alert">{error}</p>
        <div className="startup-repair-actions">
          <button className="btn primary" type="button" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
          <button className="btn" type="button" onClick={() => void window.cc.startup.quit()}>
            Quit
          </button>
        </div>
      </section>
    </main>
  );
}
