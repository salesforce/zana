import { useEffect, useRef, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';

interface AddLocalProjectDialogProps {
  onClose: () => void;
  /** Browse via the native folder picker; null if the user cancels. */
  onBrowse: () => Promise<string | null>;
  /** Add a project at an arbitrary path (typed by hand, or filled in by Browse). */
  onSubmit: (path: string) => Promise<{ id: string } | null>;
}

/**
 * Modal for adding a local-folder project: either browse via the native
 * dialog, or type a path directly. The manual field exists because
 * `dialog.showOpenDialog` can't be pointed at a location outside the app's
 * sandboxed picker roots on every OS/config, and because typing/pasting is
 * faster when the path is already known (e.g. copied from a terminal).
 * `store.addProject` (see main/store.ts) accepts any directory — this dialog
 * doesn't add its own location restriction.
 */
export function AddLocalProjectDialog({ onClose, onBrowse, onSubmit }: AddLocalProjectDialogProps) {
  const [path, setPath] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  const browse = async () => {
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
      const project = await onSubmit(path.trim());
      if (project) {
        onClose();
        return;
      }
      // addProject/addProjectByPath already toast the failure reason; keep the
      // dialog open so the user can adjust the path without retyping.
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
                onClick={browse}
                disabled={submitting}
                aria-label="Browse for folder"
              >
                <FolderOpen size={13} />
                <span>Browse…</span>
              </button>
            </div>
          </label>

          {error && <div className="modal-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={submitting}>
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
