import { product } from '../lib/product-client.js';
import { hasDesktopBridge } from '../lib/app-surface.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import type { SshHostEntry } from '@zana-ai/zcc-domain/product';
import { StencilList } from './ui/Skeleton.js';

interface AddRemoteProjectDialogProps {
  onClose: () => void;
  onSubmit: (input: {
    host: string;
    user?: string;
    remotePath?: string;
    proxyJump?: string;
    name?: string;
  }) => Promise<{ id: string } | null>;
  onSuccess: (projectId: string) => void;
}

/**
 * Modal that lists SSH hosts from `~/.ssh/config` and lets the user pick
 * one to register as a remote-backed Project. Threads run on a host daemon
 * installed later from the composer.
 * No mutation of the user's ssh config — read-only list.
 */
export function AddRemoteProjectDialog({ onClose, onSubmit, onSuccess }: AddRemoteProjectDialogProps) {
  const [hosts, setHosts] = useState<SshHostEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [user, setUser] = useState('');
  const [remotePath, setRemotePath] = useState('');
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
        : product.ssh.listHosts().then((hosts) => ({ hosts, warning: undefined }));
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
      loadSeq.current++;
    };
  }, [loadHosts]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitting, onClose]);

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
  }, [filter, hosts]);

  const pickHost = (alias: string) => {
    if (submitting) return;
    setPicked(alias);
    if (!name.trim()) setName(alias);
    const entry = hosts?.find((h) => h.alias === alias);
    setProxyJump(entry?.proxyJump ?? '');
  };

  const canSubmit = picked !== null && !submitting;

  const submit = async () => {
    if (!picked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await onSubmit({
        host: picked,
        user: user.trim() || undefined,
        remotePath: remotePath.trim() || undefined,
        proxyJump: proxyJump.trim() || undefined,
        name: name.trim() || undefined
      });
      if (!project) {
        setError('Could not add remote project');
        return;
      }
      onSuccess(project.id);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AddRemoteProjectDialogView
      hosts={hosts}
      filtered={filtered}
      filter={filter}
      loading={loading}
      warning={warning}
      error={error}
      picked={picked}
      name={name}
      user={user}
      remotePath={remotePath}
      proxyJump={proxyJump}
      busy={submitting}
      canSubmit={canSubmit}
      onFilterChange={setFilter}
      onRefresh={() => loadHosts(true)}
      onPickHost={pickHost}
      onNameChange={setName}
      onUserChange={setUser}
      onRemotePathChange={setRemotePath}
      onProxyJumpChange={setProxyJump}
      onSubmit={() => void submit()}
      onClose={onClose}
    />
  );
}

export function AddRemoteProjectDialogView({
  hosts,
  filtered,
  filter,
  loading,
  warning,
  error,
  picked,
  name,
  user,
  remotePath,
  proxyJump,
  busy,
  canSubmit,
  onFilterChange,
  onRefresh,
  onPickHost,
  onNameChange,
  onUserChange,
  onRemotePathChange,
  onProxyJumpChange,
  onSubmit,
  onClose
}: {
  hosts: SshHostEntry[] | null;
  filtered: SshHostEntry[];
  filter: string;
  loading: boolean;
  warning: string | null;
  error: string | null;
  picked: string | null;
  name: string;
  user: string;
  remotePath: string;
  proxyJump: string;
  busy: boolean;
  canSubmit: boolean;
  onFilterChange: (value: string) => void;
  onRefresh: () => void;
  onPickHost: (alias: string) => void;
  onNameChange: (value: string) => void;
  onUserChange: (value: string) => void;
  onRemotePathChange: (value: string) => void;
  onProxyJumpChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal remote-project-modal" role="dialog" aria-modal="true" aria-label="Add remote project">
        <div className="modal-header">
          <h3>Add remote project</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="list-filter">
            <Search size={12} className="list-filter-icon" />
            <input
              placeholder="Filter hosts"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              autoFocus
              disabled={busy}
            />
          </div>

          <div className="remote-host-hint-row">
            <div className="modal-hint">
              Showing hosts from <code>~/.ssh/config</code>. Threads run on a host daemon installed on that box.
            </div>
            <button
              type="button"
              className="remote-host-refresh"
              onClick={onRefresh}
              disabled={loading || busy}
              title="Refresh SSH hosts from the configured provider"
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
            {filtered.map((h) => (
              <button
                key={h.alias}
                type="button"
                className={`remote-host-row ${picked === h.alias ? 'active' : ''}`}
                onClick={() => onPickHost(h.alias)}
                disabled={busy}
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
                onChange={(e) => onNameChange(e.target.value)}
                placeholder={picked ?? 'pick a host first'}
                disabled={!picked || busy}
              />
            </label>
            <label className="remote-form-row">
              <span>User (optional)</span>
              <input
                value={user}
                onChange={(e) => onUserChange(e.target.value)}
                placeholder="defaults to ~/.ssh/config"
                disabled={!picked || busy}
              />
            </label>
            <label className="remote-form-row">
              <span>Start path (optional)</span>
              <input
                value={remotePath}
                onChange={(e) => onRemotePathChange(e.target.value)}
                placeholder="defaults to Settings remote path, else remote $HOME"
                disabled={!picked || busy}
              />
            </label>
            <label className="remote-form-row">
              <span>Jump host (optional)</span>
              <input
                value={proxyJump}
                onChange={(e) => onProxyJumpChange(e.target.value)}
                placeholder="bastion for double-hop SSH, e.g. user@bastion"
                disabled={!picked || busy}
              />
            </label>
            <p className="modal-hint">
              Install the host daemon later from the composer. Send waits until that daemon is bound and online.
            </p>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" disabled={!canSubmit} onClick={onSubmit}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
