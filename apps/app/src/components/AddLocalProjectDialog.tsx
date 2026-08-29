import { useEffect, useRef, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { HostMachinePicker } from './HostMachinePicker.js';
import { defaultHostId, useHosts } from '../hooks/useHosts.js';
import { product } from '../lib/product-client.js';

interface AddLocalProjectDialogProps {
  onClose: () => void;
  /** Browse via the native folder picker; null if the user cancels. */
  onBrowse: () => Promise<string | null>;
  /** Add a project at an arbitrary path (typed by hand, or filled in by Browse). */
  onSubmit: (path: string, hostId?: string) => Promise<{ id: string } | null>;
}

/**
 * Modal for adding a local-folder project: either browse via the native
 * dialog, or type a path directly. When more than one host daemon is
 * connected, pick the machine first — remote hosts browse via host-rpc
 * instead of the laptop's native picker.
 */
export function AddLocalProjectDialog({ onClose, onBrowse, onSubmit }: AddLocalProjectDialogProps) {
  const hosts = useHosts();
  const [hostId, setHostId] = useState<string | undefined>();
  const [path, setPath] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Array<{ kind: 'file' | 'directory'; name: string; path: string }>>([]);
  const [parent, setParent] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectedHost = hosts.find((host) => host.id === (hostId ?? defaultHostId(hosts)));
  const remoteBrowse = Boolean(selectedHost && !selectedHost.isPrimary);

  useEffect(() => {
    setHostId(defaultHostId(hosts));
  }, [hosts]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const canSubmit = path.trim().length > 0 && !submitting;

  const loadDirectory = async (nextPath?: string) => {
    if (!selectedHost) return;
    try {
      const listing = await product.hosts.directory(selectedHost.id, nextPath);
      setPath(listing.directory);
      setParent(listing.parent);
      setEntries(listing.entries.filter((entry) => entry.kind === 'directory'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not list that directory');
    }
  };

  const browse = async () => {
    if (remoteBrowse) {
      await loadDirectory(path.trim() || undefined);
      return;
    }
    const picked = await onBrowse();
    if (picked) {
      setPath(picked);
      setError(null);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await onSubmit(
        path.trim(),
        selectedHost && !selectedHost.isPrimary ? selectedHost.id : undefined
      );
      if (project) {
        onClose();
        return;
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="modal local-project-modal" role="dialog" aria-modal="true" aria-label="Add local project">
        <div className="modal-header">
          <h3>Add local project</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={submitting}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-hint">
            Pick a folder, or type/paste an absolute path (e.g. from a terminal).
          </div>

          <HostMachinePicker hosts={hosts} value={hostId} onChange={setHostId} />

          <label className="remote-form-row local-path-row">
            <span>Folder path</span>
            <div className="local-path-input-group">
              <input
                ref={inputRef}
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmit) submit();
                }}
                placeholder="/path/to/project"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                disabled={submitting}
              />
              <button
                type="button"
                className="btn"
                onClick={() => void browse()}
                disabled={submitting}
                aria-label="Browse for folder"
              >
                <FolderOpen size={13} />
                <span>Browse…</span>
              </button>
            </div>
          </label>

          {remoteBrowse && entries.length > 0 && (
            <ul className="host-directory-list" data-testid="host-directory-list">
              {parent ? (
                <li>
                  <button type="button" className="btn" onClick={() => void loadDirectory(parent)}>
                    ..
                  </button>
                </li>
              ) : null}
              {entries.map((entry) => (
                <li key={entry.path}>
                  <button type="button" className="btn" onClick={() => void loadDirectory(entry.path)}>
                    {entry.name}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && <div className="modal-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="btn primary" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? 'Adding…' : 'Add project'}
          </button>
        </div>
      </div>
    </div>
  );
}
