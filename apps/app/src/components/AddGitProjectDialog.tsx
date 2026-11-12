import { SetupFrame, useSetupBusy, useSetupPage } from './setup/SetupFrame.js';
import { product } from '../lib/product-client.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch } from 'lucide-react';
import type { CloneProjectResult } from '@zana-ai/zcc-domain/product';
import { explainGitCloneError, type GitCloneError } from '../lib/git-clone-error.js';

interface AddGitProjectDialogProps {
  fixedHostId?: string;
  fixedMachineName?: string;
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
export function AddGitProjectDialog({ onClose, onClone, onSuccess, fixedHostId, fixedMachineName }: AddGitProjectDialogProps) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  // The user can edit the name; once they do, stop auto-deriving from the URL.
  const [nameTouched, setNameTouched] = useState(false);
  const [cloneRoot, setCloneRoot] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const page = useSetupPage();
  useSetupBusy(submitting);
  const [error, setError] = useState<GitCloneError | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    product.projects.cloneRoot(fixedHostId).then(root => { if (!cancelled) setCloneRoot(root); }).catch(() => {});
    return () => { cancelled = true; };
  }, [fixedHostId]);

  // Legacy progress events have no operation id. Setup tabs use their own busy state
  // so concurrent clones cannot show each other's output.
  useEffect(() => {
    if (!submitting || page) return;
    const off = product.projects.onCloneProgress((line) => setProgress(line));
    return off;
  }, [submitting, page]);

  useEffect(() => {
    if (page) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting, page]);

  const derived = useMemo(() => deriveName(url), [url]);
  const effectiveName = nameTouched ? name : derived;
  const destPreview = cloneRoot && effectiveName ? `${cloneRoot.replace(/[\\/]$/, '')}${cloneRoot.includes('\\') ? '\\' : '/'}${effectiveName}` : null;

  const urlRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    urlRef.current?.focus();
  }, []);

  const canSubmit = url.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setProgress(page ? 'Cloning repository…' : 'Starting clone…');
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
      setProgress(null);
      setError(explainGitCloneError(result.message, result.code));
    } catch (err) {
      setProgress(null);
      setError(explainGitCloneError(err instanceof Error ? err.message : 'Clone failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return <SetupFrame title="Import from Git" onClose={onClose} closeOnBackdrop={!submitting} className="git-project-modal"
    footer={<>
          <button className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="btn primary" disabled={!canSubmit} onClick={submit}>
            {submitting ? 'Cloning…' : error ? 'Try again' : 'Clone & add'}
          </button>
    </>}>

          <div className="modal-hint">
            Paste a repository URL to clone and add it as a project. Uses your Git
            credentials (SSH keys or credential helper). Private repositories need an account with access.
          </div>
          {fixedMachineName && <p className="modal-hint">Machine: <strong>{fixedMachineName}</strong></p>}

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

          {error && (
            <div className="modal-error git-project-error" role="alert">
              <strong>{error.title}</strong>
              {error.guidance.map(line => <p key={line}>{line}</p>)}
              <details>
                <summary>Git details</summary>
                <pre>{error.details}</pre>
              </details>
            </div>
          )}
          {!error && progress && (
            <div className="git-clone-progress" aria-live="polite">
              <span className="git-clone-spinner" aria-hidden="true" />
              <span className="git-clone-progress-text">{progress}</span>
            </div>
          )}
  </SetupFrame>;
}
