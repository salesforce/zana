import { product } from '../lib/product-client.js';
/**
 * "Install from repo" dialog — installs a shared extension straight from a git
 * repository. The user gives a repo URL (+ optional branch/tag and subfolder);
 * on submit we ask main to `install({kind:'git',...})`. Main owns the whole
 * trust path: it clones (shallow), locates `extension.json`, scrubs symlinks/
 * `.git`, and funnels the tree through the single `installFromDir` seam — so the
 * deny-by-default broker + P3-D consent fire exactly as for a local dir. The url/
 * ref/subdir the renderer passes are ADVISORY hints; main re-validates everything
 * (Rule 1).
 *
 * There is NO trust fast-path for repo installs: once installed, the consent
 * overlay (ExtensionConsent) shows a loud remote-origin provenance line before
 * the code runs.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GitBranch, Download, FolderOpen } from 'lucide-react';
import { useDialogFocusTrap } from '../hooks/useDialogFocusTrap.js';

interface Props {
  onClose: () => void;
  mode?: 'install' | 'open';
}

/** Map a typed install failure code to a one-line, human explanation. */
function friendly(code: string | undefined, message: string): string {
  switch (code) {
    case 'BAD_SOURCE':
      return 'That doesn’t look like a valid git URL.';
    case 'CLONE_FAILED':
      return 'Could not clone the repository. Check the URL, branch/tag, and your access.';
    case 'MANIFEST_NOT_FOUND':
      return 'No extension.json found in the repo. If it’s in a subfolder, set the Subfolder field.';
    case 'AMBIGUOUS_MANIFEST':
      return 'Multiple extensions found. Set the Subfolder field to pick one.';
    case 'BAD_SUBDIR':
      return 'That subfolder is outside the repository.';
    case 'UNSAFE_TREE':
      return 'The repo contains symlinks and can’t be installed safely.';
    case 'WRITE_FAILED':
      return 'Installed, but the provenance record couldn’t be written; the install was rolled back.';
    default:
      return message || 'Install failed.';
  }
}

export function InstallFromGitDialog({ onClose, mode = 'install' }: Props) {
  const [url, setUrl] = useState('');
  const [ref, setRef] = useState('');
  const [subdir, setSubdir] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useDialogFocusTrap(dialogRef, onClose);
  useEffect(() => {
    urlRef.current?.focus();
  }, []);

  // Stream clone/install progress while a submit is in flight (main fires
  // fire-and-forget lines via IPC.extensions.installProgress).
  useEffect(() => {
    if (!busy) return;
    const off = product.extensions.onInstallProgress((line) => setProgress(line));
    return off;
  }, [busy]);

  const trimmedUrl = url.trim();
  const canSubmit = !!trimmedUrl && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const res =
        mode === 'open'
          ? await product.extensions.adoptLocalGit({
              url: trimmedUrl,
              ref: ref.trim() || undefined,
              subdir: subdir.trim() || undefined
            })
          : await product.extensions.install({
              kind: 'git',
              url: trimmedUrl,
              ref: ref.trim() || undefined,
              subdir: subdir.trim() || undefined
            });
      if (!res.ok) {
        setError(friendly(res.code, res.message));
        setBusy(false);
        return;
      }
      // Success: the onChanged push refreshes the hub; the consent overlay (with
      // the loud remote-origin line) fires from the app shell if it declares
      // permissions or is a git install.
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const chooseFolder = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await product.extensions.adoptLocal();
      if (!res.ok) {
        if (res.code !== 'CANCELED') setError(res.message ?? 'Could not open folder');
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const isOpen = mode === 'open';

  return createPortal(
    <div className="palette-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        ref={dialogRef}
        className="palette launch-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
          aria-label={isOpen ? 'Open an existing extension' : 'Install an extension from a repository'}
      >
        <div className="launch-panel">
          <div className="launch-header">
            <h3>
              <GitBranch size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              {isOpen ? 'Open existing plugin' : 'Install from repo'}
            </h3>
            <p>
              {isOpen
                ? 'Clone a Git repository into your extension workspace, then keep working in that checkout. You can also choose an existing local folder.'
                : 'Install a shared extension straight from a git repository. The code is not reviewed by Zana — you’ll be asked to approve what it can do before it runs.'}
            </p>
          </div>

          <div className="launch-row">
            <span className="launch-row-label">Repo URL</span>
            <input
              ref={urlRef}
              className="ext-create-input"
              style={{ flex: 1 }}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) submit();
              }}
              placeholder="https://github.com/user/repo"
              maxLength={512}
              disabled={busy}
            />
          </div>

          <div className="launch-row">
            <span className="launch-row-label">Branch or tag</span>
            <input
              className="ext-create-input"
              style={{ flex: 1 }}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) submit();
              }}
              placeholder="main (optional)"
              maxLength={256}
              disabled={busy}
            />
          </div>

          <div className="launch-row">
            <span className="launch-row-label">Subfolder</span>
            <input
              className="ext-create-input"
              style={{ flex: 1 }}
              value={subdir}
              onChange={(e) => setSubdir(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) submit();
              }}
              placeholder="path/to/extension (optional)"
              maxLength={256}
              disabled={busy}
            />
          </div>

          {busy && progress && (
            <p className="settings-help settings-help--muted" style={{ marginTop: 4 }}>
              {progress}
            </p>
          )}

          {error && <div className="launch-error" role="alert">{error}</div>}

          <div className="launch-actions">
            {isOpen && (
              <button className="btn" onClick={chooseFolder} disabled={busy}>
                <FolderOpen size={14} />
                Choose folder…
              </button>
            )}
            <button className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn primary" onClick={submit} disabled={!canSubmit}>
              <Download size={14} />
              {busy ? (isOpen ? 'Cloning…' : 'Installing…') : isOpen ? 'Clone and open' : 'Install'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
