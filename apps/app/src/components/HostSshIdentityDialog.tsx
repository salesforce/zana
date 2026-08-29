import { product } from '../lib/product-client.js';
import { hasDesktopBridge } from '../lib/app-surface.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import type { SshHostEntry } from '@zana-ai/zcc-domain/product';
import { StencilList } from './ui/Skeleton.js';

export function HostSshIdentityDialog({
  hostName,
  onClose,
  onSubmit
}: {
  hostName: string;
  onClose: () => void;
  onSubmit: (input: { host: string; user?: string; proxyJump?: string }) => Promise<void>;
}) {
  const [hosts, setHosts] = useState<SshHostEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [user, setUser] = useState('');
  const [proxyJump, setProxyJump] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadSeq = useRef(0);

  const loadHosts = useCallback((sync: boolean) => {
    if (!hasDesktopBridge()) {
      setError('SSH binding not loaded — quit (⌘Q) and relaunch the app.');
      setHosts([]);
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    setWarning(null);
    const op =
      sync && product.ssh.syncHosts
        ? product.ssh.syncHosts()
        : product.ssh.listHosts().then((rows) => ({ hosts: rows, warning: undefined }));
    op
      .then(({ hosts: rows, warning: nextWarning }) => {
        if (seq !== loadSeq.current) return;
        setHosts(rows);
        setWarning(nextWarning ?? null);
      })
      .catch((err) => {
        if (seq !== loadSeq.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load ssh config');
        setHosts([]);
      })
      .finally(() => {
        if (seq !== loadSeq.current) return;
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadHosts(false);
    return () => {
      loadSeq.current += 1;
    };
  }, [loadHosts]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const rows = hosts ?? [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      `${row.alias} ${row.hostname ?? ''} ${row.user ?? ''}`.toLowerCase().includes(needle)
    );
  }, [filter, hosts]);

  function pickHost(alias: string) {
    const row = hosts?.find((entry) => entry.alias === alias);
    setPicked(alias);
    setUser(row?.user ?? '');
    setProxyJump(row?.proxyJump ?? '');
    setError(null);
  }

  const canSubmit = Boolean(picked) && !submitting;

  async function submit() {
    if (!picked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        host: picked,
        ...(user.trim() ? { user: user.trim() } : {}),
        ...(proxyJump.trim() ? { proxyJump: proxyJump.trim() } : {})
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save SSH host');
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal remote-project-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Pick SSH host for ${hostName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Reconnect {hostName}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={submitting}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-hint">
            Pick the SSH host for this machine from <code>~/.ssh/config</code>.
          </div>
          <div className="list-filter">
            <Search size={12} className="list-filter-icon" />
            <input
              placeholder="Filter hosts"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              autoFocus
            />
          </div>
          <div className="remote-host-hint-row">
            <div className="modal-hint">Showing hosts from <code>~/.ssh/config</code>.</div>
            <button
              type="button"
              className="remote-host-refresh"
              onClick={() => loadHosts(true)}
              disabled={loading}
              title="Refresh SSH hosts"
              aria-label="Refresh SSH hosts"
            >
              <RefreshCw size={12} className={loading ? 'spinning' : undefined} />
              <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
            </button>
          </div>
          <div className="remote-host-list">
            {hosts === null && <StencilList label="Loading hosts" className="list-empty" />}
            {hosts !== null && filtered.length === 0 && (
              <div className="list-empty">
                {hosts.length === 0
                  ? 'No SSH hosts found in ~/.ssh/config.'
                  : `No hosts match “${filter}”.`}
              </div>
            )}
            {filtered.map((row) => (
              <button
                key={row.alias}
                type="button"
                className={`remote-host-row ${picked === row.alias ? 'active' : ''}`}
                onClick={() => pickHost(row.alias)}
              >
                <span className="remote-host-alias">{row.alias}</span>
                {row.hostname && <span className="remote-host-target">{row.hostname}</span>}
                {row.user && <span className="remote-host-user">@{row.user}</span>}
              </button>
            ))}
          </div>
          {error && <div className="modal-error">{error}</div>}
          {!error && warning && <div className="modal-warning">{warning}</div>}
          <div className="remote-form">
            <label className="remote-form-row">
              <span>User (optional)</span>
              <input
                value={user}
                onChange={(event) => setUser(event.target.value)}
                placeholder="defaults to ~/.ssh/config"
                disabled={!picked}
              />
            </label>
            <label className="remote-form-row">
              <span>Jump host (optional)</span>
              <input
                value={proxyJump}
                onChange={(event) => setProxyJump(event.target.value)}
                placeholder="bastion for double-hop SSH"
                disabled={!picked}
              />
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn primary" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? 'Saving…' : 'Use this host'}
          </button>
        </div>
      </div>
    </div>
  );
}
