import { product } from '../lib/product-client.js';
import { hasDesktopBridge } from '../lib/app-surface.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import type { SshHostEntry } from '@zana-ai/zcc-domain/product';
import { bootstrapOutcome } from './composer-host-status.js';
import { collectBootstrapLogs, remoteAddSubmitLabel } from './add-remote-project.js';
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
 * one to register as a remote-backed Project. Threads can run on this
 * machine with SSH tools, or on a host daemon installed over SSH.
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
  const [installHost, setInstallHost] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [pairingCommand, setPairingCommand] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadSeq = useRef(0);

  const busy = submitting || installing;

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
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

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
    if (busy || createdId) return;
    setPicked(alias);
    if (!name.trim()) setName(alias);
    const entry = hosts?.find((h) => h.alias === alias);
    setProxyJump(entry?.proxyJump ?? '');
  };

  const finish = (projectId: string) => {
    onSuccess(projectId);
    onClose();
  };

  const installDaemon = async (projectId: string) => {
    setInstalling(true);
    setError(null);
    setPairingCommand(null);
    setInstallLogs(['Installing host daemon over SSH…']);
    try {
      const events = await product.hosts.bootstrap(projectId);
      setInstallLogs(collectBootstrapLogs(events));
      const outcome = bootstrapOutcome(events);
      if (outcome.ok) {
        finish(projectId);
        return;
      }
      setError(outcome.message);
      setPairingCommand(outcome.pairingCommand ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not install host daemon');
    } finally {
      setInstalling(false);
    }
  };

  const canSubmit = picked !== null && !busy;

  const submit = async () => {
    if (!picked || busy) return;
    if (createdId) {
      if (installHost) await installDaemon(createdId);
      else finish(createdId);
      return;
    }
    setSubmitting(true);
    setError(null);
    setPairingCommand(null);
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
      setCreatedId(project.id);
      if (!installHost) {
        finish(project.id);
        return;
      }
      await installDaemon(project.id);
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
      installHost={installHost}
      created={Boolean(createdId)}
      busy={busy}
      installing={installing}
      installLogs={installLogs}
      pairingCommand={pairingCommand}
      canSubmit={canSubmit}
      onFilterChange={setFilter}
      onRefresh={() => loadHosts(true)}
      onPickHost={pickHost}
      onNameChange={setName}
      onUserChange={setUser}
      onRemotePathChange={setRemotePath}
      onProxyJumpChange={setProxyJump}
      onInstallHostChange={setInstallHost}
      onSubmit={() => void submit()}
      onSkip={() => createdId && finish(createdId)}
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
  installHost,
  created,
  busy,
  installing,
  installLogs,
  pairingCommand,
  canSubmit,
  onFilterChange,
  onRefresh,
  onPickHost,
  onNameChange,
  onUserChange,
  onRemotePathChange,
  onProxyJumpChange,
  onInstallHostChange,
  onSubmit,
  onSkip,
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
  installHost: boolean;
  created: boolean;
  busy: boolean;
  installing: boolean;
  installLogs: string[];
  pairingCommand: string | null;
  canSubmit: boolean;
  onFilterChange: (value: string) => void;
  onRefresh: () => void;
  onPickHost: (alias: string) => void;
  onNameChange: (value: string) => void;
  onUserChange: (value: string) => void;
  onRemotePathChange: (value: string) => void;
  onProxyJumpChange: (value: string) => void;
  onInstallHostChange: (value: boolean) => void;
  onSubmit: () => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const fieldsLocked = busy || created;
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
              disabled={fieldsLocked}
            />
          </div>

          <div className="remote-host-hint-row">
            <div className="modal-hint">
              Showing hosts from <code>~/.ssh/config</code>. Threads can run on this machine with SSH tools, or on a remote host daemon.
            </div>
            <button
              type="button"
              className="remote-host-refresh"
              onClick={onRefresh}
              disabled={loading || fieldsLocked}
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
                disabled={fieldsLocked}
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
                disabled={!picked || fieldsLocked}
              />
            </label>
            <label className="remote-form-row">
              <span>User (optional)</span>
              <input
                value={user}
                onChange={(e) => onUserChange(e.target.value)}
                placeholder="defaults to ~/.ssh/config"
                disabled={!picked || fieldsLocked}
              />
            </label>
            <label className="remote-form-row">
              <span>Start path (optional)</span>
              <input
                value={remotePath}
                onChange={(e) => onRemotePathChange(e.target.value)}
                placeholder="defaults to Settings remote path, else remote $HOME"
                disabled={!picked || fieldsLocked}
              />
            </label>
            <label className="remote-form-row">
              <span>Jump host (optional)</span>
              <input
                value={proxyJump}
                onChange={(e) => onProxyJumpChange(e.target.value)}
                placeholder="bastion for double-hop SSH, e.g. user@bastion"
                disabled={!picked || fieldsLocked}
              />
            </label>
            <label className="remote-install-toggle">
              <input
                type="checkbox"
                checked={installHost}
                data-testid="remote-install-host"
                onChange={(e) => onInstallHostChange(e.target.checked)}
                disabled={fieldsLocked}
              />
              <span>Install host daemon on the remote machine</span>
            </label>
            <p className="modal-hint remote-install-hint">
              SSHs from this computer and enrolls a daemon so you can pick <strong>Remote machine</strong> in the composer. Uncheck to keep using this machine with SSH tools; you can install later from the composer.
            </p>
          </div>

          {installLogs.length > 0 ? (
            <pre className="remote-install-log" data-testid="remote-install-log">
              {installLogs.join('\n')}
            </pre>
          ) : null}
          {pairingCommand ? (
            <pre className="remote-install-log" data-testid="remote-pairing-command">
              {pairingCommand}
            </pre>
          ) : null}
        </div>

        <div className="modal-footer">
          {created && error && !installing ? (
            <button className="btn" onClick={onSkip}>
              Continue without daemon
            </button>
          ) : (
            <button className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          )}
          <button className="btn primary" disabled={!canSubmit} onClick={onSubmit}>
            {remoteAddSubmitLabel({
              installHost,
              installing,
              retry: created && installHost
            })}
          </button>
        </div>
      </div>
    </div>
  );
}
