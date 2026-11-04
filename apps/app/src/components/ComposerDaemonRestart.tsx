import { useRef, useState } from 'react';
import { Loader2, RotateCw } from 'lucide-react';
import { product } from '../lib/product-client.js';

/** Uses the same main-authorized recovery path as Settings → Development. */
export function ComposerDaemonRestart({ reason }: { reason: string }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restarted, setRestarted] = useState(false);

  async function restart() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setRestarted(false);
    try {
      const result = await product.hosts.relaunchLocal();
      if (!result.ok) throw new Error(result.message);
      setRestarted(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <div className="thread-command-host-action">
    <button type="button" className="thread-command-host-action-btn is-cta"
      data-testid="composer-host-action" title={reason} disabled={busy}
      onClick={() => void restart()}>
      {busy ? <Loader2 size={12} className="thread-command-send-spin" aria-hidden="true" />
        : <RotateCw size={12} aria-hidden="true" />}
      {busy ? 'Restarting…' : 'Restart host daemon'}
    </button>
    {error && <span className="thread-command-error" role="alert">{error}</span>}
    {restarted && <span role="status">Host daemon restarted. Waiting for connection…</span>}
  </div>;
}
