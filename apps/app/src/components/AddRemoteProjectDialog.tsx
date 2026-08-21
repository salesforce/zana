import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import type { SshHostEntry } from '@zana-ai/zcc-domain/product';

interface AddRemoteProjectDialogProps {
  onClose: () => void;
  onSubmit: (input: {
    host: string;
    user?: string;
    remotePath?: string;
    proxyJump?: string;
    name?: string;
  }) => Promise<void> | void;
}

/**
 * Modal that lists SSH hosts from `~/.ssh/config` and lets the user pick
 * one to register as a remote-backed Project. No mutation of the user's
 * ssh config — read-only list.
 */
export function AddRemoteProjectDialog({ onClose, onSubmit }: AddRemoteProjectDialogProps) {
  const [hosts, setHosts] = useState<SshHostEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Non-fatal note when a refresh could not update the config but existing hosts
  // are still shown. Distinct from `error`.
  const [warning, setWarning] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [user, setUser] = useState('');
  // Start path is left BLANK by default so an unedited submit sends no
  // `remotePath` and the start-path precedence chain applies as designed:
  // per-project `remotePath` → global `AppConfig.remoteDefaultPath` (Settings)
  // → remote `$HOME`. A hardcoded default here would silently override the
  // global Settings value for every newly added remote.
  const [remotePath, setRemotePath] = useState('');
  // Bastion / jump host. Prefilled from the picked host's `ProxyJump` line when
  // ~/.ssh/config carries one; usually left as-is (ssh applies its own config
  // jump transparently), but set/overridden here when the config doesn't and
  // the reverse tunnel needs `-J` to reach the final host.
  const [proxyJump, setProxyJump] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  // Bumped on each reload; lets an in-flight load ignore its result if a newer
  // load (or unmount) supersedes it.
  const loadSeq = useRef(0);

  // `sync=true` asks an optional host provider to refresh before parsing; the
  // on-mount load just reads the existing configuration.
  const loadHosts = useCallback((sync: boolean) => {
    // Guard against a stale preload (when a dev session was running before
    // the ssh binding existed). Surfacing a friendly message beats crashing.
    if (!window.cc?.ssh?.listHosts) {
      setError('SSH binding not loaded — quit (⌘Q) and relaunch the app.');
      setHosts([]);
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    setWarning(null);
    // syncHosts returns { hosts, warning? }; listHosts returns a bare array.
    // Normalize both to the same shape.
    const op =
      sync && window.cc.ssh.syncHosts
        ? window.cc.ssh.syncHosts()
        : window.cc.ssh.listHosts().then((hosts) => ({ hosts, warning: undefined }));
    op
      .then(({ hosts, warning }) => {
        if (seq !== loadSeq.current) return;
        setHosts(hosts);
        setWarning(warning ?? null);
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
      // Invalidate any in-flight load on unmount.
      loadSeq.current++;
    };
  }, [loadHosts]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!hosts) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter(
      (h) =>
        h.alias.toLowerCase().includes(q) ||
        (h.hostname ?? '').toLowerCase().includes(q) ||
        (h.user ?? '').toLowerCase().includes(q)
    );
  }, [hosts, filter]);

  const pickHost = (alias: string) => {
    setPicked(alias);
    if (!name.trim()) setName(alias);
    // Prefill the bastion field from the host's ~/.ssh/config ProxyJump, if any,
    // so a config-managed jump is visible (and editable) rather than hidden.
    const entry = hosts?.find((h) => h.alias === alias);
    setProxyJump(entry?.proxyJump ?? '');
  };

  const canSubmit = picked !== null && !submitting;

  const submit = async () => {
    if (!picked) return;
    setSubmitting(true);
    try {
      await onSubmit({
        host: picked,
        user: user.trim() || undefined,
        remotePath: remotePath.trim() || undefined,
        proxyJump: proxyJump.trim() || undefined,
        name: name.trim() || undefined
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal remote-project-modal" role="dialog" aria-modal="true" aria-label="Add remote project">
        <div className="modal-header">
          <h3>Add remote project</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="list-filter">
            <Search size={12} className="list-filter-icon" />
            <input
              placeholder="Filter hosts"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
          </div>

            <div className="remote-host-hint-row">
              <div className="modal-hint">
               Showing hosts from <code>~/.ssh/config</code>.
              </div>
            <button
              type="button"
              className="remote-host-refresh"
              onClick={() => loadHosts(true)}
              disabled={loading}
               title="Refresh SSH hosts from the configured provider"
               aria-label="Refresh SSH hosts"
            >
              <RefreshCw size={12} className={loading ? 'spinning' : undefined} />
              <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
            </button>
          </div>

          <div className="remote-host-list">
            {hosts === null && <div className="list-empty">Loading hosts…</div>}
            {hosts !== null && filtered.length === 0 && (
              <div className="list-empty">
                 {hosts.length === 0
                   ? 'No SSH hosts found in ~/.ssh/config.'
                  : `No hosts match “${filter}”.`}
              </div>
            )}
            {filtered.map((h) => (
              <button
                key={h.alias}
                type="button"
                className={`remote-host-row ${picked === h.alias ? 'active' : ''}`}
                onClick={() => pickHost(h.alias)}
              >
                <span className="remote-host-alias">{h.alias}</span>
                {h.hostname && <span className="remote-host-target">{h.hostname}</span>}
                {h.user && <span className="remote-host-user">@{h.user}</span>}
              </button>
            ))}
          </div>

          {error && <div className="modal-error">{error}</div>}
          {!error && warning && <div className="modal-warning">{warning}</div>}

          <div className="remote-form">
            <label className="remote-form-row">
              <span>Project name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={picked ?? 'pick a host first'}
                disabled={!picked}
              />
            </label>
            <label className="remote-form-row">
              <span>User (optional)</span>
              <input
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="defaults to ~/.ssh/config"
                disabled={!picked}
              />
            </label>
            <label className="remote-form-row">
              <span>Start path (optional)</span>
              <input
                value={remotePath}
                onChange={(e) => setRemotePath(e.target.value)}
                placeholder="defaults to Settings remote path, else remote $HOME"
                disabled={!picked}
              />
            </label>
            <label className="remote-form-row">
              <span>Jump host (optional)</span>
              <input
                value={proxyJump}
                onChange={(e) => setProxyJump(e.target.value)}
                placeholder="bastion for double-hop SSH, e.g. user@bastion"
                disabled={!picked}
              />
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!canSubmit} onClick={submit}>
            {submitting ? 'Adding…' : 'Add project'}
          </button>
        </div>
      </div>
    </div>
  );
}
