import { useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, X } from 'lucide-react';
import type { CloneProjectResult } from '@zana-ai/zcc-domain/product';

interface AddGitProjectDialogProps {
  onClose: () => void;
  /** Clone + register. Resolves to the result so the dialog can branch on
   *  DEST_EXISTS / failures inline. */
  onClone: (input: { url: string; name?: string }) => Promise<CloneProjectResult>;
  /** Called with the new project's id once a clone fully succeeds, so the
   *  parent can select it. */
  onSuccess: (projectId: string) => void;
}

/** Derive the same folder name the main process will (last path segment, minus
 *  `.git`) so the editable name field and destination preview are accurate
 *  before the clone runs. Best-effort: a parse miss just shows an empty name. */
function deriveName(url: string): string {
  const raw = url.trim();
  if (!raw) return '';
  // scp-style git@host:owner/repo.git
  const scp = raw.match(/^[^@\s]+@[^:\s]+:(.+)$/);
  const tailFrom = (s: string) => (s.split('/').filter(Boolean).pop() ?? '').replace(/\.git$/i, '');
  let tail = '';
  if (scp) {
    tail = tailFrom(scp[1]);
  } else if (/^(https?|ssh|git):\/\//i.test(raw)) {
    try {
      tail = tailFrom(new URL(raw).pathname);
    } catch {
      tail = '';
    }
  } else {
    const short = raw.match(/^[\w.-]+\/([\w.-]+?)(?:\.git)?$/);
    if (short && !raw.includes('//')) tail = short[1];
  }
  // Mirror safeSegment: drop separators + leading dot/dash.
  return tail.replace(/[/\\]/g, '').replace(/^[.\-]+/, '').trim();
}

/**
 * Modal to import a project from a git URL: paste a repo link, optionally rename
 * the folder, and clone it into the clone root. Live `git clone --progress`
 * lines stream into the footer while the clone runs. Mirrors
 * AddRemoteProjectDialog's structure so the two add-flows feel consistent.
 */
export function AddGitProjectDialog({ onClose, onClone, onSuccess }: AddGitProjectDialogProps) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  // The user can edit the name; once they do, stop auto-deriving from the URL.
  const [nameTouched, setNameTouched] = useState(false);
  const [cloneRoot, setCloneRoot] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    window.cc.projects.cloneRoot().then(setCloneRoot).catch(() => {});
  }, []);

  // Stream clone progress into the footer line.
  useEffect(() => {
    const off = window.cc.projects.onCloneProgress((line) => setProgress(line));
    return off;
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const derived = useMemo(() => deriveName(url), [url]);
  const effectiveName = nameTouched ? name : derived;
  const destPreview = cloneRoot && effectiveName ? `${cloneRoot}/${effectiveName}` : null;

  const urlRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    urlRef.current?.focus();
  }, []);

  const canSubmit = url.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setProgress('Starting clone…');
    try {
      const result = await onClone({
        url: url.trim(),
        name: nameTouched && name.trim() ? name.trim() : undefined
      });
      if (result.ok) {
        onSuccess(result.project.id);
        onClose();
        return;
      }
      // Failure: surface inline. DEST_EXISTS gets a more specific hint.
      setProgress(null);
      setError(
        result.code === 'DEST_EXISTS'
          ? `${result.message}. Rename the project or remove that folder, then try again.`
          : result.message
      );
    } catch (err) {
      setProgress(null);
      setError(err instanceof Error ? err.message : 'Clone failed');
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
      <div
        className="modal git-project-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Import from Git"
      >
        <div className="modal-header">
          <h3>Import from Git</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={submitting}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-hint">
            Paste a repository URL — it&rsquo;ll be cloned into your workspace and added as a
            project. Uses your existing git auth (SSH keys, credential helper).
          </div>

          <label className="remote-form-row git-url-row">
            <span>Repository URL</span>
            <input
              ref={urlRef}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) submit();
              }}
              placeholder="https://github.com/owner/repo"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              disabled={submitting}
            />
          </label>

          <label className="remote-form-row">
            <span>Project name</span>
            <input
              value={effectiveName}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
              placeholder={derived || 'derived from URL'}
              disabled={submitting}
            />
          </label>

          {destPreview && (
            <div className="git-dest-preview" title={destPreview}>
              <GitBranch size={12} />
              <span>Clones to&nbsp;</span>
              <code>{destPreview}</code>
            </div>
          )}

          {error && <div className="modal-error">{error}</div>}
          {!error && progress && (
            <div className="git-clone-progress" aria-live="polite">
              <span className="git-clone-spinner" aria-hidden="true" />
              <span className="git-clone-progress-text">{progress}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="btn primary" disabled={!canSubmit} onClick={submit}>
            {submitting ? 'Cloning…' : 'Clone & add'}
          </button>
        </div>
      </div>
    </div>
  );
}
